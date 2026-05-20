import { afterEach, beforeEach, describe, expect, mock, test } from 'bun:test'
import { getDefaultAgentGatewayConfig, type AgentGatewayConfig } from './config.js'

const runOpenClaudeAgent = mock(async (options: {
  prompt: string
  onStdout?: (chunk: string) => void
}) => {
  options.onStdout?.(`mock response: ${options.prompt}`)
  return {
    text: `mock response: ${options.prompt}`,
    stderr: '',
    exitCode: 0,
    timedOut: false,
  }
})

mock.module('./agentRunner.js', () => ({
  runOpenClaudeAgent,
  addAgentRunObserver: () => () => {},
  normalizeMessageContent: (content: unknown) =>
    typeof content === 'string' ? content : String(content ?? ''),
  buildPromptFromChatMessages: (messages: Array<Record<string, unknown>>) => {
    const system = messages
      .filter(message => message.role === 'system')
      .map(message => String(message.content ?? ''))
    const conversation = messages
      .filter(message => message.role === 'user' || message.role === 'assistant')
      .map(message => ({
        role: String(message.role),
        content: String(message.content ?? ''),
      }))
    const lastUserIndex = conversation
      .map(message => message.role)
      .lastIndexOf('user')
    const lastUser = lastUserIndex === -1 ? undefined : conversation[lastUserIndex]
    const history = lastUserIndex <= 0 ? [] : conversation.slice(0, lastUserIndex)
    const parts = []
    if (system.length) parts.push(`System instructions:\n${system.join('\n\n')}`)
    if (history.length) {
      parts.push(
        `Conversation so far:\n${history
          .map(message => `${message.role}: ${message.content}`)
          .join('\n\n')}`,
      )
    }
    if (lastUser) parts.push(lastUser.content)
    return {
      prompt: parts.join('\n\n'),
      systemPrompt: undefined,
    }
  },
}))

function testConfig(overrides?: Partial<AgentGatewayConfig>): AgentGatewayConfig {
  const defaults = getDefaultAgentGatewayConfig()
  return {
    ...defaults,
    ...overrides,
    api: {
      ...defaults.api,
      enabled: true,
      host: '127.0.0.1',
      port: 0,
      ...overrides?.api,
    },
    telegram: {
      ...defaults.telegram,
      ...overrides?.telegram,
    },
    cron: {
      ...defaults.cron,
      ...overrides?.cron,
    },
    runner: {
      ...defaults.runner,
      ...overrides?.runner,
    },
  }
}

