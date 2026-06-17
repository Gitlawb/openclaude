/**
 * Regression tests for issue #402 — NODE_OPTIONS heap cap
 * Closes: Gitlawb/openclaude#402 — JavaScript heap OOM during large tasks
 */

import { describe, it, expect, beforeEach, afterEach } from 'bun:test'

describe('cli.tsx — NODE_OPTIONS --max-old-space-size (issue #402)', () => {
  const originalNodeOptions = process.env.NODE_OPTIONS

  beforeEach(() => {
    delete process.env.NODE_OPTIONS
  })

  afterEach(() => {
    if (originalNodeOptions !== undefined) {
      process.env.NODE_OPTIONS = originalNodeOptions
    } else {
      delete process.env.NODE_OPTIONS
    }
  })

  it('sets --max-old-space-size=8192 when NODE_OPTIONS is not set', () => {
    // Guard predicate: fires when the flag is absent
    const shouldSetHeapCap = !process.env.NODE_OPTIONS?.includes('--max-old-space-size')
    expect(shouldSetHeapCap).toBe(true)
  })

  it('does not override existing --max-old-space-size=4096', () => {
    process.env.NODE_OPTIONS = '--max-old-space-size=4096 --experimental-vm-modules'

    const shouldSetHeapCap = !process.env.NODE_OPTIONS.includes('--max-old-space-size')
    expect(shouldSetHeapCap).toBe(false)
    expect(process.env.NODE_OPTIONS).toContain('4096')
  })

  it('does not override existing --max-old-space-size=8192', () => {
    process.env.NODE_OPTIONS = '--max-old-space-size=8192'

    const shouldSetHeapCap = !process.env.NODE_OPTIONS.includes('--max-old-space-size')
    expect(shouldSetHeapCap).toBe(false)
    expect(process.env.NODE_OPTIONS).toBe('--max-old-space-size=8192')
  })

  it('appends --max-old-space-size when NODE_OPTIONS has other flags', () => {
    process.env.NODE_OPTIONS = '--inspect=9229'

    const result = `${process.env.NODE_OPTIONS} --max-old-space-size=8192`
    expect(result).toBe('--inspect=9229 --max-old-space-size=8192')
  })
})

describe('useMemoryUsage.ts — threshold constants (issue #402)', () => {
  it('HIGH_MEMORY_THRESHOLD documented as 1.5 GB', async () => {
    const src = await Bun.file(
      `${import.meta.dir}/../hooks/useMemoryUsage.ts`,
    ).text()

    expect(src).toContain('HIGH_MEMORY_THRESHOLD = 1.5 * 1024 * 1024 * 1024')
  })

  it('CRITICAL_MEMORY_THRESHOLD documented as 2.5 GB', async () => {
    const src = await Bun.file(
      `${import.meta.dir}/../hooks/useMemoryUsage.ts`,
    ).text()

    expect(src).toContain('CRITICAL_MEMORY_THRESHOLD = 2.5 * 1024 * 1024 * 1024')
  })
})

describe('Node 24 premature exit regression (issue #1678)', () => {
  it('un-awaited top-level promises lead to premature exit when no handles remain', async () => {
    const { $ } = await import('bun')
    const cacheDir = `${import.meta.dir}/../../.cache`
    await $`mkdir -p ${cacheDir}`

    const scriptPathVoid = `${cacheDir}/test-void.mjs`
    await Bun.write(scriptPathVoid, `
      async function main() {
        // A promise that never resolves, but uses no event loop handles (e.g. pending dynamic import resolution state)
        await new Promise(() => {});
        console.log('UNREACHABLE');
      }
      void main();
    `)
    
    const resVoid = await $`node ${scriptPathVoid}`.nothrow()
    // Process exits immediately (with 0) because the promise has no handles, reproducing the bug
    expect(resVoid.exitCode).toBe(0)
    expect(resVoid.stdout.toString()).not.toContain('UNREACHABLE')

    const scriptPathAwait = `${cacheDir}/test-await.mjs`
    await Bun.write(scriptPathAwait, `
      async function main() {
        // We set a timer to prove the process stays alive because of the top-level await
        setTimeout(() => { console.log('KEPT_ALIVE'); process.exit(0); }, 50);
        await new Promise(() => {});
      }
      await main();
    `)
    
    const resAwait = await $`node ${scriptPathAwait}`.nothrow()
    // Process stays alive until our timeout exits it
    expect(resAwait.exitCode).toBe(0)
    expect(resAwait.stdout.toString()).toContain('KEPT_ALIVE')
  })

  it('cli.tsx uses top-level await for main() to prevent premature exit', async () => {
    const src = await Bun.file(`${import.meta.dir}/cli.tsx`).text()
    expect(src).toMatch(/await main\(\)/)
    expect(src).not.toMatch(/^void main\(\)/m)
  })
})
