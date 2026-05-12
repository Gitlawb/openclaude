import { describe, test, expect, afterEach } from 'bun:test';
import { getOpenAIContextWindow, getOpenAIMaxOutputTokens, registerSettingsGetter } from './openaiContextWindows.js';

describe('openaiContextWindows resolution', () => {
  afterEach(() => {
    registerSettingsGetter(() => undefined);
  });

  test('resolves context window from settings', () => {
    registerSettingsGetter(() => ({
      openaiContextWindows: { 'test-model': 100000 }
    } as any));
    const result = getOpenAIContextWindow('test-model', {});
    expect(result).toBe(100000);
  });

  test('resolves max output tokens from settings', () => {
    registerSettingsGetter(() => ({
      openaiMaxOutputTokens: { 'test-model': 500 }
    } as any));
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

  test('environment variables take precedence if settings is empty', () => {
    registerSettingsGetter(() => ({ openaiContextWindows: {} } as any));
    const env = {
      CLAUDE_CODE_OPENAI_CONTEXT_WINDOWS: JSON.stringify({ 'env-model': 50000 })
    };
    const result = getOpenAIContextWindow('env-model', env as any);
    expect(result).toBe(50000);
  });
});
