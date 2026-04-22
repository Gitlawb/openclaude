#!/usr/bin/env node
/**
 * DuckHive Config Loader — reads ~/.duckhive/config.json
 * and maps meta-agent settings to Duck CLI environment variables.
 *
 * Config schema:
 * {
 *   "meta": {
 *     "enabled": true,              // enable/disable meta-agent orchestration
 *     "complexityThreshold": 4,     // complexity level that triggers meta-agent (1-10)
 *     "models": {
 *       "orchestrator": "auto",     // model for task routing/orchestration
 *       "fast": "auto",             // model for simple tasks (complexity 1-3)
 *       "standard": "auto",          // model for medium tasks (complexity 4-6)
 *       "complex": "auto",           // model for complex tasks (complexity 7-10)
 *       "android": "auto",           // model for Android control tasks
 *       "vision": "auto",            // model for vision/screenshot analysis
 *       "coding": "auto"             // model for code generation tasks
 *     },
 *     "features": {
 *       "councilEnabled": true,      // enable AI Council deliberation
 *       "fallbackEnabled": true,     // enable automatic model fallback
 *       "selfHealing": true,         // enable self-healing on failures
 *       "learning": true            // enable learning from feedback
 *     },
 *     "limits": {
 *       "maxConcurrent": 3,          // max parallel sub-agents
 *       "maxRetries": 3,             // max retry attempts per task
 *       "timeoutMs": 60000           // default task timeout in ms
 *     }
 *   },
 *   "providers": {
 *     "default": "minimax",          // default provider (minimax, kimi, openai, lmstudio)
 *     "fallback": "openrouter"       // fallback provider
 *   }
 * }
 *
 * Model aliases:
 *   "auto"          — use DuckHive's default routing
 *   "minimax/MiniMax-M2.7"  — specific provider/model
 *   "kimi/kimi-k2.5"        — Kimi vision model
 *   "local/qwen3.5-9b"      — local via LM Studio
 *   "free"                   — OpenRouter free tier
 */

import { existsSync, readFileSync } from 'fs'
import { join, dirname } from 'path'
import { fileURLToPath } from 'url'
import { homedir } from 'os'

const __dirname = dirname(fileURLToPath(import.meta.url))
const CONFIG_DIR = join(homedir(), '.duckhive')
const CONFIG_FILE = join(CONFIG_DIR, 'config.json')

// ─── Config defaults ────────────────────────────────────────────────────────────

const DEFAULT_META = {
  enabled: true,
  complexityThreshold: 4,
  models: {
    orchestrator: 'auto',
    fast: 'auto',
    standard: 'auto',
    complex: 'auto',
    android: 'auto',
    vision: 'auto',
    coding: 'auto',
  },
  features: {
    councilEnabled: true,
    fallbackEnabled: true,
    selfHealing: true,
    learning: true,
  },
  limits: {
    maxConcurrent: 3,
    maxRetries: 3,
    timeoutMs: 60000,
  },
}

const DEFAULT_PROVIDERS = {
  default: 'minimax',
  fallback: 'openrouter',
}

// ─── Config resolution ─────────────────────────────────────────────────────────

/**
 * Load and merge config from ~/.duckhive/config.json with defaults.
 * Returns the full config object.
 */
export function loadDuckhiveConfig() {
  const base = deepMerge({}, DEFAULT_META, { providers: DEFAULT_PROVIDERS })

  if (!existsSync(CONFIG_FILE)) {
    return base
  }

  try {
    const raw = readFileSync(CONFIG_FILE, 'utf-8')
    const user = JSON.parse(raw)
    return deepMerge(base, user)
  } catch (err) {
    console.error(`duckhive: warning — failed to load config from ${CONFIG_FILE}: ${err.message}`)
    return base
  }
}

/**
 * Apply config settings as environment variables for the Duck CLI subprocess.
 * Call this before spawning the underlying CLI.
 */
export function applyConfigToEnv(config) {
  const { meta, providers } = config

  // Meta-agent settings → Duck CLI env vars
  if (meta !== undefined) {
    if (meta.enabled !== undefined) {
      process.env.DUCKHIVE_META_ENABLED = String(meta.enabled)
    }
    if (meta.complexityThreshold !== undefined) {
      process.env.DUCKHIVE_META_COMPLEXITY_THRESHOLD = String(meta.complexityThreshold)
    }
    if (meta.models) {
      const { models } = meta
      if (models.orchestrator && models.orchestrator !== 'auto') {
        process.env.DUCKHIVE_MODEL_ORCHESTRATOR = models.orchestrator
      }
      if (models.fast && models.fast !== 'auto') {
        process.env.DUCKHIVE_MODEL_FAST = models.fast
      }
      if (models.standard && models.standard !== 'auto') {
        process.env.DUCKHIVE_MODEL_STANDARD = models.standard
      }
      if (models.complex && models.complex !== 'auto') {
        process.env.DUCKHIVE_MODEL_COMPLEX = models.complex
      }
      if (models.android && models.android !== 'auto') {
        process.env.DUCKHIVE_MODEL_ANDROID = models.android
      }
      if (models.vision && models.vision !== 'auto') {
        process.env.DUCKHIVE_MODEL_VISION = models.vision
      }
      if (models.coding && models.coding !== 'auto') {
        process.env.DUCKHIVE_MODEL_CODING = models.coding
      }
    }
    if (meta.features) {
      const { features } = meta
      process.env.DUCKHIVE_COUNCIL_ENABLED = String(features.councilEnabled ?? true)
      process.env.DUCKHIVE_FALLBACK_ENABLED = String(features.fallbackEnabled ?? true)
      process.env.DUCKHIVE_SELF_HEALING = String(features.selfHealing ?? true)
      process.env.DUCKHIVE_LEARNING = String(features.learning ?? true)
    }
    if (meta.limits) {
      const { limits } = meta
      if (limits.maxConcurrent !== undefined) {
        process.env.DUCKHIVE_MAX_CONCURRENT = String(limits.maxConcurrent)
      }
      if (limits.maxRetries !== undefined) {
        process.env.DUCKHIVE_MAX_RETRIES = String(limits.maxRetries)
      }
      if (limits.timeoutMs !== undefined) {
        process.env.DUCKHIVE_TIMEOUT_MS = String(limits.timeoutMs)
      }
    }
  }

  // Provider settings
  if (providers) {
    if (providers.default) {
      process.env.DUCKHIVE_DEFAULT_PROVIDER = providers.default
    }
    if (providers.fallback) {
      process.env.DUCKHIVE_FALLBACK_PROVIDER = providers.fallback
    }
  }
}

