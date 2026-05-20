import { mkdir, readFile, writeFile } from 'fs/promises'
import { resolve, join } from 'path'
import { getClaudeConfigHomeDir } from '../../utils/envUtils.js'

export type AgentGatewayPermissionMode = 'default' | 'acceptEdits' | 'bypassPermissions'

export type AgentGatewayConfig = {
  api: {
    enabled: boolean
    host: string
    port: number
    apiKey?: string
    modelName: string
    corsOrigins: string[]
  }
  cron: {
    enabled: boolean
    tickIntervalSeconds: number
  }
  telegram: {
    enabled: boolean
    botToken?: string
    allowedChatIds: string[]
    allowedUserIds: string[]
    homeChatId?: string
    mirrorAgentApiResponses: boolean
    downloadFiles: boolean
    maxDownloadBytes: number
    maxUploadBytes: number
    transcribeAudio: boolean
    transcriptionProvider: 'auto' | 'whisper' | 'parakeet' | 'openai'
    transcriptionWhisperModel: string
    transcriptionOpenAIModel: string
    transcriptionTimeoutMs: number
    replyWithTranscript: boolean
  }
  ouroboros: {
    enabled: boolean
    consciousnessEnabled: boolean
    wakeupMinSeconds: number
    wakeupMaxSeconds: number
    maxRounds: number
    budgetFraction: number
    infiniteTasksEnabled: boolean
  }
  openWebUI: {
    host: string
    port: number
    pythonCommand: string
    dataDir?: string
  }
  openRAG: {
    enabled: boolean
    url: string
    apiKey?: string
    repoDir?: string
    workspaceDir?: string
    frontendPort: number
    langflowPort: number
    doclingPort: number
    openSearchPassword?: string
    langflowSuperuser?: string
    langflowSuperuserPassword?: string
    mcpEnabled: boolean
    mcpCommand: string
    mcpArgs: string[]
    mcpTimeoutSeconds: number
  }
  ui: {
    language: 'en' | 'ru'
  }
  runner: {
    cwd?: string
    maxTurns: number
    timeoutMs: number
    permissionMode: AgentGatewayPermissionMode
    availableTools: string[]
    disallowedTools: string[]
  }
}

export const AGENT_GATEWAY_CONFIG_FILE = 'agent-gateway.json'

export function getAgentGatewayConfigPath(): string {
  return join(getClaudeConfigHomeDir(), AGENT_GATEWAY_CONFIG_FILE)
}

export function getAgentGatewayStateDir(): string {
  const stateDirOverride = process.env.OPENCLAUDE_AGENT_GATEWAY_STATE_DIR?.trim()
  if (stateDirOverride) return resolve(stateDirOverride)
  return join(getClaudeConfigHomeDir(), 'agent-gateway')
}

export function getDefaultAgentGatewayConfig(): AgentGatewayConfig {
  return {
    api: {
      enabled: false,
      host: '127.0.0.1',
      port: 8642,
      modelName: 'openclaude-agent',
      corsOrigins: [],
    },
    cron: {
      enabled: false,
      tickIntervalSeconds: 60,
    },
    telegram: {
      enabled: false,
      allowedChatIds: [],
      allowedUserIds: [],
      mirrorAgentApiResponses: false,
      downloadFiles: true,
      maxDownloadBytes: 20 * 1024 * 1024,
      maxUploadBytes: 50 * 1024 * 1024,
      transcribeAudio: true,
      transcriptionProvider: 'auto',
      transcriptionWhisperModel: 'base',
      transcriptionOpenAIModel: 'whisper-1',
      transcriptionTimeoutMs: 120 * 1000,
      replyWithTranscript: true,
    },
    ouroboros: {
      enabled: false,
      consciousnessEnabled: false,
      wakeupMinSeconds: 300,
      wakeupMaxSeconds: 7200,
      maxRounds: 3,
      budgetFraction: 0.1,
      infiniteTasksEnabled: false,
    },
    openWebUI: {
      host: 'localhost',
      port: 8080,
      pythonCommand: process.platform === 'win32' ? 'py -3.11' : 'python3.11',
    },
    openRAG: {
      enabled: false,
      url: 'http://localhost:3000',
      frontendPort: 3000,
      langflowPort: 7860,
      doclingPort: 5001,
      mcpEnabled: false,
      mcpCommand: 'uvx',
      mcpArgs: ['openrag-mcp'],
      mcpTimeoutSeconds: 60,
    },
    ui: {
      language: 'en',
    },
    runner: {
      maxTurns: 12,
      timeoutMs: 3 * 60 * 1000,
      permissionMode: 'default',
      availableTools: [],
      disallowedTools: [],
    },
  }
}

