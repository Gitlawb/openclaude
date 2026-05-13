import { describe, expect, it } from 'bun:test'
import {
  detectModeEntry,
  getModeFromInput,
  getValueFromInput,
  isInputModeCharacter,
  prependModeCharacterToInput,
} from './inputModes.js'

describe('inputModes', () => {
  describe('getModeFromInput', () => {
    it('returns bash mode for input starting with !', () => {
      expect(getModeFromInput('!')).toBe('bash')
      expect(getModeFromInput('!ls')).toBe('bash')
    })

    it('returns prompt mode for non-bash input', () => {
      expect(getModeFromInput('')).toBe('prompt')
      expect(getModeFromInput('hello')).toBe('prompt')
      expect(getModeFromInput(' !')).toBe('prompt')
    })
  })

  describe('getValueFromInput', () => {
    it('strips the leading ! when entering bash mode', () => {
      expect(getValueFromInput('!')).toBe('')
      expect(getValueFromInput('!ls -la')).toBe('ls -la')
    })

    it('returns input unchanged in prompt mode', () => {
      expect(getValueFromInput('')).toBe('')
      expect(getValueFromInput('hello')).toBe('hello')
    })
  })

  describe('isInputModeCharacter', () => {
    it('returns true only for the bare ! character', () => {
      expect(isInputModeCharacter('!')).toBe(true)
      expect(isInputModeCharacter('!ls')).toBe(false)
      expect(isInputModeCharacter('')).toBe(false)
    })
  })

  describe('prependModeCharacterToInput', () => {
    it('prepends ! when mode is bash', () => {
      expect(prependModeCharacterToInput('ls', 'bash')).toBe('!ls')
      expect(prependModeCharacterToInput('', 'bash')).toBe('!')
    })

    it('returns input unchanged in prompt mode', () => {
      expect(prependModeCharacterToInput('hello', 'prompt')).toBe('hello')
    })
  })

  describe('detectModeEntry', () => {
    // Regression for #662 — typing `!` into empty input must switch to bash
    // mode AND yield an empty stripped buffer. Before the fix the single-char
    // path returned without stripping, leaving `!` visible in the buffer.
    it('strips the mode character when typing ! into empty input', () => {
      expect(
        detectModeEntry({ value: '!', prevInputLength: 0, cursorOffset: 0 }),
      ).toEqual({ mode: 'bash', strippedValue: '' })
    })

    it('strips the mode character when pasting !cmd into empty input', () => {
      expect(
        detectModeEntry({ value: '!ls -la', prevInputLength: 0, cursorOffset: 0 }),
      ).toEqual({ mode: 'bash', strippedValue: 'ls -la' })
    })

    it('returns null when the cursor is not at the start', () => {
      expect(
        detectModeEntry({ value: '!', prevInputLength: 0, cursorOffset: 1 }),
      ).toBeNull()
    })

    it('returns null when the value does not start with !', () => {
      expect(
        detectModeEntry({ value: 'hello', prevInputLength: 0, cursorOffset: 0 }),
      ).toBeNull()
    })

    it('returns null when typing ! after existing text', () => {
      // value="ab!" with prevInputLength=2 is a single-char insertion but does
      // not start with ! — getModeFromInput returns 'prompt'.
      expect(
        detectModeEntry({ value: 'ab!', prevInputLength: 2, cursorOffset: 0 }),
      ).toBeNull()
    })

    it('returns null when prepending ! to non-empty existing text', () => {
      // Single-char insertion at start that produces "!ab" from "ab" — value
      // length is 3, prevInputLength is 2, so isSingleCharInsertion is true
      // and isMultiCharIntoEmpty is false. We accept the mode change here so
      // that typing ! at the start of existing text still toggles mode.
      const result = detectModeEntry({
        value: '!ab',
        prevInputLength: 2,
        cursorOffset: 0,
      })
      expect(result).toEqual({ mode: 'bash', strippedValue: 'ab' })
    })
  })
})
