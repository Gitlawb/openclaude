import { expect, spyOn, test, type Mock } from 'bun:test'

const isolatedEnv = new Proxy({ ...process.env }, {
  set(target, prop, value) {
    target[prop as keyof typeof target] = String(value);
    return true;
  },
  deleteProperty(target, prop) {
    delete target[prop as keyof typeof target];
    return true;
  }
});

Object.defineProperty(process, 'env', {
  value: isolatedEnv,
  writable: true,
  configurable: true,
  enumerable: true
});

if (typeof Bun !== 'undefined') {
  Object.defineProperty(Bun, 'env', {
    value: isolatedEnv,
    writable: true,
    configurable: true,
    enumerable: true
  });
}

const {
  getDefaultHaikuModel,
  getDefaultOpusModel,
  getDefaultSonnetModel,
  getDefaultMainLoopModelSetting,
} = await import('./model.js')

const providers = await import('./providers.js')

const ISOLATED_ENV_KEYS = [
  'ANTHROPIC_DEFAULT_OPUS_MODEL',
  'ANTHROPIC_DEFAULT_SONNET_MODEL',
  'ANTHROPIC_DEFAULT_HAIKU_MODEL',
  'ANTHROPIC_MODEL',
  'GEMINI_MODEL',
  'OPENAI_MODEL',
  'CLAUDE_CODE_USE_GEMINI',
  'CLAUDE_CODE_USE_OPENAI',
] as const

type IsolatedEnvKey = typeof ISOLATED_ENV_KEYS[number]

// Note: Synchronous execution only. test.concurrent and async/await are prohibited to prevent race conditions.
function runWithSandbox(
  envOverrides: Partial<Record<IsolatedEnvKey, string>>,
  testFn: (cleanupSpies: Mock<any>[]) => void | unknown
) {
  const backupEnv: Record<string, string | undefined> = {}
  const spiesToRestore: Mock<any>[] = []

  for (const key of ISOLATED_ENV_KEYS) {
    backupEnv[key] = process.env[key]
    delete process.env[key]
  }

  for (const key of ISOLATED_ENV_KEYS) {
    const overrideValue = envOverrides[key]
    if (overrideValue !== undefined) {
      process.env[key] = overrideValue
    }
  }

  try {
    const result = testFn(spiesToRestore)
    
    if (result instanceof Promise) {
      throw new Error('runWithSandbox: testFn must be synchronous.')
    }
  } finally {
    for (const key of ISOLATED_ENV_KEYS) {
      const originalValue = backupEnv[key]
      if (originalValue === undefined) {
        delete process.env[key]
      } else {
        process.env[key] = originalValue
      }
    }

    for (const spy of spiesToRestore) {
      spy.mockRestore()
    }
  }
}

// --- Gemini Provider Tests ---

test('Gemini provider loads expected default models (Fallback logic check)', () => {
  runWithSandbox({ CLAUDE_CODE_USE_GEMINI: '1' }, () => {
    expect(getDefaultOpusModel()).toBe('gemini-2.5-pro')
    expect(getDefaultSonnetModel()).toBe('gemini-2.0-flash')
    expect(getDefaultHaikuModel()).toBe('gemini-2.0-flash-lite')
  })
})

test('Gemini provider does not reference discontinued preview model', () => {
  runWithSandbox({ CLAUDE_CODE_USE_GEMINI: '1' }, () => {
    expect(getDefaultOpusModel()).not.toContain('gemini-2.5-pro-preview-03-25')
    expect(getDefaultSonnetModel()).not.toContain('gemini-2.5-pro-preview-03-25')
    expect(getDefaultHaikuModel()).not.toContain('gemini-2.5-pro-preview-03-25')
  })
})

test('Gemini provider correctly applies GEMINI_MODEL environment override', () => {
  runWithSandbox({ CLAUDE_CODE_USE_GEMINI: '1', GEMINI_MODEL: 'gemini-override' }, () => {
    expect(getDefaultOpusModel()).toBe('gemini-override')
    expect(getDefaultSonnetModel()).toBe('gemini-override')
    expect(getDefaultHaikuModel()).toBe('gemini-override')
  })
})

