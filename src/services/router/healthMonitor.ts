import { existsSync, writeFileSync, renameSync, mkdirSync } from 'node:fs'
import { join } from 'node:path'
import type { Tier, HealthStatus, TierConfig } from './types.js'
import { DEFAULT_TIER_CONFIGS, TIER_ORDER } from './types.js'
import type { EventLog } from './eventLog.js'

export class HealthMonitor {
  private statuses: Map<Tier, HealthStatus> = new Map()
  private statusFilePath: string
  private statusTextPath: string
  private intervalHandle: ReturnType<typeof setInterval> | null = null
  private eventLog: EventLog | null = null
  private tiers: Record<Tier, TierConfig>
  private projectDir: string

  constructor(projectDir: string, tiers: Record<Tier, TierConfig> = DEFAULT_TIER_CONFIGS) {
    this.projectDir = projectDir
    this.tiers = tiers
    const dir = join(projectDir, '.openclaude')
    if (!existsSync(dir)) mkdirSync(dir, { recursive: true })
    this.statusFilePath = join(dir, 'health-status.json')
    this.statusTextPath = join(dir, 'router-status.txt')
  }

  setEventLog(eventLog: EventLog): void { this.eventLog = eventLog }

  start(intervalMs: number = 60000): void {
    this.checkAll()
    this.intervalHandle = setInterval(() => this.checkAll(), intervalMs)
  }

  stop(): void {
    if (this.intervalHandle) { clearInterval(this.intervalHandle); this.intervalHandle = null }
  }

  getStatus(tier: Tier): HealthStatus | undefined { return this.statuses.get(tier) }

  getAllStatuses(): Map<Tier, HealthStatus> { return new Map(this.statuses) }

  async checkEndpoint(tier: Tier): Promise<HealthStatus> {
    const config = this.tiers[tier]
    if (!config) return this.makeOffline(tier, 'no config')

    const isOllama = config.baseURL.includes('localhost') || config.baseURL.includes('127.0.0.1')
    const isAnthropic = config.baseURL.includes('anthropic.com')

    try {
      const startTime = Date.now()
      let modelLoaded: string | null = null

      if (isOllama) {
        const ollamaBase = config.baseURL.replace('/v1', '').replace(/\/$/, '')
        const resp = await fetch(`${ollamaBase}/api/tags`, { signal: AbortSignal.timeout(5000) })
        if (!resp.ok) throw new Error(`HTTP ${resp.status}`)
        const data = await resp.json() as { models?: Array<{ name: string }> }
        modelLoaded = data.models?.find(m => m.name === config.model)?.name ?? null
      } else if (isAnthropic) {
        await fetch(config.baseURL, { method: 'GET', signal: AbortSignal.timeout(5000) }).catch(() => null)
        modelLoaded = config.model
      } else {
        const apiKey = process.env[config.apiKeyEnv] ?? ''
        const resp = await fetch(`${config.baseURL}/models`, {
          headers: { 'Authorization': `Bearer ${apiKey}` },
          signal: AbortSignal.timeout(5000),
        })
        if (!resp.ok && resp.status !== 401 && resp.status !== 403) throw new Error(`HTTP ${resp.status}`)
        modelLoaded = config.model
      }

      const latencyMs = Date.now() - startTime
      const coldStart = isOllama && !modelLoaded
      const status: HealthStatus = {
        endpoint: `${tier}-${config.name}`,
        status: latencyMs > 10000 ? 'degraded' : 'healthy',
        latencyMs,
        latencyPer1kTokens: isOllama ? latencyMs * 2 : latencyMs,
        lastCheck: new Date().toISOString(),
        lastError: null,
        modelLoaded,
        coldStart,
      }
      this.statuses.set(tier, status)
      return status
    } catch (err) {
      const status = this.makeOffline(tier, String(err))
      this.statuses.set(tier, status)
      this.eventLog?.emit({ event: 'health_check', tier, status: 'offline', error: String(err) })
      return status
    }
  }

  async checkAll(): Promise<void> {
    const checks = TIER_ORDER.map(tier => this.checkEndpoint(tier))
    await Promise.allSettled(checks)
    this.writeStatusFiles()
  }

  formatStatusBanner(): string {
    const lines: string[] = ['Provider Health:']
    for (const tier of TIER_ORDER) {
      const status = this.statuses.get(tier)
      const config = this.tiers[tier]
      if (!status || !config) {
        lines.push(`  - ${tier.padEnd(4)} ${(config?.name ?? 'unknown').padEnd(18)} unchecked`)
        continue
      }
      const icon = status.status === 'healthy' ? '\u25CF' : status.status === 'degraded' ? '\u25D0' : '\u25CB'
      const model = (status.modelLoaded ?? '-').padEnd(22)
      const latency = status.status !== 'offline' ? `${(status.latencyPer1kTokens / 1000).toFixed(1)}s/1K` : '-'
      lines.push(`  ${icon} ${tier} ${config.name.padEnd(18)} ${model} ${latency.padEnd(10)} ${status.status}`)
    }
    return lines.join('\n')
  }

  private makeOffline(tier: Tier, error: string): HealthStatus {
    return {
      endpoint: tier, status: 'offline', latencyMs: 0, latencyPer1kTokens: 0,
      lastCheck: new Date().toISOString(), lastError: error, modelLoaded: null, coldStart: false,
    }
  }

  private writeStatusFiles(): void {
    try {
      const jsonData: Record<string, HealthStatus> = {}
      for (const [tier, status] of this.statuses) jsonData[tier] = status

      const tmpJson = this.statusFilePath + '.tmp'
      writeFileSync(tmpJson, JSON.stringify(jsonData, null, 2))
      renameSync(tmpJson, this.statusFilePath)

      const txtLines = [
        `Foundation Router Status \u2014 ${new Date().toISOString()}`,
        '',
        this.formatStatusBanner(),
        '',
        `Status file: ${this.statusFilePath}`,
      ]
      const tmpTxt = this.statusTextPath + '.tmp'
      writeFileSync(tmpTxt, txtLines.join('\n'))
      renameSync(tmpTxt, this.statusTextPath)
    } catch {}
  }
}
