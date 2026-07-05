// @ts-nocheck
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { spawnSync } from 'node:child_process'
import {
  resolveCodexApiCredentials,
  resolveProviderRequest,
  isLocalProviderUrl as isProviderLocalUrl,
} from '../src/services/api/providerConfig.js'
import {
  getRouteCredentialEnvVars,
  getRouteCredentialValue,
  resolveActiveRouteIdFromEnv,
  resolveRouteIdFromBaseUrl,
} from '../src/integrations/routeMetadata.js'
import {
  getLocalOpenAICompatibleProviderLabel,
  probeOllamaGenerationReadiness,
} from '../src/utils/providerDiscovery.js'
import {
  DEFAULT_GEMINI_MODEL,
  resolveOpenAICredentialEnvState,
} from '../src/utils/providerProfile.js'
import {
  redactSecretValueForDisplay,
  redactSecretSubstringsForDisplay,
  type SecretValueSource,
} from '../src/utils/providerSecrets.js'
import { redactUrlForDisplay } from '../src/utils/urlRedaction.js'
import {
  MIN_NODE_ENGINE_RANGE,
  checkSupportedNodeVersion,
} from '../src/utils/nodeRuntime.js'
import { SandboxManager } from '../src/utils/sandbox/sandbox-adapter.js'

type CheckResult = {
  ok: boolean
  label: string
  detail?: string
}

type NodeExecutableVersionProbe =
  | {
    ok: true
    version: string
  }
  | {
    ok: false
    detail: string
  }

type CliOptions = {
  json: boolean
  outFile: string | null
}

function pass(label: string, detail?: string): CheckResult {
  return { ok: true, label, detail }
}

function fail(label: string, detail?: string): CheckResult {
  return { ok: false, label, detail }
}

function isTruthy(value: string | undefined): boolean {
  if (!value) return false
  const normalized = value.trim().toLowerCase()
  return normalized !== '' && normalized !== '0' && normalized !== 'false' && normalized !== 'no'
}

function parseOptions(argv: string[]): CliOptions {
  const options: CliOptions = {
    json: false,
    outFile: null,
  }

  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i]
    if (arg === '--json') {
      options.json = true
      continue
    }

    if (arg === '--out') {
      const next = argv[i + 1]
      if (next && !next.startsWith('--')) {
        options.outFile = next
        i++
      }
    }
  }

  return options
}

export function formatReachabilityFailureDetail(
  endpoint: string,
  status: number,
  responseBody: string,
  request: {
    transport: string
    requestedModel: string
    resolvedModel: string
  },
): string {
  const compactBody = safeDiagnosticText(
    responseBody.trim().replace(/\s+/g, ' ').slice(0, 240),
    '',
  )
  const base = `Unexpected status ${status} from ${redactUrlForDisplay(endpoint)}.`
  const bodySuffix = compactBody ? ` Body: ${compactBody}` : ''

  if (request.transport !== 'codex_responses' || status !== 400) {
    return `${base}${bodySuffix}`
  }

  if (!/not supported.*chatgpt account/i.test(responseBody)) {
    return `${base}${bodySuffix}`
  }

  const requestedModel = safeDisplayValue(request.requestedModel, 'the requested model')
  const resolvedModel = safeDisplayValue(request.resolvedModel, 'the resolved model')
  return `${base}${bodySuffix} Hint: model alias "${requestedModel}" resolved to "${resolvedModel}", which this ChatGPT account does not currently allow. Try "codexplan" or another entitled Codex model.`
}

export function readNodeExecutableVersion(
  spawn = spawnSync,
): NodeExecutableVersionProbe {
  const result = spawn('node', ['--version'], {
    encoding: 'utf8',
  })

  if (result.error) {
    return {
      ok: false,
      detail: `Unable to run \`node --version\`: ${result.error.message}. OpenClaude requires Node.js ${MIN_NODE_ENGINE_RANGE} on PATH.`,
    }
  }

  if (result.status !== 0) {
    const output = (result.stderr || result.stdout || '').trim()
    const suffix = output ? `: ${output}` : `: exit code ${result.status ?? 'unknown'}`
    return {
      ok: false,
      detail: `Unable to run \`node --version\`${suffix}. OpenClaude requires Node.js ${MIN_NODE_ENGINE_RANGE} on PATH.`,
    }
  }

  const version = (result.stdout || result.stderr || '').trim()
  if (!version) {
    return {
      ok: false,
      detail: `Unable to read Node.js version from \`node --version\`. OpenClaude requires Node.js ${MIN_NODE_ENGINE_RANGE} on PATH.`,
    }
  }

  return {
    ok: true,
    version,
  }
}

