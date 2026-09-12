import axios from 'axios'

import { runOAuthLoginFlow } from '../../cli/handlers/auth.js'
import {
  getOauthConfig,
  isVerbooMode,
  VERBOO_ROUTER_URL,
} from '../../constants/oauth.js'
import { getApiKeyFromFileDescriptor } from '../../utils/authFileDescriptor.js'
import {
  checkAndRefreshOAuthTokenIfNeeded,
  clearOAuthTokenCache,
  didOAuthRefreshRecover,
  getClaudeAIOAuthTokensAsync,
  getOauthAccountInfo,
  handleOAuth401ErrorWithOutcome,
  saveOAuthTokensIfNeeded,
} from '../../utils/auth.js'
import { getSecureStorage } from '../../utils/secureStorage/index.js'
import { saveGlobalConfig } from '../../utils/config.js'
import { logForDebugging } from '../../utils/debug.js'
import { errorMessage } from '../../utils/errors.js'
import { logError } from '../../utils/log.js'
import { storeOAuthAccountInfo } from './client.js'
import type { OAuthTokens } from './types.js'
import { showNoModelsFlow } from './purchaseFlow.js'
import { requestFreeTokenActivation, FreeTokensRequiredError } from './freeTokenActivation.js'
import { showPastDueNotice } from './pastDueFlow.js'
import { showVerbooTermsAcceptance } from '../../components/VerbooTermsAcceptance.js'
import {
  clearCLIEntitlementCache,
  fetchCLIEntitlement,
  getCLIEntitlementDeniedMessage,
} from './cliEntitlement.js'
import {
  clearCodexModelsCache,
  fetchCodexModels,
} from '../api/codexModels.js'
import {
  clearClaudeNativeModelsCache,
  fetchClaudeNativeModels,
} from '../api/claudeNativeModels.js'
import {
  clearVerbooModelsCache,
  fetchVerbooModels,
} from '../api/verbooModels.js'
import { readCodexCredentialsAsync } from '../../utils/codexCredentials.js'
import {
  hasCurrentClaudeRiskAcceptance,
  readClaudeNativeCredentialsAsync,
} from '../../utils/claudeNativeCredentials.js'
import {
  fetchVerbooTermsStatus,
  formatTermsDeadline,
  getHeadlessTermsRequiredMessage,
  getPublicTermsURL,
} from './verbooTerms.js'

export type VerbooSessionResult =
  | { kind: 'ok'; tokens: OAuthTokens; refreshed: boolean }
  | { kind: 'unauthenticated' }
  | { kind: 'invalid-api-key' }
  | { kind: 'degraded'; reason: string }

export const VERBOO_API_KEY_PREFIX = 'vbk_'
export const VERBOO_API_KEY_INVALID_MESSAGE = 'API key inválida ou expirada'
export const HEADLESS_UNAUTHENTICATED_MESSAGE =
  'Não autenticado no Verboo. Execute `verboo /login` em um terminal interativo antes de usar o modo headless.'

type RouterGet = (
  url: string,
  config?: {
    headers?: Record<string, string>
    timeout?: number
    validateStatus?: () => boolean
  },
) => Promise<{ status: number; data?: unknown }>

function isVerbooApiKey(value: string | null | undefined): value is string {
  return Boolean(value?.startsWith(VERBOO_API_KEY_PREFIX))
}

/** ANTHROPIC_API_KEY first (what the desktop injects), then the FD equivalent. */
export function readHeadlessVerbooApiKey(
  fromFd: () => string | null = getApiKeyFromFileDescriptor,
): string | undefined {
  const fromEnv = process.env.ANTHROPIC_API_KEY?.trim()
  if (isVerbooApiKey(fromEnv)) return fromEnv
  const fd = fromFd()?.trim()
  if (isVerbooApiKey(fd)) return fd
  return undefined
}

/**
 * Router `/models` is the endpoint the desktop already uses with Bearer vbk_
 * (model_service.rs). `/api/me` is the OAuth account API — fake vbk_ and fake
 * JWT both return the same 401, so we do not claim it accepts API keys.
 */
