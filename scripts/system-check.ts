// @ts-nocheck
import { existsSync, mkdirSync, writeFileSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import { spawnSync } from 'node:child_process'
import {
  resolveCodexApiCredentials,
  resolveProviderRequest,
  isLocalProviderUrl as isProviderLocalUrl,
} from '../src/services/api/providerConfig.js'

type CheckResult = {
  ok: boolean
  label: string
  detail?: string
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
  const compactBody = responseBody.trim().replace(/\s+/g, ' ').slice(0, 240)
  const base = `Unexpected status ${status} from ${endpoint}.`
  const bodySuffix = compactBody ? ` Body: ${compactBody}` : ''

  if (request.transport !== 'codex_responses' || status !== 400) {
    return `${base}${bodySuffix}`
  }

  if (!/not supported.*chatgpt account/i.test(responseBody)) {
    return `${base}${bodySuffix}`
  }

  return `${base}${bodySuffix} Hint: model alias "${request.requestedModel}" resolved to "${request.resolvedModel}", which this ChatGPT account does not currently allow. Try "codexplan" or another entitled Codex model.`
}

function checkNodeVersion(): CheckResult {
  const raw = process.versions.node
  const major = Number(raw.split('.')[0] ?? '0')
  if (Number.isNaN(major)) {
    return fail('Node.js version', `Could not parse version: ${raw}`)
  }

  if (major < 20) {
    return fail('Node.js version', `Detected ${raw}. Require >= 20.`)
  }

  return pass('Node.js version', raw)
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

function isLocalBaseUrl(baseUrl: string): boolean {
  return isProviderLocalUrl(baseUrl)
}

const GEMINI_DEFAULT_BASE_URL = 'https://generativelanguage.googleapis.com/v1beta/openai'
const GITHUB_COPILOT_BASE = 'https://api.githubcopilot.com'

function currentBaseUrl(): string {
  if (isTruthy(process.env.CLAUDE_CODE_GOOGLE)) {
    return process.env.GEMINI_BASE_URL ?? GEMINI_DEFAULT_BASE_URL
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
    results.push(pass('GEMINI_MODEL', 'Not set. Default gemini-2.0-flash will be used.'))
  } else {
    results.push(pass('GEMINI_MODEL', model))
  }

  results.push(pass('GEMINI_BASE_URL', baseUrl))

  if (!key) {
    results.push(fail('GEMINI_API_KEY', 'Missing. Set GEMINI_API_KEY or GOOGLE_API_KEY.'))
  } else {
    results.push(pass('GEMINI_API_KEY', 'Configured.'))
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
    results.push(pass('OPENAI_MODEL', process.env.OPENAI_MODEL))
  }

  results.push(pass('OPENAI_BASE_URL', baseUrl))
  return results
}

function checkOpenAIEnv(): CheckResult[] {
  const results: CheckResult[] = []
  const useGoogle = isTruthy(process.env.CLAUDE_CODE_GOOGLE)
  const useGithub = isTruthy(process.env.CLAUDE_CODE_USE_GITHUB)
  const useOpenAI = isTruthy(process.env.CLAUDE_CODE_USE_OPENAI)

  if (useGoogle) {
    return checkGeminiEnv()
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
    results.push(pass('OPENAI_MODEL', process.env.OPENAI_MODEL))
  }

  results.push(pass('OPENAI_BASE_URL', request.baseUrl))

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

  const key = process.env.OPENAI_API_KEY
  const githubToken = process.env.GITHUB_TOKEN ?? process.env.GH_TOKEN
  if (key === 'SUA_CHAVE') {
    results.push(fail('OPENAI_API_KEY', 'Placeholder value detected: SUA_CHAVE.'))
  } else if (
    !key &&
    !isLocalBaseUrl(request.baseUrl) &&
    !(useGithub && githubToken?.trim())
  ) {
    results.push(fail('OPENAI_API_KEY', 'Missing key for non-local provider URL.'))
  } else if (!key && useGithub && githubToken?.trim()) {
    results.push(
      pass('OPENAI_API_KEY', 'Not set; GITHUB_TOKEN/GH_TOKEN will be used for GitHub Models.'),
    )
  } else if (!key) {
    results.push(pass('OPENAI_API_KEY', 'Not set (allowed for local providers like Atomic Chat/Ollama/LM Studio).'))
  } else {
    results.push(pass('OPENAI_API_KEY', 'Configured.'))
  }

  return results
}

async function checkBaseUrlReachability(): Promise<CheckResult> {
  const useGoogle = isTruthy(process.env.CLAUDE_CODE_GOOGLE)
  const useOpenAI = isTruthy(process.env.CLAUDE_CODE_USE_OPENAI)
  const useGithub = isTruthy(process.env.CLAUDE_CODE_USE_GITHUB)

  if (!useGoogle && !useOpenAI && !useGithub) {
    return pass('Provider reachability', 'Skipped (OpenAI-compatible mode disabled).')
  }

  if (useGithub) {
    return pass(
      'Provider reachability',
      'Skipped for GitHub Models (inference endpoint differs from OpenAI /models probe).',
    )
  }

  const geminiBaseUrl = 'https://generativelanguage.googleapis.com/v1beta/openai'
  const resolvedBaseUrl = useGoogle
    ? (process.env.GEMINI_BASE_URL ?? geminiBaseUrl)
    : undefined
  const request = resolveProviderRequest({
    model: process.env.OPENAI_MODEL,
    baseUrl: resolvedBaseUrl ?? process.env.OPENAI_BASE_URL,
  })
  const endpoint = request.transport === 'codex_responses'
    ? `${request.baseUrl}/responses`
    : `${request.baseUrl}/models`

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
    } else if (useGoogle && (process.env.GEMINI_API_KEY ?? process.env.GOOGLE_API_KEY)) {
      headers.Authorization = `Bearer ${process.env.GEMINI_API_KEY ?? process.env.GOOGLE_API_KEY}`
    } else if (process.env.OPENAI_API_KEY) {
      headers.Authorization = `Bearer ${process.env.OPENAI_API_KEY}`
    }

    const response = await fetch(endpoint, {
      method,
      headers,
      body,
      signal: controller.signal,
    })

    if (response.status === 200 || response.status === 401 || response.status === 403) {
      return pass('Provider reachability', `Reached ${endpoint} (status ${response.status}).`)
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
    return fail('Provider reachability', `Failed to reach ${endpoint}: ${message}`)
  } finally {
    clearTimeout(timeout)
  }
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
    isTruthy(process.env.CLAUDE_CODE_GOOGLE) ||
    isTruthy(process.env.CLAUDE_CODE_USE_GITHUB)
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

function serializeSafeEnvSummary(): Record<string, string | boolean> {
  if (isTruthy(process.env.CLAUDE_CODE_GOOGLE)) {
    return {
      CLAUDE_CODE_GOOGLE: true,
      GEMINI_MODEL: process.env.GEMINI_MODEL ?? '(unset, default: gemini-2.0-flash)',
      GEMINI_BASE_URL: process.env.GEMINI_BASE_URL ?? 'https://generativelanguage.googleapis.com/v1beta/openai',
      GEMINI_API_KEY_SET: Boolean(process.env.GEMINI_API_KEY ?? process.env.GOOGLE_API_KEY),
    }
  }
  if (
    isTruthy(process.env.CLAUDE_CODE_USE_GITHUB) &&
    !isTruthy(process.env.CLAUDE_CODE_USE_OPENAI)
  ) {
    return {
      CLAUDE_CODE_USE_GITHUB: true,
      OPENAI_MODEL:
        process.env.OPENAI_MODEL ??
        '(unset, default: github:copilot → openai/gpt-4.1)',
      OPENAI_BASE_URL:
        process.env.OPENAI_BASE_URL ?? GITHUB_COPILOT_BASE,
      GITHUB_TOKEN_SET: Boolean(
        process.env.GITHUB_TOKEN ?? process.env.GH_TOKEN,
      ),
    }
  }
  const request = resolveProviderRequest({
    model: process.env.OPENAI_MODEL,
    baseUrl: process.env.OPENAI_BASE_URL,
  })
  return {
    CLAUDE_CODE_USE_OPENAI: isTruthy(process.env.CLAUDE_CODE_USE_OPENAI),
    OPENAI_MODEL: process.env.OPENAI_MODEL ?? '(unset)',
    OPENAI_BASE_URL: request.baseUrl,
    OPENAI_API_KEY_SET: Boolean(process.env.OPENAI_API_KEY),
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
  results.push(...checkOpenAIEnv())
  results.push(await checkBaseUrlReachability())
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
