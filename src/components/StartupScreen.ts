/**
 * DuckHive startup screen — filled-block text logo with gold gradient.
 * Called once at CLI startup before the Ink UI renders.
 */

import { isLocalProviderUrl, resolveProviderRequest } from '../services/api/providerConfig.js'
import { getLocalOpenAICompatibleProviderLabel } from '../utils/providerDiscovery.js'
import { getSettings_DEPRECATED } from '../utils/settings/settings.js'
import { parseUserSpecifiedModel } from '../utils/model/model.js'

declare const MACRO: { VERSION: string; DISPLAY_VERSION?: string }

const ESC = '\x1b['
const RESET = `${ESC}0m`
const DIM = `${ESC}2m`

type RGB = [number, number, number]
const rgb = (r: number, g: number, b: number) => `${ESC}38;2;${r};${g};${b}m`

function lerp(a: RGB, b: RGB, t: number): RGB {
  return [
    Math.round(a[0] + (b[0] - a[0]) * t),
    Math.round(a[1] + (b[1] - a[1]) * t),
    Math.round(a[2] + (b[2] - a[2]) * t),
  ]
}

function gradAt(stops: RGB[], t: number): RGB {
  const c = Math.max(0, Math.min(1, t))
  const s = c * (stops.length - 1)
  const i = Math.floor(s)
  if (i >= stops.length - 1) return stops[stops.length - 1]
  return lerp(stops[i], stops[i + 1], s - i)
}

function paintLine(text: string, stops: RGB[], lineT: number): string {
  let out = ''
  for (let i = 0; i < text.length; i++) {
    const t = text.length > 1 ? lineT * 0.5 + (i / (text.length - 1)) * 0.5 : lineT
    const [r, g, b] = gradAt(stops, t)
    out += `${rgb(r, g, b)}${text[i]}`
  }
  return out + RESET
}

// ─── Colors ───────────────────────────────────────────────────────────────────

const GOLD_GRAD: RGB[] = [
  [255, 215, 0],
  [255, 195, 30],
  [255, 175, 60],
  [255, 160, 90],
  [255, 140, 60],
  [255, 120, 0],
]

const GOLD: RGB = [255, 215, 0]
const AMBER: RGB = [255, 170, 0]
const ORANGE: RGB = [255, 140, 0]
const CREAM: RGB = [220, 195, 170]
const DIMCOL: RGB = [130, 110, 80]
const BORDER: RGB = [100, 80, 40]

// ─── Filled Block Text Logo ───────────────────────────────────────────────────

const LOGO_DUCK = [
  `  ████████╗ ████████╗ ████████╗ ██╗  ██╗`,
  `  ██╔═══██║ ██╔═══██║ ██╔═════╝ ███╗ ██║`,
  `  ██║   ██║ ████████║ ██████╗   ████╗██║`,
  `  ██║   ██║ ██╔═════╝ ██╔═══╝   ██╔████║`,
  `  ████████║ ██║       ████████╗ ██║ ╚███║`,
  `  ╚═══════╝ ╚═╝       ╚═══════╝ ╚═╝  ╚══╝`,
]

const LOGO_HIVE = [
  `  ████████╗ ██╗      ████████╗ ██╗   ██╗ ████████╗ ████████╗`,
  `  ██╔═════╝ ██║      ██╔═══██║ ██║   ██║ ██╔═══██║ ██╔═════╝`,
  `  ██║       ██║      ████████║ ██║   ██║ ██║   ██║ ██████╗  `,
  `  ██║       ██║      ██╔═══██║ ██║   ██║ ██║   ██║ ██╔═══╝  `,
  `  ████████╗ ████████╗██║   ██║ ╚██████╔╝ ████████║ ████████╗`,
  `  ╚═══════╝ ╚═══════╝╚═╝   ╚═╝  ╚═════╝  ╚═══════╝ ╚═══════╝`,
]

// ─── Provider detection ───────────────────────────────────────────────────────

