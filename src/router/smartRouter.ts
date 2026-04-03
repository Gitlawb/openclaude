/**
 * smartRouter.ts
 * ---------------
 * Intelligent auto-router for openclaude.
 *
 * Instead of always using one fixed provider, the smart router:
 * - Pings all configured providers on startup
 * - Scores them by latency, cost, and health
 * - Routes each request to the optimal provider
 * - Falls back automatically if a provider fails
 * - Learns from real request timings over time
 *
 * Usage:
 *   import { SmartRouter } from './smartRouter.js'
 *   const router = new SmartRouter()
 *   await router.initialize()
 *   const result = await router.route(messages, model)
 *
 * .env config:
 *   ROUTER_MODE=smart          # or: fixed (default behaviour)
 *   ROUTER_STRATEGY=latency    # or: cost, balanced
 *   ROUTER_FALLBACK=true       # auto-retry on failure
 *
 * Contribution to: https://github.com/Gitlawb/openclaude
 */

import { logger } from '../utils/logger.js'

// ── Constants ─────────────────────────────────────────────────────────────────

const DEFAULT_LARGE_REQUEST_THRESHOLD = 2000
const ERROR_RATE_THRESHOLD = 0.7
const MIN_REQUESTS_FOR_ERROR_RATE = 3
const RECHECK_DELAY_MS = 60000
const PING_TIMEOUT_MS = 5000
const LATENCY_SMOOTHING_ALPHA = 0.3

// ── Types ─────────────────────────────────────────────────────────────────────

export interface ProviderBase {
  name: string
  pingUrl: string
  apiKeyEnv: string
  costPer1kTokens: number
  bigModel: string
  smallModel: string
  latencyMs: number
  healthy: boolean
  requestCount: number
  errorCount: number
  avgLatencyMs: number
}

export interface Provider extends ProviderBase {
  readonly apiKey: string | undefined
  readonly isConfigured: boolean
  readonly errorRate: number
  score(strategy: RoutingStrategy): number
}

