#!/usr/bin/env bun
/**
 * Standalone 1claw setup script.
 *
 * Interactive:
 *   bun run setup
 *
 * Non-interactive (all flags):
 *   bun run setup --key 1ck_... --provider anthropic --model claude-sonnet-4-6 --auth byo-key --provider-key sk-ant-...
 *   bun run setup --key 1ck_... --provider openai --model gpt-4o --auth token-billing
 *   bun run setup --key 1ck_... --provider anthropic --auth oidc-federation
 *
 * Partial flags work too — the script prompts only for missing values.
 *
 * Flags:
 *   --key, -k          1claw human API key (1ck_ prefix)
 *   --provider, -p     LLM provider: anthropic, openai, gemini, mistral, xai
 *   --model, -m        Model name (defaults to provider's default)
 *   --auth, -a         Auth mode: byo-key, token-billing, oidc-federation
 *   --provider-key     Provider API key (required when --auth byo-key)
 *   --help, -h         Show this help
 */
import { createClient } from '@1claw/sdk'
import { existsSync, writeFileSync, mkdirSync } from 'node:fs'
import { join } from 'node:path'
import { homedir } from 'node:os'
import readline from 'node:readline'

const ONECLAW_BASE_URL = 'https://api.1claw.xyz'
const DEFAULT_AGENT_SCOPES = ['**']
const DEFAULT_POLICY_PATH_PATTERN = 'providers/**'

const PROVIDER_TO_SECRET_PATH: Record<string, string> = {
  ANTHROPIC_API_KEY: 'providers/anthropic/api-key',
  OPENAI_API_KEY: 'providers/openai/api-key',
  GEMINI_API_KEY: 'providers/gemini/api-key',
  GOOGLE_API_KEY: 'providers/google/api-key',
  MISTRAL_API_KEY: 'providers/mistral/api-key',
  XAI_API_KEY: 'providers/xai/api-key',
}

interface OneclawConfig {
  agentId: string
  agentApiKey: string
  vaultId: string
  baseUrl: string
  shroudEnabled: boolean
  intentsEnabled: boolean
  oidcFederationEnabled: boolean
  providerSecretPaths: Record<string, string>
  authMode?: string
  selectedProvider?: string
  selectedModel?: string
}

interface ProviderDef {
  id: string
  label: string
  envKey: string
  defaultModel: string
  models: string[]
  supportsOidc: boolean
}

const PROVIDERS: ProviderDef[] = [
  { id: 'anthropic', label: 'Anthropic (Claude)', envKey: 'ANTHROPIC_API_KEY', defaultModel: 'claude-sonnet-4-6', models: ['claude-sonnet-4-6', 'claude-opus-4-6', 'claude-haiku-3-5'], supportsOidc: true },
  { id: 'openai', label: 'OpenAI (GPT)', envKey: 'OPENAI_API_KEY', defaultModel: 'gpt-4o', models: ['gpt-4o', 'gpt-4o-mini', 'o3'], supportsOidc: false },
  { id: 'gemini', label: 'Google (Gemini)', envKey: 'GEMINI_API_KEY', defaultModel: 'gemini-2.5-pro', models: ['gemini-2.5-pro', 'gemini-2.5-flash'], supportsOidc: false },
  { id: 'mistral', label: 'Mistral', envKey: 'MISTRAL_API_KEY', defaultModel: 'mistral-large-latest', models: ['mistral-large-latest', 'mistral-medium-latest'], supportsOidc: false },
  { id: 'xai', label: 'xAI (Grok)', envKey: 'XAI_API_KEY', defaultModel: 'grok-3', models: ['grok-3', 'grok-3-mini'], supportsOidc: false },
]