function detectProvider(): { name: string; model: string; baseUrl: string; isLocal: boolean } {
  const useGemini = process.env.CLAUDE_CODE_USE_GEMINI === '1' || process.env.CLAUDE_CODE_USE_GEMINI === 'true'
  const useGithub = process.env.CLAUDE_CODE_USE_GITHUB === '1' || process.env.CLAUDE_CODE_USE_GITHUB === 'true'
  const useOpenAI = process.env.CLAUDE_CODE_USE_OPENAI === '1' || process.env.CLAUDE_CODE_USE_OPENAI === 'true'
  const useMistral = process.env.CLAUDE_CODE_USE_MISTRAL === '1' || process.env.CLAUDE_CODE_USE_MISTRAL === 'true'

  if (useGemini) {
    const model = process.env.GEMINI_MODEL || 'gemini-2.0-flash'
    const baseUrl = process.env.GEMINI_BASE_URL || 'https://generativelanguage.googleapis.com/v1beta/openai'
    return { name: 'Google Gemini', model, baseUrl, isLocal: false }
  }

  if (useMistral) {
    const model = process.env.MISTRAL_MODEL || 'devstral-latest'
    const baseUrl = process.env.MISTRAL_BASE_URL || 'https://api.mistral.ai/v1'
    return { name: 'Mistral', model, baseUrl, isLocal: false }
  }

  if (useGithub) {
    const model = process.env.OPENAI_MODEL || 'github:copilot'
    const baseUrl =
      process.env.OPENAI_BASE_URL || 'https://api.githubcopilot.com'
    return { name: 'GitHub Copilot', model, baseUrl, isLocal: false }
  }

  if (useOpenAI) {
    const rawModel = process.env.OPENAI_MODEL || 'gpt-4o'
    const resolvedRequest = resolveProviderRequest({
      model: rawModel,
      baseUrl: process.env.OPENAI_BASE_URL,
    })
    const baseUrl = resolvedRequest.baseUrl
    const isLocal = isLocalProviderUrl(baseUrl)
    let name = 'OpenAI'
    if (/nvidia/i.test(baseUrl) || /nvidia/i.test(rawModel) || process.env.NVIDIA_NIM)
      name = 'NVIDIA NIM'
    else if (/minimax/i.test(baseUrl) || /minimax/i.test(rawModel) || process.env.MINIMAX_API_KEY)
      name = 'MiniMax'
    else if (resolvedRequest.transport === 'codex_responses' || baseUrl.includes('chatgpt.com/backend-api/codex'))
      name = 'Codex'
    else if (/moonshot/i.test(baseUrl) || /kimi/i.test(rawModel))
      name = 'Moonshot (Kimi)'
    else if (/deepseek/i.test(baseUrl) || /deepseek/i.test(rawModel))
      name = 'DeepSeek'
    else if (/openrouter/i.test(baseUrl))
      name = 'OpenRouter'
    else if (/together/i.test(baseUrl))
      name = 'Together AI'
    else if (/groq/i.test(baseUrl))
      name = 'Groq'
    else if (/mistral/i.test(baseUrl) || /mistral/i.test(rawModel))
      name = 'Mistral'
    else if (/azure/i.test(baseUrl))
      name = 'Azure OpenAI'
    else if (/llama/i.test(rawModel))
      name = 'Meta Llama'
    else if (isLocal)
      name = getLocalOpenAICompatibleProviderLabel(baseUrl)

    // Resolve model alias to actual model name + reasoning effort
    let displayModel = resolvedRequest.resolvedModel
    if (resolvedRequest.reasoning?.effort) {
      displayModel = `${displayModel} (${resolvedRequest.reasoning.effort})`
    }

    return { name, model: displayModel, baseUrl, isLocal }
  }

  // Default: Anthropic - check settings.model first, then env vars
  const settings = getSettings_DEPRECATED() || {}
  const modelSetting = settings.model || process.env.ANTHROPIC_MODEL || process.env.CLAUDE_MODEL || 'claude-sonnet-4-6'
  const resolvedModel = parseUserSpecifiedModel(modelSetting)
  const baseUrl = process.env.ANTHROPIC_BASE_URL ?? 'https://api.anthropic.com'
  const isLocal = isLocalProviderUrl(baseUrl)
  return { name: 'Anthropic', model: resolvedModel, baseUrl, isLocal }
}

// ─── Box drawing ──────────────────────────────────────────────────────────────

function boxRow(content: string, width: number, rawLen: number): string {
  const pad = Math.max(0, width - 2 - rawLen)
  return `${rgb(...BORDER)}\u2502${RESET}${content}${' '.repeat(pad)}${rgb(...BORDER)}\u2502${RESET}`
}

// ─── Main ─────────────────────────────────────────────────────────────────────

