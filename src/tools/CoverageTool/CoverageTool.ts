import { readFileSync, existsSync } from 'fs'
import { resolve } from 'path'
import { z } from 'zod/v4'
import { buildTool, type ToolResult } from '../../Tool.js'
import { lazySchema } from '../../utils/lazySchema.js'
import { expandPath } from '../../utils/path.js'
import { DESCRIPTION, COVERAGE_TOOL_NAME, PROMPT } from './prompt.js'

const inputSchema = lazySchema(() =>
  z.strictObject({
    path: z.string().optional().default('.').describe('Project directory with coverage reports.'),
    format: z.enum(['lcov', 'auto']).optional().default('auto').describe('Coverage report format. Only lcov is supported.'),
    threshold: z.number().min(0).max(100).optional().describe('Minimum coverage percentage.'),
  }),
)
type InputSchema = ReturnType<typeof inputSchema>

const outputSchema = lazySchema(() =>
  z.object({
    success: z.boolean(),
    format: z.string(),
    lines: z.number().min(0).max(100),
    branches: z.number().optional(),
    totalLines: z.number().optional(),
    coveredLines: z.number().optional(),
    files: z.array(z.object({ file: z.string(), lines: z.number(), covered: z.number(), total: z.number() })).optional(),
    uncoveredFiles: z.array(z.string()).optional(),
    meetsThreshold: z.boolean().optional(),
    durationMs: z.number(),
    error: z.string().optional(),
  }),
)
type OutputSchema = ReturnType<typeof outputSchema>
export type Output = z.infer<OutputSchema>

const MAX_FILES = 100

function parseLcov(content: string): { lines: number; branches?: number; totalLines: number; coveredLines: number; files: Output['files'] } {
  let totalLines = 0, coveredLines = 0
  let currentFile = ''
  const fileMap = new Map<string, { covered: number; total: number }>()
  let branchHits = 0, branchFound = 0

  for (const line of content.split('\n')) {
    const t = line.trim()
    if (t.startsWith('SF:')) { currentFile = t.slice(3); if (!fileMap.has(currentFile)) fileMap.set(currentFile, { covered: 0, total: 0 }) }
    else if (t.startsWith('DA:')) {
      const p = t.slice(3).split(',')
      if (p.length >= 2) {
        const e = fileMap.get(currentFile)!; e.total++; totalLines++
        if (parseInt(p[1], 10) > 0) { e.covered++; coveredLines++ }
      }
    } else if (t.startsWith('BRF:')) branchFound += parseInt(t.slice(4), 10)  // accumulate across files
    else if (t.startsWith('BRH:')) branchHits += parseInt(t.slice(4), 10)  // accumulate across files
  }

  const lines = totalLines > 0 ? Math.round((coveredLines / totalLines) * 10000) / 100 : 0
  const branches = branchFound > 0 ? Math.round((branchHits / branchFound) * 10000) / 100 : undefined

  const files = [...fileMap.entries()].map(([file, d]) => ({ file, lines: d.total > 0 ? Math.round((d.covered / d.total) * 10000) / 100 : 0, covered: d.covered, total: d.total }))
    .sort((a, b) => a.lines - b.lines)
    .slice(0, MAX_FILES)

  return { lines, branches, totalLines, coveredLines, files }
}

export const CoverageTool = buildTool({
  name: COVERAGE_TOOL_NAME,
  searchHint: 'analyze code coverage from lcov reports',
  maxResultSizeChars: 100_000,
  strict: true,
  get inputSchema(): InputSchema { return inputSchema() },
  get outputSchema(): OutputSchema { return outputSchema() },
  userFacingName: () => 'Coverage',
  isReadOnly() { return true },
  isDestructive() { return false },
  toAutoClassifierInput(input) { return `${input.format ?? 'auto'} ${input.path}` },
  async description() { return DESCRIPTION },
  async prompt() { return PROMPT },
  async validateInput() { return { result: true } },
  mapToolResultToToolResultBlockParam(output, toolUseID) {
    return { tool_use_id: toolUseID, type: 'tool_result', content: JSON.stringify(output) }
  },
  renderToolUseMessage(input) {
    return `Reading coverage report at ${input.path}`
  },
  renderToolResultMessage(output) {
    if (!output.success) return `Coverage analysis failed: ${output.error}`
    let msg = `lcov: ${output.lines}% lines`
    if (output.branches !== undefined) msg += `, ${output.branches}% branches`
    msg += ` in ${output.durationMs}ms`
    if (output.uncoveredFiles?.length) msg += `, ${output.uncoveredFiles.length} files with 0% coverage`
    if (output.meetsThreshold !== undefined) msg += output.meetsThreshold ? ' ✅ meets threshold' : ' ❌ below threshold'
    return msg
  },
  async call(input, _ctx, _canUseTool?, _parentMessage?, _onProgress?): Promise<ToolResult<Output>> {
    const startTime = Date.now()
    const targetPath = resolve(expandPath(input.path ?? '.'))

    const lcovPath = resolve(targetPath, 'coverage/lcov.info')
    if (!existsSync(lcovPath)) {
      return { data: { success: false, format: 'lcov', lines: 0, durationMs: Date.now() - startTime, error: `Coverage report not found at ${lcovPath}. Run tests with coverage first.` } }
    }

    try {
      const content = readFileSync(lcovPath, 'utf-8')
      const { lines, branches, totalLines, coveredLines, files } = parseLcov(content)
      const uncoveredFiles = files?.filter(f => f.lines === 0).map(f => f.file)
      const meetsThreshold = input.threshold !== undefined ? lines >= input.threshold : undefined

      return { data: { success: true, format: 'lcov', lines, branches, totalLines, coveredLines, files, uncoveredFiles, meetsThreshold, durationMs: Date.now() - startTime } }
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err)
      return { data: { success: false, format: 'lcov', lines: 0, durationMs: Date.now() - startTime, error: msg } }
    }
  },
})