/**
 * Get a human-readable summary of the current config for display.
 */
export function getConfigSummary(config) {
  const { meta, providers } = config
  const lines = []

  lines.push(`  ${bold('Meta-Agent Configuration')}`)

  if (meta) {
    lines.push(`    ${dim('Enabled:')} ${meta.enabled ? green('ON') : red('OFF')}  ${dim('Threshold:')} ${yellow(meta.complexityThreshold)}/10`)

    const feat = meta.features
    if (feat) {
      const council = feat.councilEnabled ? green('●') : red('○')
      const fallback = feat.fallbackEnabled ? green('●') : red('○')
      const heal = feat.selfHealing ? green('●') : red('○')
      const learn = feat.learning ? green('●') : red('○')
      lines.push(`    ${dim('Features:')} council ${council}  fallback ${fallback}  heal ${heal}  learn ${learn}`)
    }

    const mods = meta.models
    if (mods) {
      const fmt = (v) => v === 'auto' ? dim('auto') : cyan(v)
      lines.push(`    ${dim('Models:')} orch=${fmt(mods.orchestrator)} fast=${fmt(mods.fast)} std=${fmt(mods.standard)}`)
      lines.push(`             complex=${fmt(mods.complex)} android=${fmt(mods.android)} vision=${fmt(mods.vision)} coding=${fmt(mods.coding)}`)
    }

    const lim = meta.limits
    if (lim) {
      lines.push(`    ${dim('Limits:')} concurrent=${lim.maxConcurrent}  retries=${lim.maxRetries}  timeout=${lim.timeoutMs}ms`)
    }
  }

  if (providers) {
    lines.push(`  ${bold('Providers')}`)
    lines.push(`    ${dim('Default:')} ${providers.default || 'minimax'}  ${dim('Fallback:')} ${providers.fallback || 'openrouter'}`)
  }

  return lines.join('\n')
}

// ─── Utilities ─────────────────────────────────────────────────────────────────

function deepMerge(target, ...sources) {
  for (const source of sources) {
    for (const key of Object.keys(source)) {
      if (source[key] && typeof source[key] === 'object' && !Array.isArray(source[key])) {
        if (!target[key]) target[key] = {}
        deepMerge(target[key], source[key])
      } else {
        target[key] = source[key]
      }
    }
  }
  return target
}

// ANSI helpers (no chalk dependency — plain strings)
const ESC = '\x1b['
const reset = () => `${ESC}0m`
const bold = (s) => `${ESC}1m${s}${reset()}`
const dim = (s) => `${ESC}2m${s}${reset()}`
const yellow = (s) => `${ESC}33m${s}${reset()}`
const cyan = (s) => `${ESC}36m${s}${reset()}`
const green = (s) => `${ESC}32m${s}${reset()}`
const red = (s) => `${ESC}31m${s}${reset()}`

// ─── CLI for config management ──────────────────────────────────────────────────

const args = process.argv.slice(2)

if (args[0] === 'config') {
  const sub = args[1]
  const cfg = loadDuckhiveConfig()

  if (sub === 'show' || !sub) {
    console.log('\n' + getConfigSummary(cfg) + '\n')
    process.exit(0)
  }

  if (sub === 'init') {
    // Create default config file
    import('fs').then(({ existsSync, writeFileSync, mkdirSync }) => {
      if (!existsSync(CONFIG_DIR)) {
        mkdirSync(CONFIG_DIR, { recursive: true })
      }
      const defaultConfig = {
        meta: DEFAULT_META,
        providers: DEFAULT_PROVIDERS,
        _comment: 'DuckHive configuration — https://github.com/Franzferdinan51/DuckHive',
      }
      writeFileSync(CONFIG_FILE, JSON.stringify(defaultConfig, null, 2))
      console.log(`Created ${CONFIG_FILE}`)
      console.log('\nEdit this file to configure meta-agent models, features, and limits.')
    })
    process.exit(0)
  }

  if (sub === 'path') {
    console.log(CONFIG_FILE)
    process.exit(0)
  }

  console.log('Usage: duckhive config [show|init|path]')
  process.exit(1)
}
