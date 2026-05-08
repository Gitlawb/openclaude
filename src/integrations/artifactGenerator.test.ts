import { mkdtemp, mkdir, rm, writeFile } from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'

import { describe, expect, test } from 'bun:test'

import {
  generateIntegrationArtifacts,
  generatedIntegrationArtifactsAreCurrent,
} from './artifactGenerator.js'

const FIXTURE_DIRS = [
  'src/integrations/vendors',
  'src/integrations/gateways',
  'src/integrations/anthropicProxies',
  'src/integrations/brands',
  'src/integrations/models',
  'src/integrations/modelCatalog/providers',
] as const

async function withFixtureRepo(
  files: Record<string, string>,
  callback: (repoRoot: string) => Promise<void>,
): Promise<void> {
  const repoRoot = await mkdtemp(
    path.join(os.tmpdir(), 'openclaude-integration-artifacts-'),
  )

  try {
    for (const dir of FIXTURE_DIRS) {
      await mkdir(path.join(repoRoot, dir), { recursive: true })
    }

    for (const [relativePath, content] of Object.entries(files)) {
      const absolutePath = path.join(repoRoot, relativePath)
      await mkdir(path.dirname(absolutePath), { recursive: true })
      await writeFile(absolutePath, content, 'utf8')
    }

    await callback(repoRoot)
  } finally {
    await rm(repoRoot, { recursive: true, force: true })
  }
}

