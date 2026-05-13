import { spawnSync } from 'child_process'
import { existsSync } from 'fs'
import { resolve } from 'path'
import { z } from 'zod/v4'
import { buildTool, type ToolResult } from '../../Tool.js'
import { lazySchema } from '../../utils/lazySchema.js'
import { expandPath } from '../../utils/path.js'
import { DESCRIPTION, DEPENDENCY_AUDIT_TOOL_NAME, PROMPT } from './prompt.js'

const inputSchema = lazySchema(() =>
  z.strictObject({
    manager: z.enum(['npm', 'pip', 'cargo', 'go', 'bun']).optional().describe('Package manager. Auto-detected.'),
    severity: z.enum(['critical', 'high', 'medium', 'low']).optional().describe('Minimum severity to report'),
    path: z.string().optional().default('.').describe('Project directory'),
  }),
)
type InputSchema = ReturnType<typeof inputSchema>

const advisorySchema = z.object({ package: z.string(), severity: z.enum(['critical', 'high', 'medium', 'low']), title: z.string(), patchedIn: z.string().optional(), moreInfo: z.string().optional() })

const outputSchema = lazySchema(() =>
  z.object({
    success: z.boolean(),
    manager: z.string(),
    total: z.number(),
    bySeverity: z.object({ critical: z.number(), high: z.number(), medium: z.number(), low: z.number() }),
    advisories: z.array(advisorySchema),
    durationMs: z.number(),
    error: z.string().optional(),
  }),
)
type OutputSchema = ReturnType<typeof outputSchema>
export type Output = z.infer<OutputSchema>

const MAX_ADVISORIES = 200
const SEVERITY_MAP: Record<string, Output['advisories'][number]['severity']> = { critical: 'critical', high: 'high', medium: 'medium', moderate: 'medium', low: 'low' }
const SEVERITY_ORDER: Record<string, number> = { critical: 0, high: 1, medium: 2, low: 99 }

const MANAGERS: Record<string, { binary: string; args: string[]; detectFiles: string[] }> = {
  npm: { binary: 'npm', args: ['audit', '--json'], detectFiles: ['package.json', 'package-lock.json'] },
  pip: { binary: 'pip-audit', args: ['--format', 'json'], detectFiles: ['requirements.txt', 'pyproject.toml'] },
  cargo: { binary: 'cargo', args: ['audit', '--json'], detectFiles: ['Cargo.toml'] },
  go: { binary: 'go', args: ['run', 'golang.org/x/vuln/cmd/govulncheck@latest', '-json', './...'], detectFiles: ['go.mod'] },
  bun: { binary: 'bun', args: ['audit', '--json'], detectFiles: ['bun.lockb', 'bun.lock'] },
}

function detectManager(dir: string): string | null {
  for (const [n, m] of Object.entries(MANAGERS)) { for (const f of m.detectFiles) { if (existsSync(resolve(dir, f))) return n } }
  return null
}

function parseAdvisories(stdout: string, mgr: string, minSev: number): Output['advisories'] {
  const result: Output['advisories'] = []
  try {
    const data = JSON.parse(stdout)
    // pip-audit uses dependencies[].vulns[] shape
    if (data.dependencies && Array.isArray(data.dependencies)) {
      for (const dep of data.dependencies) {
        if (!dep.vulns || !Array.isArray(dep.vulns)) continue
        for (const v of dep.vulns) {
          const sevRaw = ((v.severity ?? 'medium') + '').toLowerCase()
          const sev = SEVERITY_MAP[sevRaw] ?? 'medium'
          if ((SEVERITY_ORDER[sev] ?? 99) > minSev) continue
          result.push({
            package: dep.name ?? v.name ?? 'unknown',
            severity: sev,
            title: v.description ?? v.id ?? 'Unknown vulnerability',
            patchedIn: v.fixed_version ?? undefined,
            moreInfo: v.url ?? undefined,
          })
        }
      }
    } else {
      // npm/cargo/govulncheck: advisories dict or vulnerabilities/results array
      const items = mgr === 'npm' ? Object.values(data.advisories ?? data.vulnerabilities ?? {}) : data.vulnerabilities ?? data.results ?? []
      for (const v of items as any[]) {
        const sevRaw = ((v.severity ?? v.criticality ?? 'medium') + '').toLowerCase()
        const sev = SEVERITY_MAP[sevRaw] ?? 'medium'
        if ((SEVERITY_ORDER[sev] ?? 99) > minSev) continue
        result.push({
          package: v.name ?? v.package ?? v.package_name ?? 'unknown',
          severity: sev,
          title: v.title ?? v.description ?? 'Unknown vulnerability',
          patchedIn: v.patchedVersions ?? v.fixed_version ?? v.patchedIn ?? undefined,
          moreInfo: v.url ?? v.reference ?? v.advisory?.url ?? undefined,
        })
      }
    }
  } catch { /* empty */ }
  return result.slice(0, MAX_ADVISORIES)
}

