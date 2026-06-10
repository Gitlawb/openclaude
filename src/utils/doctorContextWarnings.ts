import { roughTokenCountEstimation } from '../services/tokenEstimation.js'
import type { ToolPermissionContext, Tools } from '../Tool.js'
import type { AgentDefinitionsResult } from '../tools/AgentTool/loadAgentsDir.js'
import { countMcpToolTokens } from './analyzeContext.js'
import {
  getLargeMemoryFiles,
  getMemoryFiles,
  MAX_MEMORY_CHARACTER_COUNT,
  type MemoryFileInfo,
} from './claudemd.js'
import { getMainLoopModel } from './model/model.js'
import { permissionRuleValueToString } from './permissions/permissionRuleParser.js'
import { detectUnreachableRules } from './permissions/shadowedRuleDetection.js'
import { SandboxManager } from './sandbox/sandbox-adapter.js'
import {
  AGENT_DESCRIPTIONS_THRESHOLD,
  getAgentDescriptionsTotalTokens,
} from './statusNoticeHelpers.js'
import { plural } from './stringUtils.js'

// Thresholds (matching status notices and existing patterns)
const MCP_TOOLS_THRESHOLD = 25_000

type McpToolTokenDetail = {
  name: string
  serverName?: string
  tokens: number
  isLoaded?: boolean
}

export type CheckContextWarningsOptions = {
  memoryFiles?: MemoryFileInfo[]
  mcpTokenStrategy?: 'api' | 'estimate'
  includeUnreachableRules?: boolean
}

export type ContextWarning = {
  type:
    | 'claudemd_files'
    | 'agent_descriptions'
    | 'mcp_tools'
    | 'unreachable_rules'
  severity: 'warning' | 'error'
  message: string
  details: string[]
  currentValue: number
  threshold: number
}

export type ContextWarnings = {
  claudeMdWarning: ContextWarning | null
  agentWarning: ContextWarning | null
  mcpWarning: ContextWarning | null
  unreachableRulesWarning: ContextWarning | null
}

async function safeWarning(
  run: () => Promise<ContextWarning | null>,
): Promise<ContextWarning | null> {
  try {
    return await run()
  } catch {
    return null
  }
}

async function checkClaudeMdFiles(
  memoryFiles?: MemoryFileInfo[],
): Promise<ContextWarning | null> {
  const largeFiles = getLargeMemoryFiles(memoryFiles ?? (await getMemoryFiles()))

  // This already filters for files > 40k chars each
  if (largeFiles.length === 0) {
    return null
  }

  const details = largeFiles
    .sort((a, b) => b.content.length - a.content.length)
    .map(file => `${file.path}: ${file.content.length.toLocaleString()} chars`)

  const message =
    largeFiles.length === 1
      ? `Large CLAUDE.md file detected (${largeFiles[0]!.content.length.toLocaleString()} chars > ${MAX_MEMORY_CHARACTER_COUNT.toLocaleString()})`
      : `${largeFiles.length} large CLAUDE.md files detected (each > ${MAX_MEMORY_CHARACTER_COUNT.toLocaleString()} chars)`

  return {
    type: 'claudemd_files',
    severity: 'warning',
    message,
    details,
    currentValue: largeFiles.length, // Number of files exceeding threshold
    threshold: MAX_MEMORY_CHARACTER_COUNT,
  }
}

/**
 * Check agent descriptions token count
 */
