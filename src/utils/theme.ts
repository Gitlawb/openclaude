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
  briefLabelAgent: string
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
  // Companion rarity colors — tinted per rarity tier, used by the buddy sprite
  // and speech-bubble border. Themes that don't want a bespoke palette can
  // reuse inactive/success/permission/autoAccept/warning values.
  companion_common: string
  companion_uncommon: string
  companion_rare: string
  companion_epic: string
  companion_legendary: string
}

export const THEME_NAMES = [
  'fire',
  'dark',
  'light',
  'light-daltonized',
  'dark-daltonized',
  'light-ansi',
  'dark-ansi',
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
  claude: 'rgb(215,119,87)', // Claude orange
  claudeShimmer: 'rgb(245,149,117)', // Lighter claude orange for shimmer effect
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
  clawd_body: 'rgb(215,119,87)',
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
  briefLabelAgent: 'rgb(215,119,87)', // Brand orange
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
  companion_common: 'rgb(102,102,102)',
  companion_uncommon: 'rgb(44,122,57)',
  companion_rare: 'rgb(87,105,247)',
  companion_epic: 'rgb(135,0,255)',
  companion_legendary: 'rgb(150,108,30)',
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
  briefLabelAgent: 'ansi:redBright',
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
  companion_common: 'ansi:blackBright',
  companion_uncommon: 'ansi:green',
  companion_rare: 'ansi:blue',
  companion_epic: 'ansi:magenta',
  companion_legendary: 'ansi:yellow',
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
  briefLabelAgent: 'ansi:redBright',
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
  companion_common: 'ansi:white',
  companion_uncommon: 'ansi:greenBright',
  companion_rare: 'ansi:blueBright',
  companion_epic: 'ansi:magentaBright',
  companion_legendary: 'ansi:yellowBright',
}

/**
 * Light daltonized theme (color-blind friendly) using explicit RGB values
 * to avoid inconsistencies from users' custom terminal ANSI color definitions
 */
const lightDaltonizedTheme: Theme = {
  autoAccept: 'rgb(135,0,255)', // Electric violet
  bashBorder: 'rgb(0,102,204)', // Blue instead of pink
  claude: 'rgb(255,153,51)', // Orange adjusted for deuteranopia
  claudeShimmer: 'rgb(255,183,101)', // Lighter orange for shimmer effect
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
  clawd_body: 'rgb(215,119,87)',
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
  briefLabelAgent: 'rgb(255,153,51)', // Orange adjusted for deuteranopia (matches claude)
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
  companion_common: 'rgb(102,102,102)',
  companion_uncommon: 'rgb(0,102,153)',
  companion_rare: 'rgb(51,102,255)',
  companion_epic: 'rgb(135,0,255)',
  companion_legendary: 'rgb(255,153,0)',
}

/**
 * Dark theme using explicit RGB values to avoid inconsistencies
 * from users' custom terminal ANSI color definitions
 */
const darkTheme: Theme = {
  autoAccept: 'rgb(175,135,255)', // Electric violet
  bashBorder: 'rgb(253,93,177)', // Bright pink
  claude: 'rgb(215,119,87)', // Claude orange
  claudeShimmer: 'rgb(235,159,127)', // Lighter claude orange for shimmer effect
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
  clawd_body: 'rgb(215,119,87)',
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
  briefLabelAgent: 'rgb(215,119,87)', // Brand orange
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
  companion_common: 'rgb(153,153,153)',
  companion_uncommon: 'rgb(78,186,101)',
  companion_rare: 'rgb(177,185,249)',
  companion_epic: 'rgb(175,135,255)',
  companion_legendary: 'rgb(255,193,7)',
}

/**
 * Dark daltonized theme (color-blind friendly) using explicit RGB values
 * to avoid inconsistencies from users' custom terminal ANSI color definitions
 */
