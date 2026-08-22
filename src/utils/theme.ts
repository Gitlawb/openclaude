import chalk, { Chalk } from 'chalk'
import { env } from './env.js'

export type Theme = {
  autoAccept: string
  bashBorder: string
  claude: string
  claudeShimmer: string // Lighter version of claude color for shimmer effect
  // OpenClaude brand accent (gitlawb orange). Values MUST be rgb() strings in
  // truecolor themes — spinner shimmer/stall interpolation parses them with
  // parseRGB, which silently fails on hex.
  brand: string
  brandShimmer: string // Lighter version of brand color for shimmer effect
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
  // Ultracode mode colors (blue/cyan code-oriented visual)
  ultracode: string
  ultracodeShimmer: string
}

export const THEME_NAMES = [
  'dark',
  'light',
  'light-daltonized',
  'dark-daltonized',
  'light-ansi',
  'dark-ansi',
  'dark-nord',
  'light-nord',
  'dark-nord-ansi',
] as const

/** A renderable theme. Always resolvable to a concrete color palette. */
export type ThemeName = (typeof THEME_NAMES)[number]

export const THEME_SETTINGS = ['auto', ...THEME_NAMES] as const

/**
 * A theme preference as stored in user config. `'auto'` follows the system
 * dark/light mode and is resolved to a ThemeName at runtime.
 */
export type ThemeSetting = (typeof THEME_SETTINGS)[number]

/**
 * Light theme using explicit RGB values to avoid inconsistencies
 * from users' custom terminal ANSI color definitions
 */
const lightTheme: Theme = {
  autoAccept: 'rgb(135,0,255)', // Electric violet
  bashBorder: 'rgb(255,0,135)', // Vibrant pink
  claude: 'rgb(209,87,0)', // Brand orange darkened for contrast on white
  claudeShimmer: 'rgb(255,122,26)', // Full brand orange as the shimmer highlight
  brand: 'rgb(209,87,0)', // Brand orange darkened for contrast on white
  brandShimmer: 'rgb(255,122,26)', // Full brand orange as the shimmer highlight
  claudeBlue_FOR_SYSTEM_SPINNER: 'rgb(87,105,247)', // Medium blue for system spinner
  claudeBlueShimmer_FOR_SYSTEM_SPINNER: 'rgb(117,135,255)', // Lighter blue for system spinner shimmer
  permission: 'rgb(87,105,247)', // Medium blue
  permissionShimmer: 'rgb(137,155,255)', // Lighter blue for shimmer effect
  planMode: 'rgb(0,102,102)', // Muted teal
  ide: 'rgb(71,130,200)', // Muted blue
  promptBorder: 'rgb(153,153,153)', // Medium gray
  promptBorderShimmer: 'rgb(183,183,183)', // Lighter gray for shimmer effect
  text: 'rgb(0,0,0)', // Black
  inverseText: 'rgb(255,255,255)', // White
  inactive: 'rgb(102,102,102)', // Dark gray
  inactiveShimmer: 'rgb(142,142,142)', // Lighter gray for shimmer effect
  subtle: 'rgb(175,175,175)', // Light gray
  suggestion: 'rgb(87,105,247)', // Medium blue
  remember: 'rgb(0,0,255)', // Blue
  background: 'rgb(0,153,153)', // Cyan
  success: 'rgb(44,122,57)', // Green
  error: 'rgb(171,43,63)', // Red
  warning: 'rgb(150,108,30)', // Amber
  merged: 'rgb(135,0,255)', // Electric violet (matches autoAccept)
  warningShimmer: 'rgb(200,158,80)', // Lighter amber for shimmer effect
  diffAdded: 'rgb(105,219,124)', // Light green
  diffRemoved: 'rgb(255,168,180)', // Light red
  diffAddedDimmed: 'rgb(199,225,203)', // Very light green
  diffRemovedDimmed: 'rgb(253,210,216)', // Very light red
  diffAddedWord: 'rgb(47,157,68)', // Medium green
  diffRemovedWord: 'rgb(209,69,75)', // Medium red
  // Agent colors
  red_FOR_SUBAGENTS_ONLY: 'rgb(220,38,38)', // Red 600
  blue_FOR_SUBAGENTS_ONLY: 'rgb(37,99,235)', // Blue 600
  green_FOR_SUBAGENTS_ONLY: 'rgb(22,163,74)', // Green 600
  yellow_FOR_SUBAGENTS_ONLY: 'rgb(202,138,4)', // Yellow 600
  purple_FOR_SUBAGENTS_ONLY: 'rgb(147,51,234)', // Purple 600
  orange_FOR_SUBAGENTS_ONLY: 'rgb(234,88,12)', // Orange 600
  pink_FOR_SUBAGENTS_ONLY: 'rgb(219,39,119)', // Pink 600
  cyan_FOR_SUBAGENTS_ONLY: 'rgb(8,145,178)', // Cyan 600
  // Grove colors
  professionalBlue: 'rgb(106,155,204)',
  // Chrome colors
  chromeYellow: 'rgb(251,188,4)', // Chrome yellow
  // TUI V2 colors
  clawd_body: 'rgb(209,87,0)', // Brand orange (light variant)
  clawd_background: 'rgb(0,0,0)',
  userMessageBackground: 'rgb(240, 240, 240)', // Slightly darker grey for optimal contrast
  userMessageBackgroundHover: 'rgb(252, 252, 252)', // ≥250 to quantize distinct from base at 256-color level
  messageActionsBackground: 'rgb(232, 236, 244)', // cool gray — darker than userMsg 240 (visible on white), slight blue toward `suggestion`
  selectionBg: 'rgb(180, 213, 255)', // classic light-mode selection blue (macOS/VS Code-ish); dark fgs stay readable
  bashMessageBackgroundColor: 'rgb(250, 245, 250)',

  memoryBackgroundColor: 'rgb(230, 245, 250)',
  rate_limit_fill: 'rgb(87,105,247)', // Medium blue
  rate_limit_empty: 'rgb(39,47,111)', // Dark blue
  fastMode: 'rgb(255,106,0)', // Electric orange
  fastModeShimmer: 'rgb(255,150,50)', // Lighter orange for shimmer
  // Brief/assistant mode
  briefLabelYou: 'rgb(37,99,235)', // Blue
  briefLabelClaude: 'rgb(209,87,0)', // Brand orange (light variant, matches claude)
  rainbow_red: 'rgb(235,95,87)',
  rainbow_orange: 'rgb(245,139,87)',
  rainbow_yellow: 'rgb(250,195,95)',
  rainbow_green: 'rgb(145,200,130)',
  rainbow_blue: 'rgb(130,170,220)',
  rainbow_indigo: 'rgb(155,130,200)',
  rainbow_violet: 'rgb(200,130,180)',
  rainbow_red_shimmer: 'rgb(250,155,147)',
  rainbow_orange_shimmer: 'rgb(255,185,137)',
  rainbow_yellow_shimmer: 'rgb(255,225,155)',
  rainbow_green_shimmer: 'rgb(185,230,180)',
  rainbow_blue_shimmer: 'rgb(180,205,240)',
  rainbow_indigo_shimmer: 'rgb(195,180,230)',
  rainbow_violet_shimmer: 'rgb(230,180,210)',
  ultracode: 'rgb(0,180,216)', // Cyan-blue for ultracode mode
  ultracodeShimmer: 'rgb(77,215,255)', // Brighter cyan-blue shimmer
}

