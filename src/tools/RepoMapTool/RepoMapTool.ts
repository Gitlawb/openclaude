import { z } from 'zod/v4'
import { buildTool, type ToolDef } from '../../Tool.js'
import { pwd } from '../../utils/cwd.js'
import { lazySchema } from '../../utils/lazySchema.js'
import { checkReadPermissionForTool } from '../../utils/permissions/filesystem.js'
import type { PermissionDecision } from '../../utils/permissions/PermissionResult.js'
import { AbortError } from '../../utils/errors.js'
import { buildRepoMap, extractTagsWithCache } from '../../context/repoMap/index.js'
import {
  loadCache,
  saveCache,
  statFile,
} from '../../context/repoMap/cache.js'
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

export type Output = z.infer<OutputSchema>

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
  getPath() {
    return pwd()
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
    throwIfAborted(abortController.signal)
    const root = pwd()

    // Resolve focus_symbols to file paths by searching the tag cache
    let resolvedFocusFiles = focus_files ?? []
    if (focus_symbols?.length) {
      // Import the symbol lookup dynamically to avoid circular deps at module load
      const { getRepoFiles } = await import('../../context/repoMap/gitFiles.js')

      const files = await getRepoFiles(root)
      const cache = loadCache(root)
      const fileStats = new Map(files.map(file => [file, statFile(root, file)]))
      const fileTags = await extractTagsWithCache({
        files,
        root,
        cache,
        fileStats,
        shouldContinue: () => throwIfAborted(abortController.signal),
      })
      const symbolFiles: string[] = []
      const symbolSet = new Set(focus_symbols)

      for (const result of fileTags) {
        const hasMatch = result.tags.some(
          tag => tag.kind === 'def' && symbolSet.has(tag.name),
        )
        if (hasMatch) {
          symbolFiles.push(result.path)
        }
      }

      throwIfAborted(abortController.signal)
      saveCache(root, cache)
      resolvedFocusFiles = [...resolvedFocusFiles, ...symbolFiles]
    }

    throwIfAborted(abortController.signal)
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

function throwIfAborted(signal: AbortSignal): void {
  if (signal.aborted) {
    throw new AbortError()
  }
}