const darkDaltonizedTheme: Theme = {
  autoAccept: 'rgb(175,135,255)', // Electric violet
  bashBorder: 'rgb(51,153,255)', // Bright blue
  claude: 'rgb(255,153,51)', // Orange adjusted for deuteranopia
  claudeShimmer: 'rgb(255,183,101)', // Lighter orange for shimmer effect
  claudeBlue_FOR_SYSTEM_SPINNER: 'rgb(102,204,102)', // Green accent for system spinner
  claudeBlueShimmer_FOR_SYSTEM_SPINNER: 'rgb(132,234,132)', // Lighter green for system spinner shimmer
  permission: 'rgb(102,204,102)', // Green accent
  permissionShimmer: 'rgb(132,234,132)', // Lighter green for shimmer
  planMode: 'rgb(102,153,153)', // Muted gray-teal (works for color-blind)
  ide: 'rgb(71,130,200)', // Muted blue
  promptBorder: 'rgb(136,136,136)', // Medium gray
  promptBorderShimmer: 'rgb(166,166,166)', // Lighter gray for shimmer
  text: 'rgb(255,255,255)', // White
  inverseText: 'rgb(0,0,0)', // Black
  inactive: 'rgb(153,153,153)', // Light gray
  inactiveShimmer: 'rgb(193,193,193)', // Lighter gray for shimmer effect
  subtle: 'rgb(80,80,80)', // Dark gray
  suggestion: 'rgb(102,204,102)', // Green accent
  remember: 'rgb(102,204,102)', // Green accent
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
  clawd_body: 'rgb(215,119,87)',
  clawd_background: 'rgb(0,0,0)',
  userMessageBackground: 'rgb(55, 55, 55)', // Lighter grey for better visual contrast
  userMessageBackgroundHover: 'rgb(70, 70, 70)',
  messageActionsBackground: 'rgb(44, 50, 62)', // cool gray, slight blue
  selectionBg: 'rgb(38, 79, 120)', // classic dark-mode selection blue (VS Code dark default); light fgs stay readable
  bashMessageBackgroundColor: 'rgb(65, 60, 65)',

  memoryBackgroundColor: 'rgb(55, 65, 70)',
  rate_limit_fill: 'rgb(102,204,102)', // Green accent
  rate_limit_empty: 'rgb(40,80,40)', // Dark green
  fastMode: 'rgb(255,120,20)', // Electric orange for dark bg (color-blind safe)
  fastModeShimmer: 'rgb(255,165,70)', // Lighter orange for shimmer
  briefLabelYou: 'rgb(122,180,232)', // Light blue
  briefLabelAgent: 'rgb(255,153,51)', // Orange adjusted for deuteranopia (matches claude)
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
  companion_common: 'rgb(153,153,153)',
  companion_uncommon: 'rgb(51,153,255)',
  companion_rare: 'rgb(102,204,102)',
  companion_epic: 'rgb(175,135,255)',
  companion_legendary: 'rgb(255,204,0)',
}

/**
 * Fire theme — sunset / ember palette matching the Neural Network logo.
 * Warm oranges, reds, and creams; green (#6ab04c) and red (#eb4d4b) reserved
 * for diff added/removed markers to preserve semantic clarity.
 */
