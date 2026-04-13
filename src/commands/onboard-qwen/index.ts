import type { Command } from '../../commands.js'

const onboardQwen: Command = {
  name: 'onboard-qwen',
  aliases: ['qwen-login', 'onboardqwen', 'qwenlogin'],
  description:
    'Interactive setup for Qwen (free OAuth): device-flow sign-in, credentials stored at ~/.qwen/oauth_creds.json',
  type: 'local-jsx',
  load: () => import('./onboard-qwen.js'),
}

export default onboardQwen
