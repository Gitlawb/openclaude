import { afterEach, describe, expect, test, vi } from 'vitest'
import { createAssistantMessage } from '../../utils/messages.js'
import { fetchToolsForClient } from './client.js'
import type { ConnectedMCPServer } from './types.js'

describe('MCP tool activity', () => {
  afterEach(() => {
    vi.useRealTimers()
  })

  test('emits progress heartbeats while a tool call remains pending', async () => {
    vi.useFakeTimers()
    let resolveToolCall: ((result: unknown) => void) | undefined
    let reportServerProgress:
      | ((progress: {
          progress: number
          total?: number
          message?: string
        }) => void)
      | undefined
    const sdkClient = {
      request: vi.fn(async () => ({
        tools: [
          {
            name: 'slow-tool',
            inputSchema: { type: 'object' },
          },
        ],
      })),
      callTool: vi.fn(
        (
          _request: unknown,
          _schema: unknown,
          options: {
            onprogress?: typeof reportServerProgress
          },
        ) => {
          reportServerProgress = options.onprogress
          return new Promise(resolve => {
            resolveToolCall = resolve
          })
        },
      ),
    }
    const connection = {
      type: 'connected',
      name: 'heartbeat-test',
      config: { type: 'sdk' },
      capabilities: { tools: {} },
      client: sdkClient,
    } as unknown as ConnectedMCPServer
    const [tool] = await fetchToolsForClient(connection)
    expect(tool).toBeDefined()
    const onProgress = vi.fn()
    const parentMessage = createAssistantMessage({
      content: [
        {
          type: 'tool_use',
          id: 'toolu_heartbeat',
          name: tool!.name,
          input: {},
        },
      ],
    })

    const callPromise = tool!.call(
      {},
      {
        abortController: new AbortController(),
        setAppState: vi.fn(),
      } as never,
      undefined as never,
      parentMessage,
      onProgress,
    )
    await Promise.resolve()
    await Promise.resolve()
    expect(reportServerProgress).toBeDefined()

    // Silent server: no progress notifications at all. The wrapper's own
    // heartbeat must still fire so QueryGuard sees activity.
    vi.advanceTimersByTime(30_000)
    await Promise.resolve()
    expect(onProgress).toHaveBeenLastCalledWith({
      toolUseID: 'toolu_heartbeat',
      data: expect.objectContaining({
        type: 'mcp_progress',
        status: 'progress',
        serverName: 'heartbeat-test',
        toolName: 'slow-tool',
        elapsedTimeMs: expect.any(Number),
      }),
    })

    reportServerProgress?.({
      progress: 4,
      total: 10,
      message: 'Indexing files',
    })
    vi.advanceTimersByTime(30_000)
    await Promise.resolve()

    // The next heartbeat carries the cached server progress values.
    expect(onProgress).toHaveBeenLastCalledWith({
      toolUseID: 'toolu_heartbeat',
      data: expect.objectContaining({
        type: 'mcp_progress',
        status: 'progress',
        serverName: 'heartbeat-test',
        toolName: 'slow-tool',
        progress: 4,
        total: 10,
        progressMessage: 'Indexing files',
        elapsedTimeMs: expect.any(Number),
      }),
    })

    // A later notification carrying only progress must not drop the
    // previously reported total/progressMessage, either in the forwarded
    // event or in subsequent heartbeats.
    reportServerProgress?.({ progress: 7 })
    await Promise.resolve()
    expect(onProgress).toHaveBeenLastCalledWith({
      toolUseID: 'toolu_heartbeat',
      data: expect.objectContaining({
        type: 'mcp_progress',
        status: 'progress',
        progress: 7,
        total: 10,
        progressMessage: 'Indexing files',
      }),
    })
    vi.advanceTimersByTime(30_000)
    await Promise.resolve()
    expect(onProgress).toHaveBeenLastCalledWith({
      toolUseID: 'toolu_heartbeat',
      data: expect.objectContaining({
        type: 'mcp_progress',
        status: 'progress',
        progress: 7,
        total: 10,
        progressMessage: 'Indexing files',
        elapsedTimeMs: expect.any(Number),
      }),
    })

    resolveToolCall?.({ content: [{ type: 'text', text: 'done' }] })
    await callPromise
    const progressCountAfterCompletion = onProgress.mock.calls.length
    vi.advanceTimersByTime(30_000)
    expect(onProgress).toHaveBeenCalledTimes(progressCountAfterCompletion)
  })

  test('a throwing progress callback does not break the tool call', async () => {
    vi.useFakeTimers()
    let resolveToolCall: ((result: unknown) => void) | undefined
    const sdkClient = {
      request: vi.fn(async () => ({
        tools: [
          {
            name: 'slow-tool',
            inputSchema: { type: 'object' },
          },
        ],
      })),
      callTool: vi.fn(
        () =>
          new Promise(resolve => {
            resolveToolCall = resolve
          }),
      ),
    }
    const connection = {
      type: 'connected',
      name: 'heartbeat-throw-test',
      config: { type: 'sdk' },
      capabilities: { tools: {} },
      client: sdkClient,
    } as unknown as ConnectedMCPServer
    const [tool] = await fetchToolsForClient(connection)
    expect(tool).toBeDefined()
    const onProgress = vi.fn(({ data }: { data: { status: string } }) => {
      if (data.status === 'progress') {
        throw new Error('progress consumer failure')
      }
    })
    const parentMessage = createAssistantMessage({
      content: [
        {
          type: 'tool_use',
          id: 'toolu_heartbeat_throw',
          name: tool!.name,
          input: {},
        },
      ],
    })

    const callPromise = tool!.call(
      {},
      {
        abortController: new AbortController(),
        setAppState: vi.fn(),
      } as never,
      undefined as never,
      parentMessage,
      onProgress,
    )
    await Promise.resolve()
    await Promise.resolve()

    // Heartbeat throws inside the timer callback; it must be contained
    // instead of surfacing as an uncaught exception.
    expect(() => vi.advanceTimersByTime(30_000)).not.toThrow()

    resolveToolCall?.({ content: [{ type: 'text', text: 'done' }] })
    await expect(callPromise).resolves.toMatchObject({
      data: [{ type: 'text', text: 'done' }],
    })
  })

  test('a throwing completed callback does not turn success into failure', async () => {
    const sdkClient = {
      request: vi.fn(async () => ({
        tools: [
          {
            name: 'slow-tool',
            inputSchema: { type: 'object' },
          },
        ],
      })),
      callTool: vi.fn(async () => ({
        content: [{ type: 'text', text: 'done' }],
      })),
    }
    const connection = {
      type: 'connected',
      name: 'completed-throw-test',
      config: { type: 'sdk' },
      capabilities: { tools: {} },
      client: sdkClient,
    } as unknown as ConnectedMCPServer
    const [tool] = await fetchToolsForClient(connection)
    expect(tool).toBeDefined()
    const onProgress = vi.fn(({ data }: { data: { status: string } }) => {
      if (data.status === 'completed') {
        throw new Error('progress consumer failure')
      }
    })
    const parentMessage = createAssistantMessage({
      content: [
        {
          type: 'tool_use',
          id: 'toolu_completed_throw',
          name: tool!.name,
          input: {},
        },
      ],
    })

    await expect(
      tool!.call(
        {},
        {
          abortController: new AbortController(),
          setAppState: vi.fn(),
        } as never,
        undefined as never,
        parentMessage,
        onProgress,
      ),
    ).resolves.toMatchObject({
      data: [{ type: 'text', text: 'done' }],
    })
    expect(sdkClient.callTool).toHaveBeenCalledTimes(1)
  })

  test('a throwing failed callback preserves the original tool error', async () => {
    const sdkClient = {
      request: vi.fn(async () => ({
        tools: [
          {
            name: 'slow-tool',
            inputSchema: { type: 'object' },
          },
        ],
      })),
      callTool: vi.fn(async () => {
        throw new Error('original tool failure')
      }),
    }
    const connection = {
      type: 'connected',
      name: 'failed-throw-test',
      config: { type: 'sdk' },
      capabilities: { tools: {} },
      client: sdkClient,
    } as unknown as ConnectedMCPServer
    const [tool] = await fetchToolsForClient(connection)
    expect(tool).toBeDefined()
    const onProgress = vi.fn(({ data }: { data: { status: string } }) => {
      if (data.status === 'failed') {
        throw new Error('progress consumer failure')
      }
    })
    const parentMessage = createAssistantMessage({
      content: [
        {
          type: 'tool_use',
          id: 'toolu_failed_throw',
          name: tool!.name,
          input: {},
        },
      ],
    })

    await expect(
      tool!.call(
        {},
        {
          abortController: new AbortController(),
          setAppState: vi.fn(),
        } as never,
        undefined as never,
        parentMessage,
        onProgress,
      ),
    ).rejects.toThrow('original tool failure')
  })
})
