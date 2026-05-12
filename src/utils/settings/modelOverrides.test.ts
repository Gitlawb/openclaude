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

  test('SettingsSchema rejects invalid override types', async () => {
    const { SettingsSchema } = await import('./types.js');
    const settings = {
      openaiContextWindows: {
        'invalid-model': 'not-a-number'
      }
    };
    const result = SettingsSchema().safeParse(settings);
    expect(result.success).toBe(false);
  });
});
