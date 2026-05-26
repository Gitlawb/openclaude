import type { ContextData } from './analyzeContext.js'
import { redactSecrets } from '../services/teamMemorySync/secretScanner.js'
import { formatFileSize, formatTokens } from './format.js'
import { redactUrlForDisplay } from './urlRedaction.js'

const ESTIMATED_BYTES_PER_TOKEN = 4

type ContributorKind =
  | 'system_prompt'
  | 'tool_schemas'
  | 'mcp_tool_schemas'
  | 'conversation_history'
  | 'tool_calls'
  | 'tool_results'
  | 'attachments'
  | 'memory'
  | 'agents'
  | 'skills'
  | 'other'

export type RequestSizeContributor = {
  label: string
  kind: ContributorKind
  tokens: number
  bytes: number
  details?: string
}

export type RequestSizeReport = {
  estimatedTokens: number
  estimatedBytes: number
  contributors: RequestSizeContributor[]
  topContributors: RequestSizeContributor[]
}

function estimateBytes(tokens: number): number {
  return Math.max(0, Math.round(tokens * ESTIMATED_BYTES_PER_TOKEN))
}

function sanitizeDisplayName(value: string | undefined): string {
  const raw = (value ?? 'unknown').trim() || 'unknown'
  const secretRedacted = redactSecrets(raw).replace(/\[REDACTED\]/g, 'redacted')
  const printable = redactUrlForDisplay(secretRedacted)
    .replace(/[^\x20-\x7e]/g, '?')
    .replace(/\|/g, '/')
    .replace(/(base64,)[^,\s;|)]+/gi, '$1redacted')
    .replace(/sk-ant-[A-Za-z0-9_-]{8,}/g, 'redacted')
    .replace(/sk-[A-Za-z0-9_-]{8,}/g, 'redacted')
    .replace(/AIza[A-Za-z0-9_-]{20,}/g, 'redacted')
    .replace(
      /((?:api[_-]?key|token|secret|password|passwd|pwd|auth|authorization)=)[^,\s;|)]+/gi,
      '$1redacted',
    )

  return printable.length > 80 ? `${printable.slice(0, 77)}...` : printable
}

function categoryTokens(data: ContextData, names: string[]): number {
  return data.categories
    .filter(category => names.includes(category.name))
    .reduce((sum, category) => sum + category.tokens, 0)
}

function isRequestPayloadCategory(category: ContextData['categories'][number]) {
  if ((category as { isDeferred?: boolean }).isDeferred) return false
  return ![
    'Free space',
    'Autocompact buffer',
    'Compact buffer',
    'MCP tools (deferred)',
    'System tools (deferred)',
  ].includes(category.name)
}

function requestCategoryTokenTotal(data: ContextData): number {
  return data.categories
    .filter(isRequestPayloadCategory)
    .reduce((sum, category) => sum + category.tokens, 0)
}

function addContributor(
  contributors: RequestSizeContributor[],
  label: string,
  kind: ContributorKind,
  tokens: number,
  details?: string,
) {
  if (tokens <= 0) return
  contributors.push({
    label,
    kind,
    tokens,
    bytes: estimateBytes(tokens),
    details,
  })
}

function topDetail(
  rows: Array<{ name: string; tokens: number }>,
  label: string,
): string | undefined {
  const top = rows
    .filter(row => row.tokens > 0)
    .sort((a, b) => b.tokens - a.tokens)
    .slice(0, 3)

  if (top.length === 0) return undefined

  return `${label}: ${top
    .map(row => `${sanitizeDisplayName(row.name)} ${formatTokens(row.tokens)}`)
    .join(', ')}`
}

