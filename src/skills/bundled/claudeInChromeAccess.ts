import { isClaudeAISubscriber } from '../../utils/auth.js'

export function shouldEnableClaudeInChromeSkill(options?: {
  autoEnabled?: boolean
  hasClaudeInChromeAccess?: boolean
}): boolean {
  const autoEnabled =
    options?.autoEnabled ?? defaultShouldAutoEnableClaudeInChrome()
  const hasClaudeInChromeAccess =
    options?.hasClaudeInChromeAccess ?? isClaudeAISubscriber()
  return autoEnabled && hasClaudeInChromeAccess
}

function defaultShouldAutoEnableClaudeInChrome(): boolean {
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const { shouldAutoEnableClaudeInChrome } = require(
    '../../utils/claudeInChrome/setup.js',
  ) as typeof import('../../utils/claudeInChrome/setup.js')
  return shouldAutoEnableClaudeInChrome()
}
