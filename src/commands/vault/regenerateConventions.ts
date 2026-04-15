import type { Command, LocalCommandCall } from '../../types/command.js'

const call: LocalCommandCall = async () => {
  const { resolveVaultConfig } = await import('../../vault/config.js')
  const { regenerateConventions } = await import('../../vault/scaffold.js')
  const { getOriginalCwd } = await import('../../bootstrap/state.js')

  const cfg = resolveVaultConfig(getOriginalCwd())

  try {
    const result = await regenerateConventions(cfg)
    const lines: string[] = []
    lines.push('## Conventions Regenerated')
    lines.push('')
    lines.push(`**Files written:** ${result.filesWritten.length}`)
    lines.push('')
    for (const f of result.filesWritten) {
      lines.push(`- ${f}`)
    }
    return { type: 'text', value: lines.join('\n') }
  } catch (err) {
    process.exitCode = 1
    const message = err instanceof Error ? err.message : String(err)
    return {
      type: 'text',
      value: `Failed to regenerate conventions: ${message}`,
    }
  }
}

const vaultRegenerateConventions = {
  type: 'local',
  name: 'vault-regenerate-conventions',
  description:
    'Rewrite _conventions.md and note templates to their defaults',
  supportsNonInteractive: true,
  load: () => Promise.resolve({ call }),
} satisfies Command

export default vaultRegenerateConventions
