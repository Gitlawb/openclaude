import type { Command, LocalCommandCall } from '../../types/command.js'

function parseArgs(args: string): {
  refresh: boolean
  dryRun: boolean
  noLlm: boolean
  concurrency: number
} {
  const tokens = args.split(/\s+/).filter(Boolean)
  const concurrencyIdx = tokens.indexOf('--concurrency')
  let concurrency = 4
  if (concurrencyIdx !== -1 && tokens[concurrencyIdx + 1]) {
    const parsed = parseInt(tokens[concurrencyIdx + 1], 10)
    if (!isNaN(parsed) && parsed > 0) concurrency = parsed
  }

  return {
    refresh: tokens.includes('--refresh'),
    dryRun: tokens.includes('--dry-run'),
    noLlm: tokens.includes('--no-llm'),
    concurrency,
  }
}

const call: LocalCommandCall = async (args) => {
  const { resolveVaultConfig } = await import('../../vault/config.js')
  const { indexCodebase } = await import('../../vault/indexer/index.js')
  const { runMapping } = await import('../../vault/mapper/index.js')
  const { getOriginalCwd } = await import('../../bootstrap/state.js')

  const { refresh, dryRun, noLlm, concurrency } = parseArgs(args ?? '')

  let mode: 'full' | 'refresh' | 'dry-run' = 'full'
  if (dryRun) mode = 'dry-run'
  else if (refresh) mode = 'refresh'

  const cwd = getOriginalCwd()
  const cfg = resolveVaultConfig(cwd)
  const index = await indexCodebase(cwd)

  const report = await runMapping(cfg, index, {
    mode,
    disableLlm: noLlm,
    concurrency,
    // provider: wired in T14's pipeline when not disableLlm — for now CLI always uses --no-llm
    // Real provider wiring comes when the provider adapter is integrated
  })

  const lines: string[] = []
  lines.push(`Codebase mapping: ${mode}`)
  lines.push(`  Discovered: ${report.modules.discovered}`)
  lines.push(`  Emitted:    ${report.modules.emitted}`)
  lines.push(`  Reused:     ${report.modules.reused}`)
  lines.push(`  Archived:   ${report.modules.archived}`)
  lines.push(`  MOCs:       ${report.mocs.perDomain} domain + ${report.mocs.root ? 1 : 0} root`)

  if (report.cycles.length > 0) {
    lines.push(`  Cycles:     ${report.cycles.length} detected`)
  }

  if (report.tokensIn > 0 || report.tokensOut > 0) {
    lines.push(`  Tokens:     ${report.tokensIn} in / ${report.tokensOut} out`)
  }

  if (report.orphans.length > 0) {
    lines.push(`  Orphans:    ${report.orphans.join(', ')}`)
  }

  if (report.errors.length > 0) {
    lines.push(`  Errors:     ${report.errors.length}`)
    for (const e of report.errors.slice(0, 5)) {
      lines.push(`    - ${e}`)
    }
    if (report.errors.length > 5) {
      lines.push(`    ... and ${report.errors.length - 5} more`)
    }
  }

  // Exit 1 on orphans or abort errors
  if (report.orphans.length > 0 || report.errors.some((e) => e.includes('map-aborted'))) {
    process.exitCode = 1
  }

  return { type: 'text', value: lines.join('\n') }
}

const vaultMap = {
  type: 'local',
  name: 'vault-map',
  description: 'Map the codebase into structured vault notes',
  argumentHint: '[--refresh] [--dry-run] [--no-llm] [--concurrency <n>]',
  supportsNonInteractive: true,
  load: () => Promise.resolve({ call }),
} satisfies Command

export default vaultMap
