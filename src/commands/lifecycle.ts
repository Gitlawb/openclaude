import type { Command } from '../types/command.js'

const lifecycle: Command = {
  type: 'prompt',
  name: 'lifecycle',
  description: 'Show current GSD lifecycle state and recent vault activity',
  progressMessage: 'checking lifecycle state',
  contentLength: 200,
  source: 'builtin',
  async getPromptForCommand(_args, _context) {
    const { isRepoOnboarded } = await import('../vault/config.js')
    const { resolveVaultConfig } = await import('../vault/config.js')
    const { readState } = await import('../vault/state.js')
    const { getOriginalCwd } = await import('../bootstrap/state.js')
    const { readdirSync, existsSync } = await import('fs')
    const { join } = await import('path')

    const projectRoot = getOriginalCwd()

    if (!isRepoOnboarded(projectRoot)) {
      return [{ type: 'text' as const, text: 'No vault found. Run `/onboard` first to analyze this repo and create vault docs.' }]
    }

    const config = resolveVaultConfig(projectRoot)
    const state = readState(config.vaultPath)

    // Count artifacts in each subdirectory
    const countFiles = (subdir: string): number => {
      const dir = join(config.vaultPath, subdir)
      if (!existsSync(dir)) return 0
      try {
        return readdirSync(dir).filter(f => f.endsWith('.md')).length
      } catch { return 0 }
    }

    const sections: string[] = ['## GSD Lifecycle State', '']

    if (state) {
      sections.push(`**Current Work:** ${state.currentWork}`)
      sections.push(`**Last Updated:** ${state.lastUpdated}`)
      sections.push('')

      if (state.decisions.length > 0) {
        sections.push('### Recent Decisions (last 3)')
        const recent = state.decisions.slice(-3)
        for (const d of recent) {
          sections.push(`- **${d.title}** (${d.date}) — ${d.context}`)
        }
        sections.push('')
      }

      if (state.blockers.length > 0) {
        sections.push('### Active Blockers')
        for (const b of state.blockers) {
          sections.push(`- **[${b.id}]** ${b.description}`)
        }
        sections.push('')
      }

      if (state.todos.length > 0) {
        const pending = state.todos.filter(t => !t.done)
        if (pending.length > 0) {
          sections.push('### Pending Todos')
          for (const t of pending) {
            sections.push(`- [ ] ${t.text}`)
          }
          sections.push('')
        }
      }
    } else {
      sections.push('*STATE.md not found. Run `/onboard` to initialize.*')
      sections.push('')
    }

    // Vault artifact counts
    sections.push('### Vault Artifacts')
    sections.push(`- Plans: ${countFiles('plans')}`)
    sections.push(`- Decisions: ${countFiles('decisions')}`)
    sections.push(`- Logs: ${countFiles('logs')}`)
    sections.push(`- Summaries: ${countFiles('summaries')}`)

    // Provider info
    try {
      const { getAPIProvider } = await import('../utils/model/providers.js')
      const apiProvider = getAPIProvider()
      sections.push('')
      sections.push('### Provider')
      sections.push(`- **API Provider:** ${apiProvider}`)
      sections.push(`- **Auth:** ${process.env.ANTHROPIC_API_KEY ? 'API Key' : 'OAuth'}`)
    } catch {
      // Provider info is optional
    }

    // Check for active worktree
    try {
      const { getCurrentWorktreeSession } = await import('../utils/worktree.js')
      const worktreeSession = getCurrentWorktreeSession()
      if (worktreeSession) {
        sections.push('')
        sections.push('### Active Worktree')
        sections.push(`- **Name:** ${worktreeSession.worktreeName}`)
        sections.push(`- **Path:** ${worktreeSession.worktreePath}`)
        sections.push('- Run `/promote` to promote changes or abandon the worktree')
      }
    } catch {
      // Worktree check is optional
    }

    return [{ type: 'text' as const, text: sections.join('\n') }]
  },
}

export default lifecycle
