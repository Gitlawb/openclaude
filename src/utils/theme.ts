import chalk, { Chalk } from 'chalk'
import { env } from './env.js'

export type Theme = {
  autoAccept: string
  bashBorder: string
  claude: string
  claudeShimmer: string // Lighter version of claude color for shimmer effect
  claudeBlue_FOR_SYSTEM_SPINNER: string
  claudeBlueShimmer_FOR_SYSTEM_SPINNER: string
  permission: string
  permissionShimmer: string // Lighter version of permission color for shimmer effect
  planMode: string
  ide: string
  promptBorder: string
  promptBorderShimmer: string // Lighter version of promptBorder color for shimmer effect
  text: string
  inverseText: string
  inactive: string
  inactiveShimmer: string // Lighter version of inactive color for shimmer effect
  subtle: string
  suggestion: string
  remember: string
  background: string
  // Semantic colors
  success: string
  error: string
  warning: string
  merged: string
  warningShimmer: string // Lighter version of warning color for shimmer effect
  // Diff colors
  diffAdded: string
  diffRemoved: string
  diffAddedDimmed: string
  diffRemovedDimmed: string
  // Word-level diff highlighting
  diffAddedWord: string
  diffRemovedWord: string
  // Agent colors
  red_FOR_SUBAGENTS_ONLY: string
  blue_FOR_SUBAGENTS_ONLY: string
  green_FOR_SUBAGENTS_ONLY: string
  yellow_FOR_SUBAGENTS_ONLY: string
  purple_FOR_SUBAGENTS_ONLY: string
  orange_FOR_SUBAGENTS_ONLY: string
  pink_FOR_SUBAGENTS_ONLY: string
  cyan_FOR_SUBAGENTS_ONLY: string
  // Grove colors
  professionalBlue: string
  // Chrome colors
  chromeYellow: string
  // TUI V2 colors
  clawd_body: string
  clawd_background: string
  userMessageBackground: string
  userMessageBackgroundHover: string
  /** Message-actions selection. Cool shift toward `suggestion` blue; distinct from default AND userMessageBackground. */
  messageActionsBackground: string
  /** Text-selection highlight background (alt-screen mouse selection). Solid
   *  bg that REPLACES the cell's bg while preserving its fg — matches native
   *  terminal selection. Previously SGR-7 inverse (swapped fg/bg per cell),
   *  which fragmented badly over syntax highlighting. */
  selectionBg: string
  bashMessageBackgroundColor: string

  memoryBackgroundColor: string
  rate_limit_fill: string
  rate_limit_empty: string
  fastMode: string
  fastModeShimmer: string
  // Brief/assistant mode label colors
  briefLabelYou: string
  briefLabelClaude: string
  // Rainbow colors for ultrathink keyword highlighting
  rainbow_red: string
  rainbow_orange: string
  rainbow_yellow: string
  rainbow_green: string
  rainbow_blue: string
  rainbow_indigo: string
  rainbow_violet: string
  rainbow_red_shimmer: string
  rainbow_orange_shimmer: string
  rainbow_yellow_shimmer: string
  rainbow_green_shimmer: string
  rainbow_blue_shimmer: string
  rainbow_indigo_shimmer: string
  rainbow_violet_shimmer: string
}

// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
// Atreides Theme System
// Three dark themes. One visual identity.
// Caladan Night (default) · Atreides Dawn · Imperial Ember
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

export const THEME_NAMES = [
  'caladan-night',
  'atreides-dawn',
  'imperial-ember',
] as const

/** A renderable theme. Always resolvable to a concrete color palette. */
export type ThemeName = (typeof THEME_NAMES)[number]

export const THEME_SETTINGS = ['auto', ...THEME_NAMES] as const

/**
 * A theme preference as stored in user config. `'auto'` follows the system
 * dark/light mode and is resolved to a ThemeName at runtime.
 */
export type ThemeSetting = (typeof THEME_SETTINGS)[number]

// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
// Caladan Night — Deep navy, storm blue
// The Atreides homeworld. Ocean planet. Deep water, noble restraint.
// Hue axis: 210-237 (blue). Governing principle: calm authority.
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

