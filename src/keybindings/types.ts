import type { KEYBINDING_ACTIONS, KEYBINDING_CONTEXTS } from './schema.js'

export type KeybindingContextName = (typeof KEYBINDING_CONTEXTS)[number]
export type KeybindingAction = (typeof KEYBINDING_ACTIONS)[number]

export type KeybindingBlock = {
  context: KeybindingContextName
  bindings: Record<string, string | null>
}

export type Chord = ParsedKeystroke[]

export type ParsedKeystroke = {
  key: string
  ctrl: boolean
  alt: boolean
  shift: boolean
  meta: boolean
  super: boolean
}

export type ParsedBinding = {
  context: KeybindingContextName
  chord: Chord
  action: KeybindingAction | string | null
}
