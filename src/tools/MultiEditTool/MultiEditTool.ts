import { dirname, sep } from 'path'
import { logEvent } from 'src/services/analytics/index.js'
import { diagnosticTracker } from '../../services/diagnosticTracking.js'
import { clearDeliveredDiagnosticsForFile } from '../../services/lsp/LSPDiagnosticRegistry.js'
import { getLspServerManager } from '../../services/lsp/manager.js'
import { notifyVscodeFileUpdated } from '../../services/mcp/vscodeSdkMcp.js'
import { checkTeamMemSecrets } from '../../services/teamMemorySync/teamMemSecretGuard.js'
import {
  activateConditionalSkillsForPaths,
  addSkillDirectories,
  discoverSkillDirsForPaths,
} from '../../skills/loadSkillsDir.js'
import type { ToolUseContext } from '../../Tool.js'
import { buildTool, type ToolDef } from '../../Tool.js'
import { getCwd } from '../../utils/cwd.js'
import { logForDebugging } from '../../utils/debug.js'
import { countLinesChanged } from '../../utils/diff.js'
import type { StructuredPatchHunk } from 'diff'
import { isEnvTruthy } from '../../utils/envUtils.js'
import { isENOENT } from '../../utils/errors.js'
import {
  FILE_NOT_FOUND_CWD_NOTE,
  findSimilarFile,
  getFileModificationTime,
  suggestPathUnderCwd,
  writeTextContent,
} from '../../utils/file.js'
import {
  fileHistoryEnabled,
  fileHistoryTrackEdit,
} from '../../utils/fileHistory.js'
import { logFileOperation } from '../../utils/fileOperationAnalytics.js'
import {
  type LineEndingType,
  readFileSyncWithMetadata,
} from '../../utils/fileRead.js'
import { formatFileSize } from '../../utils/format.js'
import { getFsImplementation } from '../../utils/fsOperations.js'
import { logError } from '../../utils/log.js'
import { expandPath } from '../../utils/path.js'
import {
  checkWritePermissionForTool,
  matchingRuleForInput,
} from '../../utils/permissions/filesystem.js'
import type { PermissionDecision } from '../../utils/permissions/PermissionResult.js'
import { matchWildcardPattern } from '../../utils/permissions/shellRuleMatching.js'
import { validateInputForSettingsFileEdit } from '../../utils/settings/validateEditTool.js'
import { NOTEBOOK_EDIT_TOOL_NAME } from '../NotebookEditTool/constants.js'
import {
  findActualString,
  getPatchForEdit,
  preserveQuoteStyle,
} from '../FileEditTool/utils.js'
import { MULTI_EDIT_TOOL_NAME } from './constants.js'
import { getMultiEditToolDescription } from './prompt.js'
import {
  type MultiEditInput,
  type MultiEditOutput,
  inputSchema,
  outputSchema,
} from './types.js'
import {
  getToolUseSummary,
  renderToolResultMessage,
  renderToolUseErrorMessage,
  renderToolUseMessage,
  renderToolUseRejectedMessage,
  userFacingName,
} from './UI.js'

const MAX_EDIT_FILE_SIZE = 1024 * 1024 * 1024 // 1 GiB (stat bytes)

function readFileForEdit(absoluteFilePath: string): {
  content: string
  fileExists: boolean
  encoding: BufferEncoding
  lineEndings: LineEndingType
} {
  try {
    // eslint-disable-next-line custom-rules/no-sync-fs
    const meta = readFileSyncWithMetadata(absoluteFilePath)
    return {
      content: meta.content,
      fileExists: true,
      encoding: meta.encoding,
      lineEndings: meta.lineEndings,
    }
  } catch (e) {
    if (isENOENT(e)) {
      return {
        content: '',
        fileExists: false,
        encoding: 'utf8',
        lineEndings: 'LF',
      }
    }
    throw e
  }
}