export function checkNodeVersion(
  raw: string | NodeExecutableVersionProbe = readNodeExecutableVersion(),
): CheckResult {
  if (typeof raw !== 'string' && !raw.ok) {
    return fail('Node.js version', raw.detail)
  }

  const versionCheck = checkSupportedNodeVersion(
    typeof raw === 'string' ? raw : raw.version,
  )
  if (!versionCheck.ok) {
    return fail('Node.js version', versionCheck.message)
  }

  return pass('Node.js version', versionCheck.version)
}

function checkBunRuntime(): CheckResult {
  const bunVersion = (globalThis as { Bun?: { version?: string } }).Bun?.version
  if (!bunVersion) {
    return pass('Bun runtime', 'Not running inside Bun (this is acceptable for Node startup).')
  }
  return pass('Bun runtime', bunVersion)
}

function checkBuildArtifacts(): CheckResult {
  const distCli = resolve(process.cwd(), 'dist', 'cli.mjs')
  if (!existsSync(distCli)) {
    return fail('Build artifacts', `Missing ${distCli}. Run: bun run build`)
  }
  return pass('Build artifacts', distCli)
}

export function isCliSandboxRuntimeStubbed(bundleText: string): boolean {
  return bundleText.includes('native-stub:@anthropic-ai/sandbox-runtime')
}

type SandboxRuntimeCheckInput =
  | {
      inspectionError: unknown
    }
  | {
      cliRuntimeStubbed: boolean
      sandboxEnabled: boolean
      failIfUnavailable: boolean
      sandboxingEnabled: boolean
      unavailableReason?: string
    }

function formatUnknownError(error: unknown): string {
  return error instanceof Error ? error.message : String(error)
}

export function buildSandboxRuntimeCheck(
  input: SandboxRuntimeCheckInput,
): CheckResult {
  if ('inspectionError' in input) {
    return fail(
      'Sandbox runtime',
      `Unable to inspect CLI sandbox runtime: ${formatUnknownError(input.inspectionError)}`,
    )
  }

  const effectiveBehavior = input.sandboxingEnabled
    ? 'enforcing'
    : input.sandboxEnabled
      ? input.failIfUnavailable
        ? 'fail-closed'
        : 'warning-only'
      : 'disabled'

  const detailParts = [
    `CLI bundle: ${input.cliRuntimeStubbed ? 'stubbed' : 'real runtime'}`,
    `sandbox.enabled: ${input.sandboxEnabled}`,
    `failIfUnavailable: ${input.failIfUnavailable}`,
    `effective behavior: ${effectiveBehavior}`,
  ]
  const reason =
    input.unavailableReason ??
    (input.cliRuntimeStubbed && input.sandboxEnabled
      ? 'CLI bundle contains a no-op sandbox runtime stub'
      : undefined)
  if (reason) {
    detailParts.push(`reason: ${reason}`)
  }

  const ok = !(
    input.sandboxEnabled &&
    input.failIfUnavailable &&
    Boolean(reason)
  )
  return ok
    ? pass('Sandbox runtime', detailParts.join('; '))
    : fail('Sandbox runtime', detailParts.join('; '))
}

function checkSandboxRuntime(): CheckResult {
  const distCli = resolve(process.cwd(), 'dist', 'cli.mjs')
  if (!existsSync(distCli)) {
    return fail(
      'Sandbox runtime',
      `CLI bundle missing at ${distCli}. Run: bun run build`,
    )
  }

  try {
    const bundle = readFileSync(distCli, 'utf8')
    return buildSandboxRuntimeCheck({
      cliRuntimeStubbed: isCliSandboxRuntimeStubbed(bundle),
      sandboxEnabled: SandboxManager.isSandboxEnabledInSettings(),
      failIfUnavailable: SandboxManager.isSandboxRequired(),
      sandboxingEnabled: SandboxManager.isSandboxingEnabled(),
      unavailableReason: SandboxManager.getSandboxUnavailableReason(),
    })
  } catch (error) {
    return buildSandboxRuntimeCheck({ inspectionError: error })
  }
}