function buildProviderProfileEnv(
  provider: ProviderDef,
  model: string,
  apiKey: string | undefined,
): Record<string, unknown> | null {
  const keyOrPlaceholder = apiKey ?? 'shroud-managed'
  switch (provider.id) {
    case 'anthropic':
      return {
        profile: 'anthropic',
        env: apiKey
          ? { ANTHROPIC_API_KEY: apiKey, ANTHROPIC_MODEL: model }
          : { ANTHROPIC_MODEL: model },
        createdAt: new Date().toISOString(),
      }
    case 'openai':
      return {
        profile: 'openai',
        env: {
          OPENAI_API_KEY: keyOrPlaceholder,
          CLAUDE_CODE_USE_OPENAI: '1',
          OPENAI_MODEL: model,
        },
        createdAt: new Date().toISOString(),
      }
    case 'gemini':
      return {
        profile: 'gemini',
        env: {
          GEMINI_API_KEY: keyOrPlaceholder,
          CLAUDE_CODE_USE_OPENAI: '1',
          OPENAI_BASE_URL: 'https://generativelanguage.googleapis.com/v1beta/openai/',
          OPENAI_MODEL: model,
        },
        createdAt: new Date().toISOString(),
      }
    case 'mistral':
      return {
        profile: 'mistral',
        env: {
          MISTRAL_API_KEY: keyOrPlaceholder,
          CLAUDE_CODE_USE_OPENAI: '1',
          OPENAI_BASE_URL: 'https://api.mistral.ai/v1/',
          OPENAI_MODEL: model,
        },
        createdAt: new Date().toISOString(),
      }
    case 'xai':
      return {
        profile: 'xai',
        env: {
          XAI_API_KEY: keyOrPlaceholder,
          CLAUDE_CODE_USE_OPENAI: '1',
          OPENAI_BASE_URL: 'https://api.x.ai/v1/',
          OPENAI_MODEL: model,
        },
        createdAt: new Date().toISOString(),
      }
    default:
      return null
  }
}

// --- Arg parsing ---

function parseArgs(argv: string[]): Record<string, string | true> {
  const args: Record<string, string | true> = {}
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i]!
    if (arg === '--help' || arg === '-h') { args.help = true; continue }

    const aliases: Record<string, string> = {
      '-k': '--key', '-p': '--provider', '-m': '--model', '-a': '--auth',
    }
    const name = aliases[arg] ?? arg
    if (name.startsWith('--')) {
      const key = name.slice(2)
      const next = argv[i + 1]
      if (next && !next.startsWith('-')) {
        args[key] = next
        i++
      } else {
        args[key] = true
      }
    }
  }
  return args
}

function printHelp() {
  console.log(`
Usage: bun run setup [options]

Options:
  --key, -k <key>            1claw human API key (1ck_ prefix)
  --provider, -p <provider>  LLM provider: ${PROVIDERS.map(p => p.id).join(', ')}
  --model, -m <model>        Model name (defaults to provider's default)
  --auth, -a <mode>          Auth mode: byo-key, token-billing, oidc-federation
  --provider-key <key>       Provider API key (required for --auth byo-key)
  --help, -h                 Show this help

Examples:
  bun run setup
  bun run setup --key 1ck_abc... --provider anthropic --auth oidc-federation
  bun run setup -k 1ck_abc... -p openai -m gpt-4o -a byo-key --provider-key sk-...
  bun run setup --key 1ck_abc... --provider anthropic --auth token-billing
`)
}

// --- Utils ---

function getConfigDir(): string {
  const openclaudeDir = join(homedir(), '.openclaude')
  const legacyDir = join(homedir(), '.claude')
  if (!existsSync(openclaudeDir) && existsSync(legacyDir)) return legacyDir
  return openclaudeDir
}

function saveConfig(config: OneclawConfig): void {
  const dir = getConfigDir()
  if (!existsSync(dir)) mkdirSync(dir, { recursive: true })
  writeFileSync(join(dir, 'oneclaw.json'), JSON.stringify(config, null, 2), { encoding: 'utf8', mode: 0o600 })
}

let rl: readline.Interface | null = null

function getReadline(): readline.Interface {
  if (!rl) rl = readline.createInterface({ input: process.stdin, output: process.stdout })
  return rl
}

function ask(question: string): Promise<string> {
  return new Promise(resolve => getReadline().question(question, resolve))
}

function choose(prompt: string, options: { label: string; value: string }[]): Promise<string> {
  return new Promise(resolve => {
    console.log(`\n${prompt}\n`)
    options.forEach((opt, i) => console.log(`  ${i + 1}) ${opt.label}`))
    console.log()
    const handler = async () => {
      const answer = await ask('Choose (number): ')
      const idx = parseInt(answer.trim(), 10) - 1
      if (idx >= 0 && idx < options.length) {
        resolve(options[idx]!.value)
      } else {
        console.log('Invalid choice, try again.')
        await handler()
      }
    }
    void handler()
  })
}

