import { spawnSync } from 'child_process'
import { existsSync } from 'fs'
import { resolve } from 'path'
import { z } from 'zod/v4'
import { buildTool, type ToolDef, type ToolResult } from '../../Tool.js'
import { lazySchema } from '../../utils/lazySchema.js'
import { expandPath } from '../../utils/path.js'
import { DESCRIPTION, PACKAGE_MANAGER_TOOL_NAME, PROMPT } from './prompt.js'

const inputSchema = lazySchema(() =>
  z.strictObject({
    manager: z.enum(['npm', 'pip', 'go', 'cargo', 'bun', 'brew']).optional().describe('Package manager. Auto-detected.'),
    action: z.enum(['install', 'update', 'remove', 'list', 'audit', 'outdated']).describe('Action'),
    packages: z.array(z.string().min(1)).optional().describe('Package names'),
    dev: z.boolean().optional().default(false).describe('Dev dependency'),
    global: z.boolean().optional().default(false).describe('Global install'),
    dryRun: z.boolean().optional().default(false).describe('Preview without applying'),
    path: z.string().optional().default('.').describe('Project directory'),
  }),
)
type InputSchema = ReturnType<typeof inputSchema>

const outputSchema = lazySchema(() =>
  z.object({
    success: z.boolean(),
    manager: z.string(),
    action: z.string(),
    output: z.string(),
    packagesChanged: z.array(z.string()).optional(),
    durationMs: z.number(),
    error: z.string().optional(),
  }),
)
type OutputSchema = ReturnType<typeof outputSchema>
export type Output = z.infer<OutputSchema>

const MAX_OUTPUT = 50_000

const MANAGERS: Record<string, { binary: string; detectFiles: string[] }> = {
  npm: { binary: 'npm', detectFiles: ['package.json', 'package-lock.json'] },
  pip: { binary: 'pip', detectFiles: ['requirements.txt', 'pyproject.toml', 'setup.py'] },
  go: { binary: 'go', detectFiles: ['go.mod'] },
  cargo: { binary: 'cargo', detectFiles: ['Cargo.toml'] },
  bun: { binary: 'bun', detectFiles: ['bun.lockb', 'bun.lock'] },
  brew: { binary: 'brew', detectFiles: [] },
}

function detectManager(dir: string): string | null {
  for (const [n, m] of Object.entries(MANAGERS)) { for (const f of m.detectFiles) { if (existsSync(resolve(dir, f))) return n } }
  return null
}

function buildArgs(input: z.infer<InputSchema>, mgr: string): string[] {
  const a: string[] = []
  const pkgs = (input.packages ?? []).map(p => p.replace(/[^a-zA-Z0-9@\-_./~]/g, ''))
  const dry = input.dryRun

  switch (input.action) {
    case 'install':
      if (mgr === 'npm') { a.push('install'); if (dry) a.push('--dry-run'); if (input.dev) a.push('--save-dev'); if (input.global) a.push('-g'); a.push(...pkgs) }
      else if (mgr === 'pip') { a.push('install'); if (dry) a.push('--dry-run'); if (input.global) a.push('--system'); a.push(...pkgs) }
      else if (mgr === 'go') { a.push('get'); a.push(...pkgs) }
      else if (mgr === 'cargo') { a.push('add'); if (input.dev) a.push('--dev'); a.push(...pkgs) }
      else if (mgr === 'bun') { a.push('add'); if (dry) a.push('--dry-run'); if (input.dev) a.push('--dev'); a.push(...pkgs) }
      else if (mgr === 'brew') { a.push('install'); if (dry) a.push('--dry-run'); a.push(...pkgs) }
      break
    case 'update':
      if (mgr === 'npm') { a.push('update'); a.push(...pkgs) }
      else if (mgr === 'pip') { a.push('install', '--upgrade'); a.push(...pkgs) }
      else if (mgr === 'go') { a.push('get', '-u'); a.push(...pkgs) }
      else if (mgr === 'cargo') { a.push('update'); if (pkgs.length) a.push('-p', ...pkgs) }
      else if (mgr === 'bun') { a.push('update'); a.push(...pkgs) }
      else if (mgr === 'brew') { a.push('upgrade'); a.push(...pkgs) }
      break
    case 'remove':
      if (mgr === 'npm') { a.push('uninstall'); a.push(...pkgs) }
      else if (mgr === 'pip') { a.push('uninstall', '-y'); a.push(...pkgs) }
      else if (mgr === 'cargo') { a.push('remove'); a.push(...pkgs) }
      else if (mgr === 'bun') { a.push('remove'); a.push(...pkgs) }
      else if (mgr === 'brew') { a.push('uninstall'); a.push(...pkgs) }
      else if (mgr === 'go') { a.push('mod', 'tidy') }
      break
    case 'list':
      if (mgr === 'npm') a.push('list', '--depth=0')
      else if (mgr === 'pip') a.push('list')
      else if (mgr === 'go') a.push('list', '-m', 'all')
      else if (mgr === 'cargo') a.push('install', '--list')
      else if (mgr === 'bun') a.push('pm', 'ls')
      else if (mgr === 'brew') a.push('list')
      break
    case 'audit':
      if (mgr === 'go') a.push('run', 'golang.org/x/vuln/cmd/govulncheck@latest', './...')
      else if (mgr !== 'go') a.push('audit')
      if (mgr === 'npm') a.push('--json')
      break
    case 'outdated':
      if (mgr === 'npm') a.push('outdated')
      else if (mgr === 'pip') a.push('list', '--outdated')
      else if (mgr === 'go') a.push('list', '-u', '-m', 'all')
      else if (mgr === 'cargo') a.push('outdated')
      else if (mgr === 'bun') a.push('outdated')
      else if (mgr === 'brew') a.push('outdated')
      break
  }
  return a
}

