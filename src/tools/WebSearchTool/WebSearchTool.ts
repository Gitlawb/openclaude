import type {
  BetaContentBlock,
  BetaWebSearchTool20250305,
} from '@anthropic-ai/sdk/resources/beta/messages/messages.mjs'
import { getAPIProvider } from 'src/utils/model/providers.js'
import type { PermissionResult } from 'src/utils/permissions/PermissionResult.js'

import { z } from 'zod/v4'
import { getFeatureValue_CACHED_MAY_BE_STALE } from '../../services/analytics/growthbook.js'
import { queryModelWithStreaming } from '../../services/api/claude.js'
import { collectCodexCompletedResponse } from '../../services/api/codexShim.js'
import {
  resolveCodexApiCredentials,
  resolveProviderRequest,
} from '../../services/api/providerConfig.js'
import { buildTool, type ToolDef } from '../../Tool.js'
import { lazySchema } from '../../utils/lazySchema.js'
import { logError } from '../../utils/log.js'
import { createUserMessage } from '../../utils/messages.js'
import { getMainLoopModel, getSmallFastModel } from '../../utils/model/model.js'
import { jsonParse, jsonStringify } from '../../utils/slowOperations.js'
import { asSystemPrompt } from '../../utils/systemPromptType.js'
import { getWebSearchPrompt, WEB_SEARCH_TOOL_NAME } from './prompt.js'
import {
  getToolUseSummary,
  renderToolResultMessage,
  renderToolUseMessage,
  renderToolUseProgressMessage,
} from './UI.js'

import {
  runSearch,
  getProviderMode,
  getAvailableProviders,
  type ProviderOutput,
} from './providers/index.js'

const inputSchema = lazySchema(() =>
  z.strictObject({
    query: z.string().min(2).describe('The search query to use'),
    allowed_domains: z
      .array(z.string())
      .optional()
      .describe('Only include search results from these domains'),
    blocked_domains: z
      .array(z.string())
      .optional()
      .describe('Never include search results from these domains'),
  }),
)
type InputSchema = ReturnType<typeof inputSchema>

type Input = z.infer<InputSchema>

const searchResultSchema = lazySchema(() => {
  const searchHitSchema = z.object({
    title: z.string().describe('The title of the search result'),
    url: z.string().describe('The URL of the search result'),
  })

  return z.object({
    tool_use_id: z.string().describe('ID of the tool use'),
    content: z.array(searchHitSchema).describe('Array of search hits'),
  })
})

export type SearchResult = z.infer<ReturnType<typeof searchResultSchema>>

const outputSchema = lazySchema(() =>
  z.object({
    query: z.string().describe('The search query that was executed'),
    results: z
      .array(z.union([searchResultSchema(), z.string()]))
      .describe('Search results and/or text commentary from the model'),
    durationSeconds: z
      .number()
      .describe('Time taken to complete the search operation'),
  }),
)
type OutputSchema = ReturnType<typeof outputSchema>

export type Output = z.infer<OutputSchema>

// Re-export WebSearchProgress from centralized types to break import cycles
export type { WebSearchProgress } from '../../types/tools.js'

import type { WebSearchProgress } from '../../types/tools.js'

// ---------------------------------------------------------------------------
// Shared formatting: ProviderOutput → Output
// ---------------------------------------------------------------------------

function formatProviderOutput(po: ProviderOutput, query: string): Output {
  const results: (SearchResult | string)[] = []

  const snippets = po.hits
    .filter(h => h.description)
    .map(h => `**${h.title}** — ${h.description} (${h.url})`)
    .join('\n')
  if (snippets) results.push(snippets)

  if (po.hits.length > 0) {
    results.push({
      tool_use_id: `${po.providerName}-search`,
      content: po.hits.map(h => ({ title: h.title, url: h.url })),
    })
  }

  if (results.length === 0) results.push('No results found.')

  return {
    query,
    results,
    durationSeconds: po.durationSeconds,
  }
}