describe('AgentApiServer', () => {
  let server: import('./apiServer.js').AgentApiServer | undefined

  beforeEach(() => {
    runOpenClaudeAgent.mockClear()
  })

  afterEach(async () => {
    await server?.stop()
    server = undefined
  })

  test('serves OpenAI-compatible chat completions through the agent runner', async () => {
    const { AgentApiServer } = await import('./apiServer.js')
    server = new AgentApiServer({ config: testConfig() })
    await server.start()

    const response = await fetch(`${server.url}/v1/chat/completions`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        model: 'openclaude-agent',
        messages: [{ role: 'user', content: 'hello from api' }],
      }),
    })

    expect(response.status).toBe(200)
    const body = await response.json() as {
      choices: Array<{ message: { content: string } }>
    }
    expect(body.choices[0]?.message.content).toBe(
      'mock response: hello from api',
    )
    expect(runOpenClaudeAgent).toHaveBeenCalledWith(
      expect.objectContaining({ prompt: 'hello from api' }),
    )
  })

  test('returns a client error for malformed JSON bodies', async () => {
    const { AgentApiServer } = await import('./apiServer.js')
    server = new AgentApiServer({ config: testConfig() })
    await server.start()

    const response = await fetch(`${server.url}/v1/chat/completions`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: '\uFEFF{not-json',
    })

    expect(response.status).toBe(400)
    const body = (await response.json()) as {
      error: { message: string; type: string }
    }
    expect(body.error.message).toBe('Invalid JSON request body')
    expect(body.error.type).toBe('invalid_request_error')
  })

  test('requires bearer auth when API key is configured', async () => {
    const { AgentApiServer } = await import('./apiServer.js')
    server = new AgentApiServer({
      config: testConfig({ api: { apiKey: 'secret' } as never }),
    })
    await server.start()

    const response = await fetch(`${server.url}/v1/models`)
    expect(response.status).toBe(401)

    const authorized = await fetch(`${server.url}/v1/models`, {
      headers: { Authorization: 'Bearer secret' },
    })
    expect(authorized.status).toBe(200)
  })

  test('serves OpenWebUI-friendly model aliases', async () => {
    const { AgentApiServer } = await import('./apiServer.js')
    server = new AgentApiServer({ config: testConfig() })
    await server.start()

    const bare = await fetch(`${server.url}/models`)
    expect(bare.status).toBe(200)
    const bareBody = await bare.json() as { data: Array<{ id: string }> }
    expect(bareBody.data[0]?.id).toBe('openclaude-agent')

    const apiV1 = await fetch(`${server.url}/api/v1/models/openclaude-agent`)
    expect(apiV1.status).toBe(200)
    const model = await apiV1.json() as { id: string }
    expect(model.id).toBe('openclaude-agent')
  })

  test('chains chat completions with X-Hermes-Session-Id', async () => {
    const { AgentApiServer } = await import('./apiServer.js')
    server = new AgentApiServer({ config: testConfig() })
    await server.start()

    const first = await fetch(`${server.url}/v1/chat/completions`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        model: 'openclaude-agent',
        messages: [{ role: 'user', content: 'remember alpha' }],
      }),
    })
    expect(first.status).toBe(200)
    const sessionId = first.headers.get('x-hermes-session-id')
    expect(sessionId).toBeTruthy()

    const second = await fetch(`${server.url}/v1/chat/completions`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-Hermes-Session-Id': sessionId!,
      },
      body: JSON.stringify({
        model: 'openclaude-agent',
        messages: [{ role: 'user', content: 'now beta' }],
      }),
    })
    expect(second.status).toBe(200)
    const secondBody = await second.json() as {
      choices: Array<{ message: { content: string } }>
    }
    expect(secondBody.choices[0]?.message.content).toContain('remember alpha')
    expect(secondBody.choices[0]?.message.content).toContain('now beta')
  })

  test('chains Responses API calls with previous_response_id and named conversations', async () => {
    const { AgentApiServer } = await import('./apiServer.js')
    server = new AgentApiServer({ config: testConfig() })
    await server.start()

    const first = await fetch(`${server.url}/v1/responses`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        input: 'first turn',
        conversation: 'chat-a',
      }),
    })
    expect(first.status).toBe(200)
    const firstBody = await first.json() as { id: string }

    const second = await fetch(`${server.url}/v1/responses`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        input: 'second turn',
        previous_response_id: firstBody.id,
      }),
    })
    expect(second.status).toBe(200)
    const secondBody = await second.json() as {
      previous_response_id: string
      output: Array<{ content?: Array<{ text?: string }> }>
    }
    expect(secondBody.previous_response_id).toBe(firstBody.id)
    expect(secondBody.output[0]?.content?.[0]?.text).toContain('first turn')
    expect(secondBody.output[0]?.content?.[0]?.text).toContain('second turn')

    const third = await fetch(`${server.url}/v1/responses`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        input: 'third turn',
        conversation: 'chat-a',
      }),
    })
    expect(third.status).toBe(200)
    const thirdBody = await third.json() as { previous_response_id: string }
    expect(thirdBody.previous_response_id).toBe(firstBody.id)
  })

  test('allows public or tunnel bind only when an API key is set', async () => {
    const { AgentApiServer } = await import('./apiServer.js')
    const withoutKey = new AgentApiServer({
      config: testConfig({
        api: { host: '0.0.0.0' } as never,
      }),
    })
    await expect(withoutKey.start()).rejects.toThrow(
      'without an API key',
    )

    server = new AgentApiServer({
      config: testConfig({
        api: { host: '0.0.0.0', apiKey: 'secret' } as never,
      }),
    })
    await server.start()

    const response = await fetch(`${server.url}/v1/models`, {
      headers: { Authorization: 'Bearer secret' },
    })
    expect(response.status).toBe(200)
  })

  test('strips leading frontmatter from agent responses before returning them to API clients', async () => {
    runOpenClaudeAgent.mockImplementationOnce(async () => ({
      text: [
        '---',
        'name: odessa-file-created',
        'description: created a file',
        'type: project',
        '---',
        '',
        'Создал файл Одесса2.txt на рабочем столе.',
      ].join('\n'),
      stderr: '',
      exitCode: 0,
      timedOut: false,
    }))

    const { AgentApiServer } = await import('./apiServer.js')
    server = new AgentApiServer({ config: testConfig() })
    await server.start()

    const response = await fetch(`${server.url}/v1/chat/completions`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        model: 'openclaude-agent',
        messages: [{ role: 'user', content: 'create odessa file' }],
      }),
    })

    expect(response.status).toBe(200)
    const body = await response.json() as {
      choices: Array<{ message: { content: string } }>
    }
    expect(body.choices[0]?.message.content).toBe(
      'Создал файл Одесса2.txt на рабочем столе.',
    )
  })
})
