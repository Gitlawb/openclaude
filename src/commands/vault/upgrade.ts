import type { Command, LocalCommandCall } from '../../types/command.js'

const call: LocalCommandCall = async (args: string) => {
  const { resolveVaultConfig } = await import('../../vault/config.js')
  const { upgradeVault, addScopeToVault } = await import('../../vault/upgrade.js')
  const { getOriginalCwd } = await import('../../bootstrap/state.js')

  const cfg = resolveVaultConfig(getOriginalCwd())

  // PIFA-10: --add-scope backfills `scope: project` to legacy notes.
  // Distinct operation from the v1→v2 upgrade — the flag short-circuits
  // the v1→v2 path and runs the scope backfill instead.
  if (/(^|\s)--add-scope(\s|$)/.test(args)) {
    const r = addScopeToVault(cfg)
    const lines: string[] = []
    lines.push('## Vault Upgrade — scope backfill')
    lines.push('')
    lines.push(`**Notes added (\`scope: project\` inserted):** ${r.notesAdded}`)
    lines.push(`**Notes already scoped (untouched):** ${r.notesUntouched}`)
    lines.push(`**Notes skipped (malformed frontmatter):** ${r.notesSkipped}`)
    if (r.skippedFiles.length > 0) {
      lines.push('')
      lines.push('### Skipped files')
      for (const f of r.skippedFiles) lines.push(`- ${f}`)
    }
    return { type: 'text', value: lines.join('\n') }
  }

  const result = await upgradeVault(cfg)

  const lines: string[] = []
  lines.push('## Vault Upgrade')
  lines.push('')
  lines.push(`**Shape before:** ${result.shape}`)
  lines.push(`**Shape after:** ${result.ok ? 'v2' : result.shape}`)
  lines.push(`**Notes moved:** ${result.notesMoved}`)
  const failureCount = result.failures?.length ?? 0
  lines.push(`**Failures:** ${failureCount}`)
  lines.push('')
  lines.push(result.message)

  if (failureCount > 0 && result.failures) {
    lines.push('')
    lines.push('### Failures')
    for (const v of result.failures) {
      lines.push(`- [${v.rule}] ${v.field}: expected ${v.expected}, got ${JSON.stringify(v.got)}`)
    }
  }

  if (!result.ok) {
    process.exitCode = 1
  }

  return { type: 'text', value: lines.join('\n') }
}

const vaultUpgrade = {
  type: 'local',
  name: 'vault-upgrade',
  description: 'Upgrade a v1 vault to the v2 schema (or backfill scope: project with --add-scope)',
  supportsNonInteractive: true,
  load: () => Promise.resolve({ call }),
} satisfies Command

export default vaultUpgrade