export async function validateVerbooApiKey(
  key: string,
  get: RouterGet = axios.get,
): Promise<'ok' | 'unauthorized' | 'error'> {
  const endpoint = `${VERBOO_ROUTER_URL}/models`
  try {
    const response = await get(endpoint, {
      headers: {
        Authorization: `Bearer ${key}`,
        'Content-Type': 'application/json',
      },
      timeout: 5_000,
      validateStatus: () => true,
    })
    if (response.status === 200) return 'ok'
    if (response.status === 401 || response.status === 403) return 'unauthorized'
    return 'error'
  } catch {
    return 'error'
  }
}

function apiKeySessionTokens(key: string): OAuthTokens {
  return {
    accessToken: key,
    refreshToken: null,
    expiresAt: null,
    scopes: [],
    subscriptionType: null,
    rateLimitTier: null,
  }
}

async function sessionFromVerbooApiKey(): Promise<VerbooSessionResult> {
  const key = readHeadlessVerbooApiKey()
  if (!key) return { kind: 'unauthenticated' }
  const check = await validateVerbooApiKey(key)
  if (check === 'ok') {
    return { kind: 'ok', tokens: apiKeySessionTokens(key), refreshed: false }
  }
  if (check === 'unauthorized') return { kind: 'invalid-api-key' }
  return { kind: 'degraded', reason: 'API key validation failed' }
}

async function unauthenticatedOrApiKey(): Promise<VerbooSessionResult> {
  const apiKeySession = await sessionFromVerbooApiKey()
  if (apiKeySession.kind !== 'unauthenticated') return apiKeySession
  return { kind: 'unauthenticated' }
}

function isApiKeySession(tokens: OAuthTokens): boolean {
  return tokens.accessToken.startsWith(VERBOO_API_KEY_PREFIX)
}

export function headlessSessionFailureError(
  session: { kind: 'invalid-api-key' | 'unauthenticated' },
): Error {
  if (session.kind === 'invalid-api-key') {
    return new Error(VERBOO_API_KEY_INVALID_MESSAGE)
  }
  return new Error(HEADLESS_UNAUTHENTICATED_MESSAGE)
}

export type VerbooLoginPreflightResult =
  | {
      kind: 'ready'
      tokens: OAuthTokens
      refreshed: boolean
    }
  | { kind: 'needs-oauth'; reason: 'unauthenticated' }
  | { kind: 'needs-subscription'; tokens: OAuthTokens }
  | { kind: 'degraded'; reason: string }

let validated = false

export function isVerbooSessionValidated(): boolean {
  return validated
}

export function resetVerbooSessionValidation(): void {
  validated = false
  clearCLIEntitlementCache()
}

export function markVerbooSessionValidated(): void {
  validated = true
}

type MeResponse = {
  data?: {
    id: string
    email: string
    name: string
    avatarUrl?: string | null
    confirmed: boolean
    isAdmin?: boolean
  }
}

async function callApiMe(
  accessToken: string,
): Promise<
  | { status: 'ok'; data: MeResponse['data'] }
  | { status: 'unauthorized' }
  | { status: 'error'; reason: string }
> {
  const endpoint = `${getOauthConfig().BASE_API_URL}/api/me`
  try {
    const response = await axios.get<MeResponse>(endpoint, {
      headers: {
        Authorization: `Bearer ${accessToken}`,
        'Content-Type': 'application/json',
      },
      timeout: 5_000,
      validateStatus: () => true,
    })
    if (response.status === 200 && response.data?.data) {
      return { status: 'ok', data: response.data.data }
    }
    if (response.status === 401 || response.status === 403) {
      return { status: 'unauthorized' }
    }
    return { status: 'error', reason: `HTTP ${response.status}` }
  } catch (err) {
    return { status: 'error', reason: errorMessage(err) }
  }
}

function persistAccount(user: NonNullable<MeResponse['data']>): void {
  storeOAuthAccountInfo({
    accountUuid: user.id,
    emailAddress: user.email,
    organizationUuid: user.id,
    displayName: user.name || undefined,
  })
}

