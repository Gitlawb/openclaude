import { describe, test, expect, beforeEach, afterEach } from 'bun:test'
import { mkdtempSync, rmSync, writeFileSync, mkdirSync } from 'fs'
import { tmpdir } from 'os'
import { join } from 'path'
import { detectManifests } from './manifests.js'

describe('detectManifests', () => {
  let tempDir: string

  beforeEach(() => {
    tempDir = mkdtempSync(join(tmpdir(), 'manifests-test-'))
  })

  afterEach(() => {
    rmSync(tempDir, { recursive: true, force: true })
  })

  test('detects package.json with scripts and deps', () => {
    writeFileSync(
      join(tempDir, 'package.json'),
      JSON.stringify({
        name: 'test-project',
        scripts: { build: 'tsc', test: 'bun test' },
        dependencies: { express: '^4.18.0' },
        devDependencies: { typescript: '^5.0.0' },
      }),
    )

    const results = detectManifests(tempDir)

    expect(results).toHaveLength(1)
    expect(results[0].type).toBe('npm')
    expect(results[0].language).toBe('TypeScript/JavaScript')
    expect(results[0].path).toBe('package.json')
    expect(results[0].framework).toBe('Express')
    expect(results[0].scripts).toEqual({ build: 'tsc', test: 'bun test' })
    expect(results[0].dependencies).toEqual({
      express: '^4.18.0',
      typescript: '^5.0.0',
    })
  })

  test('detects NestJS framework from @nestjs/core dependency', () => {
    writeFileSync(
      join(tempDir, 'package.json'),
      JSON.stringify({
        name: 'nest-app',
        dependencies: { '@nestjs/core': '^10.0.0', '@nestjs/common': '^10.0.0' },
      }),
    )

    const results = detectManifests(tempDir)

    expect(results).toHaveLength(1)
    expect(results[0].framework).toBe('NestJS')
  })

  test('detects Cargo.toml as Rust project', () => {
    writeFileSync(
      join(tempDir, 'Cargo.toml'),
      `[package]
name = "my-crate"
version = "0.1.0"

[dependencies]
serde = "1.0"
tokio = "1.28"
`,
    )

    const results = detectManifests(tempDir)

    expect(results).toHaveLength(1)
    expect(results[0].type).toBe('cargo')
    expect(results[0].language).toBe('Rust')
    expect(results[0].path).toBe('Cargo.toml')
    expect(results[0].dependencies).toEqual({
      serde: '1.0',
      tokio: '1.28',
    })
  })

  test('detects multiple manifests in root', () => {
    writeFileSync(
      join(tempDir, 'package.json'),
      JSON.stringify({ name: 'frontend', dependencies: { react: '^18.0.0' } }),
    )
    writeFileSync(join(tempDir, 'Gemfile'), 'source "https://rubygems.org"\ngem "rails"')

    const results = detectManifests(tempDir)

    expect(results).toHaveLength(2)
    const types = results.map((r) => r.type)
    expect(types).toContain('npm')
    expect(types).toContain('ruby')
  })

  test('detects manifests in subdirectories (monorepo)', () => {
    // Root manifest
    writeFileSync(
      join(tempDir, 'package.json'),
      JSON.stringify({ name: 'monorepo', private: true }),
    )

    // Sub-package manifest
    const pkgDir = join(tempDir, 'packages')
    mkdirSync(pkgDir)
    const subPkg = join(pkgDir, 'package.json')
    writeFileSync(
      subPkg,
      JSON.stringify({
        name: '@mono/api',
        dependencies: { '@nestjs/core': '^10.0.0' },
      }),
    )

    const results = detectManifests(tempDir)

    expect(results).toHaveLength(2)
    const paths = results.map((r) => r.path)
    expect(paths).toContain('package.json')
    expect(paths).toContain(join('packages', 'package.json'))

    const subResult = results.find((r) => r.path === join('packages', 'package.json'))
    expect(subResult?.framework).toBe('NestJS')
  })

  test('returns empty array for empty project', () => {
    const results = detectManifests(tempDir)
    expect(results).toEqual([])
  })

  test('handles malformed manifest (invalid JSON) gracefully', () => {
    writeFileSync(join(tempDir, 'package.json'), '{ this is not valid json }}}')

    const results = detectManifests(tempDir)

    expect(results).toHaveLength(1)
    expect(results[0].type).toBe('npm')
    expect(results[0].language).toBe('TypeScript/JavaScript')
    expect(results[0].framework).toBeUndefined()
    expect(results[0].scripts).toBeUndefined()
  })

  test('skips node_modules and .git directories', () => {
    // Create node_modules with a package.json inside
    const nmDir = join(tempDir, 'node_modules', 'some-pkg')
    mkdirSync(nmDir, { recursive: true })
    writeFileSync(
      join(nmDir, 'package.json'),
      JSON.stringify({ name: 'some-pkg' }),
    )

    // Create .git with something inside (hidden dir)
    const gitDir = join(tempDir, '.git')
    mkdirSync(gitDir, { recursive: true })

    // Create a legit subdirectory
    const srcDir = join(tempDir, 'api')
    mkdirSync(srcDir)
    writeFileSync(
      join(srcDir, 'package.json'),
      JSON.stringify({ name: 'api', dependencies: { fastify: '^4.0.0' } }),
    )

    const results = detectManifests(tempDir)

    // Should only find api/package.json, not node_modules or .git
    expect(results).toHaveLength(1)
    expect(results[0].path).toBe(join('api', 'package.json'))
    expect(results[0].framework).toBe('Fastify')
  })
})
