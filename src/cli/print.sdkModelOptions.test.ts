import { describe, expect, test } from 'bun:test'

import { selectSdkModelOptions } from './print.js'
import {
  encodeSwitchProfileValue,
  type ModelOption,
} from '../utils/model/modelOptions.js'

// Regression for issue #1119: the interactive `/model` picker surfaces
// inactive-provider-profile entries whose `value` is an encoded
// `__switch_profile__:<id>:<model>` string. Those are UI-only affordances and
// must never reach the SDK `initialize.models` response — they are not real,
// selectable model ids. selectSdkModelOptions is the single gate the SDK
// `modelInfos` builder runs every option through, so this asserts it strips
// them.
describe('selectSdkModelOptions — keeps cross-profile switch entries out of SDK models', () => {
  const realOptions: ModelOption[] = [
    { value: null, label: 'Default (recommended)', description: 'default' },
    { value: 'sonnet', label: 'Sonnet', description: 'Sonnet 4.6' },
    { value: 'opus', label: 'Opus', description: 'Opus 4.8' },
  ]

  test('drops encoded __switch_profile__ options', () => {
    const switchOption: ModelOption = {
      value: encodeSwitchProfileValue('profile-2', 'qwen3-coder'),
      label: 'qwen3-coder · My Ollama',
      description: 'Switch to My Ollama (http://localhost:11434/v1)',
      switchToProfileId: 'profile-2',
    }

    const selected = selectSdkModelOptions([
      realOptions[0]!,
      switchOption,
      realOptions[1]!,
      realOptions[2]!,
    ])

    expect(selected).toEqual(realOptions)
    // No surviving option carries the UI-only encoded value or the
    // switchToProfileId marker.
    expect(
      selected.some(
        o =>
          typeof o.value === 'string' &&
          o.value.startsWith('__switch_profile__:'),
      ),
    ).toBe(false)
    expect(selected.some(o => o.switchToProfileId !== undefined)).toBe(false)
  })

  test('passes through a list with no switch entries unchanged', () => {
    expect(selectSdkModelOptions(realOptions)).toEqual(realOptions)
  })
})