function normalizeStringArray(value: unknown): string[] {
  if (!Array.isArray(value)) return []
  return value
    .map(item => String(item ?? '').trim())
    .filter(Boolean)
}

function normalizePort(value: unknown, fallback: number): number {
  const parsed = Number(value)
  if (!Number.isInteger(parsed) || parsed < 1 || parsed > 65535) {
    return fallback
  }
  return parsed
}

function normalizePermissionMode(value: unknown): AgentGatewayPermissionMode {
  if (
    value === 'default' ||
    value === 'acceptEdits' ||
    value === 'bypassPermissions'
  ) {
    return value
  }
  return 'default'
}

export function normalizeAgentGatewayConfig(
  raw: unknown,
): AgentGatewayConfig {
  const defaults = getDefaultAgentGatewayConfig()
  const input = raw && typeof raw === 'object' ? raw as Record<string, any> : {}
  const api = input.api && typeof input.api === 'object' ? input.api : {}
  const cron = input.cron && typeof input.cron === 'object' ? input.cron : {}
  const telegram =
    input.telegram && typeof input.telegram === 'object' ? input.telegram : {}
  const ouroboros =
    input.ouroboros && typeof input.ouroboros === 'object' ? input.ouroboros : {}
  const openWebUI =
    input.openWebUI && typeof input.openWebUI === 'object' ? input.openWebUI : {}
  const openRAG =
    input.openRAG && typeof input.openRAG === 'object' ? input.openRAG : {}
  const ui = input.ui && typeof input.ui === 'object' ? input.ui : {}
  const runner =
    input.runner && typeof input.runner === 'object' ? input.runner : {}

  return {
    api: {
      enabled: Boolean(api.enabled),
      host: String(api.host || defaults.api.host),
      port: normalizePort(api.port, defaults.api.port),
      apiKey: String(api.apiKey || '').trim() || undefined,
      modelName: String(api.modelName || defaults.api.modelName).trim(),
      corsOrigins: normalizeStringArray(api.corsOrigins),
    },
    cron: {
      enabled: Boolean(cron.enabled),
      tickIntervalSeconds: Math.max(
        1,
        Number(cron.tickIntervalSeconds || defaults.cron.tickIntervalSeconds),
      ),
    },
    telegram: {
      enabled: Boolean(telegram.enabled),
      botToken: String(telegram.botToken || '').trim() || undefined,
      allowedChatIds: normalizeStringArray(telegram.allowedChatIds),
      allowedUserIds: normalizeStringArray(
        telegram.allowedUserIds ||
          telegram.allowedTelegramUserIds ||
          telegram.allowedAccountIds,
      ),
      homeChatId: String(telegram.homeChatId || '').trim() || undefined,
      mirrorAgentApiResponses: Boolean(telegram.mirrorAgentApiResponses),
      downloadFiles: telegram.downloadFiles !== false,
      maxDownloadBytes: Math.max(
        1_000_000,
        Number(
          telegram.maxDownloadBytes ||
            defaults.telegram.maxDownloadBytes,
        ),
      ),
      maxUploadBytes: Math.max(
        1_000_000,
        Number(telegram.maxUploadBytes || defaults.telegram.maxUploadBytes),
      ),
      transcribeAudio: telegram.transcribeAudio !== false,
      transcriptionProvider: normalizeTranscriptionProvider(
        telegram.transcriptionProvider,
      ),
      transcriptionWhisperModel: String(
        telegram.transcriptionWhisperModel ||
          defaults.telegram.transcriptionWhisperModel,
      ).trim(),
      transcriptionOpenAIModel: String(
        telegram.transcriptionOpenAIModel ||
          defaults.telegram.transcriptionOpenAIModel,
      ).trim(),
      transcriptionTimeoutMs: Math.max(
        5_000,
        Number(
          telegram.transcriptionTimeoutMs ||
            defaults.telegram.transcriptionTimeoutMs,
        ),
      ),
      replyWithTranscript: telegram.replyWithTranscript !== false,
    },
    ouroboros: {
      enabled: Boolean(ouroboros.enabled),
      consciousnessEnabled: Boolean(ouroboros.consciousnessEnabled),
      wakeupMinSeconds: Math.max(
        30,
        Number(
          ouroboros.wakeupMinSeconds ||
            defaults.ouroboros.wakeupMinSeconds,
        ),
      ),
      wakeupMaxSeconds: Math.max(
        60,
        Number(
          ouroboros.wakeupMaxSeconds ||
            defaults.ouroboros.wakeupMaxSeconds,
        ),
      ),
      maxRounds: Math.max(
        1,
        Number(ouroboros.maxRounds ?? defaults.ouroboros.maxRounds),
      ),
      budgetFraction: clampNumber(
        Number(ouroboros.budgetFraction ?? defaults.ouroboros.budgetFraction),
        0,
        1,
      ),
      infiniteTasksEnabled: Boolean(ouroboros.infiniteTasksEnabled),
    },
    openWebUI: {
      host: String(openWebUI.host || defaults.openWebUI.host).trim() || defaults.openWebUI.host,
      port: normalizePort(openWebUI.port, defaults.openWebUI.port),
      pythonCommand: String(
        openWebUI.pythonCommand || defaults.openWebUI.pythonCommand,
      ).trim(),
      dataDir: String(openWebUI.dataDir || '').trim() || undefined,
    },
    openRAG: {
      enabled: Boolean(openRAG.enabled),
      url: String(openRAG.url || defaults.openRAG.url).trim() || defaults.openRAG.url,
      apiKey: String(openRAG.apiKey || '').trim() || undefined,
      repoDir: String(openRAG.repoDir || '').trim() || undefined,
      workspaceDir: String(openRAG.workspaceDir || '').trim() || undefined,
      frontendPort: normalizePort(openRAG.frontendPort, defaults.openRAG.frontendPort),
      langflowPort: normalizePort(openRAG.langflowPort, defaults.openRAG.langflowPort),
      doclingPort: normalizePort(openRAG.doclingPort, defaults.openRAG.doclingPort),
      openSearchPassword:
        String(openRAG.openSearchPassword || '').trim() || undefined,
      langflowSuperuser:
        String(openRAG.langflowSuperuser || '').trim() || undefined,
      langflowSuperuserPassword:
        String(openRAG.langflowSuperuserPassword || '').trim() || undefined,
      mcpEnabled: Boolean(openRAG.mcpEnabled),
      mcpCommand:
        String(openRAG.mcpCommand || defaults.openRAG.mcpCommand).trim() ||
        defaults.openRAG.mcpCommand,
      mcpArgs: normalizeOpenRagMcpArgs(openRAG.mcpArgs, defaults.openRAG.mcpArgs),
      mcpTimeoutSeconds: Math.max(
        1,
        Number(openRAG.mcpTimeoutSeconds || defaults.openRAG.mcpTimeoutSeconds),
      ),
    },
    ui: {
      language: ui.language === 'ru' ? 'ru' : 'en',
    },
    runner: {
      cwd: String(runner.cwd || '').trim() || undefined,
      maxTurns: Math.max(1, Number(runner.maxTurns || defaults.runner.maxTurns)),
      timeoutMs: Math.max(
        1_000,
        Number(runner.timeoutMs || defaults.runner.timeoutMs),
      ),
      permissionMode: normalizePermissionMode(runner.permissionMode),
      availableTools: Array.isArray(runner.availableTools)
        ? normalizeStringArray(runner.availableTools)
        : Array.isArray(runner.tools)
          ? normalizeStringArray(runner.tools)
          : defaults.runner.availableTools,
      disallowedTools: Array.isArray(runner.disallowedTools)
        ? normalizeStringArray(runner.disallowedTools)
        : defaults.runner.disallowedTools,
    },
  }
}