function isLocalBaseUrl(baseUrl: string): boolean {
  return isProviderLocalUrl(baseUrl)
}

const GEMINI_DEFAULT_BASE_URL = 'https://generativelanguage.googleapis.com/v1beta/openai'
const MISTRAL_DEFAULT_BASE_URL = 'https://api.mistral.ai/v1'
const GITHUB_COPILOT_BASE = 'https://api.githubcopilot.com'

function currentSecretSource(): SecretValueSource {
  return process.env as SecretValueSource
}

function safeDisplayValue(
  value: string | null | undefined,
  fallback: string,
): string {
  return redactSecretValueForDisplay(value, currentSecretSource()) ?? fallback
}

function safeDiagnosticText(
  value: string | null | undefined,
  fallback: string,
): string {
  return redactSecretSubstringsForDisplay(value, currentSecretSource()) ?? fallback
}

function safeBaseUrlDisplay(
  value: string | null | undefined,
  fallback: string,
): string {
  if (!value) return fallback
  return safeDisplayValue(redactUrlForDisplay(value), fallback)
}

function getOpenAICompatibleRouteId(baseUrl: string): string {
  return (
    resolveRouteIdFromBaseUrl(baseUrl) ??
    resolveActiveRouteIdFromEnv(process.env) ??
    'custom'
  )
}

function getOpenAICompatibleCredentialContext(baseUrl: string): {
  routeId: string
  envVars: string[]
  value: string | undefined
} {
  const routeId = getOpenAICompatibleRouteId(baseUrl)
  return {
    routeId,
    envVars: getRouteCredentialEnvVars(routeId),
    value: getRouteCredentialValue(routeId, process.env),
  }
}

function hasPlaceholderCredential(value: string | undefined): boolean {
  return (value ?? '').split(',').some(part => part.trim() === 'SUA_CHAVE')
}

function currentBaseUrl(): string {
  if (isTruthy(process.env.CLAUDE_CODE_USE_GEMINI)) {
    return process.env.GEMINI_BASE_URL ?? GEMINI_DEFAULT_BASE_URL
  }
  if (isTruthy(process.env.CLAUDE_CODE_USE_MISTRAL)) {
    return process.env.MISTRAL_BASE_URL ?? MISTRAL_DEFAULT_BASE_URL
  }
  if (isTruthy(process.env.CLAUDE_CODE_USE_GITHUB)) {
    return process.env.OPENAI_BASE_URL ?? GITHUB_COPILOT_BASE
  }
  return process.env.OPENAI_BASE_URL ?? 'https://api.openai.com/v1'
}

function checkGeminiEnv(): CheckResult[] {
  const results: CheckResult[] = []
  const model = process.env.GEMINI_MODEL
  const key = process.env.GEMINI_API_KEY ?? process.env.GOOGLE_API_KEY
  const baseUrl = process.env.GEMINI_BASE_URL ?? GEMINI_DEFAULT_BASE_URL

  results.push(pass('Provider mode', 'Google Gemini provider enabled.'))

  if (!model) {
    results.push(pass('GEMINI_MODEL', `Not set. Default ${DEFAULT_GEMINI_MODEL} will be used.`))
  } else {
    results.push(pass('GEMINI_MODEL', safeDisplayValue(model, '')))
  }

  results.push(pass('GEMINI_BASE_URL', safeBaseUrlDisplay(baseUrl, '')))

  if (!key) {
    results.push(fail('GEMINI_API_KEY', 'Missing. Set GEMINI_API_KEY or GOOGLE_API_KEY.'))
  } else {
    results.push(pass('GEMINI_API_KEY', 'Configured.'))
  }

  return results
}

