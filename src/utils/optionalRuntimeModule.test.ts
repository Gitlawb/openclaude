import { describe, expect, test } from 'bun:test'
import {
  importOptionalRuntimeModule,
  importRuntimeModule,
  isMissingSpecifierError,
} from './optionalRuntimeModule.js'

function moduleNotFound(message: string): Error {
  const e = new Error(message)
  ;(e as { code?: string }).code = 'ERR_MODULE_NOT_FOUND'
  return e
}

describe('importOptionalRuntimeModule', () => {
  test('throws an actionable error when the optional package is missing', async () => {
    const promise = importOptionalRuntimeModule(
      '@openclaude/does-not-exist-xyz',
      'Test Feature',
    )
    await expect(promise).rejects.toThrow(
      /Test Feature requires the "@openclaude\/does-not-exist-xyz" package, which is not installed\. Install it with `npm install @openclaude\/does-not-exist-xyz`/,
    )
  })

  test('resolves the module when it is present', async () => {
    // node: builtins are always resolvable — exercises the success path. The
    // type arg mirrors how production call sites declare the module contract.
    const mod = await importOptionalRuntimeModule<typeof import('node:path')>(
      'node:path',
      'Test Feature',
    )
    const join = mod.join ?? (mod as { default?: typeof import('node:path') }).default?.join
    expect(typeof join).toBe('function')
  })

  test('does not mask a missing package as the wrong feature specifier', async () => {
    // The friendly error must name the specifier we asked for.
    try {
      await importOptionalRuntimeModule('totally-absent-pkg-123', 'Vertex AI')
      throw new Error('expected rejection')
    } catch (e) {
      expect((e as Error).message).toContain('totally-absent-pkg-123')
      expect((e as Error).message).toContain('Vertex AI')
    }
  })
})

describe('isMissingSpecifierError', () => {
  test('matches the exact missing package, quoted', () => {
    expect(
      isMissingSpecifierError(
        moduleNotFound("Cannot find package 'sharp' imported from /x/y.js"),
        'sharp',
      ),
    ).toBe(true)
    expect(
      isMissingSpecifierError(
        moduleNotFound('Cannot find module "sharp" imported from /x/y.js'),
        'sharp',
      ),
    ).toBe(true)
  })

  test('does not misattribute a lookalike transitive package', () => {
    // A missing transitive dep whose name CONTAINS the specifier must not be
    // reported as the specifier itself.
    expect(
      isMissingSpecifierError(
        moduleNotFound("Cannot find package 'sharp-libvips-dev' imported from /x"),
        'sharp',
      ),
    ).toBe(false)
    expect(
      isMissingSpecifierError(
        moduleNotFound(
          "Cannot find package '@aws-sdk/client-bedrock-runtime' imported from /x",
        ),
        '@aws-sdk/client-bedrock',
      ),
    ).toBe(false)
  })

  test('ignores errors that are not ERR_MODULE_NOT_FOUND', () => {
    const other = new Error("Cannot find package 'sharp'")
    ;(other as { code?: string }).code = 'ERR_SOMETHING_ELSE'
    expect(isMissingSpecifierError(other, 'sharp')).toBe(false)
    expect(isMissingSpecifierError(undefined, 'sharp')).toBe(false)
  })
})

describe('importRuntimeModule', () => {
  test('rejects with the raw error for a missing module (no friendly wrapping)', async () => {
    const promise = importRuntimeModule('@openclaude/does-not-exist-xyz')
    // Raw error wording differs by runtime (Node: "Cannot find package",
    // Bun: "Cannot find module") — the point is it is NOT the friendly message.
    await expect(promise).rejects.toThrow(/Cannot find (module|package)/)
    await expect(promise).rejects.not.toThrow(/npm install/)
  })
})