export async function validateVerbooSession(): Promise<VerbooSessionResult> {
  if (!isVerbooMode()) {
    return { kind: 'degraded', reason: 'not in verboo mode' }
  }

  // The startup flow used to validate the access token first and only then
  // attempt a refresh. That leaves every user with an expired access token
  // exposed to a transient /api/me failure, after which /v1/models receives
  // the same stale token. Refresh proactively (the helper is lock-safe across
  // concurrent CLI processes) before making either authenticated request.
  await checkAndRefreshOAuthTokenIfNeeded()

  const tokens = await getClaudeAIOAuthTokensAsync()
  if (!tokens?.accessToken) {
    // OAuth is primary; vbk_ is the headless fallback (desktop injects it
    // as ANTHROPIC_API_KEY).
    return sessionFromVerbooApiKey()
  }

  let result = await callApiMe(tokens.accessToken)

  if (result.status === 'unauthorized' && tokens.refreshToken) {
    logForDebugging('[VerbooStartup] /api/me returned 401, tentando refresh')
    try {
      const outcome = await handleOAuth401ErrorWithOutcome(tokens.accessToken)
      if (!didOAuthRefreshRecover(outcome)) {
        return outcome === 'transient_error'
          ? { kind: 'degraded', reason: 'temporary OAuth refresh failure' }
          : unauthenticatedOrApiKey()
      }
      const refreshed = await getClaudeAIOAuthTokensAsync()
      if (!refreshed?.accessToken) return unauthenticatedOrApiKey()
      result = await callApiMe(refreshed.accessToken)
      if (result.status === 'ok' && result.data) {
        persistAccount(result.data)
        return { kind: 'ok', tokens: refreshed, refreshed: true }
      }
    } catch (err) {
      logError(err as Error)
    }
    return unauthenticatedOrApiKey()
  }

  if (result.status === 'ok') {
    if (!result.data) {
      return { kind: 'degraded', reason: 'empty /api/me payload' }
    }
    if (!getOauthAccountInfo()) {
      persistAccount(result.data)
    }
    return { kind: 'ok', tokens, refreshed: false }
  }

  if (result.status === 'unauthorized') {
    return unauthenticatedOrApiKey()
  }

  // Erro de rede / 5xx: deixar passar com warning para não bloquear startup
  // se a API estiver instável. Se realmente sem token, próxima request 401
  // reativa o fluxo via withOAuth401Retry.
  return { kind: 'degraded', reason: result.reason }
}

export type EnsureAuthOpts = {
  /**
   * Callback para abrir o navegador / mostrar UI durante o fluxo de login.
   * Recebe a URL de autorização. Quando ausente, usa stdout simples.
   */
  onAuthUrl?: (url: string) => void | Promise<void>
}

async function ensureVerbooTermsAccepted(accessToken: string): Promise<void> {
  const result = await fetchVerbooTermsStatus(accessToken)
  if (result.kind === 'unauthorized') {
    throw new Error(
      'Sua sessão expirou durante a verificação dos Termos de Uso. Execute `verboo /login` e tente novamente.',
    )
  }
  if (result.kind === 'unavailable') {
    throw new Error(
      `Não foi possível verificar o aceite dos Termos de Uso: ${result.reason}. ` +
        'Por segurança, o acesso não será liberado sem essa verificação.',
    )
  }

  const { status } = result
  if (!status.configured) return
  if (!status.current) {
    throw new Error(
      'O servidor informou que existem Termos de Uso, mas não retornou a versão vigente.',
    )
  }

  if (status.mustAccept) {
    if (!process.stdin.isTTY || !process.stdout.isTTY) {
      throw new Error(getHeadlessTermsRequiredMessage(status))
    }
    const acceptance = await showVerbooTermsAcceptance(accessToken, status)
    if (acceptance.kind !== 'accepted') {
      throw new Error(
        'Os Termos de Uso não foram aceitos. O acesso ao produto permanece bloqueado.',
      )
    }
    process.stdout.write(
      `\n✓ Termos de Uso versão ${status.current.version} aceitos e registrados pelo servidor.\n\n`,
    )
    return
  }

  if (status.pendingReacceptance) {
    const deadline = formatTermsDeadline(status.current.enforcementAt)
    process.stderr.write(
      `\n⚠ Os Termos de Uso versão ${status.current.version} foram atualizados.` +
        `${deadline ? ` O aceite será obrigatório em ${deadline} (horário de Fortaleza).` : ''}` +
        `\nLeia em ${getPublicTermsURL(status)} e execute /terms para aceitar.\n\n`,
    )
  }
}