function checkMistralEnv(): CheckResult[] {
  const results: CheckResult[] = []
  const model = process.env.MISTRAL_MODEL
  const key = process.env.MISTRAL_API_KEY
  const baseUrl = process.env.MISTRAL_BASE_URL ?? MISTRAL_DEFAULT_BASE_URL

  results.push(pass('Provider mode', 'Mistral provider enabled.'))

  if (!model) {
    results.push(pass('MISTRAL_MODEL', 'Not set. Default will be used at runtime.'))
  } else {
    results.push(pass('MISTRAL_MODEL', safeDisplayValue(model, '')))
  }

  results.push(pass('MISTRAL_BASE_URL', safeBaseUrlDisplay(baseUrl, '')))

  if (!key) {
    results.push(fail('MISTRAL_API_KEY', 'Missing. Set MISTRAL_API_KEY.'))
  } else {
    results.push(pass('MISTRAL_API_KEY', 'Configured.'))
  }

  return results
}

function checkGithubEnv(): CheckResult[] {
  const results: CheckResult[] = []
  const baseUrl = process.env.OPENAI_BASE_URL ?? GITHUB_COPILOT_BASE
  results.push(pass('Provider mode', 'GitHub Models provider enabled.'))

  const token = process.env.GITHUB_TOKEN ?? process.env.GH_TOKEN
  if (!token?.trim()) {
    results.push(fail('GITHUB_TOKEN', 'Missing. Set GITHUB_TOKEN or GH_TOKEN.'))
  } else {
    results.push(pass('GITHUB_TOKEN', 'Configured.'))
  }

  if (!process.env.OPENAI_MODEL) {
    results.push(
      pass(
        'OPENAI_MODEL',
        'Not set. Default github:copilot → openai/gpt-4.1 at runtime.',
      ),
    )
  } else {
    results.push(pass('OPENAI_MODEL', safeDisplayValue(process.env.OPENAI_MODEL, '')))
  }

  results.push(pass('OPENAI_BASE_URL', safeBaseUrlDisplay(baseUrl, '')))
  return results
}

export function checkOpenAIEnv(): CheckResult[] {
  const results: CheckResult[] = []
  const useGemini = isTruthy(process.env.CLAUDE_CODE_USE_GEMINI)
  const useGithub = isTruthy(process.env.CLAUDE_CODE_USE_GITHUB)
  const useMistral = isTruthy(process.env.CLAUDE_CODE_USE_MISTRAL)
  const useOpenAI = isTruthy(process.env.CLAUDE_CODE_USE_OPENAI)

  if (useGemini) {
    return checkGeminiEnv()
  }

  if (useMistral) {
    return checkMistralEnv()
  }

  if (useGithub && !useOpenAI) {
    return checkGithubEnv()
  }

  if (!useOpenAI) {
    results.push(pass('Provider mode', 'Anthropic login flow enabled (CLAUDE_CODE_USE_OPENAI is off).'))
    return results
  }

  const request = resolveProviderRequest({
    model: process.env.OPENAI_MODEL,
    baseUrl: process.env.OPENAI_BASE_URL,
  })

  results.push(
    pass(
      'Provider mode',
      request.transport === 'codex_responses'
        ? 'Codex responses backend enabled.'
        : 'OpenAI-compatible provider enabled.',
    ),
  )

  if (!process.env.OPENAI_MODEL) {
    results.push(pass('OPENAI_MODEL', 'Not set. Runtime fallback model will be used.'))
  } else {
    results.push(pass('OPENAI_MODEL', safeDisplayValue(process.env.OPENAI_MODEL, '')))
  }

  results.push(pass('OPENAI_BASE_URL', safeBaseUrlDisplay(request.baseUrl, '')))

  if (request.transport === 'codex_responses') {
    const credentials = resolveCodexApiCredentials(process.env)
    if (!credentials.apiKey) {
      const authHint = credentials.authPath
        ? `Missing CODEX_API_KEY and no usable auth.json at ${credentials.authPath}.`
        : 'Missing CODEX_API_KEY and auth.json fallback.'
      results.push(fail('CODEX auth', authHint))
    } else if (!credentials.accountId) {
      results.push(fail('CHATGPT_ACCOUNT_ID', 'Missing chatgpt_account_id in Codex auth.'))
    } else {
      const detail = credentials.source === 'env'
        ? 'Using CODEX_API_KEY.'
        : `Using ${credentials.authPath}.`
      results.push(pass('CODEX auth', detail))
    }
    return results
  }

  const credentialContext = getOpenAICompatibleCredentialContext(request.baseUrl)
  const providerCredential = credentialContext.value
  const credentialLabel =
    credentialContext.envVars.length > 0
      ? credentialContext.envVars.join(' or ')
      : 'OPENAI_API_KEY'
  const githubToken = process.env.GITHUB_TOKEN ?? process.env.GH_TOKEN
  const hasGithubRouteCredential =
    credentialContext.routeId === 'github' && Boolean(githubToken?.trim())
  const openAIState = resolveOpenAICredentialEnvState(process.env)
  const hasOpenAIFallback =
    credentialContext.envVars.includes('OPENAI_API_KEYS') ||
    credentialContext.envVars.includes('OPENAI_API_KEY')
  const hasPlaceholderProviderCredential = credentialContext.envVars.some(envVar => {
    if (
      hasOpenAIFallback &&
      (envVar === 'OPENAI_API_KEYS' || envVar === 'OPENAI_API_KEY')
    ) {
      return openAIState.invalid && openAIState.envVar === envVar
    }
    return hasPlaceholderCredential(process.env[envVar])
  })
  if (
    hasPlaceholderCredential(providerCredential) ||
    hasPlaceholderProviderCredential
  ) {
    results.push(fail(credentialLabel, 'Placeholder value detected: SUA_CHAVE.'))
  } else if (
    !providerCredential &&
    !isLocalBaseUrl(request.baseUrl) &&
    !hasGithubRouteCredential
  ) {
    results.push(fail(credentialLabel, `Missing key for non-local provider URL. Set ${credentialLabel}.`))
  } else if (!providerCredential && hasGithubRouteCredential) {
    results.push(
      pass('OPENAI_API_KEY', 'Not set; GITHUB_TOKEN/GH_TOKEN will be used for GitHub Models.'),
    )
  } else if (!providerCredential) {
    results.push(pass(credentialLabel, 'Not set (allowed for local providers like Atomic Chat/Ollama/LM Studio).'))
  } else {
    results.push(pass(credentialLabel, 'Configured.'))
  }

  return results
}

