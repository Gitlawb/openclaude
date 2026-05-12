import { describe, test, expect, mock } from 'bun:test';

// Mock getInitialSettings to provide test values
mock.module('../settings/settings.js', () => ({
  getInitialSettings: () => ({
    openaiContextWindows: {
      'test-model': 100000
    },
    openaiMaxOutputTokens: {
      'test-model': 500
    }
  })
}));

import { getOpenAIContextWindow, getOpenAIMaxOutputTokens } from './openaiContextWindows.js';

describe('openaiContextWindows resolution', () => {
  test('resolves context window from settings', () => {
    const result = getOpenAIContextWindow('test-model', {});
    expect(result).toBe(100000);
  });

  test('resolves max output tokens from settings', () => {
    const result = getOpenAIMaxOutputTokens('test-model', {});
    expect(result).toBe(500);
  });

  test('falls back to environment variables if not in settings', () => {
    const env = {
      CLAUDE_CODE_OPENAI_CONTEXT_WINDOWS: JSON.stringify({ 'env-model': 50000 })
    };
    const result = getOpenAIContextWindow('env-model', env as any);
    expect(result).toBe(50000);
  });
});
