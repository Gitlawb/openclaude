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
    reportServerProgress?.({
      progress: 4,
      total: 10,
      message: 'Indexing files',
    })
    vi.advanceTimersByTime(30_000)
    await Promise.resolve()

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
      }),
    })

    resolveToolCall?.({ content: [{ type: 'text', text: 'done' }] })
    await callPromise
    const progressCountAfterCompletion = onProgress.mock.calls.length
    vi.advanceTimersByTime(30_000)
    expect(onProgress).toHaveBeenCalledTimes(progressCountAfterCompletion)
  })
})