export const MultiEditTool = buildTool({
  name: MULTI_EDIT_TOOL_NAME,
  searchHint: 'atomic multi-file edits validated before applying',
  maxResultSizeChars: 100_000,
  strict: true,
  async description() {
    return 'A tool for performing atomic multi-file edits'
  },
  async prompt() {
    return getMultiEditToolDescription()
  },
  userFacingName,
  getToolUseSummary,
  getActivityDescription(input) {
    const summary = getToolUseSummary(input)
    return summary ? `Editing ${summary}` : 'Editing multiple files'
  },
  get inputSchema() {
    return inputSchema()
  },
  get outputSchema() {
    return outputSchema()
  },
  toAutoClassifierInput(input) {
    if (!input.edits?.length) return ''
    return input.edits
      .map(
        (e: { file_path: string; new_string: string }) =>
          `${e.file_path}: ${e.new_string}`,
      )
      .join('\n')
  },
  getPath(input): string {
    // Return the first file path for permission matching
    return input.edits?.[0]?.file_path ?? ''
  },
  backfillObservableInput(input) {
    if (Array.isArray(input.edits)) {
      for (const edit of input.edits) {
        if (typeof edit.file_path === 'string') {
          edit.file_path = expandPath(edit.file_path)
        }
      }
    }
  },
  async preparePermissionMatcher({ edits }) {
    // Require EVERY edit's file_path to match the pattern so a single matching
    // path can't satisfy the matcher for the whole batch.
    return (pattern: string) =>
      edits.every((edit: { file_path: string }) =>
        matchWildcardPattern(pattern, edit.file_path),
      )
  },
  async checkPermissions(input, context): Promise<PermissionDecision> {
    const appState = context.getAppState()
    // Fail closed: an empty batch is never allowed to proceed. (validateInput
    // also rejects it, but the permission gate should not approve anything.)
    if (!input.edits || input.edits.length === 0) {
      return {
        behavior: 'deny',
        message: 'No edits provided.',
        decisionReason: { type: 'other', reason: 'empty edits array' },
      }
    }
    // Evaluate the permission decision for every distinct edit path and combine
    // the results: any deny wins, then any ask, and allow only when every path
    // allows. A batch whose first edit targets an allowed path must not write
    // arbitrary other paths in the same call.
    const paths = [
      ...new Set(input.edits.map(e => expandPath(e.file_path))),
    ]
    let pendingAsk: PermissionDecision | undefined
    for (const path of paths) {
      const decision = checkWritePermissionForTool(
        { ...MultiEditTool, getPath: () => path },
        input,
        appState.toolPermissionContext,
      )
      if (decision.behavior === 'deny') {
        return decision
      }
      if (decision.behavior === 'ask' && !pendingAsk) {
        pendingAsk = decision
      }
    }
    return (
      pendingAsk ?? {
        behavior: 'allow',
        updatedInput: input,
      }
    )
  },
  renderToolUseMessage,
  renderToolResultMessage,
  renderToolUseRejectedMessage,
  renderToolUseErrorMessage,
  async validateInput(input: MultiEditInput, toolUseContext: ToolUseContext) {
    const { edits } = input
    if (!edits || edits.length === 0) {
      return {
        result: false,
        message: 'No edits provided.',
        errorCode: 0,
      }
    }

    const errors: string[] = []
    // Accumulated per-file content so edits to the same file validate against
    // the result of earlier edits in the batch (mirrors how call() applies
    // them in order).
    const accumulatedContent = new Map<string, string>()

    for (let i = 0; i < edits.length; i++) {
      const edit = edits[i]!
      const { file_path, old_string, new_string, replace_all = false } = edit
      const fullFilePath = expandPath(file_path)
      const editLabel = `Edit ${i + 1} (${file_path})`

      // Check for secrets
      const secretError = checkTeamMemSecrets(fullFilePath, new_string)
      if (secretError) {
        errors.push(`${editLabel}: ${secretError}`)
        continue
      }

      if (old_string === new_string) {
        errors.push(
          `${editLabel}: No changes to make: old_string and new_string are exactly the same.`,
        )
        continue
      }

      // Check deny rules
      const appState = toolUseContext.getAppState()
      const denyRule = matchingRuleForInput(
        fullFilePath,
        appState.toolPermissionContext,
        'edit',
        'deny',
      )
      if (denyRule !== null) {
        errors.push(
          `${editLabel}: File is in a directory that is denied by your permission settings.`,
        )
        continue
      }

      // Skip UNC paths
      if (fullFilePath.startsWith('\\\\') || fullFilePath.startsWith('//')) {
        continue
      }

      const fs = getFsImplementation()

      // Check file size
      try {
        const { size } = await fs.stat(fullFilePath)
        if (size > MAX_EDIT_FILE_SIZE) {
          errors.push(
            `${editLabel}: File is too large to edit (${formatFileSize(size)}).`,
          )
          continue
        }
      } catch (e) {
        if (!isENOENT(e)) {
          throw e
        }
      }

      // Read file — reuse call()'s decode contract (full encoding detection)
      // and the accumulated content from earlier edits to the same file.
      let fileContent: string | null
      if (accumulatedContent.has(fullFilePath)) {
        fileContent = accumulatedContent.get(fullFilePath)!
      } else {
        const { content, fileExists } = readFileForEdit(fullFilePath)
        fileContent = fileExists ? content : null
      }

      // File doesn't exist
      if (fileContent === null) {
        if (old_string === '') {
          accumulatedContent.set(fullFilePath, '')
          continue // New file creation is valid
        }
        const similarFilename = findSimilarFile(fullFilePath)
        const cwdSuggestion = await suggestPathUnderCwd(fullFilePath)
        let message = `${editLabel}: File does not exist. ${FILE_NOT_FOUND_CWD_NOTE} ${getCwd()}.`
        if (cwdSuggestion) {
          message += ` Did you mean ${cwdSuggestion}?`
        } else if (similarFilename) {
          message += ` Did you mean ${similarFilename}?`
        }
        errors.push(message)
        continue
      }

      // File exists with empty old_string
      if (old_string === '') {
        if (fileContent.trim() !== '') {
          errors.push(
            `${editLabel}: Cannot create new file - file already exists.`,
          )
        }
        continue
      }

      if (fullFilePath.endsWith('.ipynb')) {
        errors.push(
          `${editLabel}: File is a Jupyter Notebook. Use the ${NOTEBOOK_EDIT_TOOL_NAME} to edit this file.`,
        )
        continue
      }

      // Check if file has been read
      const readTimestamp = toolUseContext.readFileState.get(fullFilePath)
      if (!readTimestamp || readTimestamp.isPartialView) {
        errors.push(
          `${editLabel}: File has not been read yet. Read it first before writing to it.`,
        )
        continue
      }

      // Check if file was modified since last read (skipped for edits to a
      // file already edited earlier in this batch — accumulatedContent is the
      // source of truth for those, not the untouched disk copy).
      if (readTimestamp && !accumulatedContent.has(fullFilePath)) {
        const lastWriteTime = getFileModificationTime(fullFilePath)
        if (lastWriteTime > readTimestamp.timestamp) {
          const isFullRead =
            readTimestamp.offset === undefined &&
            readTimestamp.limit === undefined
          if (!(isFullRead && fileContent === readTimestamp.content)) {
            errors.push(
              `${editLabel}: File has been modified since read. Read it again before attempting to write it.`,
            )
            continue
          }
        }
      }

      // Verify old_string exists
      const actualOldString = findActualString(fileContent, old_string)
      if (!actualOldString) {
        errors.push(
          `${editLabel}: String to replace not found in file.\nString: ${old_string}`,
        )
        continue
      }

      // Check uniqueness
      const matches = fileContent.split(actualOldString).length - 1
      if (matches > 1 && !replace_all) {
        errors.push(
          `${editLabel}: Found ${matches} matches of the string to replace, but replace_all is false. To replace all occurrences, set replace_all to true.`,
        )
        continue
      }

      // Additional validation for Claude settings files
      const settingsValidationResult = validateInputForSettingsFileEdit(
        fullFilePath,
        fileContent,
        () =>
          replace_all
            ? fileContent.replaceAll(actualOldString, new_string)
            : fileContent.replace(actualOldString, new_string),
      )
      if (settingsValidationResult !== null) {
        errors.push(`${editLabel}: ${settingsValidationResult.message}`)
        continue
      }

      // Apply the edit in memory so later edits to the same file validate
      // against the result (same order call() will apply them in).
      accumulatedContent.set(
        fullFilePath,
        replace_all
          ? fileContent.replaceAll(actualOldString, new_string)
          : fileContent.replace(actualOldString, new_string),
      )
    }

    if (errors.length > 0) {
      return {
        result: false,
        message: `Validation failed for ${errors.length} edit(s):\n${errors.join('\n')}`,
        errorCode: 0,
      }
    }

    return { result: true }
  },
  async call(
    input: MultiEditInput,
    {
      readFileState,
      updateFileHistoryState,
      dynamicSkillDirTriggers,
    },
    _,
    parentMessage,
  ) {
    const { edits } = input
    const fs = getFsImplementation()
    const cwd = getCwd()
    const editedFilePaths = new Set<string>()

    // Phase 1 — resolve every edit in memory. Edits to the same file are
    // applied to an accumulated copy so they compose in order. Nothing is
    // written to disk until every edit has resolved, keeping the batch
    // atomic: any failure below leaves the codebase untouched.
    type PendingFile = {
      initialContent: string
      content: string
      fileExists: boolean
      encoding: BufferEncoding
      lineEndings: LineEndingType
    }
    const pendingFiles = new Map<string, PendingFile>()
    const resolvedEdits: {
      filePath: string
      absoluteFilePath: string
      oldString: string
      newString: string
      replaceAll: boolean
      patch: StructuredPatchHunk[]
    }[] = []

    for (const edit of edits) {
      const {
        file_path,
        old_string,
        new_string,
        replace_all = false,
      } = edit
      const absoluteFilePath = expandPath(file_path)

      let pending = pendingFiles.get(absoluteFilePath)
      if (!pending) {
        const read = readFileForEdit(absoluteFilePath)
        pending = {
          initialContent: read.content,
          content: read.content,
          fileExists: read.fileExists,
          encoding: read.encoding,
          lineEndings: read.lineEndings,
        }
        pendingFiles.set(absoluteFilePath, pending)

        if (read.fileExists) {
          const lastWriteTime = getFileModificationTime(absoluteFilePath)
          const lastRead = readFileState.get(absoluteFilePath)
          if (!lastRead || lastWriteTime > lastRead.timestamp) {
            const isFullRead =
              lastRead &&
              lastRead.offset === undefined &&
              lastRead.limit === undefined
            const contentUnchanged =
              isFullRead && read.content === lastRead.content
            if (!contentUnchanged) {
              throw new Error(
                'File has been unexpectedly modified. Read it again before attempting to write it.',
              )
            }
          }
        }
      }

      // Handle quote normalization
      const actualOldString =
        findActualString(pending.content, old_string) || old_string
      const actualNewString = preserveQuoteStyle(
        old_string,
        actualOldString,
        new_string,
      )

      // Generate patch against accumulated content
      const { patch, updatedFile } = getPatchForEdit({
        filePath: absoluteFilePath,
        fileContents: pending.content,
        oldString: actualOldString,
        newString: actualNewString,
        replaceAll: replace_all,
      })

      pending.content = updatedFile
      resolvedEdits.push({
        filePath: file_path,
        absoluteFilePath,
        oldString: old_string,
        newString: new_string,
        replaceAll: replace_all,
        patch,
      })
    }

    // Phase 2 — every edit resolved, so apply them. Side effects for a given
    // file run once (on its first edit), using the file's final accumulated
    // content; per-edit telemetry is still emitted for every edit.
    const appliedFiles = new Set<string>()

    for (const {
      filePath,
      absoluteFilePath,
      oldString,
      newString,
      replaceAll,
      patch,
    } of resolvedEdits) {
      const pending = pendingFiles.get(absoluteFilePath)!

      if (!appliedFiles.has(absoluteFilePath)) {
        // Discover skills (fire-and-forget)
        if (!isEnvTruthy(process.env.CLAUDE_CODE_SIMPLE)) {
          const newSkillDirs = await discoverSkillDirsForPaths(
            [absoluteFilePath],
            cwd,
          )
          if (newSkillDirs.length > 0) {
            for (const dir of newSkillDirs) {
              dynamicSkillDirTriggers?.add(dir)
            }
            addSkillDirectories(newSkillDirs).catch(() => {})
          }
          activateConditionalSkillsForPaths([absoluteFilePath], cwd)
        }

        await diagnosticTracker.beforeFileEditedCompat(absoluteFilePath)

        // Ensure parent directory exists
        await fs.mkdir(dirname(absoluteFilePath))
        if (fileHistoryEnabled()) {
          await fileHistoryTrackEdit(
            updateFileHistoryState,
            absoluteFilePath,
            parentMessage.uuid,
          )
        }

        // Write final accumulated content to disk
        writeTextContent(
          absoluteFilePath,
          pending.content,
          pending.encoding,
          pending.lineEndings,
        )

        // Notify LSP servers
        const lspManager = getLspServerManager()
        if (lspManager) {
          clearDeliveredDiagnosticsForFile(`file://${absoluteFilePath}`)
          lspManager
            .changeFile(absoluteFilePath, pending.content)
            .catch((err: Error) => {
              logForDebugging(
                `LSP: Failed to notify server of file change for ${absoluteFilePath}: ${err.message}`,
              )
              logError(err)
            })
          lspManager.saveFile(absoluteFilePath).catch((err: Error) => {
            logForDebugging(
              `LSP: Failed to notify server of file save for ${absoluteFilePath}: ${err.message}`,
            )
            logError(err)
          })
        }

        // Notify VSCode with the on-disk state it last saw -> final content
        notifyVscodeFileUpdated(
          absoluteFilePath,
          pending.initialContent,
          pending.content,
        )

        // Update read timestamp
        readFileState.set(absoluteFilePath, {
          content: pending.content,
          timestamp: getFileModificationTime(absoluteFilePath),
          offset: undefined,
          limit: undefined,
        })

        // Log events
        if (
          absoluteFilePath.endsWith(`${sep}CLAUDE.md`) ||
          absoluteFilePath.endsWith(`${sep}AGENTS.md`)
        ) {
          logEvent('tengu_write_claudemd', {})
        }

        logFileOperation({
          operation: 'edit',
          tool: 'MultiEditTool',
          filePath: absoluteFilePath,
        })

        editedFilePaths.add(filePath)
        appliedFiles.add(absoluteFilePath)
      }

      countLinesChanged(patch)
      logEvent('tengu_edit_string_lengths', {
        oldStringBytes: Buffer.byteLength(oldString, 'utf8'),
        newStringBytes: Buffer.byteLength(newString, 'utf8'),
        replaceAll,
      })
    }

    const filePaths = [...editedFilePaths]

    return {
      data: {
        editCount: edits.length,
        filePaths,
      },
    }
  },
  mapToolResultToToolResultBlockParam(data: MultiEditOutput, toolUseID) {
    const { editCount, filePaths } = data
    return {
      tool_use_id: toolUseID,
      type: 'tool_result',
      content: `Successfully applied ${editCount} edit${editCount === 1 ? '' : 's'} across ${filePaths.length} file${filePaths.length === 1 ? '' : 's'}: ${filePaths.join(', ')}`,
    }
  },
} satisfies ToolDef<ReturnType<typeof inputSchema>, MultiEditOutput>)