function normalizeTranscriptionProvider(
  value: unknown,
): AgentGatewayConfig['telegram']['transcriptionProvider'] {
  if (
    value === 'whisper' ||
    value === 'parakeet' ||
    value === 'openai' ||
    value === 'auto'
  ) {
    return value
  }
  return 'auto'
}

function normalizeOpenRagMcpArgs(value: unknown, fallback: string[]): string[] {
  const parsed = Array.isArray(value)
    ? normalizeStringArray(value)
    : splitEnvList(String(value || '') || undefined)
  return parsed.length > 0 ? parsed : fallback
}

export async function loadAgentGatewayConfig(): Promise<AgentGatewayConfig> {
  try {
    const raw = await readFile(getAgentGatewayConfigPath(), 'utf8')
    return applyAgentGatewayEnvOverrides(normalizeAgentGatewayConfig(JSON.parse(raw)))
  } catch {
    return applyAgentGatewayEnvOverrides(getDefaultAgentGatewayConfig())
  }
}

export function applyAgentGatewayEnvOverrides(
  config: AgentGatewayConfig,
  env: NodeJS.ProcessEnv = process.env,
): AgentGatewayConfig {
  const apiEnabled = parseEnvBoolean(env.OPENCLAUDE_AGENT_API_ENABLED)
  const cronEnabled = parseEnvBoolean(env.OPENCLAUDE_AGENT_CRON_ENABLED)
  const telegramEnabled = parseEnvBoolean(env.OPENCLAUDE_TELEGRAM_ENABLED)
  const telegramDownloadFiles = parseEnvBoolean(
    env.OPENCLAUDE_TELEGRAM_DOWNLOAD_FILES,
  )
  const telegramTranscribeAudio = parseEnvBoolean(
    env.OPENCLAUDE_TELEGRAM_TRANSCRIBE_AUDIO,
  )
  const telegramReplyWithTranscript = parseEnvBoolean(
    env.OPENCLAUDE_TELEGRAM_REPLY_WITH_TRANSCRIPT,
  )
  const ouroborosEnabled = parseEnvBoolean(env.OPENCLAUDE_OUROBOROS_ENABLED)
  const consciousnessEnabled = parseEnvBoolean(
    env.OPENCLAUDE_CONSCIOUSNESS_ENABLED,
  )
  const infiniteEnabled = parseEnvBoolean(
    env.OPENCLAUDE_INFINITE_TASKS_ENABLED,
  )

  return normalizeAgentGatewayConfig({
    ...config,
    api: {
      ...config.api,
      enabled: apiEnabled ?? config.api.enabled,
      host: env.OPENCLAUDE_AGENT_API_HOST ?? config.api.host,
      port: env.OPENCLAUDE_AGENT_API_PORT ?? config.api.port,
      apiKey: env.OPENCLAUDE_AGENT_API_KEY ?? config.api.apiKey,
      modelName: env.OPENCLAUDE_AGENT_API_MODEL ?? config.api.modelName,
      corsOrigins:
        env.OPENCLAUDE_AGENT_API_CORS_ORIGINS !== undefined
          ? splitEnvList(env.OPENCLAUDE_AGENT_API_CORS_ORIGINS)
          : config.api.corsOrigins,
    },
    cron: {
      ...config.cron,
      enabled: cronEnabled ?? config.cron.enabled,
      tickIntervalSeconds:
        env.OPENCLAUDE_AGENT_CRON_TICK_SECONDS ??
        config.cron.tickIntervalSeconds,
    },
    telegram: {
      ...config.telegram,
      enabled: telegramEnabled ?? config.telegram.enabled,
      botToken: env.TELEGRAM_BOT_TOKEN ?? config.telegram.botToken,
      homeChatId:
        env.OPENCLAUDE_TELEGRAM_HOME_CHAT_ID ??
        env.TELEGRAM_HOME_CHAT_ID ??
        config.telegram.homeChatId,
      allowedChatIds:
        env.OPENCLAUDE_TELEGRAM_ALLOWED_CHAT_IDS !== undefined
          ? splitEnvList(env.OPENCLAUDE_TELEGRAM_ALLOWED_CHAT_IDS)
          : config.telegram.allowedChatIds,
      allowedUserIds:
        env.OPENCLAUDE_TELEGRAM_ALLOWED_USER_IDS !== undefined
          ? splitEnvList(env.OPENCLAUDE_TELEGRAM_ALLOWED_USER_IDS)
          : config.telegram.allowedUserIds,
      downloadFiles:
        telegramDownloadFiles ?? config.telegram.downloadFiles,
      maxDownloadBytes:
        env.OPENCLAUDE_TELEGRAM_MAX_DOWNLOAD_BYTES ??
        config.telegram.maxDownloadBytes,
      maxUploadBytes:
        env.OPENCLAUDE_TELEGRAM_MAX_UPLOAD_BYTES ??
        config.telegram.maxUploadBytes,
      transcribeAudio:
        telegramTranscribeAudio ?? config.telegram.transcribeAudio,
      transcriptionProvider:
        env.OPENCLAUDE_TELEGRAM_TRANSCRIPTION_PROVIDER ??
        config.telegram.transcriptionProvider,
      transcriptionWhisperModel:
        env.OPENCLAUDE_TELEGRAM_TRANSCRIPTION_WHISPER_MODEL ??
        config.telegram.transcriptionWhisperModel,
      transcriptionOpenAIModel:
        env.OPENCLAUDE_TELEGRAM_TRANSCRIPTION_OPENAI_MODEL ??
        config.telegram.transcriptionOpenAIModel,
      replyWithTranscript:
        telegramReplyWithTranscript ?? config.telegram.replyWithTranscript,
    },
    ouroboros: {
      ...config.ouroboros,
      enabled: ouroborosEnabled ?? config.ouroboros.enabled,
      consciousnessEnabled:
        consciousnessEnabled ?? config.ouroboros.consciousnessEnabled,
      wakeupMinSeconds:
        env.OPENCLAUDE_OUROBOROS_WAKEUP_MIN_SECONDS ??
        config.ouroboros.wakeupMinSeconds,
      wakeupMaxSeconds:
        env.OPENCLAUDE_OUROBOROS_WAKEUP_MAX_SECONDS ??
        config.ouroboros.wakeupMaxSeconds,
      maxRounds:
        env.OPENCLAUDE_OUROBOROS_MAX_ROUNDS ??
        config.ouroboros.maxRounds,
      budgetFraction:
        env.OPENCLAUDE_OUROBOROS_BUDGET_FRACTION ??
        config.ouroboros.budgetFraction,
      infiniteTasksEnabled:
        infiniteEnabled ?? config.ouroboros.infiniteTasksEnabled,
    },
    openWebUI: {
      ...config.openWebUI,
      host: env.OPENCLAUDE_OPEN_WEBUI_HOST ?? config.openWebUI.host,
      port: env.OPENCLAUDE_OPEN_WEBUI_PORT ?? config.openWebUI.port,
      pythonCommand:
        env.OPENCLAUDE_OPEN_WEBUI_PYTHON ?? config.openWebUI.pythonCommand,
      dataDir: env.OPENCLAUDE_OPEN_WEBUI_DATA_DIR ?? config.openWebUI.dataDir,
    },
    openRAG: {
      ...config.openRAG,
      enabled:
        parseEnvBoolean(env.OPENCLAUDE_OPENRAG_ENABLED) ??
        config.openRAG.enabled,
      url: env.OPENRAG_URL ?? env.OPENCLAUDE_OPENRAG_URL ?? config.openRAG.url,
      apiKey:
        env.OPENRAG_API_KEY ??
        env.OPENCLAUDE_OPENRAG_API_KEY ??
        config.openRAG.apiKey,
      repoDir: env.OPENCLAUDE_OPENRAG_REPO_DIR ?? config.openRAG.repoDir,
      workspaceDir:
        env.OPENCLAUDE_OPENRAG_WORKSPACE_DIR ?? config.openRAG.workspaceDir,
      frontendPort:
        env.OPENCLAUDE_OPENRAG_FRONTEND_PORT ?? config.openRAG.frontendPort,
      langflowPort:
        env.OPENCLAUDE_OPENRAG_LANGFLOW_PORT ?? config.openRAG.langflowPort,
      doclingPort:
        env.OPENCLAUDE_OPENRAG_DOCLING_PORT ?? config.openRAG.doclingPort,
      openSearchPassword:
        env.OPENCLAUDE_OPENRAG_OPENSEARCH_PASSWORD ??
        config.openRAG.openSearchPassword,
      langflowSuperuser:
        env.OPENCLAUDE_OPENRAG_LANGFLOW_SUPERUSER ??
        config.openRAG.langflowSuperuser,
      langflowSuperuserPassword:
        env.OPENCLAUDE_OPENRAG_LANGFLOW_SUPERUSER_PASSWORD ??
        config.openRAG.langflowSuperuserPassword,
      mcpEnabled:
        parseEnvBoolean(env.OPENCLAUDE_OPENRAG_MCP_ENABLED) ??
        config.openRAG.mcpEnabled,
      mcpCommand:
        env.OPENCLAUDE_OPENRAG_MCP_COMMAND ?? config.openRAG.mcpCommand,
      mcpArgs:
        env.OPENCLAUDE_OPENRAG_MCP_ARGS !== undefined
          ? splitEnvList(env.OPENCLAUDE_OPENRAG_MCP_ARGS)
          : config.openRAG.mcpArgs,
      mcpTimeoutSeconds:
        env.OPENRAG_MCP_TIMEOUT ??
        env.OPENCLAUDE_OPENRAG_MCP_TIMEOUT_SECONDS ??
        config.openRAG.mcpTimeoutSeconds,
    },
    ui: {
      ...config.ui,
      language:
        env.OPENCLAUDE_AGENT_UI_LANGUAGE === 'ru' ||
        env.OPENCLAUDE_AGENT_UI_LANGUAGE === 'en'
          ? env.OPENCLAUDE_AGENT_UI_LANGUAGE
          : config.ui.language,
    },
    runner: {
      ...config.runner,
      cwd: env.OPENCLAUDE_AGENT_RUNNER_CWD ?? config.runner.cwd,
      maxTurns:
        env.OPENCLAUDE_AGENT_RUNNER_MAX_TURNS ?? config.runner.maxTurns,
      timeoutMs:
        env.OPENCLAUDE_AGENT_RUNNER_TIMEOUT_MS ?? config.runner.timeoutMs,
      permissionMode:
        env.OPENCLAUDE_AGENT_RUNNER_PERMISSION_MODE ??
        config.runner.permissionMode,
      availableTools:
        env.OPENCLAUDE_AGENT_RUNNER_TOOLS !== undefined
          ? splitEnvList(env.OPENCLAUDE_AGENT_RUNNER_TOOLS)
          : config.runner.availableTools,
      disallowedTools:
        env.OPENCLAUDE_AGENT_RUNNER_DISALLOWED_TOOLS !== undefined
          ? splitEnvList(env.OPENCLAUDE_AGENT_RUNNER_DISALLOWED_TOOLS)
          : config.runner.disallowedTools,
    },
  })
}