async function checkAgentDescriptions(
  agentInfo: AgentDefinitionsResult | null,
): Promise<ContextWarning | null> {
  if (!agentInfo) {
    return null
  }

  const totalTokens = getAgentDescriptionsTotalTokens(agentInfo)

  if (totalTokens <= AGENT_DESCRIPTIONS_THRESHOLD) {
    return null
  }

  // Calculate tokens for each agent
  const agentTokens = agentInfo.activeAgents
    .filter(a => a.source !== 'built-in')
    .map(agent => {
      const description = `${agent.agentType}: ${agent.whenToUse}`
      return {
        name: agent.agentType,
        tokens: roughTokenCountEstimation(description),
      }
    })
    .sort((a, b) => b.tokens - a.tokens)

  const details = agentTokens
    .slice(0, 5)
    .map(agent => `${agent.name}: ~${agent.tokens.toLocaleString()} tokens`)

  if (agentTokens.length > 5) {
    details.push(`(${agentTokens.length - 5} more custom agents)`)
  }

  return {
    type: 'agent_descriptions',
    severity: 'warning',
    message: `Large agent descriptions (~${totalTokens.toLocaleString()} tokens > ${AGENT_DESCRIPTIONS_THRESHOLD.toLocaleString()})`,
    details,
    currentValue: totalTokens,
    threshold: AGENT_DESCRIPTIONS_THRESHOLD,
  }
}

/**
 * Check MCP tools token count
 */
async function estimateMcpToolTokens(
  tools: Tools,
  getToolPermissionContext: () => Promise<ToolPermissionContext>,
  agentInfo: AgentDefinitionsResult | null,
): Promise<{
  mcpToolTokens: number
  mcpToolDetails: McpToolTokenDetail[]
}> {
  const mcpTools = tools.filter(tool => tool.isMcp)
  const estimates = await Promise.all(
    mcpTools.map(async tool => {
      let description = ''
      try {
        description = await tool.prompt({
          getToolPermissionContext,
          tools,
          agents: agentInfo?.activeAgents ?? [],
        })
      } catch {
        description = ''
      }

      let definitionForEstimate: string
      try {
        definitionForEstimate = JSON.stringify({
          name: tool.name,
          description,
          input_schema: tool.inputJSONSchema ?? {},
        })
      } catch {
        definitionForEstimate = JSON.stringify({
          name: tool.name,
          description,
          input_schema: {},
        })
      }

      return {
        name: tool.name,
        serverName: tool.mcpInfo?.serverName ?? tool.name.split('__')[1],
        tokens: roughTokenCountEstimation(definitionForEstimate),
        isLoaded: true,
      }
    }),
  )

  const model = getMainLoopModel()
  const { isToolSearchEnabled } = await import('./toolSearch.js')
  const { isDeferredTool } = await import('../tools/ToolSearchTool/prompt.js')
  let isDeferred = false
  try {
    isDeferred = await isToolSearchEnabled(
      model,
      tools,
      getToolPermissionContext,
      agentInfo?.activeAgents ?? [],
      'analyzeMcp',
    )
  } catch {
    isDeferred = false
  }

  const mcpToolDetails = estimates.map((detail, index) => ({
    ...detail,
    isLoaded: !isDeferred || !isDeferredTool(mcpTools[index]!),
  }))

  const mcpToolTokens = mcpToolDetails
    .filter(detail => detail.isLoaded)
    .reduce((total, detail) => total + detail.tokens, 0)

  return { mcpToolTokens, mcpToolDetails }
}

function buildMcpToolsWarning(
  mcpToolTokens: number,
  mcpToolDetails: McpToolTokenDetail[],
  estimated: boolean,
): ContextWarning | null {
  if (mcpToolTokens <= MCP_TOOLS_THRESHOLD) {
    return null
  }

  const toolsByServer = new Map<string, { count: number; tokens: number }>()

  for (const tool of mcpToolDetails) {
    if (tool.isLoaded === false) {
      continue
    }

    const serverName = tool.serverName ?? tool.name.split('__')[1] ?? 'unknown'
    const current = toolsByServer.get(serverName) || { count: 0, tokens: 0 }
    toolsByServer.set(serverName, {
      count: current.count + 1,
      tokens: current.tokens + tool.tokens,
    })
  }

  const sortedServers = Array.from(toolsByServer.entries()).sort(
    (a, b) => b[1].tokens - a[1].tokens,
  )

  const details = sortedServers
    .slice(0, 5)
    .map(
      ([name, info]) =>
        `${name}: ${info.count} tools (~${info.tokens.toLocaleString()} tokens)`,
    )

  if (sortedServers.length > 5) {
    details.push(`(${sortedServers.length - 5} more servers)`)
  }

  return {
    type: 'mcp_tools',
    severity: 'warning',
    message: `Large MCP tools context (~${mcpToolTokens.toLocaleString()} tokens${estimated ? ' estimated' : ''} > ${MCP_TOOLS_THRESHOLD.toLocaleString()})`,
    details,
    currentValue: mcpToolTokens,
    threshold: MCP_TOOLS_THRESHOLD,
  }
}