/**
 * Light ANSI theme using only the 16 standard ANSI colors
 * for terminals without true color support
 */
const lightAnsiTheme: Theme = {
  autoAccept: 'ansi:magenta',
  bashBorder: 'ansi:magenta',
  claude: 'ansi:redBright',
  claudeShimmer: 'ansi:yellowBright',
  brand: 'ansi:redBright', // No orange in the 16-color palette; nearest warm hue
  brandShimmer: 'ansi:yellowBright',
  claudeBlue_FOR_SYSTEM_SPINNER: 'ansi:blue',
  claudeBlueShimmer_FOR_SYSTEM_SPINNER: 'ansi:blueBright',
  permission: 'ansi:blue',
  permissionShimmer: 'ansi:blueBright',
  planMode: 'ansi:cyan',
  ide: 'ansi:blueBright',
  promptBorder: 'ansi:white',
  promptBorderShimmer: 'ansi:whiteBright',
  text: 'ansi:black',
  inverseText: 'ansi:white',
  inactive: 'ansi:blackBright',
  inactiveShimmer: 'ansi:white',
  subtle: 'ansi:blackBright',
  suggestion: 'ansi:blue',
  remember: 'ansi:blue',
  background: 'ansi:cyan',
  success: 'ansi:green',
  error: 'ansi:red',
  warning: 'ansi:yellow',
  merged: 'ansi:magenta',
  warningShimmer: 'ansi:yellowBright',
  diffAdded: 'ansi:green',
  diffRemoved: 'ansi:red',
  diffAddedDimmed: 'ansi:green',
  diffRemovedDimmed: 'ansi:red',
  diffAddedWord: 'ansi:greenBright',
  diffRemovedWord: 'ansi:redBright',
  // Agent colors
  red_FOR_SUBAGENTS_ONLY: 'ansi:red',
  blue_FOR_SUBAGENTS_ONLY: 'ansi:blue',
  green_FOR_SUBAGENTS_ONLY: 'ansi:green',
  yellow_FOR_SUBAGENTS_ONLY: 'ansi:yellow',
  purple_FOR_SUBAGENTS_ONLY: 'ansi:magenta',
  orange_FOR_SUBAGENTS_ONLY: 'ansi:redBright',
  pink_FOR_SUBAGENTS_ONLY: 'ansi:magentaBright',
  cyan_FOR_SUBAGENTS_ONLY: 'ansi:cyan',
  // Grove colors
  professionalBlue: 'ansi:blueBright',
  // Chrome colors
  chromeYellow: 'ansi:yellow', // Chrome yellow
  // TUI V2 colors
  clawd_body: 'ansi:redBright',
  clawd_background: 'ansi:black',
  userMessageBackground: 'ansi:white',
  userMessageBackgroundHover: 'ansi:whiteBright',
  messageActionsBackground: 'ansi:white',
  selectionBg: 'ansi:cyan', // lighter named bg for light-ansi; dark fgs stay readable
  bashMessageBackgroundColor: 'ansi:whiteBright',

  memoryBackgroundColor: 'ansi:white',
  rate_limit_fill: 'ansi:yellow',
  rate_limit_empty: 'ansi:black',
  fastMode: 'ansi:red',
  fastModeShimmer: 'ansi:redBright',
  briefLabelYou: 'ansi:blue',
  briefLabelClaude: 'ansi:redBright',
  rainbow_red: 'ansi:red',
  rainbow_orange: 'ansi:redBright',
  rainbow_yellow: 'ansi:yellow',
  rainbow_green: 'ansi:green',
  rainbow_blue: 'ansi:cyan',
  rainbow_indigo: 'ansi:blue',
  rainbow_violet: 'ansi:magenta',
  rainbow_red_shimmer: 'ansi:redBright',
  rainbow_orange_shimmer: 'ansi:yellow',
  rainbow_yellow_shimmer: 'ansi:yellowBright',
  rainbow_green_shimmer: 'ansi:greenBright',
  rainbow_blue_shimmer: 'ansi:cyanBright',
  rainbow_indigo_shimmer: 'ansi:blueBright',
  rainbow_violet_shimmer: 'ansi:magentaBright',
  ultracode: 'ansi:cyanBright',
  ultracodeShimmer: 'ansi:cyanBright',
}

/**
 * Dark ANSI theme using only the 16 standard ANSI colors
 * for terminals without true color support
 */
