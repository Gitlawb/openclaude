import { describe, test, expect, afterEach, registerSettingsGetter } from 'bun:test';
import { getOpenAIContextWindow, getOpenAIMaxOutputTokens } from './openaiContextWindows.js';

describe('openaiContextWindows resolution', () => {
  afterEach(() => {
    // @ts-ignore
    const { registerSettingsGetter } = require('./openaiContextWindows.js');
    registerSettingsGetter(() => undefined);
  });

  test('resolves context window from settings', () => {
    const { registerSettingsGetter } = require('./openaiContextWindows.js');
    registerSettingsGetter(() => ({
      openaiContextWindows: { 'test-model': 100000 }
    } as any));
    const result = getOpenAIContextWindow('test-model', {});
    expect(result).toBe(100000);
  });

  test('sanitizes invalid limits from settings', () => {
    const { registerSettingsGetter } = require('./openaiContextWindows.js');
    registerSettingsGetter(() => ({
      openaiContextWindows: { 
        'bad-model': -500,
        'zero-model': 0,
        'float-model': 123.45,
        'good-model': 100000
      }
    } as any));
    
    // Fallback to 128k (standard) because these are ignored/filtered out
    // and they are not in environment vars.
    // Actually, getOpenAIContextWindow returns number | undefined.
    expect(getOpenAIContextWindow('bad-model', {})).toBeUndefined();
    expect(getOpenAIContextWindow('zero-model', {})).toBeUndefined();
    expect(getOpenAIContextWindow('good-model', {})).toBe(100000);
  });

  test('resolves max output tokens from settings', () => {
    const { registerSettingsGetter } = require('./openaiContextWindows.js');
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
    const { registerSettingsGetter } = require('./openaiContextWindows.js');
    registerSettingsGetter(() => ({ openaiContextWindows: {} } as any));
    const env = {
      CLAUDE_CODE_OPENAI_CONTEXT_WINDOWS: JSON.stringify({ 'env-model': 50000 })
    };
    const result = getOpenAIContextWindow('env-model', env as any);
    expect(result).toBe(50000);
  });
});
