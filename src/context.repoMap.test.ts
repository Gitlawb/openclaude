import { describe, expect, test } from 'bun:test'

// The feature() function from bun:bundle is shimmed at build time.
// In tests, it's not available, so we test the getRepoMapContext logic
// by importing and calling it directly — the function checks feature('REPO_MAP')
// which in the test environment (no bun:bundle shim) will throw or return false.
// We test the actual logic paths through integration-style tests.

describe('getRepoMapContext', () => {
  test('returns null when REPO_MAP flag is off (default)', async () => {
    const { getRepoMapContext } = await import('./context.js')
    const previous = process.env.REPO_MAP
    delete process.env.REPO_MAP
    getRepoMapContext.cache.clear?.()

    try {
      await expect(getRepoMapContext()).resolves.toBeNull()
    } finally {
      if (previous === undefined) delete process.env.REPO_MAP
      else process.env.REPO_MAP = previous
      getRepoMapContext.cache.clear?.()
    }
  })

  test('buildRepoMap produces valid output for context injection', async () => {
    const { mkdtempSync, writeFileSync, rmSync } = await import('fs')
    const { tmpdir } = await import('os')
    const { join } = await import('path')
    const { buildRepoMap } = await import('./context/repoMap/index.js')

    const tempDir = mkdtempSync(join(tmpdir(), 'repomap-ctx-'))
    try {
      writeFileSync(
        join(tempDir, 'main.ts'),
        'export function main(): void { console.log("hello") }\n',
      )
      writeFileSync(
        join(tempDir, 'utils.ts'),
        'import { main } from "./main"\nexport function helper(): void { main() }\n',
      )

      const result = await buildRepoMap({
        root: tempDir,
        maxTokens: 1024,
      })

      // Valid map that could be injected
      expect(result.map.length).toBeGreaterThan(0)
      expect(result.tokenCount).toBeGreaterThan(0)
      expect(result.tokenCount).toBeLessThanOrEqual(1024)
      expect(typeof result.cacheHit).toBe('boolean')
    } finally {
      rmSync(tempDir, { recursive: true, force: true })
      const { invalidateCache } = await import('./context/repoMap/index.js')
      invalidateCache(tempDir)
    }
  })

  test('getSystemContext does not include repoMap key when flag is off', async () => {
    const { getRepoMapContext, getSystemContext } = await import('./context.js')
    const previousRepoMap = process.env.REPO_MAP
    const previousRemote = process.env.CLAUDE_CODE_REMOTE
    delete process.env.REPO_MAP
    process.env.CLAUDE_CODE_REMOTE = '1'
    getRepoMapContext.cache.clear?.()
    getSystemContext.cache.clear?.()

    try {
      const context = await getSystemContext()
      expect(context).not.toHaveProperty('repoMap')
    } finally {
      if (previousRepoMap === undefined) delete process.env.REPO_MAP
      else process.env.REPO_MAP = previousRepoMap
      if (previousRemote === undefined) delete process.env.CLAUDE_CODE_REMOTE
      else process.env.CLAUDE_CODE_REMOTE = previousRemote
      getRepoMapContext.cache.clear?.()
      getSystemContext.cache.clear?.()
    }
  })
})

describe('REPO_MAP feature flag', () => {
  test('flag defaults to false in build config', async () => {
    const { readFileSync } = await import('fs')
    const ts = await import('typescript')
    const source = ts.createSourceFile(
      'scripts/build.ts',
      readFileSync('scripts/build.ts', 'utf-8'),
      ts.ScriptTarget.Latest,
      true,
    )

    let repoMapFlag: boolean | null = null
    source.forEachChild(node => {
      if (!ts.isVariableStatement(node)) return
      for (const declaration of node.declarationList.declarations) {
        if (
          ts.isIdentifier(declaration.name) &&
          declaration.name.text === 'featureFlags' &&
          declaration.initializer &&
          ts.isObjectLiteralExpression(declaration.initializer)
        ) {
          const property = declaration.initializer.properties.find(prop =>
            ts.isPropertyAssignment(prop) &&
            ts.isIdentifier(prop.name) &&
            prop.name.text === 'REPO_MAP',
          )
          if (
            property &&
            ts.isPropertyAssignment(property) &&
            property.initializer.kind === ts.SyntaxKind.FalseKeyword
          ) {
            repoMapFlag = false
          }
        }
      }
    })

    expect(repoMapFlag as boolean | null).toBe(false)
  })
})