const caladanNight: Theme = {
  // Brand accent — storm blue
  claude: 'rgb(30, 170, 215)',
  claudeShimmer: 'rgb(70, 200, 240)',
  claudeBlue_FOR_SYSTEM_SPINNER: 'rgb(100, 170, 220)',
  claudeBlueShimmer_FOR_SYSTEM_SPINNER: 'rgb(130, 195, 240)',

  // Permissions & suggestions — lighter blue
  permission: 'rgb(100, 170, 220)',
  permissionShimmer: 'rgb(130, 195, 240)',
  suggestion: 'rgb(100, 170, 220)',
  remember: 'rgb(110, 180, 230)',

  // Text — tinted white, not pure white
  text: 'rgb(205, 220, 235)',
  inverseText: 'rgb(8, 15, 25)',

  // Grays with blue tint
  inactive: 'rgb(100, 120, 140)',
  inactiveShimmer: 'rgb(140, 160, 180)',
  subtle: 'rgb(40, 55, 70)',

  // Chrome — steel blue borders
  promptBorder: 'rgb(55, 90, 120)',
  promptBorderShimmer: 'rgb(75, 115, 145)',
  bashBorder: 'rgb(40, 140, 170)',

  // Modes
  planMode: 'rgb(60, 140, 140)',
  ide: 'rgb(90, 150, 210)',
  autoAccept: 'rgb(175, 135, 255)',
  merged: 'rgb(175, 135, 255)',
  background: 'rgb(30, 170, 215)',

  // Semantic — red stays red
  success: 'rgb(78, 186, 140)',
  error: 'rgb(255, 107, 128)',
  warning: 'rgb(255, 193, 107)',
  warningShimmer: 'rgb(255, 215, 150)',

  // Diff — teal-shifted additions, standard red removals
  diffAdded: 'rgb(25, 100, 75)',
  diffRemoved: 'rgb(130, 40, 55)',
  diffAddedDimmed: 'rgb(18, 60, 48)',
  diffRemovedDimmed: 'rgb(80, 30, 40)',
  diffAddedWord: 'rgb(40, 175, 120)',
  diffRemovedWord: 'rgb(195, 75, 95)',

  // Agent colors — vibrant for subagent identification
  red_FOR_SUBAGENTS_ONLY: 'rgb(220, 38, 38)',
  blue_FOR_SUBAGENTS_ONLY: 'rgb(37, 99, 235)',
  green_FOR_SUBAGENTS_ONLY: 'rgb(22, 163, 74)',
  yellow_FOR_SUBAGENTS_ONLY: 'rgb(202, 138, 4)',
  purple_FOR_SUBAGENTS_ONLY: 'rgb(147, 51, 234)',
  orange_FOR_SUBAGENTS_ONLY: 'rgb(234, 88, 12)',
  pink_FOR_SUBAGENTS_ONLY: 'rgb(219, 39, 119)',
  cyan_FOR_SUBAGENTS_ONLY: 'rgb(8, 145, 178)',

  // Professional & chrome
  professionalBlue: 'rgb(100, 160, 215)',
  chromeYellow: 'rgb(251, 188, 4)',

  // TUI V2 — surfaces with navy undertones
  clawd_body: 'rgb(30, 160, 200)',
  clawd_background: 'rgb(5, 10, 20)',
  userMessageBackground: 'rgb(15, 25, 40)',
  userMessageBackgroundHover: 'rgb(22, 35, 55)',
  messageActionsBackground: 'rgb(12, 22, 38)',
  selectionBg: 'rgb(30, 60, 100)',
  bashMessageBackgroundColor: 'rgb(12, 20, 35)',
  memoryBackgroundColor: 'rgb(15, 28, 45)',

  // Rate limit — brand blue
  rate_limit_fill: 'rgb(100, 170, 220)',
  rate_limit_empty: 'rgb(30, 50, 80)',

  // Fast mode — bright teal
  fastMode: 'rgb(30, 180, 200)',
  fastModeShimmer: 'rgb(60, 200, 220)',

  // Labels
  briefLabelYou: 'rgb(100, 170, 220)',
  briefLabelClaude: 'rgb(30, 170, 215)',

  // Rainbow — blue-shifted spectrum for ultrathink highlighting
  rainbow_red: 'rgb(204, 70, 80)',
  rainbow_orange: 'rgb(210, 110, 50)',
  rainbow_yellow: 'rgb(200, 170, 50)',
  rainbow_green: 'rgb(50, 170, 110)',
  rainbow_blue: 'rgb(60, 140, 210)',
  rainbow_indigo: 'rgb(90, 100, 190)',
  rainbow_violet: 'rgb(140, 90, 180)',
  rainbow_red_shimmer: 'rgb(230, 120, 130)',
  rainbow_orange_shimmer: 'rgb(235, 155, 100)',
  rainbow_yellow_shimmer: 'rgb(230, 205, 100)',
  rainbow_green_shimmer: 'rgb(100, 210, 155)',
  rainbow_blue_shimmer: 'rgb(110, 180, 240)',
  rainbow_indigo_shimmer: 'rgb(140, 150, 220)',
  rainbow_violet_shimmer: 'rgb(190, 140, 215)',
}

// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
// Atreides Dawn — Warm amber, gold
// The sunrise over Caladan. Warmth after the storm.
// Hue axis: 63-78 (warm). Governing principle: generous warmth.
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

const atreidesDawn: Theme = {
  // Brand accent — warm gold
  claude: 'rgb(210, 140, 40)',
  claudeShimmer: 'rgb(235, 175, 75)',
  claudeBlue_FOR_SYSTEM_SPINNER: 'rgb(90, 150, 210)',
  claudeBlueShimmer_FOR_SYSTEM_SPINNER: 'rgb(120, 175, 230)',

  // Permissions & suggestions — amber with cool contrast
  permission: 'rgb(200, 155, 60)',
  permissionShimmer: 'rgb(225, 185, 95)',
  suggestion: 'rgb(200, 155, 60)',
  remember: 'rgb(210, 165, 70)',

  // Text — warm white
  text: 'rgb(235, 220, 200)',
  inverseText: 'rgb(12, 10, 5)',

  // Grays with warm tint
  inactive: 'rgb(130, 115, 95)',
  inactiveShimmer: 'rgb(165, 150, 130)',
  subtle: 'rgb(50, 42, 30)',

  // Chrome — amber borders
  promptBorder: 'rgb(90, 65, 25)',
  promptBorderShimmer: 'rgb(120, 90, 40)',
  bashBorder: 'rgb(160, 100, 30)',

  // Modes
  planMode: 'rgb(130, 110, 60)',
  ide: 'rgb(160, 130, 70)',
  autoAccept: 'rgb(175, 135, 255)',
  merged: 'rgb(175, 135, 255)',
  background: 'rgb(210, 140, 40)',

  // Semantic
  success: 'rgb(78, 186, 140)',
  error: 'rgb(255, 107, 128)',
  warning: 'rgb(255, 193, 107)',
  warningShimmer: 'rgb(255, 215, 150)',

  // Diff — warm-shifted additions, standard red removals
  diffAdded: 'rgb(60, 100, 40)',
  diffRemoved: 'rgb(130, 40, 55)',
  diffAddedDimmed: 'rgb(38, 60, 28)',
  diffRemovedDimmed: 'rgb(80, 30, 40)',
  diffAddedWord: 'rgb(90, 175, 60)',
  diffRemovedWord: 'rgb(195, 75, 95)',

  // Agent colors
  red_FOR_SUBAGENTS_ONLY: 'rgb(220, 38, 38)',
  blue_FOR_SUBAGENTS_ONLY: 'rgb(37, 99, 235)',
  green_FOR_SUBAGENTS_ONLY: 'rgb(22, 163, 74)',
  yellow_FOR_SUBAGENTS_ONLY: 'rgb(202, 138, 4)',
  purple_FOR_SUBAGENTS_ONLY: 'rgb(147, 51, 234)',
  orange_FOR_SUBAGENTS_ONLY: 'rgb(234, 88, 12)',
  pink_FOR_SUBAGENTS_ONLY: 'rgb(219, 39, 119)',
  cyan_FOR_SUBAGENTS_ONLY: 'rgb(8, 145, 178)',

  // Professional & chrome
  professionalBlue: 'rgb(100, 140, 200)',
  chromeYellow: 'rgb(251, 188, 4)',

  // TUI V2 — surfaces with warm undertones
  clawd_body: 'rgb(200, 135, 40)',
  clawd_background: 'rgb(8, 6, 2)',
  userMessageBackground: 'rgb(28, 22, 12)',
  userMessageBackgroundHover: 'rgb(40, 32, 18)',
  messageActionsBackground: 'rgb(24, 18, 10)',
  selectionBg: 'rgb(65, 50, 18)',
  bashMessageBackgroundColor: 'rgb(22, 18, 10)',
  memoryBackgroundColor: 'rgb(30, 24, 14)',

  // Rate limit
  rate_limit_fill: 'rgb(200, 155, 60)',
  rate_limit_empty: 'rgb(55, 40, 15)',

  // Fast mode — bright amber
  fastMode: 'rgb(220, 150, 30)',
  fastModeShimmer: 'rgb(240, 180, 60)',

  // Labels — cool blue for "you" to contrast warm theme
  briefLabelYou: 'rgb(100, 155, 215)',
  briefLabelClaude: 'rgb(210, 140, 40)',

  // Rainbow — warm-shifted spectrum
  rainbow_red: 'rgb(204, 70, 80)',
  rainbow_orange: 'rgb(210, 120, 40)',
  rainbow_yellow: 'rgb(215, 175, 30)',
  rainbow_green: 'rgb(80, 170, 60)',
  rainbow_blue: 'rgb(70, 130, 200)',
  rainbow_indigo: 'rgb(100, 90, 180)',
  rainbow_violet: 'rgb(150, 80, 160)',
  rainbow_red_shimmer: 'rgb(230, 120, 130)',
  rainbow_orange_shimmer: 'rgb(235, 165, 90)',
  rainbow_yellow_shimmer: 'rgb(240, 210, 90)',
  rainbow_green_shimmer: 'rgb(130, 210, 110)',
  rainbow_blue_shimmer: 'rgb(120, 170, 235)',
  rainbow_indigo_shimmer: 'rgb(150, 140, 215)',
  rainbow_violet_shimmer: 'rgb(195, 130, 200)',
}

// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
// Imperial Ember — Deep red, copper
// The throne room at night. Firelight on stone. Weight and warmth.
// Hue axis: 18-48 (red-orange). Governing principle: contained intensity.
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

const imperialEmber: Theme = {
  // Brand accent — copper/ember
  claude: 'rgb(220, 90, 40)',
  claudeShimmer: 'rgb(245, 130, 75)',
  claudeBlue_FOR_SYSTEM_SPINNER: 'rgb(100, 150, 210)',
  claudeBlueShimmer_FOR_SYSTEM_SPINNER: 'rgb(130, 175, 230)',

  // Permissions & suggestions — warm copper-gold
  permission: 'rgb(195, 130, 70)',
  permissionShimmer: 'rgb(220, 160, 100)',
  suggestion: 'rgb(195, 130, 70)',
  remember: 'rgb(205, 140, 80)',

  // Text — warm white
  text: 'rgb(238, 218, 210)',
  inverseText: 'rgb(10, 5, 3)',

  // Grays with warm tint
  inactive: 'rgb(130, 110, 105)',
  inactiveShimmer: 'rgb(168, 148, 140)',
  subtle: 'rgb(50, 35, 30)',

  // Chrome — dark copper borders
  promptBorder: 'rgb(85, 40, 25)',
  promptBorderShimmer: 'rgb(115, 60, 38)',
  bashBorder: 'rgb(155, 55, 35)',

  // Modes
  planMode: 'rgb(120, 80, 55)',
  ide: 'rgb(150, 100, 65)',
  autoAccept: 'rgb(175, 135, 255)',
  merged: 'rgb(175, 135, 255)',
  background: 'rgb(220, 90, 40)',

  // Semantic — red is warmer here
  success: 'rgb(78, 186, 140)',
  error: 'rgb(255, 85, 100)',
  warning: 'rgb(255, 193, 107)',
  warningShimmer: 'rgb(255, 215, 150)',

  // Diff — red-shifted additions, deeper red removals
  diffAdded: 'rgb(45, 95, 55)',
  diffRemoved: 'rgb(120, 30, 30)',
  diffAddedDimmed: 'rgb(28, 58, 35)',
  diffRemovedDimmed: 'rgb(75, 22, 22)',
  diffAddedWord: 'rgb(70, 175, 90)',
  diffRemovedWord: 'rgb(200, 60, 60)',

  // Agent colors
  red_FOR_SUBAGENTS_ONLY: 'rgb(220, 38, 38)',
  blue_FOR_SUBAGENTS_ONLY: 'rgb(37, 99, 235)',
  green_FOR_SUBAGENTS_ONLY: 'rgb(22, 163, 74)',
  yellow_FOR_SUBAGENTS_ONLY: 'rgb(202, 138, 4)',
  purple_FOR_SUBAGENTS_ONLY: 'rgb(147, 51, 234)',
  orange_FOR_SUBAGENTS_ONLY: 'rgb(234, 88, 12)',
  pink_FOR_SUBAGENTS_ONLY: 'rgb(219, 39, 119)',
  cyan_FOR_SUBAGENTS_ONLY: 'rgb(8, 145, 178)',

  // Professional & chrome
  professionalBlue: 'rgb(100, 140, 200)',
  chromeYellow: 'rgb(251, 188, 4)',

  // TUI V2 — surfaces with warm dark undertones
  clawd_body: 'rgb(210, 85, 40)',
  clawd_background: 'rgb(5, 2, 1)',
  userMessageBackground: 'rgb(25, 14, 10)',
  userMessageBackgroundHover: 'rgb(38, 22, 16)',
  messageActionsBackground: 'rgb(20, 12, 8)',
  selectionBg: 'rgb(60, 28, 18)',
  bashMessageBackgroundColor: 'rgb(20, 12, 10)',
  memoryBackgroundColor: 'rgb(28, 16, 12)',

  // Rate limit
  rate_limit_fill: 'rgb(195, 130, 70)',
  rate_limit_empty: 'rgb(50, 28, 18)',

  // Fast mode — bright copper
  fastMode: 'rgb(230, 100, 35)',
  fastModeShimmer: 'rgb(245, 135, 65)',

  // Labels — cool blue for "you" to contrast warm theme
  briefLabelYou: 'rgb(100, 155, 215)',
  briefLabelClaude: 'rgb(220, 90, 40)',

  // Rainbow — warm-shifted spectrum with red emphasis
  rainbow_red: 'rgb(210, 50, 50)',
  rainbow_orange: 'rgb(220, 100, 30)',
  rainbow_yellow: 'rgb(210, 165, 25)',
  rainbow_green: 'rgb(65, 160, 55)',
  rainbow_blue: 'rgb(65, 120, 195)',
  rainbow_indigo: 'rgb(95, 80, 170)',
  rainbow_violet: 'rgb(145, 70, 150)',
  rainbow_red_shimmer: 'rgb(240, 110, 110)',
  rainbow_orange_shimmer: 'rgb(245, 150, 85)',
  rainbow_yellow_shimmer: 'rgb(240, 200, 85)',
  rainbow_green_shimmer: 'rgb(115, 205, 110)',
  rainbow_blue_shimmer: 'rgb(115, 165, 230)',
  rainbow_indigo_shimmer: 'rgb(145, 135, 210)',
  rainbow_violet_shimmer: 'rgb(195, 125, 195)',
}