// ---------------------------------------------------------------------------
// Native Anthropic + Codex paths (unchanged, tightly coupled to SDK)
// ---------------------------------------------------------------------------

function makeToolSchema(input: Input): BetaWebSearchTool20250305 {
  return {
    type: 'web_search_20250305',
    name: 'web_search',
    allowed_domains: input.allowed_domains,
    blocked_domains: input.blocked_domains,
    max_uses: 15, // Allow up to 15 searches per query for better coverage
  }
}

function isClaudeModel(model: string): boolean {
  return /claude/i.test(model)
}

function isCodexResponsesWebSearchEnabled(): boolean {
  if (getAPIProvider() !== 'openai') {
    return false
  }

  const request = resolveProviderRequest({
    model: getMainLoopModel(),
    baseUrl: process.env.OPENAI_BASE_URL,
  })
  return request.transport === 'codex_responses'
}

function makeCodexWebSearchTool(input: Input): Record<string, unknown> {
  const tool: Record<string, unknown> = {
    type: 'web_search',
  }

  if (input.allowed_domains?.length) {
    tool.filters = {
      allowed_domains: input.allowed_domains,
    }
  }

  const timezone = Intl.DateTimeFormat().resolvedOptions().timeZone
  if (timezone) {
    tool.user_location = {
      type: 'approximate',
      timezone,
    }
  }

  return tool
}

function buildCodexWebSearchInputText(input: Input): string {
  if (!input.blocked_domains?.length) {
    return input.query
  }

  // Responses web_search supports allowed_domains filters but not blocked domains.
  // Convert blocked domains into common search-engine exclusion operators so the
  // constraint still affects ranking and candidate selection.
  const excludedSites = input.blocked_domains.map(domain => `-site:${domain}`)
  return `${input.query} ${excludedSites.join(' ')}`
}

function buildCodexWebSearchInput(input: Input): Array<Record<string, unknown>> {
  return [
    {
      type: 'message',
      role: 'user',
      content: [
        {
          type: 'input_text',
          text: buildCodexWebSearchInputText(input),
        },
      ],
    },
  ]
}

function buildCodexWebSearchInstructions(): string {
  return [
    'You are the OpenClaude web search tool.',
    'Search the web for the user query and return a concise factual answer.',
    'Include source URLs in the response.',
  ].join(' ')
}

function makeOutputFromCodexWebSearchResponse(
  response: Record<string, unknown>,
  query: string,
  durationSeconds: number,
): Output {
  const results: (SearchResult | string)[] = []
  const sourceMap = new Map<string, { title: string; url: string }>()
  const output = Array.isArray(response.output) ? response.output : []

  for (const item of output) {
    if (item?.type === 'web_search_call') {
      const sources = Array.isArray(item.action?.sources)
        ? item.action.sources
        : []
      for (const source of sources) {
        if (typeof source?.url !== 'string' || !source.url) continue
        sourceMap.set(source.url, {
          title:
            typeof source.title === 'string' && source.title
              ? source.title
              : source.url,
          url: source.url,
        })
      }
      continue
    }

    if (item?.type !== 'message' || !Array.isArray(item.content)) {
      continue
    }

    for (const part of item.content) {
      if (part?.type === 'output_text' && typeof part.text === 'string') {
        const trimmed = part.text.trim()
        if (trimmed) {
          results.push(trimmed)
        }
      }

      const annotations = Array.isArray(part?.annotations)
        ? part.annotations
        : []
      for (const annotation of annotations) {
        if (annotation?.type !== 'url_citation') continue
        if (typeof annotation.url !== 'string' || !annotation.url) continue
        sourceMap.set(annotation.url, {
          title:
            typeof annotation.title === 'string' && annotation.title
              ? annotation.title
              : annotation.url,
          url: annotation.url,
        })
      }
    }
  }

  if (results.length === 0 && typeof response.output_text === 'string') {
    const trimmed = response.output_text.trim()
    if (trimmed) {
      results.push(trimmed)
    }
  }

  if (sourceMap.size > 0) {
    results.push({
      tool_use_id: 'codex-web-search',
      content: Array.from(sourceMap.values()),
    })
  }

  return {
    query,
    results,
    durationSeconds,
  }
}

