import { describe, expect, it, beforeEach, afterEach } from 'bun:test'
import { mkdtempSync, readFileSync, readdirSync, rmSync, existsSync, writeFileSync } from 'fs'
import { tmpdir } from 'os'
import { join } from 'path'
import { extractFactsIntoMemdir } from './autoExtractFacts.js'
import { setGovernancePolicySettingsForSourceForTesting } from '../utils/governancePolicy.js'

describe('autoExtractFacts', () => {
  let memDir: string

  beforeEach(() => {
    memDir = mkdtempSync(join(tmpdir(), 'auto-extract-facts-test-'))
    // Extraction respects the memory-write approval policy; tests opt in so
    // facts are actually persisted.
    delete process.env.CLAUDE_CODE_DISABLE_AUTO_MEMORY
    setGovernancePolicySettingsForSourceForTesting(() => ({
      memory: { requireApprovalBeforeWrite: false },
    }))
  })

  afterEach(() => {
    setGovernancePolicySettingsForSourceForTesting(null)
    rmSync(memDir, { recursive: true, force: true })
  })

  function factsDir(): string {
    return join(memDir, '.facts')
  }

  function countFactFiles(): number {
    const dir = factsDir()
    if (!existsSync(dir)) return 0
    return readdirSync(dir).filter(f => f.endsWith('.md')).length
  }

  it('extracts environment variables', async () => {
    await extractFactsIntoMemdir('export DATABASE_URL=postgres://localhost:5432/mydb', memDir)
    expect(countFactFiles()).toBeGreaterThan(0)
    const files = readdirSync(factsDir())
    expect(files.some(f => f.includes('database-url'))).toBe(true)
  })

  it('redacts quoted multi-token env values so no residue reaches concept extractors', async () => {
    // The value "my secret password" contains spaces; without proper quoting
    // the individual words would leak into scrubbedContent and get extracted
    // as concept facts.
    await extractFactsIntoMemdir(
      'export SECRET_TOKEN="my secret password"',
      memDir,
    )
    const files = readdirSync(factsDir())
    // env fact should exist
    expect(files.some(f => f.includes('secret-token') || f.includes('SECRET_TOKEN'))).toBe(true)
    // no concept fact should be created from the value tokens
    const conceptFacts = files.filter(f => f.startsWith('fact-concept-'))
    expect(conceptFacts.some(f => f.includes('secret'))).toBe(false)
    expect(conceptFacts.some(f => f.includes('password'))).toBe(false)
  })

  it('extracts versions', async () => {
    await extractFactsIntoMemdir('upgrade to v2.1.3 and use node v18', memDir)
    expect(countFactFiles()).toBeGreaterThan(0)
  })

  it('extracts URLs', async () => {
    await extractFactsIntoMemdir('deployed at https://api.example.com/v1/users', memDir)
    expect(countFactFiles()).toBeGreaterThan(0)
  })

  it('redacts credentials, query strings, and fragments from URL facts', async () => {
    await extractFactsIntoMemdir(
      'endpoint https://user:pass@api.example.com/path?secret=token#section here',
      memDir,
    )
    const files = readdirSync(factsDir()).filter(f => f.includes('api-example-com'))
    expect(files.length).toBeGreaterThan(0)
    const content = readFileSync(join(factsDir(), files[0]), 'utf-8')
    expect(content).toContain('https://api.example.com/path')
    expect(content).not.toContain('user:pass')
    expect(content).not.toContain('secret=token')
    expect(content).not.toContain('#section')
  })

  it('extracts absolute paths', async () => {
    await extractFactsIntoMemdir('the config is at /opt/app/config/settings.json', memDir)
    expect(countFactFiles()).toBeGreaterThan(0)
  })

  it('extracts backtick concepts', async () => {
    await extractFactsIntoMemdir('call the `PaymentProcessor` service', memDir)
    expect(countFactFiles()).toBeGreaterThan(0)
  })

  it('does not extract backtick-wrapped secret-like values', async () => {
    await extractFactsIntoMemdir(
      [
        'use key `sk-live-SUPERSECRET_123` for prod, `ghp_abc123def456ghi789` for CI,',
        'and `AKIAIOSFODNN7EXAMPLE` for AWS. The GitLab token is `glpat-abcdefghijklmnopqrstuvwxyz`.',
      ].join(' '),
      memDir,
    )
    const files = readdirSync(factsDir())
    const conceptFacts = files.filter(f => f.startsWith('fact-concept-'))
    expect(conceptFacts.some(f => f.includes('sk-live'))).toBe(false)
    expect(conceptFacts.some(f => f.includes('ghp_'))).toBe(false)
    expect(conceptFacts.some(f => f.includes('AKIA'))).toBe(false)
    expect(conceptFacts.some(f => f.includes('glpat-'))).toBe(false)
  })

  it('does not extract npm tokens from backticks', async () => {
    await extractFactsIntoMemdir(
      'install with `npm_abcdefghijklmnopqrstuvwxyzabcdefghij`',
      memDir,
    )
    const files = readdirSync(factsDir())
    const conceptFacts = files.filter(f => f.startsWith('fact-concept-'))
    expect(conceptFacts.some(f => f.includes('npm_'))).toBe(false)
  })

  it('does not extract JWT bearer values', async () => {
    await extractFactsIntoMemdir(
      'authorization: Bearer `eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJzdWIiOiIxMjM0NTY3ODkwIiwibmFtZSI6IkpvaG4gRG9lIiwiaWF0IjoxNTE2MjM5MDIyfQ.SflKxwRJSMeKKF2QT4fwpMeJf36POk6yJV_adQssw5c`',
      memDir,
    )
    const files = readdirSync(factsDir())
    const conceptFacts = files.filter(f => f.startsWith('fact-concept-'))
    expect(conceptFacts.some(f => f.includes('eyJ'))).toBe(false)
    expect(conceptFacts.some(f => f.includes('JWT') || f.includes('jwt'))).toBe(false)
  })

  it('extracts technical terms with PascalCase', async () => {
    await extractFactsIntoMemdir('the UserAuthentication flow handles login', memDir)
    const files = readdirSync(factsDir())
    expect(files.some(f => f.includes('userauthentication'))).toBe(true)
  })

  it('extracts project file signatures', async () => {
    await extractFactsIntoMemdir('check build.gradle and pom.xml', memDir)
    expect(countFactFiles()).toBeGreaterThan(0)
  })

  it('extracts IP addresses', async () => {
    await extractFactsIntoMemdir('connect to 192.168.1.100 or 10.0.0.1', memDir)
    const files = readdirSync(factsDir())
    expect(files.some(f => f.includes('192' ) || f.includes('10'))).toBe(true)
  })

  it('detects React and Redux mentions', async () => {
    await extractFactsIntoMemdir('we use React with Redux', memDir)
    const files = readdirSync(factsDir()).map(f => f.toLowerCase())
    expect(files.some(f => f.includes('react'))).toBe(true)
    expect(files.some(f => f.includes('redux'))).toBe(true)
  })

  it('writes files with proper frontmatter', async () => {
    await extractFactsIntoMemdir('DATABASE_HOST=prod-db-1.internal', memDir)
    const files = readdirSync(factsDir())
    expect(files.length).toBeGreaterThan(0)
    const content = readFileSync(join(factsDir(), files[0]), 'utf-8')
    expect(content).toContain('---')
    expect(content).toContain('type: reference')
  })

  it('handles empty content gracefully', async () => {
    await extractFactsIntoMemdir('', memDir)
    expect(countFactFiles()).toBe(0)
  })

  it('does not persist token-like URL path segments (P1#3)', async () => {
    await extractFactsIntoMemdir(
      'download from https://api.example.com/download/super-secret-access-token',
      memDir,
    )
    const files = readdirSync(factsDir()).map(f => f.toLowerCase())
    const endpoint = files.find(f => f.includes('example'))
    expect(endpoint).toBeDefined()
    const content = readFileSync(join(factsDir(), endpoint!), 'utf-8').toLowerCase()
    // The opaque token path component must not be persisted.
    expect(content).not.toContain('super-secret-access-token')
    expect(content).toContain('api.example.com')
  })

  it('does not persist token-like hyphenated terms as concepts (P1#3)', async () => {
    await extractFactsIntoMemdir('the value is super-secret-access-token here', memDir)
    const dir = factsDir()
    const files = existsSync(dir) ? readdirSync(dir).map(f => f.toLowerCase()) : []
    expect(files.some(f => f.includes('super-secret-access-token'))).toBe(false)
  })

  it('extracts passive project rules (P2#7)', async () => {
    await extractFactsIntoMemdir(
      'Always use pnpm. Never commit secrets. Prefer SQLite WAL.',
      memDir,
    )
    const files = readdirSync(factsDir()).map(f => f.toLowerCase())
    expect(files.some(f => f.includes('rule'))).toBe(true)
  })
})

