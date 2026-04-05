import type { LocalCommandCall } from '../../types/command.js'
import { getRouter } from '../../services/router/index.js'

const ROUTER_VERSION = '1.2.0'

export const call: LocalCommandCall = async () => {
  const router = getRouter()
  const routerStatus = router ? (router.isEnabled() ? 'active' : 'disabled (fallback)') : 'not initialized'

  const lines = [
    '## Version',
    '',
    '**openclaude:** v0.1.7',
    '**Foundation Router:** v' + ROUTER_VERSION,
    '**Router status:** ' + routerStatus,
    '',
    'Built by Foundation Operations',
    'github.com/foundationoperations/openclaude',
  ]

  return { type: 'text', value: lines.join('
') }
}