function buildDefaultProviders(): Provider[] {
  const big = process.env.BIG_MODEL ?? 'gpt-4.1'
  const small = process.env.SMALL_MODEL ?? 'gpt-4.1-mini'
  const ollamaUrl = process.env.OLLAMA_BASE_URL ?? 'http://localhost:11434'
  const atomicChatUrl = process.env.ATOMIC_CHAT_BASE_URL ?? 'http://127.0.0.1:1337'
  const nvidiaBaseUrl = process.env.NVIDIA_BASE_URL ?? 'https://integrate.api.nvidia.com/v1'
  const anthropicBaseUrl = process.env.ANTHROPIC_BASE_URL ?? 'https://api.anthropic.com'

  const providers: ProviderBase[] = [
    {
      name: 'firstParty',
      pingUrl: `${anthropicBaseUrl}/v1/models`,
      apiKeyEnv: 'ANTHROPIC_API_KEY',
      costPer1kTokens: 0.003,
      bigModel: big.includes('claude') ? big : 'claude-sonnet-4-20250514',
      smallModel: small.includes('claude') ? small : 'claude-haiku-3-20250514',
      latencyMs: 0,
      healthy: false,
      requestCount: 0,
      errorCount: 0,
      avgLatencyMs: 0,
    },
    {
      name: 'bedrock',
      pingUrl: 'https://bedrock.runtime.{region}.amazonaws.com',
      apiKeyEnv: 'AWS_ACCESS_KEY_ID',
      costPer1kTokens: 0.0025,
      bigModel: big.includes('claude') ? big : 'anthropic.claude-sonnet-4-20250514',
      smallModel: small.includes('claude') ? small : 'anthropic.claude-haiku-3-20250514',
      latencyMs: 0,
      healthy: false,
      requestCount: 0,
      errorCount: 0,
      avgLatencyMs: 0,
    },
    {
      name: 'vertex',
      pingUrl: 'https://{region}-aiplatform.googleapis.com/v1',
      apiKeyEnv: 'GOOGLEAPPLICATIONCREDENTIALS',
      costPer1kTokens: 0.002,
      bigModel: big.includes('gemini') ? big : 'gemini-2.0-pro',
      smallModel: small.includes('gemini') ? small : 'gemini-2.0-flash',
      latencyMs: 0,
      healthy: false,
      requestCount: 0,
      errorCount: 0,
      avgLatencyMs: 0,
    },
    {
      name: 'github',
      pingUrl: 'https://models.inference.ai.azure.com/v1/chat/completions',
      apiKeyEnv: 'GITHUB_TOKEN',
      costPer1kTokens: 0.0005,
      bigModel: big.includes('gpt') ? big : 'gpt-4o',
      smallModel: small.includes('gpt') ? small : 'gpt-4o-mini',
      latencyMs: 0,
      healthy: false,
      requestCount: 0,
      errorCount: 0,
      avgLatencyMs: 0,
    },
    {
      name: 'openai',
      pingUrl: 'https://api.openai.com/v1/models',
      apiKeyEnv: 'OPENAI_API_KEY',
      costPer1kTokens: 0.002,
      bigModel: big.includes('gpt') ? big : 'gpt-4.1',
      smallModel: small.includes('gpt') ? small : 'gpt-4.1-mini',
      latencyMs: 0,
      healthy: false,
      requestCount: 0,
      errorCount: 0,
      avgLatencyMs: 0,
    },
    {
      name: 'gemini',
      pingUrl: 'https://generativelanguage.googleapis.com/v1/models',
      apiKeyEnv: 'GEMINI_API_KEY',
      costPer1kTokens: 0.0005,
      bigModel: big.includes('gemini') ? big : 'gemini-2.5-pro',
      smallModel: small.includes('gemini') ? small : 'gemini-2.0-flash',
      latencyMs: 0,
      healthy: false,
      requestCount: 0,
      errorCount: 0,
      avgLatencyMs: 0,
    },
    {
      name: 'ollama',
      pingUrl: `${ollamaUrl}/api/tags`,
      apiKeyEnv: '',
      costPer1kTokens: 0.0,
      bigModel: !big.includes('gemini') && !big.includes('gpt') ? big : 'llama3:8b',
      smallModel: !small.includes('gemini') && !small.includes('gpt') ? small : 'llama3:8b',
      latencyMs: 0,
      healthy: false,
      requestCount: 0,
      errorCount: 0,
      avgLatencyMs: 0,
    },
    {
      name: 'atomic-chat',
      pingUrl: `${atomicChatUrl}/v1/models`,
      apiKeyEnv: '',
      costPer1kTokens: 0.0,
      bigModel: !big.includes('gemini') && !big.includes('gpt') ? big : 'llama3:8b',
      smallModel: !small.includes('gemini') && !small.includes('gpt') ? small : 'llama3:8b',
      latencyMs: 0,
      healthy: false,
      requestCount: 0,
      errorCount: 0,
      avgLatencyMs: 0,
    },
    {
      name: 'nvidia',
      pingUrl: `${nvidiaBaseUrl}/models`,
      apiKeyEnv: 'NVIDIA_API_KEY',
      costPer1kTokens: 0.0001,
      bigModel: ['llama', 'nemotron', 'meta'].some(x => big.toLowerCase().includes(x))
        ? big
        : 'meta/llama3-70b-instruct',
      smallModel: ['llama', 'nemotron', 'meta'].some(x => small.toLowerCase().includes(x))
        ? small
        : 'meta/llama3-8b-instruct',
      latencyMs: 0,
      healthy: false,
      requestCount: 0,
      errorCount: 0,
      avgLatencyMs: 0,
    },
  ]

  return providers.map(p => createProvider(p))
}

// ── Smart Router ──────────────────────────────────────────────────────────────

export type RoutingStrategy = 'latency' | 'cost' | 'balanced'

export interface RoutingResult {
  provider: string
  model: string
  apiKey: string
  providerObject: Provider
}

export class SmartRouter {
  private providers: Provider[]
  private strategy: RoutingStrategy
  private fallbackEnabled: boolean
  private initialized = false