describe('integration artifact generator', () => {
  test('checked-in generated artifacts are current', async () => {
    await expect(generatedIntegrationArtifactsAreCurrent()).resolves.toBe(true)
  })

  test('derives loader and preset manifest entries for a preset gateway from descriptor files', async () => {
    await withFixtureRepo(
      {
        'src/integrations/vendors/openai.ts': `export default {
  id: 'openai',
  label: 'OpenAI',
  classification: 'openai-compatible',
  defaultBaseUrl: 'https://api.openai.com/v1',
  setup: { requiresAuth: true, authMode: 'api-key', credentialEnvVars: ['OPENAI_API_KEY'] },
  transportConfig: { kind: 'openai-compatible' },
  usage: { supported: false },
}
`,
        'src/integrations/gateways/acme.ts': `export default {
  id: 'acme',
  label: 'Acme Gateway',
  defaultBaseUrl: 'https://gateway.acme.test/v1',
  setup: { requiresAuth: true, authMode: 'api-key', credentialEnvVars: ['ACME_API_KEY'] },
  transportConfig: { kind: 'openai-compatible' },
  preset: {
    id: 'acme-gateway',
    description: 'Acme hosted gateway',
    vendorId: 'openai',
    apiKeyEnvVars: ['ACME_API_KEY'],
  },
  catalog: {
    source: 'static',
    models: [{ id: 'acme-fast', apiName: 'acme-fast', default: true }],
  },
  usage: { supported: false },
}
`,
      },
      async repoRoot => {
        const [{ content }] = await generateIntegrationArtifacts({ repoRoot })

        expect(content).toContain("import gatewayAcme from '../gateways/acme.js'")
        expect(content).toContain('"preset": "acme-gateway"')
        expect(content).toContain('"gatewayId": "acme"')
        expect(content).toContain('"routeId": "acme"')
      },
    )
  })

  test('derives loader and preset manifest entries for a direct first-party vendor from descriptor files', async () => {
    await withFixtureRepo(
      {
        'src/integrations/vendors/acme-first-party.ts': `export default {
  id: 'acme-first-party',
  label: 'Acme First Party',
  classification: 'openai-compatible',
  defaultBaseUrl: 'https://api.acme.test/v1',
  setup: { requiresAuth: true, authMode: 'api-key', credentialEnvVars: ['ACME_API_KEY'] },
  transportConfig: { kind: 'openai-compatible' },
  preset: {
    id: 'acme-direct',
    description: 'Acme direct API',
    apiKeyEnvVars: ['ACME_API_KEY'],
  },
  catalog: {
    source: 'static',
    models: [{ id: 'acme-fast', apiName: 'acme-fast', default: true }],
  },
  usage: { supported: false },
}
`,
      },
      async repoRoot => {
        const [{ content }] = await generateIntegrationArtifacts({ repoRoot })

        expect(content).toContain(
          "import vendorAcmeFirstParty from '../vendors/acme-first-party.js'",
        )
        expect(content).toContain('"preset": "acme-direct"')
        expect(content).toContain('"routeId": "acme-first-party"')
        expect(content).toContain('"vendorId": "acme-first-party"')
      },
    )
  })

  test('generates provider catalog static imports from provider JSON files', async () => {
    await withFixtureRepo(
      {
        'src/integrations/modelCatalog/providers/zeta-provider.json': `{
  "schemaVersion": 1,
  "provider": "zeta-provider",
  "label": "Zeta Provider",
  "baseUrl": "https://zeta.example/v1",
  "endpoints": {
    "chatCompletions": {
      "path": "/chat/completions",
      "protocol": "openai-chat-completions"
    }
  },
  "defaults": {
    "endpoint": "chatCompletions"
  },
  "models": {
    "zeta-fast": {
      "label": "Zeta Fast",
      "apiName": "zeta-fast",
      "visibility": { "defaultFor": ["main"] }
    }
  }
}
`,
        'src/integrations/modelCatalog/providers/alpha-provider.json': `{
  "schemaVersion": 1,
  "provider": "alpha-provider",
  "label": "Alpha Provider",
  "baseUrl": "https://alpha.example/v1",
  "endpoints": {
    "chatCompletions": {
      "path": "/chat/completions",
      "protocol": "openai-chat-completions"
    }
  },
  "defaults": {
    "endpoint": "chatCompletions"
  },
  "models": {
    "alpha-fast": {
      "label": "Alpha Fast",
      "apiName": "alpha-fast",
      "visibility": { "defaultFor": ["main"] }
    }
  }
}
`,
      },
      async repoRoot => {
        const artifacts = await generateIntegrationArtifacts({ repoRoot })
        const providerCatalogArtifact = artifacts.find(artifact =>
          artifact.path.endsWith(
            'src/integrations/modelCatalog/providerCatalogs.generated.ts',
          ),
        )

        expect(providerCatalogArtifact).toBeDefined()
        expect(providerCatalogArtifact?.content).toContain(
          "import providerCatalogAlphaProvider from './providers/alpha-provider.json'",
        )
        expect(providerCatalogArtifact?.content).toContain(
          "import providerCatalogZetaProvider from './providers/zeta-provider.json'",
        )
        expect(providerCatalogArtifact?.content).toMatch(
          /export const PROVIDER_CATALOGS = \[\n  providerCatalogAlphaProvider,\n  providerCatalogZetaProvider,\n\] as const satisfies readonly ProviderCatalog\[\]/,
        )
      },
    )
  })

  test('pins anthropic to the top, sorts the rest by description, and keeps custom at the bottom', async () => {
    await withFixtureRepo(
      {
        'src/integrations/vendors/anthropic.ts': `export default {
  id: 'anthropic',
  label: 'Anthropic',
  classification: 'anthropic',
  defaultBaseUrl: 'https://api.anthropic.com',
  setup: { requiresAuth: true, authMode: 'api-key', credentialEnvVars: ['ANTHROPIC_API_KEY'] },
  transportConfig: { kind: 'anthropic-native' },
  preset: {
    id: 'anthropic',
    description: 'Zulu direct API',
    apiKeyEnvVars: ['ANTHROPIC_API_KEY'],
    fallbackModel: 'claude-sonnet-4-6',
  },
  usage: { supported: false },
}
`,
        'src/integrations/vendors/openai.ts': `export default {
  id: 'openai',
  label: 'OpenAI',
  classification: 'openai-compatible',
  defaultBaseUrl: 'https://api.openai.com/v1',
  setup: { requiresAuth: true, authMode: 'api-key', credentialEnvVars: ['OPENAI_API_KEY'] },
  transportConfig: { kind: 'openai-compatible' },
  usage: { supported: false },
}
`,
        'src/integrations/gateways/zeta.ts': `export default {
  id: 'zeta',
  label: 'Zeta',
  defaultBaseUrl: 'https://zeta.test/v1',
  setup: { requiresAuth: true, authMode: 'api-key', credentialEnvVars: ['ZETA_API_KEY'] },
  transportConfig: { kind: 'openai-compatible' },
  preset: {
    id: 'zeta',
    description: 'Zeta 10',
    vendorId: 'openai',
    apiKeyEnvVars: ['ZETA_API_KEY'],
  },
  catalog: { source: 'static', models: [{ id: 'zeta', apiName: 'zeta', default: true }] },
  usage: { supported: false },
}
`,
        'src/integrations/gateways/alpha.ts': `export default {
  id: 'alpha',
  label: 'Alpha',
  defaultBaseUrl: 'https://alpha.test/v1',
  setup: { requiresAuth: true, authMode: 'api-key', credentialEnvVars: ['ALPHA_API_KEY'] },
  transportConfig: { kind: 'openai-compatible' },
  preset: {
    id: 'alpha',
    description: 'Alpha 2',
    vendorId: 'openai',
    apiKeyEnvVars: ['ALPHA_API_KEY'],
  },
  catalog: { source: 'static', models: [{ id: 'alpha', apiName: 'alpha', default: true }] },
  usage: { supported: false },
}
`,
        'src/integrations/gateways/custom.ts': `export default {
  id: 'custom',
  label: 'Custom',
  setup: { requiresAuth: false, authMode: 'api-key' },
  transportConfig: { kind: 'openai-compatible' },
  preset: {
    id: 'custom',
    description: 'Any OpenAI-compatible provider',
    vendorId: 'openai',
    apiKeyEnvVars: ['OPENAI_API_KEY'],
    fallbackBaseUrl: 'http://localhost:11434/v1',
    fallbackModel: 'local-model',
  },
  catalog: { source: 'static', models: [] },
  usage: { supported: false },
}
`,
      },
      async repoRoot => {
        const [{ content }] = await generateIntegrationArtifacts({ repoRoot })

        const orderedMatch = content.match(
          /export const ORDERED_PROVIDER_PRESETS = \[\n([\s\S]*?)\n\] as const/,
        )
        expect(orderedMatch).not.toBeNull()
        const orderedPresetIds = Array.from(
          orderedMatch![1]!.matchAll(/"([^"]+)"/g),
          match => match[1]!,
        )

        expect(orderedPresetIds).toEqual(['anthropic', 'alpha', 'zeta', 'custom'])
      },
    )
  })
})