const darkAnsiTheme: Theme = {
  autoAccept: 'ansi:magentaBright',
  bashBorder: 'ansi:magentaBright',
  claude: 'ansi:redBright',
  claudeShimmer: 'ansi:yellowBright',
  brand: 'ansi:redBright', // No orange in the 16-color palette; nearest warm hue
  brandShimmer: 'ansi:yellowBright',
  claudeBlue_FOR_SYSTEM_SPINNER: 'ansi:blueBright',
  claudeBlueShimmer_FOR_SYSTEM_SPINNER: 'ansi:blueBright',
  permission: 'ansi:blueBright',
  permissionShimmer: 'ansi:blueBright',
  planMode: 'ansi:cyanBright',
  ide: 'ansi:blue',
  promptBorder: 'ansi:white',
  promptBorderShimmer: 'ansi:whiteBright',
  text: 'ansi:whiteBright',
  inverseText: 'ansi:black',
  inactive: 'ansi:white',
  inactiveShimmer: 'ansi:whiteBright',
  subtle: 'ansi:white',
  suggestion: 'ansi:blueBright',
  remember: 'ansi:blueBright',
  background: 'ansi:cyanBright',
  success: 'ansi:greenBright',
  error: 'ansi:redBright',
  warning: 'ansi:yellowBright',
  merged: 'ansi:magentaBright',
  warningShimmer: 'ansi:yellowBright',
  diffAdded: 'ansi:green',
  diffRemoved: 'ansi:red',
  diffAddedDimmed: 'ansi:green',
  diffRemovedDimmed: 'ansi:red',
  diffAddedWord: 'ansi:greenBright',
  diffRemovedWord: 'ansi:redBright',
  // Agent colors
  red_FOR_SUBAGENTS_ONLY: 'ansi:redBright',
  blue_FOR_SUBAGENTS_ONLY: 'ansi:blueBright',
  green_FOR_SUBAGENTS_ONLY: 'ansi:greenBright',
  yellow_FOR_SUBAGENTS_ONLY: 'ansi:yellowBright',
  purple_FOR_SUBAGENTS_ONLY: 'ansi:magentaBright',
  orange_FOR_SUBAGENTS_ONLY: 'ansi:redBright',
  pink_FOR_SUBAGENTS_ONLY: 'ansi:magentaBright',
  cyan_FOR_SUBAGENTS_ONLY: 'ansi:cyanBright',
  // Grove colors
  professionalBlue: 'rgb(106,155,204)',
  // Chrome colors
  chromeYellow: 'ansi:yellowBright', // Chrome yellow
  // TUI V2 colors
  clawd_body: 'ansi:redBright',
  clawd_background: 'ansi:black',
  userMessageBackground: 'ansi:blackBright',
  userMessageBackgroundHover: 'ansi:white',
  messageActionsBackground: 'ansi:blackBright',
  selectionBg: 'ansi:blue', // darker named bg for dark-ansi; bright fgs stay readable
  bashMessageBackgroundColor: 'ansi:black',

  memoryBackgroundColor: 'ansi:blackBright',
  rate_limit_fill: 'ansi:yellow',
  rate_limit_empty: 'ansi:white',
  fastMode: 'ansi:redBright',
  fastModeShimmer: 'ansi:redBright',
  briefLabelYou: 'ansi:blueBright',
  briefLabelClaude: 'ansi:redBright',
  rainbow_red: 'ansi:red',
  rainbow_orange: 'ansi:redBright',
  rainbow_yellow: 'ansi:yellow',
  rainbow_green: 'ansi:green',
  rainbow_blue: 'ansi:cyan',
  rainbow_indigo: 'ansi:blue',
  rainbow_violet: 'ansi:magenta',
  rainbow_red_shimmer: 'ansi:redBright',
  rainbow_orange_shimmer: 'ansi:yellow',
  rainbow_yellow_shimmer: 'ansi:yellowBright',
  rainbow_green_shimmer: 'ansi:greenBright',
  rainbow_blue_shimmer: 'ansi:cyanBright',
  rainbow_indigo_shimmer: 'ansi:blueBright',
  rainbow_violet_shimmer: 'ansi:magentaBright',
  ultracode: 'ansi:cyanBright',
  ultracodeShimmer: 'ansi:cyanBright',
}

/**
 * Light daltonized theme (color-blind friendly) using explicit RGB values
 * to avoid inconsistencies from users' custom terminal ANSI color definitions
 */
const lightDaltonizedTheme: Theme = {
  autoAccept: 'rgb(135,0,255)', // Electric violet
  bashBorder: 'rgb(0,102,204)', // Blue instead of pink
  claude: 'rgb(200,100,0)', // Brand orange darkened for white bg, luminance-separated from warning
  claudeShimmer: 'rgb(255,150,40)', // Lighter brand orange for shimmer effect
  brand: 'rgb(200,100,0)', // Brand orange darkened for white bg, luminance-separated from warning
  brandShimmer: 'rgb(255,150,40)', // Lighter brand orange for shimmer effect
  claudeBlue_FOR_SYSTEM_SPINNER: 'rgb(51,102,255)', // Bright blue for system spinner
  claudeBlueShimmer_FOR_SYSTEM_SPINNER: 'rgb(101,152,255)', // Lighter bright blue for system spinner shimmer
  permission: 'rgb(51,102,255)', // Bright blue
  permissionShimmer: 'rgb(101,152,255)', // Lighter bright blue for shimmer
  planMode: 'rgb(51,102,102)', // Muted blue-gray (works for color-blind)
  ide: 'rgb(71,130,200)', // Muted blue
  promptBorder: 'rgb(153,153,153)', // Medium gray
  promptBorderShimmer: 'rgb(183,183,183)', // Lighter gray for shimmer
  text: 'rgb(0,0,0)', // Black
  inverseText: 'rgb(255,255,255)', // White
  inactive: 'rgb(102,102,102)', // Dark gray
  inactiveShimmer: 'rgb(142,142,142)', // Lighter gray for shimmer effect
  subtle: 'rgb(175,175,175)', // Light gray
  suggestion: 'rgb(51,102,255)', // Bright blue
  remember: 'rgb(51,102,255)', // Bright blue
  background: 'rgb(0,153,153)', // Cyan (color-blind friendly)
  success: 'rgb(0,102,153)', // Blue instead of green for deuteranopia
  error: 'rgb(204,0,0)', // Pure red for better distinction
  warning: 'rgb(255,153,0)', // Orange adjusted for deuteranopia
  merged: 'rgb(135,0,255)', // Electric violet (matches autoAccept)
  warningShimmer: 'rgb(255,183,50)', // Lighter orange for shimmer
  diffAdded: 'rgb(153,204,255)', // Light blue instead of green
  diffRemoved: 'rgb(255,204,204)', // Light red
  diffAddedDimmed: 'rgb(209,231,253)', // Very light blue
  diffRemovedDimmed: 'rgb(255,233,233)', // Very light red
  diffAddedWord: 'rgb(51,102,204)', // Medium blue (less intense than deep blue)
  diffRemovedWord: 'rgb(153,51,51)', // Softer red (less intense than deep red)
  // Agent colors (daltonism-friendly)
  red_FOR_SUBAGENTS_ONLY: 'rgb(204,0,0)', // Pure red
  blue_FOR_SUBAGENTS_ONLY: 'rgb(0,102,204)', // Pure blue
  green_FOR_SUBAGENTS_ONLY: 'rgb(0,204,0)', // Pure green
  yellow_FOR_SUBAGENTS_ONLY: 'rgb(255,204,0)', // Golden yellow
  purple_FOR_SUBAGENTS_ONLY: 'rgb(128,0,128)', // True purple
  orange_FOR_SUBAGENTS_ONLY: 'rgb(255,128,0)', // True orange
  pink_FOR_SUBAGENTS_ONLY: 'rgb(255,102,178)', // Adjusted pink
  cyan_FOR_SUBAGENTS_ONLY: 'rgb(0,178,178)', // Adjusted cyan
  // Grove colors
  professionalBlue: 'rgb(106,155,204)',
  // Chrome colors
  chromeYellow: 'rgb(251,188,4)', // Chrome yellow
  // TUI V2 colors
  clawd_body: 'rgb(200,100,0)', // Brand orange (light daltonized variant)
  clawd_background: 'rgb(0,0,0)',
  userMessageBackground: 'rgb(220, 220, 220)', // Slightly darker grey for optimal contrast
  userMessageBackgroundHover: 'rgb(232, 232, 232)', // ≥230 to quantize distinct from base at 256-color level
  messageActionsBackground: 'rgb(210, 216, 226)', // cool gray — darker than userMsg 220, slight blue
  selectionBg: 'rgb(180, 213, 255)', // light selection blue; daltonized fgs are yellows/blues, both readable on light blue
  bashMessageBackgroundColor: 'rgb(250, 245, 250)',

  memoryBackgroundColor: 'rgb(230, 245, 250)',
  rate_limit_fill: 'rgb(51,102,255)', // Bright blue
  rate_limit_empty: 'rgb(23,46,114)', // Dark blue
  fastMode: 'rgb(255,106,0)', // Electric orange (color-blind safe)
  fastModeShimmer: 'rgb(255,150,50)', // Lighter orange for shimmer
  briefLabelYou: 'rgb(37,99,235)', // Blue
  briefLabelClaude: 'rgb(200,100,0)', // Brand orange adjusted for deuteranopia (matches claude)
  rainbow_red: 'rgb(235,95,87)',
  rainbow_orange: 'rgb(245,139,87)',
  rainbow_yellow: 'rgb(250,195,95)',
  rainbow_green: 'rgb(145,200,130)',
  rainbow_blue: 'rgb(130,170,220)',
  rainbow_indigo: 'rgb(155,130,200)',
  rainbow_violet: 'rgb(200,130,180)',
  rainbow_red_shimmer: 'rgb(250,155,147)',
  rainbow_orange_shimmer: 'rgb(255,185,137)',
  rainbow_yellow_shimmer: 'rgb(255,225,155)',
  rainbow_green_shimmer: 'rgb(185,230,180)',
  rainbow_blue_shimmer: 'rgb(180,205,240)',
  rainbow_indigo_shimmer: 'rgb(195,180,230)',
  rainbow_violet_shimmer: 'rgb(230,180,210)',
  ultracode: 'rgb(0,180,216)', // Cyan-blue for ultracode mode
  ultracodeShimmer: 'rgb(77,215,255)', // Brighter cyan-blue shimmer
}