  constructor(
    providers?: Provider[],
    strategy?: RoutingStrategy,
    fallbackEnabled?: boolean,
  ) {
    this.providers = providers ?? buildDefaultProviders()
    this.strategy = strategy ?? (process.env.ROUTER_STRATEGY as RoutingStrategy) ?? 'balanced'
    this.fallbackEnabled = fallbackEnabled ?? (process.env.ROUTER_FALLBACK?.toLowerCase() === 'true')
  }

  // ── Initialization ────────────────────────────────────────────────────────

  async initialize(): Promise<void> {
    logger.info('SmartRouter: benchmarking providers...')
    await Promise.all(
      this.providers.map(p => this.pingProvider(p)),
    )
    const available = this.providers.filter(p => p.healthy && p.isConfigured)
    logger.info(
      `SmartRouter ready. Available providers: ${available.map(p => p.name).join(', ')}`,
    )
    if (available.length === 0) {
      logger.warning(
        'SmartRouter: no providers available! Check your API keys in .env',
      )
    }
    this.initialized = true
  }

  private async pingProvider(provider: Provider): Promise<void> {
    if (!provider.isConfigured) {
      provider.healthy = false
      logger.debug(`SmartRouter: ${provider.name} skipped — no API key`)
      return
    }

    const headers: Record<string, string> = {}
    if (provider.apiKey) {
      headers.Authorization = `Bearer ${provider.apiKey}`
    }

    const start = performance.now()
    try {
      const response = await fetch(provider.pingUrl, {
        method: 'GET',
        headers,
        signal: AbortSignal.timeout(PING_TIMEOUT_MS),
      })
      const elapsedMs = performance.now() - start

      if ([200, 400, 401, 403].includes(response.status)) {
        // 400/401/403 means reachable, just possibly bad key
        // We still mark healthy for routing purposes
        provider.healthy = true
        provider.latencyMs = elapsedMs
        provider.avgLatencyMs = elapsedMs
        logger.info(
          `SmartRouter: ${provider.name} OK (${elapsedMs.toFixed(0)}ms, status=${response.status})`,
        )
      } else {
        provider.healthy = false
        logger.warning(
          `SmartRouter: ${provider.name} unhealthy (status=${response.status})`,
        )
      }
    } catch (error) {
      provider.healthy = false
      logger.warning(`SmartRouter: ${provider.name} unreachable — ${error}`)
    }
  }

  // ── Routing logic ─────────────────────────────────────────────────────────

  selectProvider(): Provider | null {
    const available = this.providers.filter(p => p.healthy && p.isConfigured)
    return this.getBestProvider(available)
  }

  async selectProviderAsync(): Promise<string | null> {
    if (!this.initialized) {
      await this.initialize()
    }
    const provider = this.selectProvider()
    return provider?.name ?? null
  }

  getModelForProvider(provider: Provider, claudeModel: string): string {
    const isLarge = ['opus', 'sonnet', 'large', 'big'].some(
      keyword => claudeModel.toLowerCase().includes(keyword),
    )
    return isLarge ? provider.bigModel : provider.smallModel
  }

  isLargeRequest(messages: Array<{ content?: unknown }>, threshold = DEFAULT_LARGE_REQUEST_THRESHOLD): boolean {
    const totalChars = messages.reduce((sum, m) => {
      return sum + String(m.content ?? '').length
    }, 0)
    return totalChars > threshold
  }

  private updateLatency(provider: Provider, durationMs: number): void {
    provider.avgLatencyMs = LATENCY_SMOOTHING_ALPHA * durationMs + (1 - LATENCY_SMOOTHING_ALPHA) * provider.avgLatencyMs
  }

  private getBestProvider(available: Provider[]): Provider | null {
    if (available.length === 0) return null
    return available.reduce((best, current) =>
      current.score(this.strategy) < best.score(this.strategy) ? current : best
    )
  }

  // ── Main routing entry point ──────────────────────────────────────────────

