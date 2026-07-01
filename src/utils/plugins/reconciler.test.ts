import { describe, expect, test } from 'bun:test'

import { diffMarketplaces } from './reconciler.js'
import type { DeclaredMarketplace } from './marketplaceManager.js'
import type { KnownMarketplacesFile, MarketplaceSource } from './schemas.js'

const githubSource = (repo: string): MarketplaceSource => ({
  source: 'github',
  repo,
})

const declared = (
  source: MarketplaceSource,
  sourceIsFallback = false,
): DeclaredMarketplace => ({ source, sourceIsFallback })

// Marketplace names are user-controlled (settings.json `extraKnownMarketplaces`).
// `diffMarketplaces` looks each declared name up in the materialized map with
// `materialized[name]`. If that map is a plain object — which the reconciler's
// error fallback used to produce — a name that collides with an
// `Object.prototype` member (constructor / toString / valueOf / hasOwnProperty)
// resolves to the inherited function instead of `undefined`, so the entry is
// misclassified as already-materialized (sourceChanged) instead of missing.
// Same prototype-pollution class as the marketplace cache fix in #1787.
describe('diffMarketplaces — prototype-named marketplaces', () => {
  for (const protoName of [
    'constructor',
    'toString',
    'valueOf',
    'hasOwnProperty',
  ]) {
    test(`treats a marketplace named "${protoName}" as missing when not materialized`, () => {
      const declaredMap: Record<string, DeclaredMarketplace> = {
        [protoName]: declared(githubSource('acme/plugins')),
      }
      // A plain object — exactly what an unsafe error fallback yields. The fix
      // must make the lookup own-property-exact so the inherited member can't
      // masquerade as a materialized entry.
      const materialized = {} as KnownMarketplacesFile

      const diff = diffMarketplaces(declaredMap, materialized)

      expect(diff.missing).toEqual([protoName])
      expect(diff.sourceChanged).toEqual([])
      expect(diff.upToDate).toEqual([])
    })
  }

  test('still classifies a real materialized entry as up to date', () => {
    const source = githubSource('acme/plugins')
    const declaredMap: Record<string, DeclaredMarketplace> = {
      'acme-plugins': declared(source),
    }
    const materialized = {
      'acme-plugins': {
        source,
        installLocation: '/home/u/.claude/plugins/marketplaces/acme-plugins',
      },
    } as unknown as KnownMarketplacesFile

    const diff = diffMarketplaces(declaredMap, materialized)

    expect(diff.upToDate).toEqual(['acme-plugins'])
    expect(diff.missing).toEqual([])
    expect(diff.sourceChanged).toEqual([])
  })

  test('reports a genuinely absent marketplace as missing', () => {
    const declaredMap: Record<string, DeclaredMarketplace> = {
      'never-seen': declared(githubSource('acme/other')),
    }
    const diff = diffMarketplaces(
      declaredMap,
      {} as KnownMarketplacesFile,
    )

    expect(diff.missing).toEqual(['never-seen'])
  })
})