/**
 * Dark theme using explicit RGB values to avoid inconsistencies
 * from users' custom terminal ANSI color definitions
 */
const darkTheme: Theme = {
  autoAccept: 'rgb(175,135,255)', // Electric violet
  bashBorder: 'rgb(253,93,177)', // Bright pink
  claude: 'rgb(255,122,26)', // OpenClaude brand orange
  claudeShimmer: 'rgb(255,177,95)', // Lighter brand orange for shimmer effect
  brand: 'rgb(255,122,26)', // OpenClaude brand orange
  brandShimmer: 'rgb(255,177,95)', // Lighter brand orange for shimmer effect
  claudeBlue_FOR_SYSTEM_SPINNER: 'rgb(147,165,255)', // Blue for system spinner
  claudeBlueShimmer_FOR_SYSTEM_SPINNER: 'rgb(177,195,255)', // Lighter blue for system spinner shimmer
  permission: 'rgb(177,185,249)', // Light blue-purple
  permissionShimmer: 'rgb(207,215,255)', // Lighter blue-purple for shimmer
  planMode: 'rgb(72,150,140)', // Muted sage green
  ide: 'rgb(71,130,200)', // Muted blue
  promptBorder: 'rgb(136,136,136)', // Medium gray
  promptBorderShimmer: 'rgb(166,166,166)', // Lighter gray for shimmer
  text: 'rgb(255,255,255)', // White
  inverseText: 'rgb(0,0,0)', // Black
  inactive: 'rgb(153,153,153)', // Light gray
  inactiveShimmer: 'rgb(193,193,193)', // Lighter gray for shimmer effect
  subtle: 'rgb(80,80,80)', // Dark gray
  suggestion: 'rgb(177,185,249)', // Light blue-purple
  remember: 'rgb(177,185,249)', // Light blue-purple
  background: 'rgb(0,204,204)', // Bright cyan
  success: 'rgb(78,186,101)', // Bright green
  error: 'rgb(255,107,128)', // Bright red
  warning: 'rgb(255,193,7)', // Bright amber
  merged: 'rgb(175,135,255)', // Electric violet (matches autoAccept)
  warningShimmer: 'rgb(255,223,57)', // Lighter amber for shimmer
  diffAdded: 'rgb(34,92,43)', // Dark green
  diffRemoved: 'rgb(122,41,54)', // Dark red
  diffAddedDimmed: 'rgb(71,88,74)', // Very dark green
  diffRemovedDimmed: 'rgb(105,72,77)', // Very dark red
  diffAddedWord: 'rgb(56,166,96)', // Medium green
  diffRemovedWord: 'rgb(179,89,107)', // Softer red (less intense than bright red)
  // Agent colors
  red_FOR_SUBAGENTS_ONLY: 'rgb(220,38,38)', // Red 600
  blue_FOR_SUBAGENTS_ONLY: 'rgb(37,99,235)', // Blue 600
  green_FOR_SUBAGENTS_ONLY: 'rgb(22,163,74)', // Green 600
  yellow_FOR_SUBAGENTS_ONLY: 'rgb(202,138,4)', // Yellow 600
  purple_FOR_SUBAGENTS_ONLY: 'rgb(147,51,234)', // Purple 600
  orange_FOR_SUBAGENTS_ONLY: 'rgb(234,88,12)', // Orange 600
  pink_FOR_SUBAGENTS_ONLY: 'rgb(219,39,119)', // Pink 600
  cyan_FOR_SUBAGENTS_ONLY: 'rgb(8,145,178)', // Cyan 600
  // Grove colors
  professionalBlue: 'rgb(106,155,204)',
  // Chrome colors
  chromeYellow: 'rgb(251,188,4)', // Chrome yellow
  // TUI V2 colors
  clawd_body: 'rgb(255,122,26)', // Brand orange
  clawd_background: 'rgb(0,0,0)',
  userMessageBackground: 'rgb(55, 55, 55)', // Lighter grey for better visual contrast
  userMessageBackgroundHover: 'rgb(70, 70, 70)',
  messageActionsBackground: 'rgb(44, 50, 62)', // cool gray, slight blue
  selectionBg: 'rgb(38, 79, 120)', // classic dark-mode selection blue (VS Code dark default); light fgs stay readable
  bashMessageBackgroundColor: 'rgb(65, 60, 65)',

  memoryBackgroundColor: 'rgb(55, 65, 70)',
  rate_limit_fill: 'rgb(177,185,249)', // Light blue-purple
  rate_limit_empty: 'rgb(80,83,112)', // Medium blue-purple
  fastMode: 'rgb(255,120,20)', // Electric orange for dark bg
  fastModeShimmer: 'rgb(255,165,70)', // Lighter orange for shimmer
  briefLabelYou: 'rgb(122,180,232)', // Light blue
  briefLabelClaude: 'rgb(255,122,26)', // Brand orange (matches claude)
  rainbow_red: 'rgb(235,95,87)',
  rainbow_orange: 'rgb(245,139,87)',
  rainbow_yellow: 'rgb(250,195,95)',
  rainbow_green: 'rgb(145,200,130)',
  rainbow_blue: 'rgb(130,170,220)',
  rainbow_indigo: 'rgb(155,130,200)',
  rainbow_violet: 'rgb(200,130,180)',
  rainbow_red_shimmer: 'rgb(250,155,147)',
  rainbow_orange_shimmer: 'rgb(255,185,137)',
  rainbow_yellow_shimmer: 'rgb(255,225,155)',
  rainbow_green_shimmer: 'rgb(185,230,180)',
  rainbow_blue_shimmer: 'rgb(180,205,240)',
  rainbow_indigo_shimmer: 'rgb(195,180,230)',
  rainbow_violet_shimmer: 'rgb(230,180,210)',
  ultracode: 'rgb(0,180,216)', // Cyan-blue for ultracode mode
  ultracodeShimmer: 'rgb(77,215,255)', // Brighter cyan-blue shimmer
}

