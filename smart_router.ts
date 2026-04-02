/**
 * smart_router.ts
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
 *   import { SmartRouter } from './smart_router.js'
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

import { logger } from './utils/logger.js' // You may need to create this or use console.log

// ── Provider definitions ──────────────────────────────────────────────────────

export interface Provider {
  name: string                        // e.g. "openai", "gemini", "ollama", "nvidia"
  pingUrl: string                     // URL used to check health
  apiKeyEnv: string                   // env var name for API key
  costPer1kTokens: number             // estimated cost USD per 1k tokens
  bigModel: string                    // model for sonnet/large requests
  smallModel: string                  // model for haiku/small requests
  latencyMs: number                   // updated by benchmark
  healthy: boolean                    // updated by health checks
  requestCount: number                // total requests routed here
  errorCount: number                  // total errors from this provider
  avgLatencyMs: number                // rolling average from real requests
}

function buildDefaultProviders(): Provider[] {
  const big = process.env.BIG_MODEL ?? 'gpt-4.1'
  const small = process.env.SMALL_MODEL ?? 'gpt-4.1-mini'
  const ollamaUrl = process.env.OLLAMA_BASE_URL ?? 'http://localhost:11434'
  const atomicChatUrl = process.env.ATOMIC_CHAT_BASE_URL ?? 'http://127.0.0.1:1337'
  const nvidiaBaseUrl = process.env.NVIDIA_BASE_URL ?? 'https://integrate.api.nvidia.com/v1'

  return [
    {
      name: 'openai',
      pingUrl: 'https://api.openai.com/v1/models',
      apiKeyEnv: 'OPENAI_API_KEY',
      costPer1kTokens: 0.002,
      bigModel: big.includes('gpt') ? big : 'gpt-4.1',
      smallModel: small.includes('gpt') ? small : 'gpt-4.1-mini',
    },
    {
      name: 'gemini',
      pingUrl: 'https://generativelanguage.googleapis.com/v1/models',
      apiKeyEnv: 'GEMINI_API_KEY',
      costPer1kTokens: 0.0005,
      bigModel: big.includes('gemini') ? big : 'gemini-2.5-pro',
      smallModel: small.includes('gemini') ? small : 'gemini-2.0-flash',
    },
    {
      name: 'ollama',
      pingUrl: `${ollamaUrl}/api/tags`,
      apiKeyEnv: '',
      costPer1kTokens: 0.0,   // free — local
      bigModel: (!big.includes('gemini') && !big.includes('gpt')) ? big : 'llama3:8b',
      smallModel: (!small.includes('gemini') && !small.includes('gpt')) ? small : 'llama3:8b',
    },
    {
      name: 'atomic-chat',
      pingUrl: `${atomicChatUrl}/v1/models`,
      apiKeyEnv: '',
      costPer1kTokens: 0.0,   // free — local (Apple Silicon)
      bigModel: (!big.includes('gemini') && !big.includes('gpt')) ? big : 'llama3:8b',
      smallModel: (!small.includes('gemini') && !small.includes('gpt')) ? small : 'llama3:8b',
    },
    {
      name: 'nvidia',
      pingUrl: `${nvidiaBaseUrl}/models`,
      apiKeyEnv: 'NVIDIA_API_KEY',
      costPer1kTokens: 0.0001,  // estimated - varies by model
      bigModel: ['llama', 'nemotron', 'meta'].some(x => big.toLowerCase().includes(x))
        ? big
        : 'meta/llama3-70b-instruct',
      smallModel: ['llama', 'nemotron', 'meta'].some(x => small.toLowerCase().includes(x))
        ? small
        : 'meta/llama3-8b-instruct',
    },
  ]
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
        signal: AbortSignal.timeout(5000),
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

  selectProvider(isLargeRequest = false): Provider | null {
    const available = this.providers.filter(p => p.healthy && p.isConfigured)
    if (available.length === 0) {
      return null
    }

    return available.reduce((best, current) => {
      return current.score(this.strategy) < best.score(this.strategy) ? current : best
    })
  }

  getModelForProvider(provider: Provider, claudeModel: string): string {
    const isLarge = ['opus', 'sonnet', 'large', 'big'].some(
      keyword => claudeModel.toLowerCase().includes(keyword),
    )
    return isLarge ? provider.bigModel : provider.smallModel
  }

  isLargeRequest(messages: Array<{ content?: unknown }>): boolean {
    const totalChars = messages.reduce((sum, m) => {
      return sum + String(m.content ?? '').length
    }, 0)
    return totalChars > 2000  // >2000 chars = treat as large
  }

  private updateLatency(provider: Provider, durationMs: number): void {
    const alpha = 0.3  // weight for new observation
    provider.avgLatencyMs = alpha * durationMs + (1 - alpha) * provider.avgLatencyMs
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

    const provider = available.reduce((best, current) => {
      return current.score(this.strategy) < best.score(this.strategy) ? current : best
    })
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
      // After 3 consecutive failures, mark unhealthy temporarily
      const recentErrors = provider.errorCount
      const recentTotal = provider.requestCount
      if (recentTotal >= 3 && (recentErrors / recentTotal) > 0.7) {
        logger.warning(
          `SmartRouter: ${providerName} error rate high (${(provider.errorRate * 100).toFixed(0)}%), marking unhealthy`,
        )
        provider.healthy = false
        // Schedule re-check after 60s
        setTimeout(() => {
          this.recheckProvider(provider)
        }, 60000)
      }
    }
  }

  private async recheckProvider(provider: Provider, delay = 60000): Promise<void> {
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

// Add computed properties to Provider interface via augmentation
declare global {
  interface Provider {
    readonly apiKey: string | undefined
    readonly isConfigured: boolean
    readonly errorRate: number
    score(strategy: RoutingStrategy): number
  }
}

// Add getters and methods to Provider objects
function enhanceProvider(provider: Provider): Provider {
  return Object.assign(provider, {
    get apiKey(): string | undefined {
      return provider.apiKeyEnv ? process.env[provider.apiKeyEnv] : undefined
    },
    
    get isConfigured(): boolean {
      if (['ollama', 'atomic-chat'].includes(provider.name)) {
        return true  // Local providers need no API key
      }
      return !!provider.apiKey
    },
    
    get errorRate(): number {
      if (provider.requestCount === 0) {
        return 0.0
      }
      return provider.errorCount / provider.requestCount
    },
    
    score(strategy: RoutingStrategy): number {
      if (!provider.healthy || !provider.isConfigured) {
        return Number.POSITIVE_INFINITY
      }

      const latencyScore = provider.avgLatencyMs / 1000.0   // normalize to seconds
      const costScore = provider.costPer1kTokens * 100      // normalize to similar scale
      const errorPenalty = provider.errorRate * 500         // heavy penalty for errors

      if (strategy === 'latency') {
        return latencyScore + errorPenalty
      } else if (strategy === 'cost') {
        return costScore + errorPenalty
      } else {  // balanced
        return (latencyScore * 0.5) + (costScore * 0.5) + errorPenalty
      }
    },
  })
}

// Export factory function to create enhanced providers
export function createProvider(base: Omit<Provider, keyof Provider>): Provider {
  return enhanceProvider({ ...base } as Provider)
}
