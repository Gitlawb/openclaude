/**
 * doctor:autonomy — report provider health + recent route decisions.
 *
 * Usage:
 *   bun run scripts/doctor-autonomy.ts
 *   bun run scripts/doctor-autonomy.ts --json
 *   bun run scripts/doctor-autonomy.ts --probe
 *
 * Reads ~/.claude/settings.json directly (no full CLI bootstrap) so it works
 * outside the agent runtime.
 */
import { existsSync, readFileSync } from 'node:fs'
import { homedir } from 'node:os'
import { join } from 'node:path'
import {
  getHealthSnapshot,
  probeAndUpdate,
  type HealthSnapshot,
} from '../src/services/autonomy/providerHealth.js'

type LooseSettings = {
  autonomy?: {
    enabled?: boolean
    mode?: string
    classifier?: string
  }
  taskRouting?: Record<string, string | undefined>
  fallbackChains?: Record<string, string[]>
  agentModels?: Record<string, { base_url: string; api_key: string }>
  agentRouting?: Record<string, string>
}

const args = process.argv.slice(2)
const asJson = args.includes('--json')
const doProbe = args.includes('--probe')

function loadSettings(): LooseSettings {
  const path = join(homedir(), '.claude', 'settings.json')
  if (!existsSync(path)) {
    return {}
  }
  try {
    return JSON.parse(readFileSync(path, 'utf8')) as LooseSettings
  } catch (e) {
    console.error(`Failed to parse ${path}: ${e}`)
    return {}
  }
}

function envAutonomyEnabled(settings: LooseSettings): boolean {
  const v = process.env.OPENCLAUDE_AUTONOMY
  if (v === '0' || v === 'false') return false
  if (v === '1' || v === 'true') return true
  return Boolean(settings.autonomy?.enabled)
}

function envMode(settings: LooseSettings): string {
  const m = process.env.OPENCLAUDE_AUTONOMY_MODE
  if (m) return m
  return settings.autonomy?.mode ?? 'smart'
}

async function main(): Promise<void> {
  const settings = loadSettings()
  const autonomyOn = envAutonomyEnabled(settings)
  const mode = envMode(settings)

  if (doProbe && settings.agentModels) {
    for (const [model, cfg] of Object.entries(settings.agentModels)) {
      await probeAndUpdate(model, cfg.base_url, cfg.api_key)
    }
  }

  const snapshot: HealthSnapshot = getHealthSnapshot()

  const report = {
    autonomy: {
      enabled: autonomyOn,
      mode,
      classifier: settings.autonomy?.classifier ?? 'heuristic',
      taskRouting: settings.taskRouting ?? null,
      fallbackChains: settings.fallbackChains ?? null,
      agentRouting: settings.agentRouting ?? null,
    },
    agentModels: settings.agentModels ? Object.keys(settings.agentModels) : [],
    health: snapshot.entries,
    recentRoutes: snapshot.recentRoutes.slice(-20),
    settingsPath: join(homedir(), '.claude', 'settings.json'),
    generatedAt: new Date().toISOString(),
  }

  if (asJson) {
    console.log(JSON.stringify(report, null, 2))
    return
  }

  console.log('OpenClaude Autonomy Doctor')
  console.log('==========================')
  console.log(`settings: ${report.settingsPath}`)
  console.log(`enabled:  ${report.autonomy.enabled}`)
  console.log(`mode:     ${report.autonomy.mode}`)
  console.log(`classifier: ${report.autonomy.classifier}`)
  console.log('')

  if (report.autonomy.taskRouting) {
    console.log('taskRouting:')
    for (const [tier, model] of Object.entries(report.autonomy.taskRouting)) {
      if (model) console.log(`  ${tier.padEnd(10)} → ${model}`)
    }
    console.log('')
  } else {
    console.log('taskRouting: (not configured)')
    console.log('')
  }

  if (report.autonomy.fallbackChains) {
    console.log('fallbackChains:')
    for (const [k, chain] of Object.entries(report.autonomy.fallbackChains)) {
      console.log(`  ${k}: ${chain.join(' → ')}`)
    }
    console.log('')
  }

  console.log(`agentModels (${report.agentModels.length}):`)
  for (const m of report.agentModels) {
    console.log(`  - ${m}`)
  }
  console.log('')

  if (report.health.length === 0) {
    console.log('health: (empty — no probes or live requests in this process)')
    console.log('  tip: re-run with --probe to ping agentModels endpoints')
  } else {
    console.log('health:')
    for (const e of report.health) {
      const flag = e.healthy ? 'OK ' : 'BAD'
      console.log(
        `  [${flag}] ${e.model}  avg=${Math.round(e.avgLatencyMs)}ms  req=${e.requestCount}  err=${e.errorCount}  ${e.baseURL}`,
      )
      if (e.lastError) console.log(`         lastError: ${e.lastError}`)
    }
  }
  console.log('')

  if (report.recentRoutes.length === 0) {
    console.log('recentRoutes: (none in this process — live routes appear during agent runs)')
  } else {
    console.log(`recentRoutes (last ${report.recentRoutes.length}):`)
    for (const r of report.recentRoutes) {
      const t = new Date(r.ts).toISOString().slice(11, 19)
      console.log(
        `  ${t} ${r.event.padEnd(8)} ${r.model}  src=${r.source}${r.tier ? ` tier=${r.tier}` : ''}`,
      )
    }
  }
}

main().catch(err => {
  console.error(err)
  process.exit(1)
})