test('Gemini provider main loop setting defaults to sonnet', () => {
  runWithSandbox({ CLAUDE_CODE_USE_GEMINI: '1' }, () => {
    expect(getDefaultMainLoopModelSetting()).toBe('gemini-2.0-flash')
  })
})

test('Gemini provider main loop setting respects GEMINI_MODEL override', () => {
  runWithSandbox({ CLAUDE_CODE_USE_GEMINI: '1', GEMINI_MODEL: 'gemini-override' }, () => {
    expect(getDefaultMainLoopModelSetting()).toBe('gemini-override')
  })
})

// --- OpenAI Provider Tests ---

test('OpenAI provider loads expected default models (Fallback logic check)', () => {
  runWithSandbox({ CLAUDE_CODE_USE_OPENAI: '1' }, () => {
    expect(getDefaultOpusModel()).toBe('gpt-4o')
    expect(getDefaultSonnetModel()).toBe('gpt-4o')
    expect(getDefaultHaikuModel()).toBe('gpt-4o-mini')
  })
})

test('OpenAI provider correctly applies OPENAI_MODEL environment override', () => {
  runWithSandbox({ CLAUDE_CODE_USE_OPENAI: '1', OPENAI_MODEL: 'openai-override' }, () => {
    expect(getDefaultOpusModel()).toBe('openai-override')
    expect(getDefaultSonnetModel()).toBe('openai-override')
    expect(getDefaultHaikuModel()).toBe('openai-override')
  })
})

test('OpenAI provider main loop setting defaults to opus', () => {
  runWithSandbox({ CLAUDE_CODE_USE_OPENAI: '1' }, () => {
    expect(getDefaultMainLoopModelSetting()).toBe('gpt-4o')
  })
})

test('OpenAI provider main loop setting respects OPENAI_MODEL override', () => {
  runWithSandbox({ CLAUDE_CODE_USE_OPENAI: '1', OPENAI_MODEL: 'openai-override' }, () => {
    expect(getDefaultMainLoopModelSetting()).toBe('openai-override')
  })
})

// --- Codex Provider Tests ---

test('Codex provider loads expected default models (Fallback logic check)', () => {
  runWithSandbox({}, (spies) => {
    const providerSpy = spyOn(providers, 'getAPIProvider').mockReturnValue('codex')
    spies.push(providerSpy)
    
    expect(getDefaultOpusModel()).toBe('gpt-5.4')
    expect(getDefaultSonnetModel()).toBe('gpt-5.4')
    expect(getDefaultHaikuModel()).toBe('gpt-5.4-mini')
  })
})

test('Codex provider correctly applies OPENAI_MODEL environment override', () => {
  runWithSandbox({ OPENAI_MODEL: 'codex-override' }, (spies) => {
    const providerSpy = spyOn(providers, 'getAPIProvider').mockReturnValue('codex')
    spies.push(providerSpy)
    
    expect(getDefaultOpusModel()).toBe('codex-override')
    expect(getDefaultSonnetModel()).toBe('codex-override')
    expect(getDefaultHaikuModel()).toBe('codex-override')
  })
})

test('Codex provider main loop setting defaults to opus', () => {
  runWithSandbox({}, (spies) => {
    const providerSpy = spyOn(providers, 'getAPIProvider').mockReturnValue('codex')
    spies.push(providerSpy)
    
    expect(getDefaultMainLoopModelSetting()).toBe('gpt-5.4')
  })
})

test('Codex provider main loop setting respects OPENAI_MODEL override', () => {
  runWithSandbox({ OPENAI_MODEL: 'codex-override' }, (spies) => {
    const providerSpy = spyOn(providers, 'getAPIProvider').mockReturnValue('codex')
    spies.push(providerSpy)
    
    expect(getDefaultMainLoopModelSetting()).toBe('codex-override')
  })
})