export const DependencyAuditTool = buildTool({
  name: DEPENDENCY_AUDIT_TOOL_NAME,
  searchHint: 'scan dependencies for known vulnerabilities',
  maxResultSizeChars: 100_000,
  strict: true,
  get inputSchema(): InputSchema { return inputSchema() },
  get outputSchema(): OutputSchema { return outputSchema() },
  userFacingName: () => 'Dependency Audit',
  isReadOnly() { return false },
  isDestructive() { return false },
  toAutoClassifierInput(input) { return `${input.manager ?? 'auto'} audit${input.severity ? ` >=${input.severity}` : ''}` },
  async description() { return DESCRIPTION },
  async prompt() { return PROMPT },
  async validateInput() { return { result: true } },
  async checkPermissions(input) {
    return { behavior: 'ask', message: `Audit ${input.manager ?? 'auto'} dependencies`, updatedInput: input }
  },
  mapToolResultToToolResultBlockParam(output, toolUseID) {
    return { tool_use_id: toolUseID, type: 'tool_result', content: JSON.stringify(output) }
  },
  renderToolUseMessage(input) {
    return `Auditing ${input.manager ?? 'auto'} dependencies${input.severity ? ` (${input.severity}+)` : ''}`
  },
  renderToolResultMessage(output) {
    if (!output.success) return `Dependency audit failed: ${output.error}`
    if (output.total === 0) return `No vulnerabilities found in ${output.durationMs}ms`
    const parts = [`Found ${output.total} vulnerabilities:`]
    for (const [s, l] of [['critical', 'critical'], ['high', 'high'], ['medium', 'medium'], ['low', 'low']]) {
      const c = (output.bySeverity as any)?.[s] ?? 0; if (c > 0) parts.push(`${c} ${l}`)
    }
    parts.push(`in ${output.durationMs}ms`)
    return parts.join(' ')
  },
  async call(input, _ctx, _canUseTool?, _parentMessage?, _onProgress?): Promise<ToolResult<Output>> {
    const startTime = Date.now()
    const targetPath = resolve(expandPath(input.path ?? '.'))
    const mgrName = input.manager ?? detectManager(targetPath)

    if (!mgrName) return { data: { success: false, manager: 'unknown', total: 0, bySeverity: { critical: 0, high: 0, medium: 0, low: 0 }, advisories: [], durationMs: Date.now() - startTime, error: 'No package manager detected.' } }

    const mgr = MANAGERS[mgrName]
    if (!mgr) return { data: { success: false, manager: mgrName, total: 0, bySeverity: { critical: 0, high: 0, medium: 0, low: 0 }, advisories: [], durationMs: Date.now() - startTime, error: `Unsupported: ${mgrName}` } }

    try {
      // Use spawnSync instead of execSync so non-zero exit (vulnerabilities found) still captures output
      const result = spawnSync(mgr.binary, mgr.args, { cwd: targetPath, timeout: 120_000, maxBuffer: 200_000, encoding: 'utf-8' })
      if (result.error) return { data: { success: false, manager: mgrName, total: 0, bySeverity: { critical: 0, high: 0, medium: 0, low: 0 }, advisories: [], durationMs: Date.now() - startTime, error: `Binary not found: ${mgr.binary}` } }
      const stdout = result.stdout ?? ''
      const stderr = result.stderr ?? ''
      const status = result.status ?? 0

      // npm audit exits non-zero when vulnerabilities are found — that's a success for us
      const minSev = input.severity ? (SEVERITY_ORDER[input.severity] ?? 0) : 99
      const advisories = parseAdvisories(stdout, mgrName, minSev)
      const bySeverity = { critical: 0, high: 0, medium: 0, low: 0 }
      for (const a of advisories) bySeverity[a.severity]++

      if (advisories.length === 0 && status !== 0 && !stdout) {
        return { data: { success: false, manager: mgrName, total: 0, bySeverity, advisories: [], durationMs: Date.now() - startTime, error: stderr || `audit exited with code ${status}` } }
      }

      return { data: { success: true, manager: mgrName, total: advisories.length, bySeverity, advisories, durationMs: Date.now() - startTime } }
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err)
      return { data: { success: false, manager: mgrName, total: 0, bySeverity: { critical: 0, high: 0, medium: 0, low: 0 }, advisories: [], durationMs: Date.now() - startTime, error: msg } }
    }
  },
})
