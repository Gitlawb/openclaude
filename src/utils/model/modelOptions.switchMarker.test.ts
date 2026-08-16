import { describe, expect, test } from 'bun:test'
import {
  encodeSwitchProfileValue,
  resolveSelectedSwitchProfileId,
  type ModelOption,
} from './modelOptions.js'

// resolveSelectedSwitchProfileId is the presented-option authority for whether
// a /model selection activates a provider (#1119/#1164). It must key on the
// actual option carrying the marker, and treat duplicate-value matches as
// ambiguous so a literal custom id cannot borrow another option's marker.
describe('resolveSelectedSwitchProfileId', () => {
  const switchValue = encodeSwitchProfileValue('work', 'gpt-5.5')

  test('returns the marker of the single matching switch option', () => {
    const options: ModelOption[] = [
      { value: 'claude-opus-4-6', label: 'Active', description: 'Active' },
      { value: switchValue, label: 'Switch to Work', description: 'Switch', switchToProfileId: 'work' },
    ]
    expect(resolveSelectedSwitchProfileId(options, switchValue)).toBe('work')
  })

  test('returns undefined for a literal option with no marker', () => {
    const options: ModelOption[] = [
      { value: switchValue, label: 'Literal custom model', description: 'Literal' },
    ]
    expect(resolveSelectedSwitchProfileId(options, switchValue)).toBeUndefined()
  })

  test('returns undefined when two options share the selected value (ambiguous)', () => {
    // A literal custom id whose value collides with an encoded switch value must
    // NOT borrow the switch option's marker.
    const options: ModelOption[] = [
      { value: switchValue, label: 'Switch to Work', description: 'Switch', switchToProfileId: 'work' },
      { value: switchValue, label: 'Literal custom model', description: 'Literal' },
    ]
    expect(resolveSelectedSwitchProfileId(options, switchValue)).toBeUndefined()
  })

  test('returns undefined when nothing matches the selected value', () => {
    const options: ModelOption[] = [
      { value: 'claude-opus-4-6', label: 'Active', description: 'Active' },
    ]
    expect(resolveSelectedSwitchProfileId(options, switchValue)).toBeUndefined()
  })
})