/**
 * Dark daltonized theme (color-blind friendly) using explicit RGB values
 * to avoid inconsistencies from users' custom terminal ANSI color definitions
 */
const darkDaltonizedTheme: Theme = {
  autoAccept: 'rgb(175,135,255)', // Electric violet
  bashBorder: 'rgb(51,153,255)', // Bright blue
  claude: 'rgb(255,150,40)', // Brand orange adjusted for deuteranopia (luminance-separated from error/warning)
  claudeShimmer: 'rgb(255,195,115)', // Lighter brand orange for shimmer effect
  brand: 'rgb(255,150,40)', // Brand orange adjusted for deuteranopia (luminance-separated from error/warning)
  brandShimmer: 'rgb(255,195,115)', // Lighter brand orange for shimmer effect
  claudeBlue_FOR_SYSTEM_SPINNER: 'rgb(153,204,255)', // Light blue for system spinner
  claudeBlueShimmer_FOR_SYSTEM_SPINNER: 'rgb(183,224,255)', // Lighter blue for system spinner shimmer
  permission: 'rgb(153,204,255)', // Light blue
  permissionShimmer: 'rgb(183,224,255)', // Lighter blue for shimmer
  planMode: 'rgb(102,153,153)', // Muted gray-teal (works for color-blind)
  ide: 'rgb(71,130,200)', // Muted blue
  promptBorder: 'rgb(136,136,136)', // Medium gray
  promptBorderShimmer: 'rgb(166,166,166)', // Lighter gray for shimmer
  text: 'rgb(255,255,255)', // White
  inverseText: 'rgb(0,0,0)', // Black
  inactive: 'rgb(153,153,153)', // Light gray
  inactiveShimmer: 'rgb(193,193,193)', // Lighter gray for shimmer effect
  subtle: 'rgb(80,80,80)', // Dark gray
  suggestion: 'rgb(153,204,255)', // Light blue
  remember: 'rgb(153,204,255)', // Light blue
  background: 'rgb(0,204,204)', // Bright cyan (color-blind friendly)
  success: 'rgb(51,153,255)', // Blue instead of green
  error: 'rgb(255,102,102)', // Bright red
  warning: 'rgb(255,204,0)', // Yellow-orange for deuteranopia
  merged: 'rgb(175,135,255)', // Electric violet (matches autoAccept)
  warningShimmer: 'rgb(255,234,50)', // Lighter yellow-orange for shimmer
  diffAdded: 'rgb(0,68,102)', // Dark blue
  diffRemoved: 'rgb(102,0,0)', // Dark red
  diffAddedDimmed: 'rgb(62,81,91)', // Dimmed blue
  diffRemovedDimmed: 'rgb(62,44,44)', // Dimmed red
  diffAddedWord: 'rgb(0,119,179)', // Medium blue
  diffRemovedWord: 'rgb(179,0,0)', // Medium red
  // Agent colors (daltonism-friendly, dark mode)
  red_FOR_SUBAGENTS_ONLY: 'rgb(255,102,102)', // Bright red
  blue_FOR_SUBAGENTS_ONLY: 'rgb(102,178,255)', // Bright blue
  green_FOR_SUBAGENTS_ONLY: 'rgb(102,255,102)', // Bright green
  yellow_FOR_SUBAGENTS_ONLY: 'rgb(255,255,102)', // Bright yellow
  purple_FOR_SUBAGENTS_ONLY: 'rgb(178,102,255)', // Bright purple
  orange_FOR_SUBAGENTS_ONLY: 'rgb(255,178,102)', // Bright orange
  pink_FOR_SUBAGENTS_ONLY: 'rgb(255,153,204)', // Bright pink
  cyan_FOR_SUBAGENTS_ONLY: 'rgb(102,204,204)', // Bright cyan
  // Grove colors
  professionalBlue: 'rgb(106,155,204)',
  // Chrome colors
  chromeYellow: 'rgb(251,188,4)', // Chrome yellow
  // TUI V2 colors
  clawd_body: 'rgb(255,150,40)', // Brand orange (dark daltonized variant)
  clawd_background: 'rgb(0,0,0)',
  userMessageBackground: 'rgb(55, 55, 55)', // Lighter grey for better visual contrast
  userMessageBackgroundHover: 'rgb(70, 70, 70)',
  messageActionsBackground: 'rgb(44, 50, 62)', // cool gray, slight blue
  selectionBg: 'rgb(38, 79, 120)', // classic dark-mode selection blue (VS Code dark default); light fgs stay readable
  bashMessageBackgroundColor: 'rgb(65, 60, 65)',

  memoryBackgroundColor: 'rgb(55, 65, 70)',
  rate_limit_fill: 'rgb(153,204,255)', // Light blue
  rate_limit_empty: 'rgb(69,92,115)', // Dark blue
  fastMode: 'rgb(255,120,20)', // Electric orange for dark bg (color-blind safe)
  fastModeShimmer: 'rgb(255,165,70)', // Lighter orange for shimmer
  briefLabelYou: 'rgb(122,180,232)', // Light blue
  briefLabelClaude: 'rgb(255,150,40)', // Brand orange adjusted for deuteranopia (matches claude)
  rainbow_red: 'rgb(235,95,87)',
  rainbow_orange: 'rgb(245,139,87)',
  rainbow_yellow: 'rgb(250,195,95)',
  rainbow_green: 'rgb(145,200,130)',
  rainbow_blue: 'rgb(130,170,220)',
  rainbow_indigo: 'rgb(155,130,200)',
  rainbow_violet: 'rgb(200,130,180)',
  rainbow_red_shimmer: 'rgb(250,155,147)',
  rainbow_orange_shimmer: 'rgb(255,185,137)',
  rainbow_yellow_shimmer: 'rgb(255,225,155)',
  rainbow_green_shimmer: 'rgb(185,230,180)',
  rainbow_blue_shimmer: 'rgb(180,205,240)',
  rainbow_indigo_shimmer: 'rgb(195,180,230)',
  rainbow_violet_shimmer: 'rgb(230,180,210)',
  ultracode: 'rgb(0,180,216)', // Cyan-blue for ultracode mode
  ultracodeShimmer: 'rgb(77,215,255)', // Brighter cyan-blue shimmer
}

