import { z } from 'zod/v4'
import { buildTool, type ToolDef } from '../../Tool.js'
import { getCwd } from '../../utils/cwd.js'
import { lazySchema } from '../../utils/lazySchema.js'
import { checkReadPermissionForTool } from '../../utils/permissions/filesystem.js'
import type { PermissionDecision } from '../../utils/permissions/PermissionResult.js'
import { buildRepoMap } from '../../context/repoMap/index.js'
import { REPO_MAP_TOOL_NAME, getDescription } from './prompt.js'
import {
  getToolUseSummary,
  renderToolResultMessage,
  renderToolUseErrorMessage,
  renderToolUseMessage,
} from './UI.js'

const inputSchema = lazySchema(() =>
  z.strictObject({
    max_tokens: z
      .number()
      .int()
      .min(256)
      .max(16384)
      .optional()
      .describe(
        'Maximum token budget for the rendered map. Higher values include more files. Default: 1024.',
      ),
    focus_files: z
      .array(z.string())
      .optional()
      .describe(
        'Relative file or directory paths to boost in the ranking (e.g. ["src/tools/", "src/context.ts"]).',
      ),
    focus_symbols: z
      .array(z.string())
      .optional()
      .describe(
        'Symbol names to boost — files defining these symbols rank higher (e.g. ["buildTool", "ToolUseContext"]).',
      ),
  }),
)
type InputSchema = ReturnType<typeof inputSchema>

const outputSchema = lazySchema(() =>
  z.object({
    rendered: z.string(),
    token_count: z.number(),
    file_count: z.number(),
    total_file_count: z.number(),
    cache_hit: z.boolean(),
    build_time_ms: z.number(),
  }),
)
type OutputSchema = ReturnType<typeof outputSchema>

type Output = z.infer<OutputSchema>

export const RepoMapTool = buildTool({
  name: REPO_MAP_TOOL_NAME,
  searchHint: 'structural map of repository files and symbols',
  maxResultSizeChars: 50_000,
  async description() {
    return getDescription()
  },
  userFacingName() {
    return 'Repository map'
  },
  getToolUseSummary,
  getActivityDescription(input) {
    if (input?.focus_files?.length) {
      return `Building repository map (focus: ${input.focus_files.join(', ')})`
    }
    return 'Building repository map'
  },
  get inputSchema(): InputSchema {
    return inputSchema()
  },
  get outputSchema(): OutputSchema {
    return outputSchema()
  },
  isConcurrencySafe() {
    return true
  },
  isReadOnly() {
    return true
  },
  isSearchOrReadCommand() {
    return { isSearch: false, isRead: true }
  },
  toAutoClassifierInput(input) {
    const parts: string[] = ['repomap']
    if (input.focus_files?.length) parts.push(`focus: ${input.focus_files.join(',')}`)
    return parts.join(' ')
  },
  async checkPermissions(input, context): Promise<PermissionDecision> {
    const appState = context.getAppState()
    return checkReadPermissionForTool(
      RepoMapTool,
      input,
      appState.toolPermissionContext,
    )
  },
  async prompt() {
    return getDescription()
  },
  renderToolUseMessage,
  renderToolUseErrorMessage,
  renderToolResultMessage,
  extractSearchText({ rendered }) {
    return rendered
  },
  mapToolResultToToolResultBlockParam(output, toolUseID) {
    const summary = [
      `Repository map: ${output.file_count} files ranked (${output.total_file_count} total), ${output.token_count} tokens`,
      output.cache_hit ? '(cached)' : `(built in ${output.build_time_ms}ms)`,
    ].join(' ')

    return {
      tool_use_id: toolUseID,
      type: 'tool_result',
      content: `${summary}\n\n${output.rendered}`,
    }
  },
  async call(
    { max_tokens = 1024, focus_files, focus_symbols },
    { abortController },
  ) {
    const root = getCwd()

    // Resolve focus_symbols to file paths by searching the tag cache
    let resolvedFocusFiles = focus_files ?? []
    if (focus_symbols?.length) {
      // Import the symbol lookup dynamically to avoid circular deps at module load
      const { getRepoFiles } = await import('../../context/repoMap/gitFiles.js')
      const { extractTags } = await import('../../context/repoMap/symbolExtractor.js')
      const { initParser } = await import('../../context/repoMap/parser.js')

      await initParser()
      const files = await getRepoFiles(root)
      const symbolFiles: string[] = []
      const symbolSet = new Set(focus_symbols)

      // Scan files for matching symbol definitions
      for (const file of files) {
        if (abortController.signal.aborted) break
        const tags = await extractTags(file, root)
        if (tags) {
          const hasMatch = tags.tags.some(
            t => t.kind === 'def' && symbolSet.has(t.name),
          )
          if (hasMatch) {
            symbolFiles.push(file)
          }
        }
      }

      resolvedFocusFiles = [...resolvedFocusFiles, ...symbolFiles]
    }

    const result = await buildRepoMap({
      root,
      maxTokens: max_tokens,
      focusFiles: resolvedFocusFiles.length > 0 ? resolvedFocusFiles : undefined,
    })

    const output: Output = {
      rendered: result.map,
      token_count: result.tokenCount,
      file_count: result.fileCount,
      total_file_count: result.totalFileCount,
      cache_hit: result.cacheHit,
      build_time_ms: result.buildTimeMs,
    }

    return { data: output }
  },
} satisfies ToolDef<InputSchema, Output>)
