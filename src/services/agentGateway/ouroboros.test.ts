import { describe, expect, test } from 'bun:test'
import {
  applyAgentGatewayEnvOverrides,
  isAgentGatewayEnabled,
  normalizeAgentGatewayConfig,
} from './config.js'
import { resolveProjectRoot, selfList } from './selfEdit.js'

describe('agent gateway Ouroboros config', () => {
  test('normalizes opt-in consciousness settings', () => {
    const config = normalizeAgentGatewayConfig({
      ouroboros: {
        enabled: true,
        consciousnessEnabled: true,
        wakeupMinSeconds: 5,
        wakeupMaxSeconds: 10,
        maxRounds: 0,
        budgetFraction: 2,
        infiniteTasksEnabled: true,
      },
    })

    expect(config.ouroboros.enabled).toBe(true)
    expect(config.ouroboros.consciousnessEnabled).toBe(true)
    expect(config.ouroboros.infiniteTasksEnabled).toBe(true)
    expect(config.ouroboros.wakeupMinSeconds).toBe(30)
    expect(config.ouroboros.wakeupMaxSeconds).toBe(60)
    expect(config.ouroboros.maxRounds).toBe(1)
    expect(config.ouroboros.budgetFraction).toBe(1)
    expect(isAgentGatewayEnabled(config)).toBe(true)
  })

  test('supports Telegram user allowlist and env overrides', () => {
    const config = applyAgentGatewayEnvOverrides(
      normalizeAgentGatewayConfig({
        telegram: {
          allowedUserIds: ['42'],
        },
      }),
      {
        TELEGRAM_BOT_TOKEN: '123:abc',
        OPENCLAUDE_TELEGRAM_ALLOWED_USER_IDS: '100, 200',
        OPENCLAUDE_TELEGRAM_MAX_DOWNLOAD_BYTES: '1234567',
        OPENCLAUDE_TELEGRAM_MAX_UPLOAD_BYTES: '2345678',
        OPENCLAUDE_TELEGRAM_TRANSCRIBE_AUDIO: '0',
        OPENCLAUDE_TELEGRAM_TRANSCRIPTION_PROVIDER: 'openai',
        OPENCLAUDE_TELEGRAM_TRANSCRIPTION_OPENAI_MODEL: 'gpt-4o-mini-transcribe',
        OPENCLAUDE_AGENT_API_PORT: '8765',
        OPENCLAUDE_AGENT_UI_LANGUAGE: 'ru',
        OPENCLAUDE_AGENT_RUNNER_CWD: '/workspace',
        OPENCLAUDE_AGENT_RUNNER_MAX_TURNS: '7',
        OPENCLAUDE_AGENT_RUNNER_TIMEOUT_MS: '12345',
        OPENCLAUDE_AGENT_RUNNER_PERMISSION_MODE: 'bypassPermissions',
        OPENCLAUDE_AGENT_RUNNER_TOOLS: 'Bash,Read,Write',
        OPENCLAUDE_AGENT_RUNNER_DISALLOWED_TOOLS: '',
        OPENCLAUDE_AGENT_CRON_TICK_SECONDS: '5',
        OPENCLAUDE_OPENRAG_ENABLED: '1',
        OPENRAG_URL: 'http://localhost:3000',
        OPENRAG_API_KEY: 'orag_test',
        OPENCLAUDE_OPENRAG_FRONTEND_PORT: '3300',
        OPENCLAUDE_OPENRAG_LANGFLOW_PORT: '7861',
        OPENCLAUDE_OPENRAG_DOCLING_PORT: '5002',
        OPENCLAUDE_OPENRAG_MCP_ENABLED: '1',
        OPENCLAUDE_OPENRAG_MCP_COMMAND: 'uvx',
        OPENCLAUDE_OPENRAG_MCP_ARGS: 'openrag-mcp',
        OPENRAG_MCP_TIMEOUT: '90',
        OPENCLAUDE_OUROBOROS_WAKEUP_MIN_SECONDS: '45',
        OPENCLAUDE_OUROBOROS_WAKEUP_MAX_SECONDS: '90',
        OPENCLAUDE_OUROBOROS_MAX_ROUNDS: '4',
        OPENCLAUDE_OUROBOROS_BUDGET_FRACTION: '0.25',
      },
    )

    expect(config.telegram.botToken).toBe('123:abc')
    expect(config.telegram.allowedUserIds).toEqual(['100', '200'])
    expect(config.telegram.maxDownloadBytes).toBe(1234567)
    expect(config.telegram.maxUploadBytes).toBe(2345678)
    expect(config.telegram.transcribeAudio).toBe(false)
    expect(config.telegram.transcriptionProvider).toBe('openai')
    expect(config.telegram.transcriptionOpenAIModel).toBe(
      'gpt-4o-mini-transcribe',
    )
    expect(config.api.port).toBe(8765)
    expect(config.ui.language).toBe('ru')
    expect(config.runner.cwd).toBe('/workspace')
    expect(config.runner.maxTurns).toBe(7)
    expect(config.runner.timeoutMs).toBe(12345)
    expect(config.runner.permissionMode).toBe('bypassPermissions')
    expect(config.runner.availableTools).toEqual(['Bash', 'Read', 'Write'])
    expect(config.runner.disallowedTools).toEqual([])
    expect(config.cron.tickIntervalSeconds).toBe(5)
    expect(config.openRAG.enabled).toBe(true)
    expect(config.openRAG.url).toBe('http://localhost:3000')
    expect(config.openRAG.apiKey).toBe('orag_test')
    expect(config.openRAG.frontendPort).toBe(3300)
    expect(config.openRAG.langflowPort).toBe(7861)
    expect(config.openRAG.doclingPort).toBe(5002)
    expect(config.openRAG.mcpEnabled).toBe(true)
    expect(config.openRAG.mcpCommand).toBe('uvx')
    expect(config.openRAG.mcpArgs).toEqual(['openrag-mcp'])
    expect(config.openRAG.mcpTimeoutSeconds).toBe(90)
    expect(config.ouroboros.wakeupMinSeconds).toBe(45)
    expect(config.ouroboros.wakeupMaxSeconds).toBe(90)
    expect(config.ouroboros.maxRounds).toBe(4)
    expect(config.ouroboros.budgetFraction).toBe(0.25)
  })
})

describe('agent gateway self-edit paths', () => {
  test('resolves self-edit operations from the project root', async () => {
    expect(resolveProjectRoot()).toBe(process.cwd())

    const listing = await selfList('src/services/agentGateway')
    expect(listing.files).toContain('src/services/agentGateway/apiServer.ts')
  })
})