async function ensureCLIEntitlement(accessToken: string): Promise<void> {
  const requestStartedAt = performance.now()
  clearCLIEntitlementCache()
  let entitlement = await fetchCLIEntitlement({ force: true })
  if (entitlement.allowed) return

  if (entitlement.reason === 'free_tokens_exhausted' || entitlement.reason === 'free_tokens_activation_pending' || entitlement.reason === 'free_tokens_accounting_pending') {
    if (await requestFreeTokenActivation({ startup: true, requestStartedAt })) {
      entitlement = await fetchCLIEntitlement({ force: true })
      if (entitlement.allowed) return
    }
    throw new FreeTokensRequiredError()
  }
  if (entitlement.reason === 'past_due') {
    const resolved = await showPastDueNotice(accessToken)
    if (resolved) {
      clearCLIEntitlementCache()
      entitlement = await fetchCLIEntitlement({ force: true })
      if (entitlement.allowed) return
    }
  } else if (process.stdin.isTTY && process.stdout.isTTY) {
    const purchased = await showNoModelsFlow(accessToken)
    if (purchased) {
      for (let attempt = 0; attempt < 4; attempt += 1) {
        clearCLIEntitlementCache()
        entitlement = await fetchCLIEntitlement({ force: true })
        if (entitlement.allowed) return
        if (attempt < 3) {
          await new Promise(resolve => setTimeout(resolve, 3_000))
        }
      }
    }
  }

  throw new Error(getCLIEntitlementDeniedMessage(entitlement.reason))
}

async function primeCodexCatalogIfAuthenticated(): Promise<void> {
  const credentials = await readCodexCredentialsAsync()
  if (!credentials) return
  clearCodexModelsCache()
  try {
    await fetchCodexModels({ force: true })
  } catch (error) {
    logForDebugging(
      `[VerbooStartup] Não foi possível atualizar o catálogo Codex: ${errorMessage(error)}`,
      { level: 'warn' },
    )
  }
}

async function primeClaudeCatalogIfAuthenticated(): Promise<void> {
  const credentials = await readClaudeNativeCredentialsAsync()
  if (!credentials || !hasCurrentClaudeRiskAcceptance(credentials)) return
  clearClaudeNativeModelsCache()
  try {
    await fetchClaudeNativeModels({ force: true })
  } catch (error) {
    logForDebugging(
      `[VerbooStartup] Não foi possível atualizar o catálogo Claude opcional: ${errorMessage(error)}`,
      { level: 'warn' },
    )
  }
}

async function loadVerbooCatalog(accessToken: string): Promise<void> {
  clearVerbooModelsCache()
  const models = await fetchVerbooModels(accessToken, { force: true })
  if (models.length === 0) {
    throw new Error(
      'Nenhum modelo Verboo está disponível para esta conta no momento.',
    )
  }
}

export async function installVerbooOAuthTokens(
  tokens: OAuthTokens,
): Promise<void> {
  const storage = getSecureStorage()
  const storageData = storage.read() || {}
  const updatedStorageData = { ...storageData }
  delete updatedStorageData.verbooApiKey
  storage.update(updatedStorageData)

  const result = saveOAuthTokensIfNeeded(tokens)
  if (!result.success) {
    throw new Error(result.warning ?? 'Não foi possível salvar a sessão Verboo')
  }
  clearOAuthTokenCache()
}

export async function preflightVerbooLogin(): Promise<VerbooLoginPreflightResult> {
  if (!isVerbooMode()) {
    return { kind: 'degraded', reason: 'not in verboo mode' }
  }

  const session = await validateVerbooSession()
  if (session.kind === 'unauthenticated') {
    return { kind: 'needs-oauth', reason: 'unauthenticated' }
  }
  if (session.kind === 'invalid-api-key') {
    return { kind: 'degraded', reason: VERBOO_API_KEY_INVALID_MESSAGE }
  }
  if (session.kind === 'degraded') {
    return { kind: 'degraded', reason: session.reason }
  }
  if (isApiKeySession(session.tokens)) {
    return {
      kind: 'ready',
      tokens: session.tokens,
      refreshed: session.refreshed,
    }
  }

  const terms = await fetchVerbooTermsStatus(session.tokens.accessToken)
  if (terms.kind === 'unauthorized') {
    return { kind: 'needs-oauth', reason: 'unauthenticated' }
  }
  if (terms.kind === 'unavailable') {
    return {
      kind: 'degraded',
      reason: `verificação dos termos: ${terms.reason}`,
    }
  }
  if (terms.status.mustAccept) {
    return {
      kind: 'degraded',
      reason: `${getHeadlessTermsRequiredMessage(terms.status)} Execute /terms para aceitar diretamente no CLI.`,
    }
  }

  let entitlement
  try {
    entitlement = await fetchCLIEntitlement({ force: true })
  } catch (error) {
    return { kind: 'degraded', reason: errorMessage(error) }
  }
  if (!entitlement.allowed) {
    return { kind: 'needs-subscription', tokens: session.tokens }
  }

  return {
    kind: 'ready',
    tokens: session.tokens,
    refreshed: session.refreshed,
  }
}