async function checkMcpTools(
  tools: Tools,
  getToolPermissionContext: () => Promise<ToolPermissionContext>,
  agentInfo: AgentDefinitionsResult | null,
  tokenStrategy: CheckContextWarningsOptions['mcpTokenStrategy'] = 'api',
): Promise<ContextWarning | null> {
  const mcpTools = tools.filter(tool => tool.isMcp)

  // Note: MCP tools are loaded asynchronously and may not be available
  // when doctor command runs, as it executes before MCP connections are established
  if (mcpTools.length === 0) {
    return null
  }

  if (tokenStrategy === 'estimate') {
    const { mcpToolTokens, mcpToolDetails } = await estimateMcpToolTokens(
      tools,
      getToolPermissionContext,
      agentInfo,
    )
    return buildMcpToolsWarning(mcpToolTokens, mcpToolDetails, true)
  }

  try {
    // Use the existing countMcpToolTokens function from analyzeContext
    const model = getMainLoopModel()
    const { mcpToolTokens, mcpToolDetails } = await countMcpToolTokens(
      tools,
      getToolPermissionContext,
      agentInfo,
      model,
    )

    return buildMcpToolsWarning(mcpToolTokens, mcpToolDetails, false)
  } catch (_error) {
    const { mcpToolTokens, mcpToolDetails } = await estimateMcpToolTokens(
      tools,
      getToolPermissionContext,
      agentInfo,
    )
    return buildMcpToolsWarning(mcpToolTokens, mcpToolDetails, true)
  }
}

/**
 * Check for unreachable permission rules (e.g., specific allow rules shadowed by tool-wide ask rules)
 */
async function checkUnreachableRules(
  getToolPermissionContext: () => Promise<ToolPermissionContext>,
): Promise<ContextWarning | null> {
  const context = await getToolPermissionContext()
  const sandboxAutoAllowEnabled =
    SandboxManager.isSandboxingEnabled() &&
    SandboxManager.isAutoAllowBashIfSandboxedEnabled()

  const unreachable = detectUnreachableRules(context, {
    sandboxAutoAllowEnabled,
  })

  if (unreachable.length === 0) {
    return null
  }

  const details = unreachable.flatMap(r => [
    `${permissionRuleValueToString(r.rule.ruleValue)}: ${r.reason}`,
    `  Fix: ${r.fix}`,
  ])

  return {
    type: 'unreachable_rules',
    severity: 'warning',
    message: `${unreachable.length} ${plural(unreachable.length, 'unreachable permission rule')} detected`,
    details,
    currentValue: unreachable.length,
    threshold: 0,
  }
}

/**
 * Check all context warnings for the doctor command
 */
export async function checkContextWarnings(
  tools: Tools,
  agentInfo: AgentDefinitionsResult | null,
  getToolPermissionContext: () => Promise<ToolPermissionContext>,
  options: CheckContextWarningsOptions = {},
): Promise<ContextWarnings> {
  const includeUnreachableRules = options.includeUnreachableRules ?? true
  const [claudeMdWarning, agentWarning, mcpWarning, unreachableRulesWarning] =
    await Promise.all([
      safeWarning(() => checkClaudeMdFiles(options.memoryFiles)),
      safeWarning(() => checkAgentDescriptions(agentInfo)),
      safeWarning(() =>
        checkMcpTools(
          tools,
          getToolPermissionContext,
          agentInfo,
          options.mcpTokenStrategy,
        ),
      ),
      includeUnreachableRules
        ? safeWarning(() => checkUnreachableRules(getToolPermissionContext))
        : Promise.resolve(null),
    ])

  return {
    claudeMdWarning,
    agentWarning,
    mcpWarning,
    unreachableRulesWarning,
  }
}