  async route(
    messages: Array<{ content?: unknown }>,
    claudeModel = 'claude-sonnet',
    attempt = 0,
    excludeProviders?: string[],
  ): Promise<RoutingResult> {
    if (!this.initialized) {
      await this.initialize()
    }

    const exclude = new Set(excludeProviders ?? [])
    const large = this.isLargeRequest(messages)

    const available = this.providers.filter(
      p => p.healthy && p.isConfigured && !exclude.has(p.name),
    )

    if (available.length === 0) {
      throw new Error(
        'SmartRouter: no providers available. Check your API keys and provider health.',
      )
    }

    const provider = this.getBestProvider(available)
    if (!provider) {
      throw new Error('SmartRouter: no suitable provider found')
    }
    const model = this.getModelForProvider(provider, claudeModel)

    logger.debug(
      `SmartRouter: routing to ${provider.name}/${model} ` +
      `(strategy=${this.strategy}, large=${large}, attempt=${attempt})`,
    )

    return {
      provider: provider.name,
      model,
      apiKey: provider.apiKey ?? 'none',
      providerObject: provider,
    }
  }

  async recordResult(
    providerName: string,
    success: boolean,
    durationMs: number,
  ): Promise<void> {
    const provider = this.providers.find(p => p.name === providerName)
    if (!provider) {
      return
    }

    provider.requestCount++
    if (success) {
      this.updateLatency(provider, durationMs)
    } else {
      provider.errorCount++
      // After threshold failures, mark unhealthy temporarily
      if (provider.requestCount >= MIN_REQUESTS_FOR_ERROR_RATE && provider.errorRate > ERROR_RATE_THRESHOLD) {
        logger.warning(
          `SmartRouter: ${providerName} error rate high (${(provider.errorRate * 100).toFixed(0)}%), marking unhealthy`,
        )
        provider.healthy = false
        setTimeout(() => {
          this.recheckProvider(provider)
        }, RECHECK_DELAY_MS)
      }
    }
  }

  private async recheckProvider(provider: Provider): Promise<void> {
    await new Promise(resolve => setTimeout(resolve, delay))
    await this.pingProvider(provider)
    if (provider.healthy) {
      logger.info(
        `SmartRouter: ${provider.name} recovered, re-adding to pool`,
      )
    }
  }

  // ── Status report ─────────────────────────────────────────────────────────

  status(): Array<Record<string, unknown>> {
    return this.providers.map(p => ({
      provider: p.name,
      healthy: p.healthy,
      configured: p.isConfigured,
      latency_ms: Math.round(p.avgLatencyMs * 10) / 10,
      cost_per_1k: p.costPer1kTokens,
      requests: p.requestCount,
      errors: p.errorCount,
      error_rate: `${(p.errorRate * 100).toFixed(1)}%`,
      score: p.healthy && p.isConfigured
        ? Math.round(p.score(this.strategy) * 1000) / 1000
        : 'N/A',
    }))
  }
}

// Factory function to create enhanced providers with computed properties
function createProvider(base: ProviderBase): Provider {
  const provider = base as unknown as Provider

  // Attach computed properties
  Object.defineProperty(provider, 'apiKey', {
    get() {
      return this.apiKeyEnv ? process.env[this.apiKeyEnv] : undefined
    },
    configurable: true,
  })

  Object.defineProperty(provider, 'isConfigured', {
    get() {
      if (['ollama', 'atomic-chat'].includes(this.name)) {
        return true
      }
      return !!this.apiKey
    },
    configurable: true,
  })

  Object.defineProperty(provider, 'errorRate', {
    get() {
      if (this.requestCount === 0) return 0.0
      return this.errorCount / this.requestCount
    },
    configurable: true,
  })

  provider.score = function(strategy: RoutingStrategy): number {
    if (!this.healthy || !this.isConfigured) {
      return Number.POSITIVE_INFINITY
    }

    const latencyScore = this.avgLatencyMs / 1000.0
    const costScore = this.costPer1kTokens * 100
    const errorPenalty = this.errorRate * 500

    switch (strategy) {
      case 'latency':
        return latencyScore + errorPenalty
      case 'cost':
        return costScore + errorPenalty
      default:
        return latencyScore * 0.5 + costScore * 0.5 + errorPenalty
    }
  }

  return provider
}

// Export factory function
export { createProvider }