describe('autoExtractFacts governance gate (P1#1, P2#6)', () => {
  let memDir: string

  beforeEach(() => {
    memDir = mkdtempSync(join(tmpdir(), 'auto-extract-gate-test-'))
    setGovernancePolicySettingsForSourceForTesting(null)
    delete process.env.CLAUDE_CODE_DISABLE_AUTO_MEMORY
  })

  afterEach(() => {
    setGovernancePolicySettingsForSourceForTesting(null)
    rmSync(memDir, { recursive: true, force: true })
  })

  it('does not write facts when memory-write approval is required', async () => {
    setGovernancePolicySettingsForSourceForTesting(() => ({
      memory: { requireApprovalBeforeWrite: true },
    }))
    const result = await extractFactsIntoMemdir('DATABASE_HOST=prod-db-1.internal', memDir)
    expect(result).toBe(false)
    expect(factCount()).toBe(0)
  })

  it('does not write facts when auto-memory is disabled', async () => {
    setGovernancePolicySettingsForSourceForTesting(() => ({
      memory: { requireApprovalBeforeWrite: false },
    }))
    process.env.CLAUDE_CODE_DISABLE_AUTO_MEMORY = '1'
    const result = await extractFactsIntoMemdir('we use React with Redux', memDir)
    expect(result).toBe(false)
    expect(factCount()).toBe(0)
    delete process.env.CLAUDE_CODE_DISABLE_AUTO_MEMORY
  })

  it('degrades non-fatally when the facts directory cannot be created (P2#6)', async () => {
    setGovernancePolicySettingsForSourceForTesting(() => ({
      memory: { requireApprovalBeforeWrite: false },
    }))
    // Pass a path that is an existing *file* so the .facts subdirectory cannot
    // be created; the extractor must not throw (it would otherwise crash the
    // turn before the model request) and must return false.
    const fileDir = join(memDir, 'not-a-dir')
    writeFileSync(fileDir, 'x')
    const result = await extractFactsIntoMemdir('we use React with Redux', fileDir)
    expect(result).toBe(false)
  })

  function factCount(): number {
    const dir = join(memDir, '.facts')
    if (!existsSync(dir)) return 0
    return readdirSync(dir).filter(f => f.endsWith('.md')).length
  }
})