// --- Main ---

async function main() {
  const flags = parseArgs(process.argv.slice(2))

  if (flags.help) {
    printHelp()
    process.exit(0)
  }

  const isNonInteractive = Boolean(
    typeof flags.key === 'string' &&
    typeof flags.provider === 'string' &&
    typeof flags.auth === 'string'
  )

  console.log('\n╔══════════════════════════════════════════════╗')
  console.log('║       1claw Setup — OpenClaude Integration   ║')
  console.log('╚══════════════════════════════════════════════╝\n')

  if (!isNonInteractive) {
    console.log('This will provision a 1claw agent, vault, and policies,')
    console.log('then configure OpenClaude with your chosen LLM provider.\n')
  }

  // Step 1: 1claw API Key
  let trimmedKey: string
  if (typeof flags.key === 'string') {
    trimmedKey = flags.key.trim()
  } else {
    trimmedKey = (await ask('Enter your 1claw API key (1ck_...): ')).trim()
  }
  if (!trimmedKey) {
    console.error('No API key provided. Exiting.')
    process.exit(1)
  }

  console.log(isNonInteractive ? 'Validating API key...' : '\nValidating API key...')
  const client = createClient({ baseUrl: ONECLAW_BASE_URL, apiKey: trimmedKey })
  try {
    const authRes = await client.auth.apiKeyToken({ api_key: trimmedKey })
    if (authRes.error) {
      console.error(`Authentication failed: ${authRes.error.message}`)
      process.exit(1)
    }
    console.log('Authenticated successfully.')
  } catch (err: any) {
    console.error(`Authentication failed: ${err?.message ?? err}`)
    process.exit(1)
  }

  // Step 2: Choose Provider
  let provider: ProviderDef
  if (typeof flags.provider === 'string') {
    const found = PROVIDERS.find(p => p.id === flags.provider)
    if (!found) {
      console.error(`Unknown provider: ${flags.provider}. Valid: ${PROVIDERS.map(p => p.id).join(', ')}`)
      process.exit(1)
    }
    provider = found
    console.log(`Provider: ${provider.label}`)
  } else {
    const providerId = await choose('Choose your LLM provider:', PROVIDERS.map(p => ({ label: p.label, value: p.id })))
    provider = PROVIDERS.find(p => p.id === providerId)!
  }

  // Step 3: Choose Model
  let model: string
  if (typeof flags.model === 'string') {
    model = flags.model
    console.log(`Model: ${model}`)
  } else if (isNonInteractive) {
    model = provider.defaultModel
    console.log(`Model: ${model} (default)`)
  } else {
    model = await choose(`Choose a ${provider.label} model:`, provider.models.map(m => ({ label: m, value: m })))
  }

  // Step 4: Auth Mode
  let authMode: string
  if (typeof flags.auth === 'string') {
    const validModes = ['byo-key', 'token-billing', 'oidc-federation']
    if (!validModes.includes(flags.auth)) {
      console.error(`Unknown auth mode: ${flags.auth}. Valid: ${validModes.join(', ')}`)
      process.exit(1)
    }
    if (flags.auth === 'oidc-federation' && !provider.supportsOidc) {
      console.error(`OIDC federation is only supported for Anthropic.`)
      process.exit(1)
    }
    authMode = flags.auth
    console.log(`Auth: ${authMode}`)
  } else {
    const authOptions = [
      { label: 'Use my own API key (stored in 1claw Vault)', value: 'byo-key' },
      { label: '1Claw LLM Token Billing (no key needed)', value: 'token-billing' },
    ]
    if (provider.supportsOidc) {
      authOptions.push({ label: 'OIDC Federation — keyless Anthropic access', value: 'oidc-federation' })
    }
    authMode = await choose('How should OpenClaude authenticate?', authOptions)
  }

  // Provider API key (BYO)
  let providerApiKey: string | undefined
  if (authMode === 'byo-key') {
    if (typeof flags['provider-key'] === 'string') {
      providerApiKey = flags['provider-key'].trim()
    } else {
      providerApiKey = (await ask(`\nEnter your ${provider.label} API key: `)).trim()
    }
    if (!providerApiKey) {
      console.error('No provider API key provided. Exiting.')
      process.exit(1)
    }
  }

  // Step 5: Bootstrap
  console.log('\nProvisioning resources...')
  try {
    const vaultRes = await client.vault.create({
      name: 'openclaude-providers',
      description: 'LLM provider API keys managed by OpenClaude',
    })
    if (vaultRes.error) throw new Error(`Vault: ${vaultRes.error.message}`)
    const vaultId = vaultRes.data!.id
    console.log(`  Vault created: ${vaultId}`)

    const agentRes = await client.agents.create({
      name: 'openclaude-agent',
      scopes: DEFAULT_AGENT_SCOPES,
      intents_api_enabled: true,
    })
    if (agentRes.error) throw new Error(`Agent: ${agentRes.error.message}`)
    const agentId = agentRes.data!.agent.id
    const agentApiKey = agentRes.data!.api_key
    if (!agentApiKey) throw new Error('Agent created but no API key returned')
    console.log(`  Agent created: ${agentId}`)

    const enableOidc = authMode === 'oidc-federation'
    const updatePayload: Record<string, unknown> = {
      shroud_enabled: true,
      shroud_config: {
        pii_policy: 'redact',
        injection_threshold: 0.7,
        enable_secret_redaction: true,
        enable_response_filtering: true,
      },
      federation_enabled: enableOidc,
      federation_audiences: enableOidc ? ['https://api.anthropic.com'] : [],
    }
    await client.agents.update(agentId, updatePayload as any)
    console.log('  Agent configured: Shroud + Intents enabled')

    await client.access.grantAgent(vaultId, agentId, ['read'], { secretPathPattern: DEFAULT_POLICY_PATH_PATTERN })
    console.log('  Policy granted: agent can read providers/**')

    if (authMode === 'byo-key' && providerApiKey) {
      const secretPath = PROVIDER_TO_SECRET_PATH[provider.envKey]
      if (secretPath) {
        await client.secrets.set(vaultId, secretPath, providerApiKey, { type: 'api_key' })
        console.log(`  API key stored in vault at ${secretPath}`)
      }
    }

    const config: OneclawConfig = {
      agentId,
      agentApiKey,
      vaultId,
      baseUrl: ONECLAW_BASE_URL,
      shroudEnabled: true,
      intentsEnabled: true,
      oidcFederationEnabled: enableOidc,
      providerSecretPaths: { ...PROVIDER_TO_SECRET_PATH },
      authMode,
      selectedProvider: provider.id,
      selectedModel: model,
    }
    saveConfig(config)
    const configPath = join(getConfigDir(), 'oneclaw.json')

    const profileEnv = buildProviderProfileEnv(provider, model, authMode === 'byo-key' ? providerApiKey : undefined)
    if (profileEnv) {
      const profilePath = join(getConfigDir(), '.openclaude-profile.json')
      writeFileSync(profilePath, JSON.stringify(profileEnv, null, 2), { encoding: 'utf8', mode: 0o600 })
      console.log(`  Provider profile saved: ${profilePath}`)
    }

    console.log('\n═══════════════════════════════════════════')
    console.log('  Setup complete!')
    console.log('═══════════════════════════════════════════\n')
    console.log(`  Provider:  ${provider.label}`)
    console.log(`  Model:     ${model}`)
    console.log(`  Auth:      ${authMode === 'byo-key' ? 'BYO Key (Vault)' : authMode === 'token-billing' ? '1Claw Token Billing' : 'OIDC Federation'}`)
    console.log(`  Config:    ${configPath}`)
    console.log()

    if (authMode === 'token-billing') {
      console.log('  NOTE: Enable LLM Token Billing at https://1claw.xyz → Billing')
    }
    if (authMode === 'oidc-federation') {
      console.log('  NOTE: Register 1claw as OIDC IdP in Anthropic Console:')
      console.log(`  Issuer: https://api.1claw.xyz  |  Sub: agent:${agentId}`)
      console.log('  Guide: https://1claw.xyz/blog/oidc-federation-anthropic-wif-no-static-keys')
    }

    console.log('\n  Run OpenClaude to start using your configured provider.')
    console.log('  Manage your agent and vault at https://1claw.xyz\n')
  } catch (err: any) {
    console.error(`\nSetup failed: ${err?.message ?? err}`)
    process.exit(1)
  }

  rl?.close()
}

void main()
