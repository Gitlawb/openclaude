import type { Command } from '../types/command.js'

const onboard: Command = {
  type: 'prompt',
  name: 'onboard',
  description: 'Analyze this repo and generate vault docs for AI context',
  progressMessage: 'onboarding repo',
  contentLength: 500,
  source: 'builtin',
  async getPromptForCommand(_args, _context) {
    // Import lazily to avoid heavy dependency loading at startup
    const { isRepoOnboarded, runOnboarding } = await import('../vault/onboard.js')
    const { getOriginalCwd } = await import('../bootstrap/state.js')

    const projectRoot = getOriginalCwd()
    const alreadyOnboarded = isRepoOnboarded(projectRoot)

    // Run onboarding and collect results
    const messages: string[] = []
    const result = await runOnboarding(projectRoot, {
      onProgress: (msg) => messages.push(msg),
    })

    const summary = [
      alreadyOnboarded ? '## Re-onboarding Complete' : '## Onboarding Complete',
      '',
      `**Vault path:** \`${result.vaultPath}\``,
      `**Provider:** ${result.provider}`,
      `**Docs generated:** ${result.docsGenerated.join(', ')}`,
      '',
      result.providerFile.skipped
        ? `Provider config skipped: ${result.providerFile.reason}`
        : `**Provider config:** \`${result.providerFile.filePath}\``,
      '',
      '### Progress',
      ...messages.map(m => `- ${m}`),
    ].join('\n')

    return [{ type: 'text', text: summary }]
  },
}

export default onboard