async function checkBaseUrlReachability(): Promise<CheckResult> {
  const useGemini = isTruthy(process.env.CLAUDE_CODE_USE_GEMINI)
  const useOpenAI = isTruthy(process.env.CLAUDE_CODE_USE_OPENAI)
  const useGithub = isTruthy(process.env.CLAUDE_CODE_USE_GITHUB)
  const useMistral = isTruthy(process.env.CLAUDE_CODE_USE_MISTRAL)

  if (!useGemini && !useOpenAI && !useGithub && !useMistral) {
    return pass('Provider reachability', 'Skipped (OpenAI-compatible mode disabled).')
  }

  if (useGithub && !useOpenAI) {
    return pass(
      'Provider reachability',
      'Skipped for GitHub Models (inference endpoint differs from OpenAI /models probe).',
    )
  }

  const geminiBaseUrl = 'https://generativelanguage.googleapis.com/v1beta/openai'
  const resolvedBaseUrl = useGemini
    ? (process.env.GEMINI_BASE_URL ?? geminiBaseUrl)
    : undefined
  const request = resolveProviderRequest({
    model: process.env.OPENAI_MODEL,
    baseUrl: resolvedBaseUrl ?? process.env.OPENAI_BASE_URL,
  })
  const endpoint = request.transport === 'codex_responses'
    ? `${request.baseUrl}/responses`
    : `${request.baseUrl}/models`
  const redactedEndpoint = redactUrlForDisplay(endpoint)

  const controller = new AbortController()
  const timeout = setTimeout(() => controller.abort(), 4000)

  try {
    const headers: Record<string, string> = {}
    let method = 'GET'
    let body: string | undefined

    if (request.transport === 'codex_responses') {
      const credentials = resolveCodexApiCredentials(process.env)
      if (credentials.apiKey) {
        headers.Authorization = `Bearer ${credentials.apiKey}`
      }
      if (credentials.accountId) {
        headers['chatgpt-account-id'] = credentials.accountId
      }
      headers['Content-Type'] = 'application/json'
      headers.originator = 'openclaude'
      method = 'POST'
      body = JSON.stringify({
        model: request.resolvedModel,
        instructions: 'Runtime doctor probe.',
        input: [
          {
            type: 'message',
            role: 'user',
            content: [{ type: 'input_text', text: 'ping' }],
          },
        ],
        store: false,
        stream: true,
      })
    } else if (useGemini && (process.env.GEMINI_API_KEY ?? process.env.GOOGLE_API_KEY)) {
      headers.Authorization = `Bearer ${process.env.GEMINI_API_KEY ?? process.env.GOOGLE_API_KEY}`
    } else if (useMistral && process.env.MISTRAL_API_KEY) {
      headers.Authorization = `Bearer ${process.env.MISTRAL_API_KEY}`
    } else {
      const credential = getOpenAICompatibleCredentialContext(request.baseUrl).value
      if (credential) {
        headers.Authorization = `Bearer ${credential}`
      }
    }

    const response = await fetch(endpoint, {
      method,
      headers,
      body,
      signal: controller.signal,
    })

    if (response.status === 200 || response.status === 401 || response.status === 403) {
      return pass(
        'Provider reachability',
        `Reached ${redactedEndpoint} (status ${response.status}).`,
      )
    }

    const responseBody = await response.text().catch(() => '')
    const detail = formatReachabilityFailureDetail(
      endpoint,
      response.status,
      responseBody,
      request,
    )
    return fail(
      'Provider reachability',
      detail,
    )
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error)
    return fail(
      'Provider reachability',
      `Failed to reach ${redactedEndpoint}: ${message}`,
    )
  } finally {
    clearTimeout(timeout)
  }
}

