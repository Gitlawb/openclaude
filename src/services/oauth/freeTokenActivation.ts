import { VERBOO_FRONT_BASE_URL } from '../../constants/oauth.js'
import { getIsNonInteractiveSession } from '../../bootstrap/state.js'

export class FreeTokensRequiredError extends Error {
  readonly status = 402
  readonly code = 'free_tokens_exhausted'
  readonly activationUrl = `${VERBOO_FRONT_BASE_URL}/free-tokens`
  constructor() {
    const interactive = !getIsNonInteractiveSession() && process.stdin.isTTY && process.stdout.isTTY
    const nextStep = interactive
      ? 'Tente novamente para ver as opções de ativação'
      : 'Abra a CLI em modo interativo para confirmar a ativação'
    super(`A inferência está pausada porque seus tokens grátis acabaram, o limite de contabilização foi atingido ou a ativação ainda não foi confirmada. ${nextStep} ou acesse ${VERBOO_FRONT_BASE_URL}/free-tokens.`)
    this.name = 'FreeTokensRequiredError'
  }
}

type Presenter = () => Promise<boolean>
let presenter: Presenter | undefined
let pending: Promise<boolean> | undefined
let declinedAt = -Infinity

export function registerFreeTokenActivationPresenter(value: Presenter): () => void {
  presenter = value
  return () => { if (presenter === value) presenter = undefined }
}

// All agents in a terminal share one consent prompt. A refusal also suppresses
// late arrivals from requests that were already running in parallel. A fresh
// request can present the choices again immediately after a refusal.
export function requestFreeTokenActivation(options: { startup?: boolean; requestStartedAt?: number } = {}): Promise<boolean> {
  if (getIsNonInteractiveSession() || !process.stdin.isTTY || !process.stdout.isTTY) return Promise.resolve(false)
  if (pending) return pending
  if ((options.requestStartedAt ?? performance.now()) <= declinedAt) return Promise.resolve(false)
  const show = presenter ?? (options.startup ? async () => {
    const { showFreeTokenActivation } = await import('../../components/FreeTokenActivation.js')
    return showFreeTokenActivation()
  } : undefined)
  if (!show) return Promise.resolve(false)
  pending = show().then(async result => {
    if (!result) declinedAt = performance.now()
    else {
      const { clearCLIEntitlementCache } = await import('./cliEntitlement.js')
      const { clearVerbooModelsCache, fetchVerbooModels } = await import('../api/verbooModels.js')
      const { getClaudeAIOAuthTokensAsync } = await import('../../utils/auth.js')
      clearCLIEntitlementCache(); clearVerbooModelsCache()
      const tokens = await getClaudeAIOAuthTokensAsync()
      if (tokens?.accessToken) await fetchVerbooModels(tokens.accessToken, { force: true }).catch(() => {})
    }
    return result
  }).finally(() => { pending = undefined })
  return pending
}
