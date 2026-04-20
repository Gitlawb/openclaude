/**
 * MockQueryEngine — deterministic mock for SDK happy-path tests.
 *
 * Replaces the real QueryEngine via Bun.mock.module().
 * submitMessage() yields a fixed message sequence:
 *   1. assistant text response
 *   2. result (success)
 */
import type { SDKMessage } from '../../../src/entrypoints/sdk.js'

export class MockQueryEngine {
  config = {
    mcpClients: [] as unknown[],
    tools: [] as unknown[],
    agents: [] as unknown[],
  }

  private _messages: unknown[] = []
  private _sessionId = 'mock-session-id'
  private _aborted = false

  async *submitMessage(
    prompt: string,
    _options?: { uuid?: string; isMeta?: boolean },
  ): AsyncGenerator<SDKMessage, void, unknown> {
    if (this._aborted) return

    // Yield an assistant response
    yield {
      type: 'assistant',
      message: {
        role: 'assistant',
        content: [{ type: 'text', text: `Mock response to: ${prompt}` }],
        model: 'mock-model',
      },
    } as unknown as SDKMessage

    // Yield a result message
    yield {
      type: 'result',
      subtype: 'success',
      result: `Completed: ${prompt}`,
      session_id: this._sessionId,
      cost_usd: 0,
      duration_ms: 10,
      duration_api_ms: 5,
      is_error: false,
      num_turns: 1,
      total_cost: 0,
    } as unknown as SDKMessage
  }

  injectMessages(messages: unknown[]): void {
    this._messages.push(...messages)
  }

  injectAgents(agents: unknown[]): void {
    this.config.agents = agents
  }

  updateTools(tools: unknown[]): void {
    this.config.tools = tools
  }

  getMessages(): unknown[] {
    return this._messages
  }

  getSessionId(): string {
    return this._sessionId
  }

  interrupt(): void {
    this._aborted = true
  }
}