async function checkProviderGenerationReadiness(): Promise<CheckResult> {
  const useGemini = isTruthy(process.env.CLAUDE_CODE_USE_GEMINI)
  const useOpenAI = isTruthy(process.env.CLAUDE_CODE_USE_OPENAI)
  const useGithub = isTruthy(process.env.CLAUDE_CODE_USE_GITHUB)
  const useMistral = isTruthy(process.env.CLAUDE_CODE_USE_MISTRAL)

  if (!useGemini && !useOpenAI && !useGithub && !useMistral) {
    return pass('Provider generation readiness', 'Skipped (OpenAI-compatible mode disabled).')
  }

  if (useGithub && !useOpenAI) {
    return pass(
      'Provider generation readiness',
      'Skipped for GitHub Models (runtime generation uses a different endpoint flow).',
    )
  }

  if (useGemini || useMistral) {
    return pass(
      'Provider generation readiness',
      'Skipped for managed provider mode.',
    )
  }

  if (!useOpenAI) {
    return pass('Provider generation readiness', 'Skipped (OpenAI-compatible mode disabled).')
  }

  const request = resolveProviderRequest({
    model: process.env.OPENAI_MODEL,
    baseUrl: process.env.OPENAI_BASE_URL,
  })

  if (request.transport === 'codex_responses') {
    return pass(
      'Provider generation readiness',
      'Skipped for Codex responses (reachability probe already performs a lightweight generation request).',
    )
  }

  if (!isLocalBaseUrl(request.baseUrl)) {
    return pass('Provider generation readiness', 'Skipped for non-local provider URL.')
  }

  const localProviderLabel = getLocalOpenAICompatibleProviderLabel(request.baseUrl)
  if (localProviderLabel !== 'Ollama') {
    return pass(
      'Provider generation readiness',
      `Skipped for ${localProviderLabel} (no provider-specific generation probe).`,
    )
  }

  const readiness = await probeOllamaGenerationReadiness({
    baseUrl: request.baseUrl,
    model: request.requestedModel,
  })

  if (readiness.state === 'ready') {
    return pass(
      'Provider generation readiness',
      `Generated a test response with ${safeDisplayValue(readiness.probeModel ?? request.requestedModel, 'the requested model')}.`,
    )
  }

  if (readiness.state === 'unreachable') {
    return fail(
      'Provider generation readiness',
      `Could not reach Ollama at ${redactUrlForDisplay(request.baseUrl)}.`,
    )
  }

  if (readiness.state === 'no_models') {
    return fail(
      'Provider generation readiness',
      'Ollama is reachable, but no installed models were found. Pull a model first (for example: ollama pull qwen2.5-coder:7b).',
    )
  }

  const detail = safeDiagnosticText(readiness.detail, '')
  const detailSuffix = detail ? ` Detail: ${detail}.` : ''
  return fail(
    'Provider generation readiness',
    `Ollama is reachable, but generation failed for ${safeDisplayValue(readiness.probeModel ?? request.requestedModel, 'the requested model')}.${detailSuffix}`,
  )
}