export function getTheme(themeName: ThemeName): Theme {
  switch (themeName) {
    case 'atreides-dawn':
      return atreidesDawn
    case 'imperial-ember':
      return imperialEmber
    default:
      return caladanNight
  }
}

// Create a chalk instance with 256-color level for Apple Terminal
// Apple Terminal doesn't handle 24-bit color escape sequences well
const chalkForChart =
  env.terminal === 'Apple_Terminal'
    ? new Chalk({ level: 2 }) // 256 colors
    : chalk

/**
 * Converts a theme color to an ANSI escape sequence for use with asciichart.
 * Uses chalk to generate the escape codes, with 256-color mode for Apple Terminal.
 */
export function themeColorToAnsi(themeColor: string): string {
  const rgbMatch = themeColor.match(/rgb\(\s?(\d+),\s?(\d+),\s?(\d+)\s?\)/)
  if (rgbMatch) {
    const r = parseInt(rgbMatch[1]!, 10)
    const g = parseInt(rgbMatch[2]!, 10)
    const b = parseInt(rgbMatch[3]!, 10)
    // Use chalk.rgb which auto-converts to 256 colors when level is 2
    // Extract just the opening escape sequence by using a marker
    const colored = chalkForChart.rgb(r, g, b)('X')
    return colored.slice(0, colored.indexOf('X'))
  }
  // Fallback to magenta if parsing fails
  return '\x1b[35m'
}