function addMcpContributors(
  data: ContextData,
  contributors: RequestSizeContributor[],
) {
  const mcpCategoryTokens = categoryTokens(data, ['MCP tools'])
  const loadedTools = data.mcpTools.filter(tool => tool.isLoaded !== false)

  if (loadedTools.length === 0) {
    addContributor(
      contributors,
      'MCP tool schemas',
      'mcp_tool_schemas',
      mcpCategoryTokens,
    )
    return
  }

  const byServer = new Map<string, number>()
  for (const tool of loadedTools) {
    const serverName = sanitizeDisplayName(tool.serverName || 'unknown')
    byServer.set(serverName, (byServer.get(serverName) ?? 0) + tool.tokens)
  }

  const serverEntries = [...byServer.entries()]
  const scaledServerTokens =
    mcpCategoryTokens > 0
      ? scaleTokenParts(
          serverEntries.map(([, tokens]) => tokens),
          mcpCategoryTokens,
        )
      : serverEntries.map(([, tokens]) => tokens)

  for (const [index, [serverName]] of serverEntries.entries()) {
    addContributor(
      contributors,
      `MCP server ${serverName}`,
      'mcp_tool_schemas',
      scaledServerTokens[index] ?? 0,
    )
  }
}

function scaleTokens(tokens: number, scale: number): number {
  return Math.max(0, Math.round(tokens * scale))
}

function scaleTokenParts(tokens: number[], targetTotal: number): number[] {
  if (targetTotal <= 0) return tokens.map(tokenCount => Math.max(0, tokenCount))

  const rawTotal = tokens.reduce((sum, tokenCount) => sum + tokenCount, 0)
  if (rawTotal <= 0) return tokens.map(() => 0)

  const scaled = tokens.map((tokenCount, index) => {
    const exact = (tokenCount / rawTotal) * targetTotal
    const floor = Math.floor(exact)
    return {
      index,
      tokens: floor,
      remainder: exact - floor,
    }
  })

  let remaining =
    targetTotal - scaled.reduce((sum, part) => sum + part.tokens, 0)
  for (const part of [...scaled].sort((a, b) => b.remainder - a.remainder)) {
    if (remaining <= 0) break
    part.tokens += 1
    remaining -= 1
  }

  return scaled
    .sort((a, b) => a.index - b.index)
    .map(part => Math.max(0, part.tokens))
}

