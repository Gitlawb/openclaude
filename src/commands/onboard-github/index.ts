import type { Command } from '../../commands.js'

const onboardGithub: Command = {
  name: 'onboard-github',
  aliases: ['onboarding-github', 'onboardgithub', 'onboardinggithub'],
  description:
    'Interactive setup for GitHub Copilot: OAuth device login stored in secure storage',
  type: 'local-jsx',
  load: () => import('./onboard-github.js'),
}

export default onboardGithub
