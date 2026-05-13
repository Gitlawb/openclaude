import { spawnSync } from 'child_process'
import { resolve } from 'path'
import { z } from 'zod/v4'
import { buildTool, type ToolResult } from '../../Tool.js'
import { lazySchema } from '../../utils/lazySchema.js'
import { expandPath } from '../../utils/path.js'
import { DESCRIPTION, FILE_ARCHIVE_TOOL_NAME, PROMPT } from './prompt.js'

const inputSchema = lazySchema(() =>
  z.strictObject({
    action: z.enum(['create', 'extract', 'list']).describe('Archive action'),
    format: z.enum(['zip', 'tar', 'tar.gz', 'gz']).describe('Archive format'),
    source: z.union([z.string(), z.array(z.string())]).describe('Source file(s) or directory'),
    destination: z.string().optional().describe('Destination archive or extraction path'),
  }),
)
type InputSchema = ReturnType<typeof inputSchema>

const outputSchema = lazySchema(() =>
  z.object({
    success: z.boolean(),
    action: z.string(),
    format: z.string(),
    files: z.array(z.string()).optional(),
    fileCount: z.number().optional(),
    destination: z.string().optional(),
    durationMs: z.number(),
    error: z.string().optional(),
  }),
)
type OutputSchema = ReturnType<typeof outputSchema>
export type Output = z.infer<OutputSchema>

const MAX_FILES_LISTED = 200

export const FileArchiveTool = buildTool({
  name: FILE_ARCHIVE_TOOL_NAME,
  searchHint: 'create, extract, or inspect archive files',
  maxResultSizeChars: 50_000,
  strict: true,
  get inputSchema(): InputSchema { return inputSchema() },
  get outputSchema(): OutputSchema { return outputSchema() },
  userFacingName: () => 'File Archive',
  isReadOnly(input) { return input ? input.action === 'list' : true },
  isDestructive(input) { return input ? input.action === 'extract' && !!input.destination : false },
  toAutoClassifierInput(input) { return `${input.action} ${input.format} ${typeof input.source === 'string' ? input.source : input.source.join(',')}` },
  getPath(input) { return typeof input.source === 'string' ? input.source : input.source[0] || '' },
  async description() { return DESCRIPTION },
  async prompt() { return PROMPT },
  async validateInput(input) {
    if (input.action === 'extract' && !input.destination) return { result: false, message: 'Destination path required for extract', errorCode: 1 }
    if (input.action === 'create' && !input.source) return { result: false, message: 'Source required for create', errorCode: 1 }
    return { result: true }
  },
  async checkPermissions(input) {
    if (input.action === 'extract' || input.action === 'create') {
      return { behavior: 'ask', message: `${input.action === 'create' ? 'Create' : 'Extract'} ${input.format} archive?`, updatedInput: input }
    }
    return { behavior: 'allow', updatedInput: input }
  },
  mapToolResultToToolResultBlockParam(output, toolUseID) {
    return { tool_use_id: toolUseID, type: 'tool_result', content: JSON.stringify(output) }
  },
  renderToolUseMessage(input) {
    const src = typeof input.source === 'string' ? input.source : input.source.join(', ')
    return { type: 'text', text: `${input.action} ${input.format} ${src}${input.destination ? ` → ${input.destination}` : ''}` }
  },
  renderToolResultMessage(output) {
    if (!output.success) return { type: 'text', text: `Archive ${output.action} failed: ${output.error}` }
    if (output.action === 'list' && output.files) return { type: 'text', text: `Archive contains ${output.fileCount} files in ${output.durationMs}ms` }
    return { type: 'text', text: `Archive ${output.action} (${output.format}) completed in ${output.durationMs}ms` }
  },
  async call(input, _ctx, _canUseTool?, _parentMessage?, _onProgress?): Promise<ToolResult<Output>> {
    const startTime = Date.now()
    const dest = input.destination ? resolve(expandPath(input.destination)) : ''
    const srcArg = typeof input.source === 'string' ? resolve(expandPath(input.source)) : input.source.map(s => resolve(expandPath(s)))

    try {
      let binary = ''; const args: string[] = []

      if (input.format === 'zip') {
        if (input.action === 'create') { binary = 'zip'; args.push('-r', dest); Array.isArray(srcArg) ? args.push(...srcArg) : args.push(srcArg) }
        else if (input.action === 'extract') { binary = 'unzip'; args.push('-o', typeof srcArg === 'string' ? srcArg : srcArg[0], '-d', dest) }
        else if (input.action === 'list') { binary = 'unzip'; args.push('-l', typeof srcArg === 'string' ? srcArg : srcArg[0]) }
      } else if (input.format === 'tar') {
        binary = 'tar'
        if (input.action === 'create') { args.push('-cf', dest); Array.isArray(srcArg) ? args.push(...srcArg) : args.push(srcArg) }
        else if (input.action === 'extract') { args.push('-xf', typeof srcArg === 'string' ? srcArg : srcArg[0], '-C', dest) }
        else if (input.action === 'list') { args.push('-tf', typeof srcArg === 'string' ? srcArg : srcArg[0]) }
      } else if (input.format === 'tar.gz') {
        binary = 'tar'
        if (input.action === 'create') { args.push('-czf', dest); Array.isArray(srcArg) ? args.push(...srcArg) : args.push(srcArg) }
        else if (input.action === 'extract') { args.push('-xzf', typeof srcArg === 'string' ? srcArg : srcArg[0], '-C', dest) }
        else if (input.action === 'list') { args.push('-tzf', typeof srcArg === 'string' ? srcArg : srcArg[0]) }
      } else if (input.format === 'gz') {
        if (input.action === 'create') { binary = 'gzip'; args.push('-k', typeof srcArg === 'string' ? srcArg : srcArg[0]) }
        else if (input.action === 'extract') { binary = 'gunzip'; args.push('-k', typeof srcArg === 'string' ? srcArg : srcArg[0]) }
        else if (input.action === 'list') { binary = 'gzip'; args.push('-l', typeof srcArg === 'string' ? srcArg : srcArg[0]) }
      }

      const result = spawnSync(binary, args, { timeout: 120_000, maxBuffer: 100_000, encoding: 'utf-8' })
      if (result.error) return { data: { success: false, action: input.action, format: input.format, durationMs: Date.now() - startTime, error: `Binary not found: ${binary}. Install it and try again.` } }

      const stdout = (result.stdout ?? '').trim()
      if (result.status !== 0) return { data: { success: false, action: input.action, format: input.format, durationMs: Date.now() - startTime, error: ((result.stderr || stdout) || `${binary} exited with code ${result.status}`).slice(0, 2000) } }

      let files: string[] | undefined
      let fileCount: number | undefined
      if (input.action === 'list') {
        const lines = stdout.split('\n').filter(l => l.trim()).slice(1)
        files = lines.slice(0, MAX_FILES_LISTED).map(l => l.trim().split(/\s+/).pop() || l.trim())
        fileCount = lines.length
      }

      return { data: { success: true, action: input.action, format: input.format, files, fileCount, destination: dest || undefined, durationMs: Date.now() - startTime } }
    } catch (err) {
      return { data: { success: false, action: input.action, format: input.format, durationMs: Date.now() - startTime, error: err instanceof Error ? err.message : String(err) } }
    }
  },
})
