// @ts-nocheck
import { z } from 'zod/v4'
import { buildTool, type ToolDef } from '../../Tool.js'
import { lazySchema } from '../../utils/lazySchema.js'
import { DESCRIPTION } from './prompt.js'

const MESH_API_URL = 'http://localhost:4000'

const inputSchema = lazySchema(() =>
  z.strictObject({
    action: z
      .enum(['status', 'broadcast', 'peers', 'send'])
      .describe('Mesh networking action'),
    message: z.string().optional().describe('Message for broadcast or send'),
    peerId: z.string().optional().describe('Target peer ID for send'),
    peerName: z.string().optional().describe('Target peer name for send'),
  }),
)
type InputSchema = ReturnType<typeof inputSchema>

const outputSchema = lazySchema(() =>
  z.object({
    success: z.boolean(),
    action: z.string(),
    connected: z.boolean().optional(),
    agents: z
      .array(
        z.object({
          id: z.string(),
          name: z.string(),
          capabilities: z.array(z.string()),
          lastSeen: z.number(),
        }),
      )
      .optional(),
    peerCount: z.number().optional(),
    broadcastId: z.string().optional(),
    messageId: z.string().optional(),
    error: z.string().optional(),
  }),
)
type OutputSchema = ReturnType<typeof outputSchema>
type Output = z.infer<OutputSchema>

async function meshRequest(
  path: string,
  options?: RequestInit,
): Promise<{ ok: boolean; data?: unknown; error?: string }> {
  try {
    const res = await fetch(`${MESH_API_URL}${path}`, {
      ...options,
      headers: {
        'Content-Type': 'application/json',
        'x-api-key': 'openclaw-mesh-default-key',
        ...options?.headers,
      },
    })
    const data = await res.json().catch(() => ({}))
    return { ok: res.ok, data }
  } catch (e) {
    return { ok: false, error: String(e) }
  }
}

export const MeshTool = buildTool({
  name: 'mesh',
  async description() { return DESCRIPTION },
  async prompt() { return DESCRIPTION },
  get inputSchema(): InputSchema { return inputSchema() },
  get outputSchema(): OutputSchema { return outputSchema() },
  isConcurrencySafe() { return true },
  isReadOnly() { return true },
  async call(input, context, canUseTool, parentMessage) {
    const { action, message, peerId, peerName } = input

    switch (action) {
      case 'status': {
        const result = await meshRequest('/api/mesh/status')
        if (!result.ok) {
          return {
            data: {
              success: false,
              action: 'status',
              connected: false,
              error: result.error || 'Mesh API unreachable (is agent-mesh-api running on port 4000?)',
            },
          }
        }
        return {
          data: {
            success: true,
            action: 'status',
            connected: true,
            ...(result.data as object),
          },
        }
      }

      case 'peers': {
        const result = await meshRequest('/api/mesh/agents')
        if (!result.ok) {
          return {
            data: {
              success: false,
              action: 'peers',
              error: result.error || 'Failed to fetch peers',
            },
          }
        }
        const agents = ((result.data as { agents?: unknown[] })?.agents || []) as {
          id: string
          name: string
          capabilities?: string[]
          lastSeen?: number
        }[]
        return {
          data: {
            success: true,
            action: 'peers',
            agents,
            peerCount: agents.length,
          },
        }
      }

      case 'broadcast': {
        if (!message) {
          return {
            data: {
              success: false,
              action: 'broadcast',
              error: 'message required for broadcast',
            },
          }
        }
        const result = await meshRequest('/api/mesh/broadcast', {
          method: 'POST',
          body: JSON.stringify({ content: message }),
        })
        if (!result.ok) {
          return {
            data: {
              success: false,
              action: 'broadcast',
              error: result.error || 'Broadcast failed',
            },
          }
        }
        return {
          data: {
            success: true,
            action: 'broadcast',
            broadcastId: (result.data as { id?: string })?.id || 'unknown',
            message: `Broadcast sent: ${message.slice(0, 50)}${message.length > 50 ? '...' : ''}`,
          },
        }
      }

      case 'send': {
        if (!message) {
          return {
            data: {
              success: false,
              action: 'send',
              error: 'message required for send',
            },
          }
        }
        const target = peerId || peerName
        if (!target) {
          return {
            data: {
              success: false,
              action: 'send',
              error: 'peerId or peerName required for send',
            },
          }
        }
        const result = await meshRequest('/api/mesh/message', {
          method: 'POST',
          body: JSON.stringify({ to: target, content: message }),
        })
        if (!result.ok) {
          return {
            data: {
              success: false,
              action: 'send',
              error: result.error || 'Send failed',
            },
          }
        }
        return {
          data: {
            success: true,
            action: 'send',
            messageId: (result.data as { id?: string })?.id || 'unknown',
            message: `Message sent to ${target}: ${message.slice(0, 50)}${message.length > 50 ? '...' : ''}`,
          },
        }
      }

      default:
        return {
          data: {
            success: false,
            action,
            error: `Unknown action: ${action}`,
          },
        }
    }
  },
} satisfies ToolDef<InputSchema, Output>)
