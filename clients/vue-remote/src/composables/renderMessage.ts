// Turn a raw WireMessage into display pieces.
// A single message may carry multiple content blocks — text, tool_use,
// tool_result, image. We expose each block so the UI can render them with
// distinct styling rather than cramming them into one string.

import type { ContentBlock, WireMessage } from '../types'
import { normaliseToolResult, summariseTool, type ToolSummary } from './toolSummary'

export type MessageRole = 'user' | 'assistant' | 'system'

export type RenderedBlock =
  | { kind: 'text'; text: string }
  | { kind: 'local_output'; text: string }
  | {
      kind: 'tool_use'
      id: string
      summary: ToolSummary
    }
  | { kind: 'tool_result'; content: string; isError: boolean; toolUseId: string }
  | { kind: 'image'; mediaType?: string; data?: string }
  | { kind: 'turn_duration'; durationMs: number }

export interface RenderedMessage {
  role: MessageRole
  uuid: string
  blocks: RenderedBlock[]
  isMeta: boolean
  isEmpty: boolean
}

function coerceBlocks(
  content: string | ContentBlock[] | undefined,
): ContentBlock[] {
  if (typeof content === 'string') {
    return [{ type: 'text', text: content }]
  }
  if (Array.isArray(content)) return content
  return []
}

function extractTag(text: string, tag: string): string | null {
  const open = `<${tag}>`
  const close = `</${tag}>`
  const start = text.indexOf(open)
  if (start === -1) return null
  const end = text.indexOf(close, start)
  if (end === -1) return null
  return text.slice(start + open.length, end)
}

// Mirror the TUI's UserTextMessage dispatch logic.
// Returns a RenderedBlock for display, or null to skip the block entirely.
function processUserTextBlock(text: string): RenderedBlock | null {
  // Invisible system injections — hide completely
  if (extractTag(text, 'tick') !== null) return null
  if (text.includes('<local-command-caveat>')) return null

  // Slash command: show as "/command args"
  if (text.includes('<command-message>')) {
    const cmd = extractTag(text, 'command-message') ?? ''
    const args = extractTag(text, 'command-args')
    const display = args ? `/${cmd} ${args}` : `/${cmd}`
    return { kind: 'text', text: display }
  }

  // Local command stdout/stderr: show extracted content in a preformatted block
  if (
    text.startsWith('<local-command-stdout') ||
    text.startsWith('<local-command-stderr')
  ) {
    const stdout = extractTag(text, 'local-command-stdout') ?? ''
    const stderr = extractTag(text, 'local-command-stderr') ?? ''
    const combined = [stdout.trim(), stderr.trim()].filter(Boolean).join('\n')
    return combined ? { kind: 'local_output', text: combined } : null
  }

  // Bash output/input injections — hide from web view (noise)
  if (
    text.startsWith('<bash-stdout') ||
    text.startsWith('<bash-stderr') ||
    text.includes('<bash-input>')
  ) {
    return null
  }

  // Other system-injected XML blocks — hide
  if (
    text.includes('<user-memory-input>') ||
    text.includes('<task-notification') ||
    text.includes('<mcp-resource-update') ||
    text.includes('<mcp-polling-update')
  ) {
    return null
  }

  if (!text.trim()) return null
  return { kind: 'text', text }
}

export function renderMessage(m: WireMessage): RenderedMessage {
  const role: MessageRole =
    m.type === 'user' ? 'user' : m.type === 'assistant' ? 'assistant' : 'system'

  // Special-case system subtypes that don't carry a content array but still
  // need to render inline.
  if (m.type === 'system' && m.subtype === 'turn_duration') {
    const durationMs = typeof m.durationMs === 'number' ? m.durationMs : 0
    return {
      role: 'system',
      uuid: typeof m.uuid === 'string' ? m.uuid : '',
      blocks: [{ kind: 'turn_duration', durationMs }],
      isMeta: m.isMeta === true,
      isEmpty: false,
    }
  }

  const raw = m.message?.content ?? m.content
  const blocks = coerceBlocks(raw)

  const rendered: RenderedBlock[] = []
  for (const b of blocks) {
    if (!b || typeof b !== 'object') continue
    if (b.type === 'text' && typeof b.text === 'string') {
      if (role === 'user') {
        const block = processUserTextBlock(b.text)
        if (block) rendered.push(block)
      } else {
        if (b.text.trim()) rendered.push({ kind: 'text', text: b.text })
      }
    } else if (b.type === 'tool_use') {
      const name = typeof b.name === 'string' ? b.name : 'tool'
      rendered.push({
        kind: 'tool_use',
        id: typeof b.id === 'string' ? b.id : '',
        summary: summariseTool(name, b.input),
      })
    } else if (b.type === 'tool_result') {
      rendered.push({
        kind: 'tool_result',
        content: normaliseToolResult(b.content),
        isError: b.is_error === true,
        toolUseId:
          typeof b.tool_use_id === 'string' ? (b.tool_use_id as string) : '',
      })
    } else if (b.type === 'image') {
      rendered.push({
        kind: 'image',
        mediaType: b.source?.media_type,
        data: b.source?.data,
      })
    }
  }

  return {
    role,
    uuid: typeof m.uuid === 'string' ? m.uuid : '',
    blocks: rendered,
    isMeta: m.isMeta === true,
    isEmpty: rendered.length === 0,
  }
}