export async function saveAgentGatewayConfig(
  config: AgentGatewayConfig,
): Promise<void> {
  const normalized = normalizeAgentGatewayConfig(config)
  await mkdir(getClaudeConfigHomeDir(), { recursive: true })
  await mkdir(getAgentGatewayStateDir(), { recursive: true })
  await writeFile(
    getAgentGatewayConfigPath(),
    `${JSON.stringify(normalized, null, 2)}\n`,
    'utf8',
  )
}

export async function updateAgentGatewayConfig(
  updater: (current: AgentGatewayConfig) => AgentGatewayConfig,
): Promise<AgentGatewayConfig> {
  const current = await loadAgentGatewayConfig()
  const next = normalizeAgentGatewayConfig(updater(current))
  await saveAgentGatewayConfig(next)
  return next
}

export function isAgentGatewayEnabled(config: AgentGatewayConfig): boolean {
  return config.api.enabled || config.cron.enabled || config.telegram.enabled
    || (config.ouroboros.enabled && config.ouroboros.consciousnessEnabled)
}

export function getAgentGatewayProjectRoot(config?: AgentGatewayConfig): string {
  return resolve(config?.runner.cwd || process.cwd())
}

function clampNumber(value: number, min: number, max: number): number {
  if (!Number.isFinite(value)) return min
  return Math.max(min, Math.min(max, value))
}

function parseEnvBoolean(value: string | undefined): boolean | undefined {
  if (value === undefined) return undefined
  const normalized = value.trim().toLowerCase()
  if (['1', 'true', 'yes', 'on'].includes(normalized)) return true
  if (['0', 'false', 'no', 'off'].includes(normalized)) return false
  return undefined
}

function splitEnvList(value: string | undefined): string[] {
  if (!value) return []
  return value
    .split(/[,\s]+/)
    .map(item => item.trim())
    .filter(Boolean)
}

export function maskSecret(value: string | undefined): string {
  if (!value) return 'not set'
  if (value.length <= 8) return 'set'
  return `${value.slice(0, 4)}...${value.slice(-4)}`
}
