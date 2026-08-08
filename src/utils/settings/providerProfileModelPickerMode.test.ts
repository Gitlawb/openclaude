import { describe, expect, test } from 'bun:test'

describe('SettingsSchema providerProfileModelPickerMode', () => {
  test('accepts explicit provider profile model picker modes', async () => {
    const { SettingsSchema } = await import('./types.js')

    for (const mode of ['auto', 'profile', 'provider'] as const) {
      const result = SettingsSchema().safeParse({
        providerProfileModelPickerMode: mode,
      })

      expect(result.success).toBe(true)
      expect(result.data?.providerProfileModelPickerMode).toBe(mode)
    }
  })

  test('treats invalid provider profile model picker modes as unset', async () => {
    const { SettingsSchema } = await import('./types.js')
    const result = SettingsSchema().safeParse({
      providerProfileModelPickerMode: 'catalog',
    })

    expect(result.success).toBe(true)
    expect(result.data?.providerProfileModelPickerMode).toBeUndefined()
  })
})
