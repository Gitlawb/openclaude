import { describe, expect, test } from 'bun:test'
import { validateProviderCatalog } from './schema.js'
import type { ProviderCatalog } from './types.js'

function validCatalog(overrides: Partial<ProviderCatalog> = {}): ProviderCatalog {
  return {
    schemaVersion: 1,
    provider: 'fixture',
    label: 'Fixture',
    baseUrl: 'https://example.com/v1',
    endpoints: {
      chatCompletions: {
        path: '/chat/completions',
        protocol: 'openai-chat-completions',
        streaming: true,
      },
      models: {
        path: '/models',
        protocol: 'models-list',
      },
    },
    defaults: {
      endpoint: 'chatCompletions',
      limits: {
        contextWindow: 128000,
        maxOutputTokens: { default: 8192, upperLimit: 32768 },
      },
    },
    models: {
      'fixture-model': {
        label: 'Fixture Model',
        endpoint: 'chatCompletions',
      },
    },
    ...overrides,
  }
}

describe('provider catalog schema', () => {
  test('accepts a valid provider catalog', () => {
    expect(validateProviderCatalog(validCatalog())).toEqual({
      valid: true,
      errors: [],
    })
  })

  test('rejects a model that references a missing endpoint', () => {
    const result = validateProviderCatalog(
      validCatalog({
        models: {
          'fixture-model': {
            label: 'Fixture Model',
            endpoint: 'missingEndpoint',
          },
        },
      }),
    )

    expect(result.valid).toBe(false)
    expect(result.errors).toContain(
      'model "fixture-model" references missing endpoint "missingEndpoint"',
    )
  })

  test('rejects defaults that reference a missing endpoint', () => {
    const result = validateProviderCatalog(
      validCatalog({
        defaults: {
          endpoint: 'missingEndpoint',
        },
      }),
    )

    expect(result.valid).toBe(false)
    expect(result.errors).toContain(
      'defaults.endpoint references missing endpoint "missingEndpoint"',
    )
  })

  test('rejects discovery that references a missing endpoint', () => {
    const result = validateProviderCatalog(
      validCatalog({
        discovery: {
          endpoint: 'missingEndpoint',
          parser: 'openai-models-list',
        },
      }),
    )

    expect(result.valid).toBe(false)
    expect(result.errors).toContain(
      'discovery references missing endpoint "missingEndpoint"',
    )
  })

  test('rejects a model without an explicit or default endpoint', () => {
    const result = validateProviderCatalog(
      validCatalog({
        defaults: {
          limits: {
            contextWindow: 128000,
            maxOutputTokens: { default: 8192, upperLimit: 32768 },
          },
        },
        models: {
          'fixture-model': {
            label: 'Fixture Model',
          },
        },
      }),
    )

    expect(result.valid).toBe(false)
    expect(result.errors).toContain(
      'model "fixture-model" must define an endpoint or inherit one from templates/defaults',
    )
  })

  test('accepts a model that inherits endpoint from an extended template', () => {
    const result = validateProviderCatalog(
      validCatalog({
        defaults: {
          limits: {
            contextWindow: 128000,
            maxOutputTokens: { default: 8192, upperLimit: 32768 },
          },
        },
        templates: {
          messagesTemplate: {
            endpoint: 'models',
          },
        },
        models: {
          'fixture-model': {
            label: 'Fixture Model',
            extends: ['messagesTemplate'],
          },
        },
      }),
    )

    expect(result).toEqual({
      valid: true,
      errors: [],
    })
  })

  test('validates the endpoint from the last endpoint-bearing template', () => {
    const result = validateProviderCatalog(
      validCatalog({
        defaults: {
          limits: {
            contextWindow: 128000,
            maxOutputTokens: { default: 8192, upperLimit: 32768 },
          },
        },
        templates: {
          chatTemplate: {
            endpoint: 'chatCompletions',
          },
          modelsTemplate: {
            endpoint: 'models',
          },
        },
        models: {
          'fixture-model': {
            label: 'Fixture Model',
            extends: ['chatTemplate', 'modelsTemplate'],
          },
        },
      }),
    )

    expect(result).toEqual({
      valid: true,
      errors: [],
    })
  })

  test('rejects an invalid endpoint inherited from the last endpoint-bearing template', () => {
    const result = validateProviderCatalog(
      validCatalog({
        defaults: {
          limits: {
            contextWindow: 128000,
            maxOutputTokens: { default: 8192, upperLimit: 32768 },
          },
        },
        templates: {
          chatTemplate: {
            endpoint: 'chatCompletions',
          },
          missingEndpointTemplate: {
            endpoint: 'missingEndpoint',
          },
        } as ProviderCatalog['templates'],
        models: {
          'fixture-model': {
            label: 'Fixture Model',
            extends: ['chatTemplate', 'missingEndpointTemplate'],
          },
        },
      }),
    )

    expect(result.valid).toBe(false)
    expect(result.errors).toContain(
      'model "fixture-model" references missing endpoint "missingEndpoint"',
    )
  })

  test('rejects a model that references a missing fallback endpoint', () => {
    const result = validateProviderCatalog(
      validCatalog({
        models: {
          'fixture-model': {
            label: 'Fixture Model',
            endpoint: 'chatCompletions',
            fallbackEndpoint: 'missingEndpoint',
          },
        },
      }),
    )

    expect(result.valid).toBe(false)
    expect(result.errors).toContain(
      'model "fixture-model" references missing fallback endpoint "missingEndpoint"',
    )
  })

  test('rejects a model that extends a missing template', () => {
    const result = validateProviderCatalog(
      validCatalog({
        models: {
          'fixture-model': {
            label: 'Fixture Model',
            endpoint: 'chatCompletions',
            extends: ['missingTemplate'],
          },
        },
      }),
    )

    expect(result.valid).toBe(false)
    expect(result.errors).toContain(
      'model "fixture-model" references missing template "missingTemplate"',
    )
  })

  test('rejects model max output defaults above upper limits', () => {
    const result = validateProviderCatalog(
      validCatalog({
        models: {
          'fixture-model': {
            label: 'Fixture Model',
            endpoint: 'chatCompletions',
            limits: {
              maxOutputTokens: { default: 64000, upperLimit: 32768 },
            },
          },
        },
      }),
    )

    expect(result.valid).toBe(false)
    expect(result.errors).toContain(
      'model "fixture-model".limits.maxOutputTokens.default must be <= upperLimit',
    )
  })

  test('rejects duplicate normalized aliases within one model', () => {
    const result = validateProviderCatalog(
      validCatalog({
        models: {
          'fixture-model': {
            label: 'Fixture Model',
            endpoint: 'chatCompletions',
            aliases: ['Fixture Alias', ' fixture alias '],
          },
        },
      }),
    )

    expect(result.valid).toBe(false)
    expect(result.errors).toContain(
      'alias " fixture alias " is duplicated within model "fixture-model"',
    )
  })

  test('rejects duplicate normalized aliases across models', () => {
    const result = validateProviderCatalog(
      validCatalog({
        models: {
          'fixture-model': {
            label: 'Fixture Model',
            endpoint: 'chatCompletions',
            aliases: ['Shared Alias'],
          },
          'second-model': {
            label: 'Second Model',
            endpoint: 'chatCompletions',
            aliases: [' shared alias '],
          },
        },
      }),
    )

    expect(result.valid).toBe(false)
    expect(result.errors).toContain(
      'alias " shared alias " is used by both "fixture-model" and "second-model"',
    )
  })

  test('allows template metadata extensions', () => {
    expect(
      validateProviderCatalog(
        validCatalog({
          templates: {
            futureMetadata: {
              label: 'Future Metadata',
              vendorMetadata: {
                rollout: 'canary',
              },
            },
          } as ProviderCatalog['templates'],
        }),
      ),
    ).toEqual({
      valid: true,
      errors: [],
    })
  })

  test('allows template partial known nested fragments', () => {
    expect(
      validateProviderCatalog(
        validCatalog({
          templates: {
            partialPricing: {
              pricing: { input: 1 },
            },
          } as ProviderCatalog['templates'],
        }),
      ),
    ).toEqual({
      valid: true,
      errors: [],
    })
  })

  test('rejects negative template pricing values', () => {
    const result = validateProviderCatalog(
      validCatalog({
        templates: {
          badPricing: {
            pricing: { input: -1 },
          },
        } as ProviderCatalog['templates'],
      }),
    )

    expect(result.valid).toBe(false)
    expect(result.errors.length).toBeGreaterThan(0)
  })

  test('rejects invalid template token limits', () => {
    const result = validateProviderCatalog(
      validCatalog({
        templates: {
          badLimits: {
            limits: { contextWindow: 0 },
          },
        } as ProviderCatalog['templates'],
      }),
    )

    expect(result.valid).toBe(false)
    expect(result.errors.length).toBeGreaterThan(0)
  })

  test('rejects non-string template endpoints', () => {
    const result = validateProviderCatalog(
      validCatalog({
        templates: {
          badEndpointType: {
            endpoint: 1,
          },
        } as any,
      }),
    )

    expect(result.valid).toBe(false)
    expect(result.errors.length).toBeGreaterThan(0)
  })

  test('rejects non-string template fallback endpoints', () => {
    const result = validateProviderCatalog(
      validCatalog({
        templates: {
          badFallbackType: {
            fallbackEndpoint: 1,
          },
        } as any,
      }),
    )

    expect(result.valid).toBe(false)
    expect(result.errors.length).toBeGreaterThan(0)
  })

  test('rejects invalid template extends values', () => {
    const result = validateProviderCatalog(
      validCatalog({
        templates: {
          badExtendsType: {
            extends: [1],
          },
        } as any,
      }),
    )

    expect(result.valid).toBe(false)
    expect(result.errors.length).toBeGreaterThan(0)
  })

  test('rejects a template that references a missing endpoint', () => {
    const result = validateProviderCatalog(
      validCatalog({
        templates: {
          badEndpoint: {
            endpoint: 'missingEndpoint',
          },
        } as ProviderCatalog['templates'],
      }),
    )

    expect(result.valid).toBe(false)
    expect(result.errors).toContain(
      'template "badEndpoint" references missing endpoint "missingEndpoint"',
    )
  })

  test('rejects a template that references a missing fallback endpoint', () => {
    const result = validateProviderCatalog(
      validCatalog({
        templates: {
          badFallback: {
            fallbackEndpoint: 'missingEndpoint',
          },
        } as ProviderCatalog['templates'],
      }),
    )

    expect(result.valid).toBe(false)
    expect(result.errors).toContain(
      'template "badFallback" references missing fallback endpoint "missingEndpoint"',
    )
  })

  test('rejects a template that extends a missing template', () => {
    const result = validateProviderCatalog(
      validCatalog({
        templates: {
          badExtends: {
            extends: ['missingTemplate'],
          },
        } as ProviderCatalog['templates'],
      }),
    )

    expect(result.valid).toBe(false)
    expect(result.errors).toContain(
      'template "badExtends" references missing template "missingTemplate"',
    )
  })

  test('rejects template max output defaults above upper limits', () => {
    const result = validateProviderCatalog(
      validCatalog({
        templates: {
          badLimits: {
            limits: {
              maxOutputTokens: { default: 64000, upperLimit: 32768 },
            },
          },
        } as ProviderCatalog['templates'],
      }),
    )

    expect(result.valid).toBe(false)
    expect(result.errors).toContain(
      'template "badLimits".limits.maxOutputTokens.default must be <= upperLimit',
    )
  })

  test('rejects unknown fields on full model entries', () => {
    const result = validateProviderCatalog(
      validCatalog({
        models: {
          'fixture-model': {
            label: 'Fixture Model',
            endpoint: 'chatCompletions',
            unknownModelField: true,
          } as any,
        },
      }),
    )

    expect(result.valid).toBe(false)
    expect(result.errors.some((error) => error.includes('additional properties'))).toBe(
      true,
    )
  })

  test('rejects invalid numeric catalog constraints', () => {
    const result = validateProviderCatalog(
      validCatalog({
        defaults: {
          endpoint: 'chatCompletions',
          limits: {
            contextWindow: 0,
            maxInputTokens: 1.5,
            maxOutputTokens: { default: -1, upperLimit: 32768 },
          },
          pricing: {
            input: -0.1,
            output: 1,
          },
        },
      }),
    )

    expect(result.valid).toBe(false)
    expect(result.errors.length).toBeGreaterThanOrEqual(4)
  })

  test('rejects invalid catalog array values', () => {
    const result = validateProviderCatalog(
      validCatalog({
        models: {
          'fixture-model': {
            label: 'Fixture Model',
            endpoint: 'chatCompletions',
            classification: ['chat', 'chat'],
            aliases: [''],
            request: {
              removeBodyFields: [''],
            },
          },
        },
      }),
    )

    expect(result.valid).toBe(false)
    expect(result.errors.length).toBeGreaterThanOrEqual(3)
  })

  test('rejects max output defaults above upper limits', () => {
    const result = validateProviderCatalog(
      validCatalog({
        defaults: {
          endpoint: 'chatCompletions',
          limits: {
            contextWindow: 128000,
            maxOutputTokens: { default: 64000, upperLimit: 32768 },
          },
        },
      }),
    )

    expect(result.valid).toBe(false)
    expect(result.errors).toContain(
      'defaults.limits.maxOutputTokens.default must be <= upperLimit',
    )
  })
})