const fireTheme: Theme = {
  autoAccept: 'rgb(217,119,87)', // Ember
  bashBorder: 'rgb(235,77,75)', // #eb4d4b — fire red, stands out on dark warm bg
  claude: 'rgb(240,148,100)', // Accent — assistant color
  claudeShimmer: 'rgb(255,180,100)', // Brightest sunset point
  claudeBlue_FOR_SYSTEM_SPINNER: 'rgb(240,148,100)', // No blue — mirror to accent
  claudeBlueShimmer_FOR_SYSTEM_SPINNER: 'rgb(255,180,100)',
  permission: 'rgb(240,148,100)', // Accent — replaces blue for inline code / permissions
  permissionShimmer: 'rgb(255,180,100)',
  planMode: 'rgb(255,180,100)', // Bright sunset — plan mode
  ide: 'rgb(193,95,60)', // Mid sunset
  promptBorder: 'rgb(100,80,65)', // Tmyanyy border from logo
  promptBorderShimmer: 'rgb(193,95,60)', // Ember pulse
  text: 'rgb(255,255,255)', // White — main text
  inverseText: 'rgb(0,0,0)', // Black
  inactive: 'rgb(120,100,82)', // Dim from logo
  inactiveShimmer: 'rgb(160,140,122)',
  subtle: 'rgb(80,65,55)', // Darker ember for subtle
  suggestion: 'rgb(240,148,100)', // Accent
  remember: 'rgb(217,119,87)', // Ember
  background: 'rgb(60,40,30)', // Dark ember
  success: 'rgb(106,176,76)', // #6ab04c — fire green for success
  error: 'rgb(235,77,75)', // #eb4d4b — fire red for errors
  warning: 'rgb(255,180,100)', // Bright sunset
  merged: 'rgb(217,119,87)', // Matches ember
  warningShimmer: 'rgb(255,210,140)',
  diffAdded: 'rgb(30,50,25)', // Dark olive bg
  diffRemoved: 'rgb(60,25,25)', // Dark maroon bg
  diffAddedDimmed: 'rgb(45,60,40)',
  diffRemovedDimmed: 'rgb(75,40,40)',
  diffAddedWord: 'rgb(60,110,50)', // Medium olive — word-level bg
  diffRemovedWord: 'rgb(120,45,45)', // Medium maroon — word-level bg
  // Agent colors — warm fire-palette variants
  red_FOR_SUBAGENTS_ONLY: 'rgb(235,77,75)',
  blue_FOR_SUBAGENTS_ONLY: 'rgb(130,60,50)', // Deepest ember in place of "blue"
  green_FOR_SUBAGENTS_ONLY: 'rgb(106,176,76)',
  yellow_FOR_SUBAGENTS_ONLY: 'rgb(255,180,100)',
  purple_FOR_SUBAGENTS_ONLY: 'rgb(160,75,55)', // Brick in place of "purple"
  orange_FOR_SUBAGENTS_ONLY: 'rgb(240,148,100)',
  pink_FOR_SUBAGENTS_ONLY: 'rgb(217,119,87)',
  cyan_FOR_SUBAGENTS_ONLY: 'rgb(193,95,60)',
  professionalBlue: 'rgb(106,155,204)', // External ref — keep as-is
  chromeYellow: 'rgb(255,180,100)',
  clawd_body: 'rgb(240,148,100)',
  clawd_background: 'rgb(0,0,0)',
  userMessageBackground: 'rgb(55,45,40)', // Dark warm gray
  userMessageBackgroundHover: 'rgb(70,55,48)',
  messageActionsBackground: 'rgb(65,48,38)',
  selectionBg: 'rgb(100,60,40)', // Warm selection
  bashMessageBackgroundColor: 'rgb(55,35,35)',
  memoryBackgroundColor: 'rgb(50,45,55)',
  rate_limit_fill: 'rgb(240,148,100)',
  rate_limit_empty: 'rgb(80,55,45)',
  fastMode: 'rgb(255,120,20)',
  fastModeShimmer: 'rgb(255,165,70)',
  briefLabelYou: 'rgb(220,195,170)', // Cream
  briefLabelAgent: 'rgb(240,148,100)', // Accent
  // Rainbow — 7 points along the sunset gradient
  rainbow_red: 'rgb(130,60,50)',
  rainbow_orange: 'rgb(160,75,55)',
  rainbow_yellow: 'rgb(193,95,60)',
  rainbow_green: 'rgb(217,119,87)',
  rainbow_blue: 'rgb(240,140,80)',
  rainbow_indigo: 'rgb(255,160,90)',
  rainbow_violet: 'rgb(255,180,100)',
  rainbow_red_shimmer: 'rgb(170,90,75)',
  rainbow_orange_shimmer: 'rgb(200,110,85)',
  rainbow_yellow_shimmer: 'rgb(225,135,95)',
  rainbow_green_shimmer: 'rgb(245,155,115)',
  rainbow_blue_shimmer: 'rgb(255,175,120)',
  rainbow_indigo_shimmer: 'rgb(255,195,130)',
  rainbow_violet_shimmer: 'rgb(255,210,150)',
  // Companion rarity — fire gradient from dim ember to blazing sunset
  companion_common: 'rgb(130,60,50)',
  companion_uncommon: 'rgb(160,75,55)',
  companion_rare: 'rgb(193,95,60)',
  companion_epic: 'rgb(240,140,80)',
  companion_legendary: 'rgb(255,180,100)',
}

export function getTheme(themeName: ThemeName): Theme {
  switch (themeName) {
    case 'fire':
      return fireTheme
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
    case 'dark':
      return darkTheme
    default:
      return fireTheme
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