/**
 * Dark Nord theme — arctic, low-contrast palette (nord0–nord15) using
 * explicit RGB values. Deliberately quieter than `dark`: desaturated
 * frost blues replace bright accents, and muted grays carry structure.
 */
const darkNordTheme: Theme = {
  autoAccept: 'rgb(180,142,173)', // nord15 — muted purple accent
  bashBorder: 'rgb(208,135,112)', // nord12 — warm orange
  claude: 'rgb(208,135,112)', // nord12 — brand warm orange
  claudeShimmer: 'rgb(233,175,142)', // lighter nord12 for shimmer effect
  brand: 'rgb(208,135,112)', // nord12 — brand warm orange
  brandShimmer: 'rgb(233,175,142)', // lighter nord12 for shimmer effect
  claudeBlue_FOR_SYSTEM_SPINNER: 'rgb(129,161,193)', // nord9 — frost blue
  claudeBlueShimmer_FOR_SYSTEM_SPINNER: 'rgb(163,192,221)', // lighter nord9 for shimmer
  permission: 'rgb(136,192,208)', // nord8 — bright frost blue
  permissionShimmer: 'rgb(186,222,232)', // lighter nord8 for shimmer effect
  planMode: 'rgb(94,129,172)', // nord10 — muted deep blue
  ide: 'rgb(129,161,193)', // nord9 — frost blue
  promptBorder: 'rgb(76,86,106)', // nord3 — mid gray-blue
  promptBorderShimmer: 'rgb(130,142,165)', // lighter nord3 for shimmer
  text: 'rgb(236,239,244)', // nord6 — lightest, for text
  inverseText: 'rgb(46,52,64)', // nord0 — darkest, for inverse text
  inactive: 'rgb(76,86,106)', // nord3
  inactiveShimmer: 'rgb(150,160,180)', // lighter nord3 for shimmer effect
  subtle: 'rgb(67,76,94)', // nord2 — dark gray-blue
  suggestion: 'rgb(136,192,208)', // nord8 — bright frost blue
  remember: 'rgb(129,161,193)', // nord9 — frost blue
  background: 'rgb(143,188,187)', // nord7 — bright cyan (frost)
  success: 'rgb(163,190,140)', // nord14 — aurora green
  error: 'rgb(191,97,106)', // nord11 — aurora red
  warning: 'rgb(235,203,139)', // nord13 — aurora yellow
  merged: 'rgb(180,142,173)', // nord15 (matches autoAccept)
  warningShimmer: 'rgb(245,222,175)', // lighter nord13 for shimmer
  diffAdded: 'rgb(58,102,72)', // darkened nord14 for background
  diffRemoved: 'rgb(102,52,58)', // darkened nord11 for background
  diffAddedDimmed: 'rgb(48,72,58)', // very dark green
  diffRemovedDimmed: 'rgb(82,62,66)', // very dark red
  diffAddedWord: 'rgb(163,190,140)', // nord14 — aurora green
  diffRemovedWord: 'rgb(214,127,135)', // softened nord11
  // Agent colors (Nord-frost set)
  red_FOR_SUBAGENTS_ONLY: 'rgb(191,97,106)', // nord11
  blue_FOR_SUBAGENTS_ONLY: 'rgb(129,161,193)', // nord9
  green_FOR_SUBAGENTS_ONLY: 'rgb(163,190,140)', // nord14
  yellow_FOR_SUBAGENTS_ONLY: 'rgb(235,203,139)', // nord13
  purple_FOR_SUBAGENTS_ONLY: 'rgb(180,142,173)', // nord15
  orange_FOR_SUBAGENTS_ONLY: 'rgb(208,135,112)', // nord12
  pink_FOR_SUBAGENTS_ONLY: 'rgb(222,150,190)', // lightened nord15
  cyan_FOR_SUBAGENTS_ONLY: 'rgb(143,188,187)', // nord7
  // Grove colors
  professionalBlue: 'rgb(129,161,193)', // nord9
  // Chrome colors
  chromeYellow: 'rgb(235,203,139)', // nord13
  // TUI V2 colors
  clawd_body: 'rgb(208,135,112)', // nord12 (matches brand)
  clawd_background: 'rgb(46,52,64)', // nord0 — dark arctic background
  userMessageBackground: 'rgb(59,66,82)', // nord1 — elevated surface
  userMessageBackgroundHover: 'rgb(67,76,94)', // nord2 — hover surface
  messageActionsBackground: 'rgb(80,94,118)', // cool gray-blue, slightly toward nord9
  selectionBg: 'rgb(94,129,172)', // nord10 — classic dark selection blue
  bashMessageBackgroundColor: 'rgb(67,76,94)', // nord2
  memoryBackgroundColor: 'rgb(63,75,92)', // nord1 with slight teal cast
  rate_limit_fill: 'rgb(136,192,208)', // nord8
  rate_limit_empty: 'rgb(55,77,98)', // dark blue
  fastMode: 'rgb(208,135,112)', // nord12 — warm orange
  fastModeShimmer: 'rgb(233,175,142)', // lighter nord12 for shimmer
  // Brief/assistant mode
  briefLabelYou: 'rgb(136,192,208)', // nord8
  briefLabelClaude: 'rgb(208,135,112)', // nord12 (matches brand)
  rainbow_red: 'rgb(210,110,118)', // nord11-leaning
  rainbow_orange: 'rgb(208,135,112)', // nord12
  rainbow_yellow: 'rgb(235,203,139)', // nord13
  rainbow_green: 'rgb(163,190,140)', // nord14
  rainbow_blue: 'rgb(129,161,193)', // nord9
  rainbow_indigo: 'rgb(160,140,190)', // nord15-leaning
  rainbow_violet: 'rgb(180,142,173)', // nord15
  rainbow_red_shimmer: 'rgb(240,150,155)',
  rainbow_orange_shimmer: 'rgb(238,175,150)',
  rainbow_yellow_shimmer: 'rgb(245,222,175)',
  rainbow_green_shimmer: 'rgb(195,215,175)',
  rainbow_blue_shimmer: 'rgb(170,195,225)',
  rainbow_indigo_shimmer: 'rgb(195,180,220)',
  rainbow_violet_shimmer: 'rgb(215,180,205)',
  ultracode: 'rgb(136,192,208)', // nord8
  ultracodeShimmer: 'rgb(186,222,232)', // lighter nord8
}

