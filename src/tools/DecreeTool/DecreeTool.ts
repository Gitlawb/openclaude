// @ts-nocheck
import { z } from 'zod/v4'
import { buildTool, type ToolDef } from '../../Tool.js'
import { lazySchema } from '../../utils/lazySchema.js'

const inputSchema = lazySchema(() =>
  z.strictObject({
    action: z.enum(['check', 'enforce', 'list', 'issue', 'revoke']).describe('Decree action'),
    tool: z.string().optional().describe('Tool name to check'),
    command: z.string().optional().describe('Command to check against decrees'),
    title: z.string().optional().describe('Decree title'),
    content: z.string().optional().describe('Decree content'),
    decreeId: z.string().optional().describe('Decree ID'),
    scope: z.enum(['universal', 'agent', 'session', 'project']).optional().describe('Decree scope'),
  }),
)
type InputSchema = ReturnType<typeof inputSchema>

// In-memory decree store (would persist in production)
const decrees: Array<{id: string; title: string; content: string; scope: string; status: string; rules: string[]; priority: string; created: string}> = []

export const DecreeTool = buildTool({
  name: 'decree',
  async description() { return 'Decree enforcement system — issue binding decrees (THE LAW), check if a tool/command is allowed, list active decrees. Decrees are enforced before tool execution. Part of Hive Nation Senate governance.' },
  async prompt() { return 'Binding decree system — issue THE LAW, check if tools are allowed, enforce Senate decisions. Use /decree issue to create binding rules. Use /decree check before executing tools in critical contexts.' },
  get inputSchema(): InputSchema { return inputSchema() },
  get outputSchema() {
    return z.object({
      success: z.boolean(),
      action: z.string(),
      allowed: z.boolean().optional(),
      decreeId: z.string().optional(),
      reason: z.string().optional(),
      decrees: z.array(z.object({ id: z.string(), title: z.string(), status: z.string(), scope: z.string() })).optional(),
      error: z.string().optional(),
    })
  },
  isConcurrencySafe() { return true },
  isReadOnly(input) { return input.action === 'check' || input.action === 'list' },
  async call(input, context, canUseTool, parentMessage) {
    const { action, tool, command, title, content, scope, decreeId } = input

    switch (action) {
      case 'check': {
        const target = tool ?? command ?? 'unknown'
        // Check against active universal + agent-scoped decrees
        const activeDecrees = decrees.filter(d => d.status === 'active')
        const blockingDecrees = activeDecrees.filter(d =>
          d.scope === 'universal' &&
          (d.rules.some(r => target.toLowerCase().includes(r.toLowerCase())) ||
           d.content.toLowerCase().includes(target.toLowerCase()))
        )
        if (blockingDecrees.length > 0) {
          return {
            data: {
              success: true,
              action: 'check',
              allowed: false,
              reason: `BLOCKED by decree(s): ${blockingDecrees.map(d => d.title).join(', ')}`,
              decreeId: blockingDecrees[0].id,
            },
          }
        }
        return { data: { success: true, action: 'check', allowed: true, reason: 'No blocking decrees' } }
      }
      case 'list': {
        return {
          data: {
            success: true,
            action: 'list',
            decrees: decrees.map(d => ({ id: d.id, title: d.title, status: d.status, scope: d.scope })),
          },
        }
      }
      case 'issue': {
        if (!title || !content) return { data: { success: false, action: 'issue', error: 'title and content required' } }
        const id = `decree_${Date.now()}`
        const rules: string[] = []
        // Extract potential rules from content
        if (content.toLowerCase().includes('no delete')) rules.push('delete', 'rm', 'remove')
        if (content.toLowerCase().includes('no deploy')) rules.push('deploy', 'push --all')
        if (content.toLowerCase().includes('auth required')) rules.push('auth', 'sudo')
        decrees.push({
          id,
          title,
          content,
          scope: scope ?? 'agent',
          status: 'active',
          rules,
          priority: 'high',
          created: new Date().toISOString(),
        })
        return { data: { success: true, action: 'issue', decreeId: id, reason: `Decree "${title}" is now THE LAW` } }
      }
      case 'revoke': {
        if (!decreeId) return { data: { success: false, action: 'revoke', error: 'decreeId required' } }
        const decree = decrees.find(d => d.id === decreeId)
        if (!decree) return { data: { success: false, action: 'revoke', error: 'decree not found' } }
        decree.status = 'revoked'
        return { data: { success: true, action: 'revoke', reason: `Decree "${decree.title}" revoked` } }
      }
      default:
        return { data: { success: false, action, error: `Unknown action: ${action}` } }
    }
  },
} satisfies ToolDef<InputSchema, { data: any }>)
