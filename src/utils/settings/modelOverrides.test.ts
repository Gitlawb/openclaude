import { describe, test, expect } from 'bun:test';

describe('SettingsSchema model overrides', () => {
  test('SettingsSchema accepts openaiContextWindows and openaiMaxOutputTokens', async () => {
    const { SettingsSchema } = await import('./types.js');
    const settings = {
      openaiContextWindows: {
        'devstral-small-2': 256000,
        'gpt-4o': 128000
      },
      openaiMaxOutputTokens: {
        'devstral-small-2': 4096
      }
    };
    const result = SettingsSchema().safeParse(settings);
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.openaiContextWindows).toEqual(settings.openaiContextWindows);
      expect(result.data.openaiMaxOutputTokens).toEqual(settings.openaiMaxOutputTokens);
    }
  });

  test('SettingsSchema rejects invalid override types (non-integers)', async () => {
    const { SettingsSchema } = await import('./types.js');
    const settings = {
      openaiContextWindows: {
        'invalid-model': 123.45
      }
    };
    const result = SettingsSchema().safeParse(settings);
    expect(result.success).toBe(false);
  });

  test('SettingsSchema rejects non-positive integers', async () => {
    const { SettingsSchema } = await import('./types.js');
    const result1 = SettingsSchema().safeParse({
      openaiContextWindows: { 'm': 0 }
    });
    expect(result1.success).toBe(false);

    const result2 = SettingsSchema().safeParse({
      openaiContextWindows: { 'm': -100 }
    });
    expect(result2.success).toBe(false);
  });

  test('SettingsSchema accepts agentModels', async () => {
    const { SettingsSchema } = await import('./types.js');
    const settings = {
      agentModels: {
        'custom-model': {
          base_url: 'https://example.com/api',
          api_key: 'secret-key'
        }
      }
    };
    const result = SettingsSchema().safeParse(settings);
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.agentModels).toEqual(settings.agentModels);
    }
  });
});