/**
 * Light Nord theme — same arctic palette as `dark-nord`, re-weighted for a
 * light background: mid-tone accents are darkened for contrast, surface
 * grays shift to the light end (nord4–nord6), and text inverts to nord0.
 */
const lightNordTheme: Theme = {
  autoAccept: 'rgb(155,110,150)', // darkened nord15 for white bg
  bashBorder: 'rgb(191,97,106)', // nord11 — aurora red
  claude: 'rgb(180,104,80)', // darkened nord12 for white bg
  claudeShimmer: 'rgb(220,150,120)', // lighter nord12 for shimmer
  brand: 'rgb(180,104,80)', // darkened nord12 for white bg
  brandShimmer: 'rgb(220,150,120)', // lighter nord12 for shimmer
  claudeBlue_FOR_SYSTEM_SPINNER: 'rgb(94,129,172)', // nord10
  claudeBlueShimmer_FOR_SYSTEM_SPINNER: 'rgb(130,165,210)', // lighter nord10
  permission: 'rgb(94,129,172)', // nord10
  permissionShimmer: 'rgb(130,165,210)', // lighter nord10 for shimmer
  planMode: 'rgb(58,120,120)', // muted teal
  ide: 'rgb(94,129,172)', // nord10
  promptBorder: 'rgb(216,222,233)', // nord4 — light gray-blue
  promptBorderShimmer: 'rgb(229,233,240)', // nord5 for shimmer
  text: 'rgb(46,52,64)', // nord0 — darkest, for text
  inverseText: 'rgb(236,239,244)', // nord6 — for inverse text
  inactive: 'rgb(76,86,106)', // nord3
  inactiveShimmer: 'rgb(130,142,165)', // lighter nord3 for shimmer
  subtle: 'rgb(216,222,233)', // nord4 — light gray
  suggestion: 'rgb(94,129,172)', // nord10
  remember: 'rgb(94,129,172)', // nord10
  background: 'rgb(58,140,140)', // darkened nord7 for white bg
  success: 'rgb(90,130,70)', // darkened nord14
  error: 'rgb(180,80,90)', // darkened nord11
  warning: 'rgb(160,120,40)', // darkened nord13
  merged: 'rgb(155,110,150)', // darkened nord15 (matches autoAccept)
  warningShimmer: 'rgb(200,160,80)', // lighter warning for shimmer
  diffAdded: 'rgb(188,224,176)', // light green
  diffRemoved: 'rgb(240,196,200)', // light red
  diffAddedDimmed: 'rgb(220,238,212)', // very light green
  diffRemovedDimmed: 'rgb(250,224,226)', // very light red
  diffAddedWord: 'rgb(76,130,60)', // medium green
  diffRemovedWord: 'rgb(200,90,100)', // medium red
  // Agent colors (Nord, darkened for light bg)
  red_FOR_SUBAGENTS_ONLY: 'rgb(191,97,106)', // nord11
  blue_FOR_SUBAGENTS_ONLY: 'rgb(94,129,172)', // nord10
  green_FOR_SUBAGENTS_ONLY: 'rgb(90,130,70)', // darkened nord14
  yellow_FOR_SUBAGENTS_ONLY: 'rgb(180,140,50)', // darkened nord13
  purple_FOR_SUBAGENTS_ONLY: 'rgb(155,110,150)', // darkened nord15
  orange_FOR_SUBAGENTS_ONLY: 'rgb(180,104,80)', // darkened nord12
  pink_FOR_SUBAGENTS_ONLY: 'rgb(200,120,160)', // pink-leaning nord15
  cyan_FOR_SUBAGENTS_ONLY: 'rgb(58,140,140)', // darkened nord7
  // Grove colors
  professionalBlue: 'rgb(94,129,172)', // nord10
  // Chrome colors
  chromeYellow: 'rgb(200,160,60)', // darkened nord13
  // TUI V2 colors
  clawd_body: 'rgb(180,104,80)', // matches brand
  clawd_background: 'rgb(236,239,244)', // nord6 — light surface
  userMessageBackground: 'rgb(229,233,240)', // nord5 — elevated surface
  userMessageBackgroundHover: 'rgb(216,222,233)', // nord4 — hover surface
  messageActionsBackground: 'rgb(205,212,226)', // cool gray, slightly toward nord9
  selectionBg: 'rgb(174,206,240)', // nord9-tinted light selection blue
  bashMessageBackgroundColor: 'rgb(235,238,244)', // near-nord5
  memoryBackgroundColor: 'rgb(226,238,240)', // nord5 with teal cast
  rate_limit_fill: 'rgb(94,129,172)', // nord10
  rate_limit_empty: 'rgb(60,80,110)', // dark blue
  fastMode: 'rgb(200,120,60)', // warmed nord12
  fastModeShimmer: 'rgb(230,160,100)', // lighter for shimmer
  // Brief/assistant mode
  briefLabelYou: 'rgb(94,129,172)', // nord10
  briefLabelClaude: 'rgb(180,104,80)', // matches brand
  rainbow_red: 'rgb(200,105,110)',
  rainbow_orange: 'rgb(208,135,112)', // nord12
  rainbow_yellow: 'rgb(200,160,60)', // darkened nord13
  rainbow_green: 'rgb(110,150,90)', // darkened nord14
  rainbow_blue: 'rgb(94,129,172)', // nord10
  rainbow_indigo: 'rgb(140,120,180)',
  rainbow_violet: 'rgb(155,110,150)', // darkened nord15
  rainbow_red_shimmer: 'rgb(230,150,155)',
  rainbow_orange_shimmer: 'rgb(238,175,150)',
  rainbow_yellow_shimmer: 'rgb(235,205,140)',
  rainbow_green_shimmer: 'rgb(160,190,140)',
  rainbow_blue_shimmer: 'rgb(150,180,220)',
  rainbow_indigo_shimmer: 'rgb(180,160,210)',
  rainbow_violet_shimmer: 'rgb(200,160,195)',
  ultracode: 'rgb(60,150,180)', // darkened nord8
  ultracodeShimmer: 'rgb(110,190,215)', // lighter nord8
}