/**
 * Garante que existe uma sessão Verboo válida antes do REPL montar. Em modo
 * não-TTY (ex.: -p headless), lança erro com mensagem clara em vez de abrir
 * navegador.
 */
export async function ensureVerbooAuthenticated(
  opts: EnsureAuthOpts = {},
): Promise<void> {
  if (!isVerbooMode() || validated) return

  const session = await validateVerbooSession()

  if (session.kind === 'ok') {
    if (!isApiKeySession(session.tokens)) {
      await ensureVerbooTermsAccepted(session.tokens.accessToken)
      await ensureCLIEntitlement(session.tokens.accessToken)
    }
    await loadVerbooCatalog(session.tokens.accessToken)
    await primeCodexCatalogIfAuthenticated()
    await primeClaudeCatalogIfAuthenticated()
    validated = true
    return
  }

  if (session.kind === 'degraded') {
    logForDebugging(
      `[VerbooStartup] Sessão degradada: ${session.reason}. Validando termos e licença antes de liberar.`,
    )

    const stored = await getClaudeAIOAuthTokensAsync()
    if (!stored?.accessToken) {
      throw new Error('Não foi possível validar a sessão local do Verboo.')
    }
    await ensureVerbooTermsAccepted(stored.accessToken)
    await ensureCLIEntitlement(stored.accessToken)
    await loadVerbooCatalog(stored.accessToken)
    await primeCodexCatalogIfAuthenticated()
    await primeClaudeCatalogIfAuthenticated()
    validated = true
    return
  }

  if (session.kind === 'invalid-api-key') {
    throw headlessSessionFailureError(session)
  }

  // unauthenticated → precisa abrir login. Só faz sentido em TTY.
  if (!process.stdin.isTTY || !process.stdout.isTTY) {
    throw headlessSessionFailureError(session)
  }

  process.stdout.write(
    '\n🔐 Você precisa autenticar para usar o Verboo Code.\n',
  )
  process.stdout.write('Abrindo navegador em code.verboo.ai…\n')

  const onAuthUrl =
    opts.onAuthUrl ??
    ((url: string) => {
      process.stdout.write(`\nCaso o navegador não abra, acesse:\n${url}\n\n`)
    })

  const tokens = await runOAuthLoginFlow({
    loginWithClaudeAi: false,
    onAuthUrl,
  })

  await installVerbooOAuthTokens(tokens)
  const confirmedSession = await validateVerbooSession()
  if (confirmedSession.kind === 'unauthenticated') {
    throw new Error(
      'A sessão recém-autenticada foi rejeitada pelo Verboo. Feche variáveis de credencial herdadas do terminal e tente `verboo /login` novamente.',
    )
  }
  process.stdout.write('\n✓ Autenticação concluída.\n\n')

  saveGlobalConfig((current) =>
    current.hasCompletedOnboarding
      ? current
      : { ...current, hasCompletedOnboarding: true },
  )

  // Terms and the server-side CLI entitlement must both confirm access before
  // the session is marked as validated.
  const accessToken =
    confirmedSession.kind === 'ok'
      ? confirmedSession.tokens.accessToken
      : tokens.accessToken
  await ensureVerbooTermsAccepted(accessToken)
  await ensureCLIEntitlement(accessToken)
  await loadVerbooCatalog(accessToken)
  await primeCodexCatalogIfAuthenticated()
  await primeClaudeCatalogIfAuthenticated()
  validated = true
}