export function createRequestSizeReport(data: ContextData): RequestSizeReport {
  const contributors: RequestSizeContributor[] = []
  const messageBreakdown = data.messageBreakdown
  const messageCategoryTokens = categoryTokens(data, ['Messages'])

  addContributor(
    contributors,
    'System prompt',
    'system_prompt',
    categoryTokens(data, ['System prompt']),
  )
  addContributor(
    contributors,
    'Tool schemas',
    'tool_schemas',
    categoryTokens(data, ['System tools', '[internal] System tools']),
  )
  addMcpContributors(data, contributors)
  addContributor(
    contributors,
    'Memory files',
    'memory',
    categoryTokens(data, ['Memory files']),
    data.memoryFiles.length > 0
      ? `${data.memoryFiles.length} memory file${data.memoryFiles.length === 1 ? '' : 's'}`
      : undefined,
  )
  addContributor(
    contributors,
    'Custom agents',
    'agents',
    categoryTokens(data, ['Custom agents']),
    data.agents.length > 0
      ? `${data.agents.length} custom agent${data.agents.length === 1 ? '' : 's'}`
      : undefined,
  )
  addContributor(
    contributors,
    'Skills',
    'skills',
    categoryTokens(data, ['Skills']),
    data.skills
      ? `${data.skills.includedSkills}/${data.skills.totalSkills} skills included`
      : undefined,
  )

  if (messageBreakdown) {
    const rawConversationTokens =
      messageBreakdown.assistantMessageTokens +
      messageBreakdown.userMessageTokens
    const rawMessageContributorTokens =
      rawConversationTokens +
      messageBreakdown.toolCallTokens +
      messageBreakdown.toolResultTokens +
      messageBreakdown.attachmentTokens
    const messageScale =
      messageCategoryTokens > 0 && rawMessageContributorTokens > 0
        ? messageCategoryTokens / rawMessageContributorTokens
        : 1
    const [
      conversationTokens,
      toolCallTokens,
      toolResultTokens,
      attachmentTokens,
    ] =
      messageCategoryTokens > 0
        ? scaleTokenParts(
            [
              rawConversationTokens,
              messageBreakdown.toolCallTokens,
              messageBreakdown.toolResultTokens,
              messageBreakdown.attachmentTokens,
            ],
            messageCategoryTokens,
          )
        : [
            rawConversationTokens,
            messageBreakdown.toolCallTokens,
            messageBreakdown.toolResultTokens,
            messageBreakdown.attachmentTokens,
          ]

    addContributor(
      contributors,
      'Conversation history',
      'conversation_history',
      conversationTokens ?? 0,
    )
    addContributor(
      contributors,
      'Tool calls',
      'tool_calls',
      toolCallTokens ?? 0,
      topDetail(
        messageBreakdown.toolCallsByType.map(tool => ({
          name: tool.name,
          tokens: scaleTokens(tool.callTokens, messageScale),
        })),
        'Top calls',
      ),
    )
    addContributor(
      contributors,
      'Tool results',
      'tool_results',
      toolResultTokens ?? 0,
      topDetail(
        messageBreakdown.toolCallsByType.map(tool => ({
          name: tool.name,
          tokens: scaleTokens(tool.resultTokens, messageScale),
        })),
        'Top results',
      ),
    )
    addContributor(
      contributors,
      'Attachments/media',
      'attachments',
      attachmentTokens ?? 0,
      topDetail(
        messageBreakdown.attachmentsByType.map(attachment => ({
          name: attachment.name,
          tokens: scaleTokens(attachment.tokens, messageScale),
        })),
        'Top media',
      ),
    )
  }

  const accountedTokens = contributors.reduce(
    (sum, contributor) => sum + contributor.tokens,
    0,
  )
  const categoryTotal = requestCategoryTokenTotal(data)
  const unaccountedTokens = Math.max(0, categoryTotal - accountedTokens)
  addContributor(
    contributors,
    'Other request content',
    'other',
    unaccountedTokens,
  )

  const sortedContributors = contributors
    .filter(contributor => contributor.tokens > 0)
    .sort((a, b) => b.tokens - a.tokens)

  const contributorTotal = sortedContributors.reduce(
    (sum, contributor) => sum + contributor.tokens,
    0,
  )
  const estimatedTokens = categoryTotal > 0 ? categoryTotal : contributorTotal

  return {
    estimatedTokens,
    estimatedBytes: estimateBytes(estimatedTokens),
    contributors: sortedContributors,
    topContributors: sortedContributors.slice(0, 10),
  }
}

export function formatRequestSizeReport(report: RequestSizeReport): string {
  const lines = [
    'Request context size',
    '',
    `Estimated context load: ${formatFileSize(report.estimatedBytes)} (~${formatTokens(report.estimatedTokens)} tokens; rough byte equivalent at ~4 bytes/token)`,
    [
      'Caveat: This is a context/token estimate, not the serialized JSON request-body size.',
      'Base64 image/PDF/media payloads may be much larger on the wire.',
    ].join(' '),
    [
      'Privacy: shows contributor names and sizes only;',
      'request content is not printed.',
    ].join(' '),
    '',
  ]

  if (report.topContributors.length === 0) {
    lines.push('No request contributors found for the current context.')
    return lines.join('\n')
  }

  lines.push('Top contributors:')
  lines.push('')
  lines.push('| # | Contributor | Tokens | Context byte equiv. |')
  lines.push('|---|-------------|--------|---------------------|')

  for (const [index, contributor] of report.topContributors.entries()) {
    const details = contributor.details ? ` (${contributor.details})` : ''
    lines.push(
      [
        `| ${index + 1}`,
        contributor.label + details,
        formatTokens(contributor.tokens),
        `${formatFileSize(contributor.bytes)} |`,
      ].join(' | '),
    )
  }

  return lines.join('\n')
}