async function runCodexWebSearch(
  input: Input,
  signal: AbortSignal,
): Promise<Output> {
  const startTime = performance.now()
  const request = resolveProviderRequest({
    model: getMainLoopModel(),
    baseUrl: process.env.OPENAI_BASE_URL,
  })
  const credentials = resolveCodexApiCredentials()

  if (!credentials.apiKey) {
    throw new Error('Codex web search requires CODEX_API_KEY or a valid auth.json.')
  }
  if (!credentials.accountId) {
    throw new Error(
      'Codex web search requires CHATGPT_ACCOUNT_ID or an auth.json with chatgpt_account_id.',
    )
  }

  const body: Record<string, unknown> = {
    model: request.resolvedModel,
    input: buildCodexWebSearchInput(input),
    instructions: buildCodexWebSearchInstructions(),
    tools: [makeCodexWebSearchTool(input)],
    tool_choice: 'required',
    include: ['web_search_call.action.sources'],
    store: false,
    stream: true,
  }

  if (request.reasoning) {
    body.reasoning = request.reasoning
  }

  const response = await fetch(`${request.baseUrl}/responses`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${credentials.apiKey}`,
      'chatgpt-account-id': credentials.accountId,
      originator: 'openclaude',
    },
    body: JSON.stringify(body),
    signal,
  })

  if (!response.ok) {
    const errorBody = await response.text().catch(() => 'unknown error')
    throw new Error(`Codex web search error ${response.status}: ${errorBody}`)
  }

  const payload = await collectCodexCompletedResponse(response)
  const endTime = performance.now()
  return makeOutputFromCodexWebSearchResponse(
    payload,
    input.query,
    (endTime - startTime) / 1000,
  )
}

function makeOutputFromSearchResponse(
  result: BetaContentBlock[],
  query: string,
  durationSeconds: number,
): Output {
  // The result is a sequence of these blocks:
  // - text to start -- always?
  // [
  //    - server_tool_use
  //    - web_search_tool_result
  //    - text and citation blocks intermingled
  //  ]+  (this block repeated for each search)

  const results: (SearchResult | string)[] = []
  let textAcc = ''
  let inText = true

  for (const block of result) {
    if (block.type === 'server_tool_use') {
      if (inText) {
        inText = false
        if (textAcc.trim().length > 0) {
          results.push(textAcc.trim())
        }
        textAcc = ''
      }
      continue
    }

    if (block.type === 'web_search_tool_result') {
      // Handle error case - content is a WebSearchToolResultError
      if (!Array.isArray(block.content)) {
        const errorMessage = `Web search error: ${block.content.error_code}`
        logError(new Error(errorMessage))
        results.push(errorMessage)
        continue
      }
      // Success case - add results to our collection
      const hits = block.content.map(r => ({ title: r.title, url: r.url }))
      results.push({
        tool_use_id: block.tool_use_id,
        content: hits,
      })
    }

    if (block.type === 'text') {
      if (inText) {
        textAcc += block.text
      } else {
        inText = true
        textAcc = block.text
      }
    }
  }

  if (textAcc.length) {
    results.push(textAcc.trim())
  }

  return {
    query,
    results,
    durationSeconds,
  }
}

// ---------------------------------------------------------------------------
// Helper: should we use adapter-based providers?
// ---------------------------------------------------------------------------

/**
 * Returns true for transient errors that are safe to fall through on in auto mode
 * (network failures, timeouts, HTTP 5xx). Config and guardrail errors return false.
 */
function isTransientError(err: unknown): boolean {
  if (!(err instanceof Error)) return true
  const msg = err.message.toLowerCase()
  // Guardrail / config errors — must surface
  if (msg.includes('must use https')) return false
  if (msg.includes('private/reserved address')) return false
  if (msg.includes('not in the safe allowlist')) return false
  if (msg.includes('exceeds') && msg.includes('bytes')) return false
  if (msg.includes('not a valid url')) return false
  if (msg.includes('is not configured')) return false
  // Transient errors — safe to fall through
  if (err.name === 'AbortError') return true
  if (msg.includes('timed out')) return true
  if (msg.includes('fetch failed') || msg.includes('econnrefused') || msg.includes('enotfound')) return true
  if (msg.includes('returned 5')) return true // HTTP 5xx
  // Unknown — treat as transient to preserve auto-mode fallback semantics
  return true
}

/**
 * Returns true when we should use the adapter-based provider system.
 *
 * In auto mode: native/first-party/Codex paths take precedence.
 *   → Only falls back to adapter if no native path is available.
 * In explicit adapter modes (tavily, ddg, custom, etc.): always true.
 * In native mode: never true.
 */
function shouldUseAdapterProvider(): boolean {
  const mode = getProviderMode()
  if (mode === 'native') return false
  if (mode !== 'auto') return true // explicit adapter mode (tavily, ddg, custom, etc.)

  // Auto mode: native/first-party/Codex take precedence over adapter
  if (isCodexResponsesWebSearchEnabled()) return false
  const provider = getAPIProvider()
  if (provider === 'firstParty' || provider === 'vertex' || provider === 'foundry') {
    return false
  }
  // No native path available — fall back to adapter
  return getAvailableProviders().length > 0
}

// ---------------------------------------------------------------------------
// Tool export
// ---------------------------------------------------------------------------

export const WebSearchTool = buildTool({
  name: WEB_SEARCH_TOOL_NAME,
  searchHint: 'search the web for current information',
  maxResultSizeChars: 100_000,
  shouldDefer: true,
  async description(input) {
    return `Claude wants to search the web for: ${input.query}`
  },
  userFacingName() {
    return 'Web Search'
  },
  getToolUseSummary,
  getActivityDescription(input) {
    const summary = getToolUseSummary(input)
    return summary ? `Searching for ${summary}` : 'Searching the web'
  },
  isEnabled() {
    const mode = getProviderMode()

    // Specific provider mode: enabled if any adapter is configured
    if (mode !== 'auto' && mode !== 'native') {
      return getAvailableProviders().length > 0
    }

    // Auto/native mode: check all paths
    if (getAvailableProviders().length > 0) return true
    if (isCodexResponsesWebSearchEnabled()) return true

    const provider = getAPIProvider()
    const model = getMainLoopModel()

    // Enable for firstParty
    if (provider === 'firstParty') {
      return true
    }

    // Enable for Vertex AI with supported models (Claude 4.0+)
    if (provider === 'vertex') {
      const supportsWebSearch =
        model.includes('claude-opus-4') ||
        model.includes('claude-sonnet-4') ||
        model.includes('claude-haiku-4')

      return supportsWebSearch
    }

    // Foundry only ships models that already support Web Search
    if (provider === 'foundry') {
      return true
    }

    return false
  },
  get inputSchema(): InputSchema {
    return inputSchema()
  },
  get outputSchema(): OutputSchema {
    return outputSchema()
  },
  isConcurrencySafe() {
    return true
  },
  isReadOnly() {
    return true
  },
  toAutoClassifierInput(input) {
    return input.query
  },
  async checkPermissions(_input): Promise<PermissionResult> {
    return {
      behavior: 'passthrough',
      message: 'WebSearchTool requires permission.',
      suggestions: [
        {
          type: 'addRules',
          rules: [{ toolName: WEB_SEARCH_TOOL_NAME }],
          behavior: 'allow',
          destination: 'localSettings',
        },
      ],
    }
  },
  async prompt() {
    // Strip "US only" when using non-native backends
    if (shouldUseAdapterProvider() || isCodexResponsesWebSearchEnabled()) {
      return getWebSearchPrompt().replace(
        /\n\s*-\s*Web search is only available in the US/,
        '',
      )
    }
    return getWebSearchPrompt()
  },
  renderToolUseMessage,
  renderToolUseProgressMessage,
  renderToolResultMessage,
  extractSearchText() {
    // renderToolResultMessage shows only "Did N searches in Xs" chrome —
    // the results[] content never appears on screen. Heuristic would index
    // string entries in results[] (phantom match). Nothing to search.
    return ''
  },
  async validateInput(input) {
    const { query, allowed_domains, blocked_domains } = input
    if (!query.length) {
      return {
        result: false,
        message: 'Error: Missing query',
        errorCode: 1,
      }
    }
    if (allowed_domains?.length && blocked_domains?.length) {
      return {
        result: false,
        message:
          'Error: Cannot specify both allowed_domains and blocked_domains in the same request',
        errorCode: 2,
      }
    }
    return { result: true }
  },
  async call(input, context, _canUseTool, _parentMessage, onProgress) {
    // --- Adapter-based providers (custom, firecrawl, ddg) ---
    // runSearch handles fallback semantics based on WEB_SEARCH_PROVIDER mode:
    //   - "auto": tries each provider, falls through on failure
    //   - specific mode: runs one provider, throws on failure
    if (shouldUseAdapterProvider()) {
      const mode = getProviderMode()
      const isExplicitAdapter = mode !== 'auto'
      try {
        const providerOutput = await runSearch(
          {
            query: input.query,
            allowed_domains: input.allowed_domains,
            blocked_domains: input.blocked_domains,
          },
          context.abortController.signal,
        )
        // Explicit adapter: return even 0 hits (no silent native fallback)
        if (isExplicitAdapter || providerOutput.hits.length > 0) {
          return { data: formatProviderOutput(providerOutput, input.query) }
        }
        // Auto mode with 0 hits: fall through to native
      } catch (err) {
        // Explicit adapter: throw the real error (no silent native fallback)
        if (isExplicitAdapter) throw err
        // Auto mode: only fall through on transient errors (network, timeout, 5xx).
        // Config / guardrail errors (SSRF, HTTPS, bad URL, etc.) must surface.
        if (!isTransientError(err)) throw err
        console.error(
          `[web-search] Adapter failed, falling through to native: ${err}`,
        )
      }
    }

    // --- Codex / OpenAI Responses path ---
    if (isCodexResponsesWebSearchEnabled()) {
      return {
        data: await runCodexWebSearch(input, context.abortController.signal),
      }
    }

    // --- Native Anthropic path (firstParty / vertex / foundry) ---
    const startTime = performance.now()
    const { query } = input
    const userMessage = createUserMessage({
      content: 'Perform a web search for the query: ' + query,
    })
    const toolSchema = makeToolSchema(input)

    const useHaiku = getFeatureValue_CACHED_MAY_BE_STALE(
      'tengu_plum_vx3',
      false,
    )

    const appState = context.getAppState()
    const queryStream = queryModelWithStreaming({
      messages: [userMessage],
      systemPrompt: asSystemPrompt([
        'You are an assistant for performing a web search tool use',
      ]),
      thinkingConfig: useHaiku
        ? { type: 'disabled' as const }
        : context.options.thinkingConfig,
      tools: [],
      signal: context.abortController.signal,
      options: {
        getToolPermissionContext: async () => appState.toolPermissionContext,
        model: useHaiku ? getSmallFastModel() : context.options.mainLoopModel,
        toolChoice: useHaiku ? { type: 'tool', name: 'web_search' } : undefined,
        isNonInteractiveSession: context.options.isNonInteractiveSession,
        hasAppendSystemPrompt: !!context.options.appendSystemPrompt,
        extraToolSchemas: [toolSchema],
        querySource: 'web_search_tool',
        agents: context.options.agentDefinitions.activeAgents,
        mcpTools: [],
        agentId: context.agentId,
        effortValue: appState.effortValue,
      },
    })

    const allContentBlocks: BetaContentBlock[] = []
    let currentToolUseId = null
    let currentToolUseJson = ''
    let progressCounter = 0
    const toolUseQueries = new Map() // Map of tool_use_id to query

    for await (const event of queryStream) {
      if (event.type === 'assistant') {
        allContentBlocks.push(...event.message.content)
        continue
      }

      // Track tool use ID when server_tool_use starts
      if (
        event.type === 'stream_event' &&
        event.event?.type === 'content_block_start'
      ) {
        const contentBlock = event.event.content_block
        if (contentBlock && contentBlock.type === 'server_tool_use') {
          currentToolUseId = contentBlock.id
          currentToolUseJson = ''
          continue
        }
      }

      // Accumulate JSON for current tool use
      if (
        currentToolUseId &&
        event.type === 'stream_event' &&
        event.event?.type === 'content_block_delta'
      ) {
        const delta = event.event.delta
        if (delta?.type === 'input_json_delta' && delta.partial_json) {
          currentToolUseJson += delta.partial_json

          // Try to extract query from partial JSON for progress updates
          try {
            const queryMatch = currentToolUseJson.match(
              /"query"\s*:\s*"((?:[^"\\]|\\.)*)"/,
            )
            if (queryMatch && queryMatch[1]) {
              const query = jsonParse('"' + queryMatch[1] + '"')

              if (
                !toolUseQueries.has(currentToolUseId) ||
                toolUseQueries.get(currentToolUseId) !== query
              ) {
                toolUseQueries.set(currentToolUseId, query)
                progressCounter++
                if (onProgress) {
                  onProgress({
                    toolUseID: `search-progress-${progressCounter}`,
                    data: {
                      type: 'query_update',
                      query,
                    },
                  })
                }
              }
            }
          } catch {
            // Ignore parsing errors for partial JSON
          }
        }
      }

      // Yield progress when search results come in
      if (
        event.type === 'stream_event' &&
        event.event?.type === 'content_block_start'
      ) {
        const contentBlock = event.event.content_block
        if (contentBlock && contentBlock.type === 'web_search_tool_result') {
          const toolUseId = contentBlock.tool_use_id
          const actualQuery = toolUseQueries.get(toolUseId) || query
          const content = contentBlock.content

          progressCounter++
          if (onProgress) {
            onProgress({
              toolUseID: toolUseId || `search-progress-${progressCounter}`,
              data: {
                type: 'search_results_received',
                resultCount: Array.isArray(content) ? content.length : 0,
                query: actualQuery,
              },
            })
          }
        }
      }
    }

    // Process the final result
    const endTime = performance.now()
    const durationSeconds = (endTime - startTime) / 1000

    const data = makeOutputFromSearchResponse(
      allContentBlocks,
      query,
      durationSeconds,
    )
    return { data }
  },
  mapToolResultToToolResultBlockParam(output, toolUseID) {
    const { query, results } = output

    let formattedOutput = `Web search results for query: "${query}"\n\n`

    // Process the results array - it can contain both string summaries and search result objects.
    // Guard against null/undefined entries that can appear after JSON round-tripping
    // (e.g., from compaction or transcript deserialization).
    ;(results ?? []).forEach(result => {
      if (result == null) {
        return
      }
      if (typeof result === 'string') {
        // Text summary
        formattedOutput += result + '\n\n'
      } else {
        // Search result with links
        if (result.content?.length > 0) {
          formattedOutput += `Links: ${jsonStringify(result.content)}\n\n`
        } else {
          formattedOutput += 'No links found.\n\n'
        }
      }
    })

    formattedOutput +=
      '\nREMINDER: You MUST include the sources above in your response to the user using markdown hyperlinks.'

    return {
      tool_use_id: toolUseID,
      type: 'tool_result',
      content: formattedOutput.trim(),
    }
  },
} satisfies ToolDef<InputSchema, Output, WebSearchProgress>)