export const PackageManagerTool: ToolDef<InputSchema, Output> = {
  name: PACKAGE_MANAGER_TOOL_NAME,
  searchHint: 'manage project dependencies',
  maxResultSizeChars: MAX_OUTPUT,
  strict: true,
  get inputSchema(): InputSchema { return inputSchema() },
  get outputSchema(): OutputSchema { return outputSchema() },
  userFacingName: () => 'Package Manager',
  isReadOnly(input) { return input ? ['list', 'audit', 'outdated'].includes(input.action) : false },
  isDestructive(input) { return input ? ['remove', 'update'].includes(input.action) : false },
  toAutoClassifierInput(input) { return `${input.manager ?? 'auto'} ${input.action} ${(input.packages ?? []).join(',')}` },
  async description() { return DESCRIPTION },
  async prompt() { return PROMPT },
  async validateInput(input) {
    if (['install', 'update', 'remove'].includes(input.action) && (!input.packages || input.packages.length === 0)) return { result: false, message: `Packages required for ${input.action}`, errorCode: 1 }
    return { result: true }
  },
  async checkPermissions(input) {
    if (['install', 'remove', 'update'].includes(input.action)) {
      return { behavior: 'ask', askReason: `Run "${input.action}" on ${(input.packages ?? []).join(', ')}?`, updatedInput: input }
    }
    return { behavior: 'allow', updatedInput: input }
  },
  mapToolResultToToolResultBlockParam(output, toolUseID) {
    return { tool_use_id: toolUseID, type: 'tool_result', content: JSON.stringify(output) }
  },
  renderToolUseMessage(input) {
    const d = input.dryRun ? ' (dry-run)' : ''
    return { type: 'text', text: `${input.manager ?? 'auto'} ${input.action} ${(input.packages ?? []).join(', ')}${d}`.trim() }
  },
  renderToolResultMessage(output) {
    if (!output.success) return { type: 'text', text: `${output.manager} ${output.action} failed: ${output.error}` }
    const c = output.packagesChanged?.length ? ` — ${output.packagesChanged.join(', ')}` : ''
    return { type: 'text', text: `${output.manager} ${output.action} succeeded${c} in ${output.durationMs}ms` }
  },
  async call(input, ctx, _canUseTool?, _parentMessage?, _onProgress?): Promise<ToolResult<Output>> {
    const startTime = Date.now()
    const targetPath = resolve(expandPath(input.path ?? '.'))
    const mgrName = input.manager ?? detectManager(targetPath)

    if (!mgrName) return { data: { success: false, manager: 'unknown', action: input.action, output: '', durationMs: Date.now() - startTime, error: 'No package manager detected.' } }

    try {
      const args = buildArgs(input, mgrName)
      if (!args.length) return { data: { success: false, manager: mgrName, action: input.action, output: '', durationMs: Date.now() - startTime, error: `Unsupported action ${input.action} for ${mgrName}` } }

      const result = spawnSync(MANAGERS[mgrName].binary, args, { cwd: targetPath, timeout: 120_000, maxBuffer: MAX_OUTPUT, encoding: 'utf-8' })
      const stdout = (result.stdout ?? '').slice(0, MAX_OUTPUT)
      const stderr = (result.stderr ?? '').slice(0, 2000)
      const changed = ['install', 'update', 'remove'].includes(input.action) ? input.packages : undefined

      return { data: { success: (result.status ?? 1) === 0, manager: mgrName, action: input.action, output: stdout || stderr, packagesChanged: changed, durationMs: Date.now() - startTime } }
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err)
      return { data: { success: false, manager: mgrName, action: input.action, output: '', durationMs: Date.now() - startTime, error: msg } }
    }
  },
}