function isAtomicChatUrl(baseUrl: string): boolean {
  try {
    const parsed = new URL(baseUrl)
    return parsed.port === '1337' && isLocalBaseUrl(baseUrl)
  } catch {
    return false
  }
}

function checkOllamaProcessorMode(): CheckResult {
  if (
    !isTruthy(process.env.CLAUDE_CODE_USE_OPENAI) ||
    isTruthy(process.env.CLAUDE_CODE_USE_GEMINI) ||
    isTruthy(process.env.CLAUDE_CODE_USE_GITHUB) ||
    isTruthy(process.env.CLAUDE_CODE_USE_MISTRAL)
  ) {
    return pass('Ollama processor mode', 'Skipped (OpenAI-compatible mode disabled).')
  }

  const baseUrl = currentBaseUrl()
  if (!isLocalBaseUrl(baseUrl)) {
    return pass('Ollama processor mode', 'Skipped (provider URL is not local).')
  }

  if (isAtomicChatUrl(baseUrl)) {
    return pass('Ollama processor mode', 'Skipped (Atomic Chat local provider detected, not Ollama).')
  }

  const result = spawnSync('ollama', ['ps'], {
    cwd: process.cwd(),
    encoding: 'utf8',
    shell: true,
  })

  if (result.status !== 0) {
    const detail = (result.stderr || result.stdout || 'Unable to run ollama ps').trim()
    return pass('Ollama processor mode', `Native CLI check failed (${detail}). Assuming valid Docker/remote backend since HTTP ping passed.`)
  }

  const output = (result.stdout || '').trim()
  if (!output) {
    return fail('Ollama processor mode', 'ollama ps returned empty output.')
  }

  const lines = output.split(/\r?\n/).map(line => line.trim()).filter(Boolean)
  const modelLine = lines.find(line => line.includes(':') && !line.startsWith('NAME'))
  if (!modelLine) {
    return pass('Ollama processor mode', 'No loaded model found (run a prompt first).')
  }

  if (modelLine.includes('CPU')) {
    return pass('Ollama processor mode', 'Detected CPU mode. This is valid but can be slow for larger models.')
  }

  return pass('Ollama processor mode', `Detected non-CPU mode: ${modelLine}`)
}