/**
 * Dark Nord ANSI theme — same structural mapping as `dark-nord` but using
 * only the 16 standard ANSI colors for terminals without truecolor support.
 * The frost blues lean on cyanBright, and warm accents fall back to
 * redBright (there is no orange in the base 16-color palette).
 */
const darkNordAnsiTheme: Theme = {
  autoAccept: 'ansi:magentaBright', // nearest to nord15 purple
  bashBorder: 'ansi:redBright',
  claude: 'ansi:redBright', // no orange in 16-color palette; nearest warm hue
  claudeShimmer: 'ansi:yellowBright',
  brand: 'ansi:redBright', // no orange in 16-color palette; nearest warm hue
  brandShimmer: 'ansi:yellowBright',
  claudeBlue_FOR_SYSTEM_SPINNER: 'ansi:blueBright',
  claudeBlueShimmer_FOR_SYSTEM_SPINNER: 'ansi:cyanBright',
  permission: 'ansi:cyanBright', // frost blue
  permissionShimmer: 'ansi:cyanBright',
  planMode: 'ansi:cyan',
  ide: 'ansi:blue',
  promptBorder: 'ansi:white',
  promptBorderShimmer: 'ansi:whiteBright',
  text: 'ansi:whiteBright',
  inverseText: 'ansi:black',
  inactive: 'ansi:white',
  inactiveShimmer: 'ansi:whiteBright',
  subtle: 'ansi:white',
  suggestion: 'ansi:cyanBright',
  remember: 'ansi:cyanBright',
  background: 'ansi:cyanBright',
  success: 'ansi:greenBright',
  error: 'ansi:redBright',
  warning: 'ansi:yellowBright',
  merged: 'ansi:magentaBright',
  warningShimmer: 'ansi:yellowBright',
  diffAdded: 'ansi:green',
  diffRemoved: 'ansi:red',
  diffAddedDimmed: 'ansi:green',
  diffRemovedDimmed: 'ansi:red',
  diffAddedWord: 'ansi:greenBright',
  diffRemovedWord: 'ansi:redBright',
  // Agent colors
  red_FOR_SUBAGENTS_ONLY: 'ansi:redBright',
  blue_FOR_SUBAGENTS_ONLY: 'ansi:blueBright',
  green_FOR_SUBAGENTS_ONLY: 'ansi:greenBright',
  yellow_FOR_SUBAGENTS_ONLY: 'ansi:yellowBright',
  purple_FOR_SUBAGENTS_ONLY: 'ansi:magentaBright',
  orange_FOR_SUBAGENTS_ONLY: 'ansi:redBright',
  pink_FOR_SUBAGENTS_ONLY: 'ansi:magentaBright',
  cyan_FOR_SUBAGENTS_ONLY: 'ansi:cyanBright',
  // Grove colors
  professionalBlue: 'ansi:blueBright',
  // Chrome colors
  chromeYellow: 'ansi:yellowBright',
  // TUI V2 colors
  clawd_body: 'ansi:redBright',
  clawd_background: 'ansi:black',
  userMessageBackground: 'ansi:blackBright',
  userMessageBackgroundHover: 'ansi:white',
  messageActionsBackground: 'ansi:blackBright',
  selectionBg: 'ansi:blue',
  bashMessageBackgroundColor: 'ansi:black',
  memoryBackgroundColor: 'ansi:blackBright',
  rate_limit_fill: 'ansi:cyanBright',
  rate_limit_empty: 'ansi:white',
  fastMode: 'ansi:redBright',
  fastModeShimmer: 'ansi:redBright',
  briefLabelYou: 'ansi:cyanBright',
  briefLabelClaude: 'ansi:redBright',
  rainbow_red: 'ansi:red',
  rainbow_orange: 'ansi:redBright',
  rainbow_yellow: 'ansi:yellow',
  rainbow_green: 'ansi:green',
  rainbow_blue: 'ansi:cyan',
  rainbow_indigo: 'ansi:blue',
  rainbow_violet: 'ansi:magenta',
  rainbow_red_shimmer: 'ansi:redBright',
  rainbow_orange_shimmer: 'ansi:yellow',
  rainbow_yellow_shimmer: 'ansi:yellowBright',
  rainbow_green_shimmer: 'ansi:greenBright',
  rainbow_blue_shimmer: 'ansi:cyanBright',
  rainbow_indigo_shimmer: 'ansi:blueBright',
  rainbow_violet_shimmer: 'ansi:magentaBright',
  ultracode: 'ansi:cyanBright',
  ultracodeShimmer: 'ansi:cyanBright',
}

export function getTheme(themeName: ThemeName): Theme {
  switch (themeName) {
    case 'light':
      return lightTheme
    case 'light-ansi':
      return lightAnsiTheme
    case 'dark-ansi':
      return darkAnsiTheme
    case 'light-daltonized':
      return lightDaltonizedTheme
    case 'dark-daltonized':
      return darkDaltonizedTheme
    case 'dark-nord':
      return darkNordTheme
    case 'light-nord':
      return lightNordTheme
    case 'dark-nord-ansi':
      return darkNordAnsiTheme
    default:
      return darkTheme
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
