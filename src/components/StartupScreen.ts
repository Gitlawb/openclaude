/**
 * Neural Network startup screen — filled-block text logo with sunset gradient.
 * Called once at CLI startup before the Ink UI renders.
 *
 * Addresses: https://github.com/Gitlawb/openclaude/issues/55
 */

import { isLocalProviderUrl, resolveProviderRequest } from '../services/api/providerConfig.js'
import { getLocalOpenAICompatibleProviderLabel } from '../utils/providerDiscovery.js'
import { getMainLoopModel } from '../utils/model/model.js'
import { getSelectedFavoriteModel } from '../utils/favorites.js'
import type { FavoriteModelPricing } from '../utils/config.js'

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

const SUNSET_GRAD: RGB[] = [
  [255, 180, 100],
  [240, 140, 80],
  [217, 119, 87],
  [193, 95, 60],
  [160, 75, 55],
  [130, 60, 50],
]

const ACCENT: RGB = [240, 148, 100]
const CREAM: RGB = [220, 195, 170]
const DIMCOL: RGB = [120, 100, 82]
const BORDER: RGB = [100, 80, 65]

// ─── Filled Block Text Logo ───────────────────────────────────────────────────

const LOGO_SKYSERVICE = [
  `  ███████╗██╗  ██╗██╗   ██╗███████╗███████╗██████╗ ██╗   ██╗██╗ ██████╗███████╗`,
  `  ██╔════╝██║ ██╔╝╚██╗ ██╔╝██╔════╝██╔════╝██╔══██╗██║   ██║██║██╔════╝██╔════╝`,
  `  ╚██████╗█████╔╝  ╚████╔╝ ╚██████╗█████╗  ██████╔╝██║   ██║██║██║     █████╗  `,
  `   ╚═══██╗██╔═██╗   ╚██╔╝   ╚═══██╗██╔══╝  ██╔══██╗╚██╗ ██╔╝██║██║     ██╔══╝  `,
  `  ██████╔╝██║  ██╗   ██║   ██████╔╝███████╗██║  ██║ ╚████╔╝ ██║╚██████╗███████╗`,
  `  ╚═════╝ ╚═╝  ╚═╝   ╚═╝   ╚═════╝ ╚══════╝╚═╝  ╚═╝  ╚═══╝  ╚═╝ ╚═════╝╚══════╝`,
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

  // Default: Anthropic — delegate to the same resolver the main loop uses so the
  // banner reflects reality (respects ANTHROPIC_MODEL, settings.model, and the
  // subscription-aware default — e.g. Opus for Max/Team Premium). Note: the
  // --model CLI flag is parsed later in main.tsx, so it won't be reflected here.
  return { name: 'Anthropic', model: getMainLoopModel(), baseUrl: 'https://api.anthropic.com', isLocal: false }
}

// ─── Pricing formatting ───────────────────────────────────────────────────────

function formatStartupPrice(value: number): string {
  return value >= 0.1 ? `$${value.toFixed(2)}` : `$${value.toFixed(4)}`
}

function formatStartupContext(tokens: number): string {
  if (!Number.isFinite(tokens) || tokens <= 0) return ''
  if (tokens >= 1_000_000) return `${Math.round(tokens / 100_000) / 10}M ctx`
  if (tokens >= 1_000) return `${Math.round(tokens / 1_000)}k ctx`
  return `${tokens} ctx`
}