export function serializeSafeEnvSummary(): Record<string, string | boolean> {
  if (isTruthy(process.env.CLAUDE_CODE_USE_GEMINI)) {
    return {
      CLAUDE_CODE_USE_GEMINI: true,
      GEMINI_MODEL: safeDisplayValue(process.env.GEMINI_MODEL, `(unset, default: ${DEFAULT_GEMINI_MODEL})`),
      GEMINI_BASE_URL: safeBaseUrlDisplay(process.env.GEMINI_BASE_URL ?? 'https://generativelanguage.googleapis.com/v1beta/openai', ''),
      GEMINI_API_KEY_SET: Boolean(process.env.GEMINI_API_KEY ?? process.env.GOOGLE_API_KEY),
    }
  }
  if (isTruthy(process.env.CLAUDE_CODE_USE_MISTRAL)) {
    return {
      CLAUDE_CODE_USE_MISTRAL: true,
      MISTRAL_MODEL: safeDisplayValue(process.env.MISTRAL_MODEL, '(unset, default: devstral-latest)'),
      MISTRAL_BASE_URL: safeBaseUrlDisplay(process.env.MISTRAL_BASE_URL ?? 'https://api.mistral.ai/v1', ''),
      MISTRAL_API_KEY_SET: Boolean(process.env.MISTRAL_API_KEY),
    }
  }
  if (
    isTruthy(process.env.CLAUDE_CODE_USE_GITHUB) &&
    !isTruthy(process.env.CLAUDE_CODE_USE_OPENAI)
  ) {
    return {
      CLAUDE_CODE_USE_GITHUB: true,
      OPENAI_MODEL:
        safeDisplayValue(
          process.env.OPENAI_MODEL,
          '(unset, default: github:copilot → openai/gpt-4.1)',
        ),
      OPENAI_BASE_URL:
        safeBaseUrlDisplay(process.env.OPENAI_BASE_URL ?? GITHUB_COPILOT_BASE, ''),
      GITHUB_TOKEN_SET: Boolean(
        process.env.GITHUB_TOKEN ?? process.env.GH_TOKEN,
      ),
    }
  }
  const request = resolveProviderRequest({
    model: process.env.OPENAI_MODEL,
    baseUrl: process.env.OPENAI_BASE_URL,
  })
  const credentialContext = getOpenAICompatibleCredentialContext(request.baseUrl)
  return {
    CLAUDE_CODE_USE_OPENAI: isTruthy(process.env.CLAUDE_CODE_USE_OPENAI),
    OPENAI_MODEL: safeDisplayValue(process.env.OPENAI_MODEL, '(unset)'),
    OPENAI_BASE_URL: safeBaseUrlDisplay(request.baseUrl, ''),
    OPENAI_API_KEY_SET: Boolean(process.env.OPENAI_API_KEY),
    PROVIDER_API_KEY_SET: Boolean(credentialContext.value),
    CODEX_API_KEY_SET: Boolean(resolveCodexApiCredentials(process.env).apiKey),
  }
}

function printResults(results: CheckResult[]): void {
  for (const result of results) {
    const icon = result.ok ? 'PASS' : 'FAIL'
    const suffix = result.detail ? ` - ${result.detail}` : ''
    console.log(`[${icon}] ${result.label}${suffix}`)
  }
}

function writeJsonReport(
  options: CliOptions,
  results: CheckResult[],
): void {
  const envSummary = serializeSafeEnvSummary()
  const payload = {
    timestamp: new Date().toISOString(),
    cwd: process.cwd(),
    summary: {
      total: results.length,
      passed: results.filter(result => result.ok).length,
      failed: results.filter(result => !result.ok).length,
    },
    env: envSummary,
    results,
  }

  if (options.json) {
    console.log(
      JSON.stringify(
        {
          timestamp: payload.timestamp,
          cwd: payload.cwd,
          summary: payload.summary,
          env: '[redacted in console JSON output; use --out-file for the full report]',
          results: payload.results,
        },
        null,
        2,
      ),
    )
  }

  if (options.outFile) {
    const outputPath = resolve(process.cwd(), options.outFile)
    mkdirSync(dirname(outputPath), { recursive: true })
    writeFileSync(outputPath, JSON.stringify(payload, null, 2), 'utf8')
    if (!options.json) {
      console.log(`Report written to ${outputPath}`)
    }
  }
}

async function main(): Promise<void> {
  const options = parseOptions(process.argv.slice(2))
  const results: CheckResult[] = []

  const { enableConfigs } = await import('../src/utils/config.js')
  enableConfigs()
  const { applySafeConfigEnvironmentVariables } = await import('../src/utils/managedEnv.js')
  applySafeConfigEnvironmentVariables()
  const { hydrateGithubModelsTokenFromSecureStorage } = await import('../src/utils/githubModelsCredentials.js')
  hydrateGithubModelsTokenFromSecureStorage()

  results.push(checkNodeVersion())
  results.push(checkBunRuntime())
  results.push(checkBuildArtifacts())
  results.push(checkSandboxRuntime())
  results.push(...checkOpenAIEnv())
  results.push(await checkBaseUrlReachability())
  results.push(await checkProviderGenerationReadiness())
  results.push(checkOllamaProcessorMode())

  if (!options.json) {
    printResults(results)
  }

  writeJsonReport(options, results)

  const hasFailure = results.some(result => !result.ok)
  if (hasFailure) {
    process.exitCode = 1
    return
  }

  if (!options.json) {
    console.log('\nRuntime checks completed successfully.')
  }
}

if (import.meta.main) {
  await main()
}

export {}