export function printStartupScreen(): void {
  // Skip in non-interactive / CI / print mode
  if (process.env.CI || !process.stdout.isTTY) return

  const p = detectProvider()
  const W = 62
  const out: string[] = []

  out.push('')

  // Gradient logo
  const allLogo = [...LOGO_DUCK, '', ...LOGO_HIVE]
  const total = allLogo.length
  for (let i = 0; i < total; i++) {
    const t = total > 1 ? i / (total - 1) : 0
    if (allLogo[i] === '') {
      out.push('')
    } else {
      out.push(paintLine(allLogo[i], GOLD_GRAD, t))
    }
  }

  out.push('')

  // Tagline
  out.push(`  ${rgb(...AMBER)}\u2726${RESET} ${rgb(...CREAM)}Any model. Every tool. One Hive.${RESET} ${rgb(...AMBER)}\u2726${RESET}`)
  out.push('')

  // Provider info box
  out.push(`${rgb(...BORDER)}╔${'═'.repeat(W - 2)}╗${RESET}`)

  const lbl = (k: string, v: string, c: RGB = CREAM): [string, number] => {
    const padK = k.padEnd(9)
    return [` ${DIM}${rgb(...DIMCOL)}${padK}${RESET} ${rgb(...c)}${v}${RESET}`, ` ${padK} ${v}`.length]
  }

  const provC: RGB = p.isLocal ? [130, 175, 130] : GOLD
  let [r, l] = lbl('Provider', p.name, provC)
  out.push(boxRow(r, W, l))
  ;[r, l] = lbl('Model', p.model)
  out.push(boxRow(r, W, l))

  // ─── Meta-agent config ─────────────────────────────────────────────────────
  const metaEnabled = process.env.DUCKHIVE_META_ENABLED !== 'false'
  const complexityThresh = parseInt(process.env.DUCKHIVE_META_COMPLEXITY_THRESHOLD || '4', 10)
  const metaModel = process.env.DUCKHIVE_MODEL_ORCHESTRATOR || 'auto'
  const councilOn = process.env.DUCKHIVE_COUNCIL_ENABLED !== 'false'
  const fallbackOn = process.env.DUCKHIVE_FALLBACK_ENABLED !== 'false'
  const healOn = process.env.DUCKHIVE_SELF_HEALING !== 'false'
  const maxConcurrent = process.env.DUCKHIVE_MAX_CONCURRENT || '3'

  const dot = (on: boolean) => on ? `${rgb(...GOLD)}●${RESET}` : `${rgb(...DIMCOL)}○${RESET}`

  out.push(`${rgb(...BORDER)}╠${'═'.repeat(W - 2)}╣${RESET}`)
  ;[r, l] = lbl('Meta-Agent', metaEnabled ? `${rgb(...GOLD)}ON${RESET}` : `${DIM}${rgb(...DIMCOL)}OFF${RESET}`, metaEnabled ? GOLD : DIMCOL)
  out.push(boxRow(r, W, l))
  ;[r, l] = lbl('Threshold', `${complexityThresh}/10`, CREAM)
  out.push(boxRow(r, W, l))
  ;[r, l] = lbl('Orchestrator', metaModel === 'auto' ? `${DIM}auto${RESET}` : `${rgb(...AMBER)}${metaModel}${RESET}`, CREAM)
  out.push(boxRow(r, W, l))
  const featStr = `council ${dot(councilOn)}  fallback ${dot(fallbackOn)}  heal ${dot(healOn)}`
  ;[r, l] = lbl('Features', featStr, CREAM)
  out.push(boxRow(r, W, l))
  ;[r, l] = lbl('Max Agents', maxConcurrent, CREAM)
  out.push(boxRow(r, W, l))

  const sC: RGB = p.isLocal ? [130, 175, 130] : GOLD
  const sL = p.isLocal ? 'local' : 'cloud'
  const sRow = ` ${rgb(...sC)}\u25cf${RESET} ${DIM}${rgb(...DIMCOL)}${sL}${RESET}    ${DIM}${rgb(...DIMCOL)}Ready \u2014 type ${RESET}${rgb(...GOLD)}/help${RESET}${DIM}${rgb(...DIMCOL)} to begin${RESET}`
  const sLen = ` \u25cf ${sL}    Ready \u2014 type /help to begin`.length
  out.push(boxRow(sRow, W, sLen))

  out.push(`${rgb(...BORDER)}╚${'═'.repeat(W - 2)}╝${RESET}`)

  // Powered by badge
  out.push(`  ${DIM}${rgb(...DIMCOL)}\u25cf${RESET} ${rgb(...AMBER)}DuckHive${RESET} ${DIM}${rgb(...DIMCOL)}\u00b7${RESET} ${rgb(...ORANGE)}Powered by MiniMax M2.7${RESET}`)

  // Version + model info
  out.push(`  ${DIM}${rgb(...DIMCOL)}\u25cf${RESET} ${rgb(...ORANGE)}v${MACRO.DISPLAY_VERSION ?? MACRO.VERSION}${RESET} ${DIM}${rgb(...DIMCOL)}\u00b7${RESET} DuckHive   ${DIM}${rgb(...DIMCOL)}\u00b7${RESET} ${p.model}`)

  // Config hint
  out.push(`  ${DIM}Configure: ${RESET}${rgb(...GOLD)}.duckhive/config.json${RESET} ${DIM}or run ${RESET}${rgb(...GOLD)}duckhive config init${RESET}`)

  out.push('')

  process.stdout.write(out.join('\n') + '\n')
}