function formatStartupPricingLine(p: FavoriteModelPricing): string {
  const parts: string[] = []
  const { promptPricePerMToken: prompt, completionPricePerMToken: completion } = p
  if (prompt !== null && completion !== null) {
    parts.push(
      `${formatStartupPrice(prompt)} / ${formatStartupPrice(completion)} per Mtok`,
    )
  } else if (prompt !== null) {
    parts.push(`${formatStartupPrice(prompt)} per Mtok`)
  } else if (completion !== null) {
    parts.push(`${formatStartupPrice(completion)} per Mtok`)
  }
  const ctx = formatStartupContext(p.contextLength)
  if (ctx) parts.push(ctx)
  return parts.join(' · ')
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
  const allLogo = [...LOGO_SKYSERVICE]
  const total = allLogo.length
  for (let i = 0; i < total; i++) {
    const t = total > 1 ? i / (total - 1) : 0
    if (allLogo[i] === '') {
      out.push('')
    } else {
      out.push(paintLine(allLogo[i], SUNSET_GRAD, t))
    }
  }

  out.push('')

  // Tagline
  out.push(`  ${rgb(...ACCENT)}\u2726${RESET} ${rgb(...CREAM)}Хмаркові технології нового покоління${RESET} ${rgb(...ACCENT)}\u2726${RESET}`)
  out.push('')

  // Provider info box
  out.push(`${rgb(...BORDER)}\u2554${'\u2550'.repeat(W - 2)}\u2557${RESET}`)

  // Centered version header
  const versionStr = `Neural Network v${MACRO.DISPLAY_VERSION ?? MACRO.VERSION}`
  const innerW = W - 2
  const vPad = Math.max(0, Math.floor((innerW - versionStr.length) / 2))
  const vRow = `${' '.repeat(vPad)}${DIM}${rgb(...DIMCOL)}Neural Network ${RESET}${rgb(...ACCENT)}v${MACRO.DISPLAY_VERSION ?? MACRO.VERSION}${RESET}`
  out.push(boxRow(vRow, W, vPad + versionStr.length))

  out.push(`${rgb(...BORDER)}\u2560${'\u2550'.repeat(W - 2)}\u2563${RESET}`)

  const lbl = (k: string, v: string, c: RGB = CREAM): [string, number] => {
    const padK = k.padEnd(10)
    return [` ${DIM}${rgb(...DIMCOL)}${padK}${RESET} ${rgb(...c)}${v}${RESET}`, ` ${padK} ${v}`.length]
  }

  const provC: RGB = p.isLocal ? [130, 175, 130] : ACCENT
  let [r, l] = lbl('Провайдер', p.name, provC)
  out.push(boxRow(r, W, l))
  ;[r, l] = lbl('Модель', p.model)
  out.push(boxRow(r, W, l))
  const ep = p.baseUrl.length > 38 ? p.baseUrl.slice(0, 35) + '...' : p.baseUrl
  ;[r, l] = lbl('Адреса', ep)
  out.push(boxRow(r, W, l))

  // Pricing (if cached on the selected favorite). Skipped silently for
  // providers without published per-token pricing (local models, etc).
  const pricing = getSelectedFavoriteModel()?.pricing
  if (pricing) {
    const priceLine = formatStartupPricingLine(pricing)
    if (priceLine) {
      ;[r, l] = lbl('Ціна', priceLine)
      out.push(boxRow(r, W, l))
    }
  }

  // Current working directory (truncated from the left if too long)
  const cwd = process.cwd()
  const maxDirLen = W - 14  // W - 2 (borders) - 1 (space) - 10 (label) - 1 (space)
  const dirDisplay = cwd.length > maxDirLen ? '\u2026' + cwd.slice(-(maxDirLen - 1)) : cwd
  ;[r, l] = lbl('Директорія', dirDisplay)
  out.push(boxRow(r, W, l))

  out.push(`${rgb(...BORDER)}\u2560${'\u2550'.repeat(W - 2)}\u2563${RESET}`)

  const sC: RGB = p.isLocal ? [130, 175, 130] : ACCENT
  const sL = p.isLocal ? 'локально' : 'хмара'
  const sRow = ` ${rgb(...sC)}\u25cf${RESET} ${DIM}${rgb(...DIMCOL)}${sL}${RESET}    ${DIM}${rgb(...DIMCOL)}Готово — введи ${RESET}${rgb(...ACCENT)}/help${RESET}${DIM}${rgb(...DIMCOL)} щоб почати${RESET}`
  const sLen = ` \u25cf ${sL}    Готово — введи /help щоб почати`.length
  out.push(boxRow(sRow, W, sLen))

  out.push(`${rgb(...BORDER)}\u255a${'\u2550'.repeat(W - 2)}\u255d${RESET}`)
  out.push('')

  process.stdout.write(out.join('\n') + '\n')
}
