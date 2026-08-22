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
    // Match if ANY edit's file_path matches the pattern
    return (pattern: string) =>
      edits.some((edit: { file_path: string }) =>
        matchWildcardPattern(pattern, edit.file_path),
      )
  },
  async checkPermissions(input, context): Promise<PermissionDecision> {
    const appState = context.getAppState()
    return checkWritePermissionForTool(
      MultiEditTool,
      input,
      appState.toolPermissionContext,
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

      // Read file
      let fileContent: string | null
      try {
        const fileBuffer = await fs.readFileBytes(fullFilePath)
        const encoding: BufferEncoding =
          fileBuffer.length >= 2 &&
          fileBuffer[0] === 0xff &&
          fileBuffer[1] === 0xfe
            ? 'utf16le'
            : 'utf8'
        fileContent = fileBuffer.toString(encoding).replaceAll('\r\n', '\n')
      } catch (e) {
        if (isENOENT(e)) {
          fileContent = null
        } else {
          throw e
        }
      }

      // File doesn't exist
      if (fileContent === null) {
        if (old_string === '') {
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

      // Check if file was modified since last read
      if (readTimestamp) {
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

    for (const edit of edits) {
      const {
        file_path,
        old_string,
        new_string,
        replace_all = false,
      } = edit
      const absoluteFilePath = expandPath(file_path)

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

      // Read current state
      const {
        content: originalFileContents,
        fileExists,
        encoding,
        lineEndings: endings,
      } = readFileForEdit(absoluteFilePath)

      if (fileExists) {
        const lastWriteTime = getFileModificationTime(absoluteFilePath)
        const lastRead = readFileState.get(absoluteFilePath)
        if (!lastRead || lastWriteTime > lastRead.timestamp) {
          const isFullRead =
            lastRead &&
            lastRead.offset === undefined &&
            lastRead.limit === undefined
          const contentUnchanged =
            isFullRead && originalFileContents === lastRead.content
          if (!contentUnchanged) {
            throw new Error(
              'File has been unexpectedly modified. Read it again before attempting to write it.',
            )
          }
        }
      }

      // Handle quote normalization
      const actualOldString =
        findActualString(originalFileContents, old_string) || old_string
      const actualNewString = preserveQuoteStyle(
        old_string,
        actualOldString,
        new_string,
      )

      // Generate patch and apply
      const { patch, updatedFile } = getPatchForEdit({
        filePath: absoluteFilePath,
        fileContents: originalFileContents,
        oldString: actualOldString,
        newString: actualNewString,
        replaceAll: replace_all,
      })

      // Write to disk
      writeTextContent(absoluteFilePath, updatedFile, encoding, endings)

      // Notify LSP servers
      const lspManager = getLspServerManager()
      if (lspManager) {
        clearDeliveredDiagnosticsForFile(`file://${absoluteFilePath}`)
        lspManager
          .changeFile(absoluteFilePath, updatedFile)
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

      // Notify VSCode
      notifyVscodeFileUpdated(
        absoluteFilePath,
        originalFileContents,
        updatedFile,
      )

      // Update read timestamp
      readFileState.set(absoluteFilePath, {
        content: updatedFile,
        timestamp: getFileModificationTime(absoluteFilePath),
        offset: undefined,
        limit: undefined,
      })

      // Log events
      if (absoluteFilePath.endsWith(`${sep}CLAUDE.md`)) {
        logEvent('tengu_write_claudemd', {})
      }
      countLinesChanged(patch)

      logFileOperation({
        operation: 'edit',
        tool: 'MultiEditTool',
        filePath: absoluteFilePath,
      })

      logEvent('tengu_edit_string_lengths', {
        oldStringBytes: Buffer.byteLength(old_string, 'utf8'),
        newStringBytes: Buffer.byteLength(new_string, 'utf8'),
        replaceAll: replace_all,
      })

      editedFilePaths.add(file_path)
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
