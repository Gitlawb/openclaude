import { describe, test, expect, beforeEach, afterEach } from 'bun:test'
import { mkdtempSync, rmSync, writeFileSync, mkdirSync } from 'fs'
import { execSync } from 'child_process'
import { tmpdir } from 'os'
import { join } from 'path'
import { indexCodebase, countFiles } from './index.js'

describe('indexCodebase', () => {
  let tempDir: string

  beforeEach(() => {
    tempDir = mkdtempSync(join(tmpdir(), 'indexer-test-'))
  })

  afterEach(() => {
    rmSync(tempDir, { recursive: true, force: true })
  })

  test('indexes a minimal Node.js project with all fields populated', async () => {
    // Set up a minimal Node.js project with git
    execSync('git init', { cwd: tempDir, stdio: 'pipe' })
    execSync('git config user.email "test@test.com"', { cwd: tempDir, stdio: 'pipe' })
    execSync('git config user.name "Test"', { cwd: tempDir, stdio: 'pipe' })

    writeFileSync(
      join(tempDir, 'package.json'),
      JSON.stringify({
        name: 'test-project',
        scripts: { build: 'tsc', test: 'bun test', dev: 'bun run src/index.ts' },
        dependencies: { express: '^4.18.0' },
        devDependencies: { typescript: '^5.0.0' },
      }),
    )

    mkdirSync(join(tempDir, 'src'))
    writeFileSync(join(tempDir, 'src', 'index.ts'), 'console.log("hello")')

    writeFileSync(join(tempDir, 'README.md'), '# Test Project\n\nThis is a test project for indexing.\n')

    // Commit so git is clean
    execSync('git add -A && git commit -m "init"', { cwd: tempDir, stdio: 'pipe' })

    const result = await indexCodebase(tempDir)

    // Git info
    expect(result.git).not.toBeNull()
    expect(result.git!.isDirty).toBe(false)
    expect(typeof result.git!.branch).toBe('string')

    // Languages
    expect(result.languages).toContain('TypeScript/JavaScript')

    // Manifests
    expect(result.manifests.length).toBeGreaterThanOrEqual(1)
    expect(result.manifests[0].type).toBe('npm')

    // Structure
    expect(result.structure.topLevelDirs).toContain('src')
    expect(result.structure.entryPoints).toContain('src/index.ts')
    expect(result.structure.isMonorepo).toBe(false)

    // Testing
    expect(result.testing.testCommands).toContain('bun test')

    // Docs
    expect(result.docs.hasReadme).toBe(true)
    expect(result.docs.readmePath).toBe('README.md')
    expect(result.docs.readmeFirstParagraph).toBe('This is a test project for indexing.')

    // Commands
    expect(result.commands.build).toBe('tsc')
    expect(result.commands.test).toBe('bun test')
    expect(result.commands.dev).toBe('bun run src/index.ts')

    // File count
    expect(result.fileCount).toBeGreaterThan(0)
    expect(result.isLargeRepo).toBe(false)
  })

  test('indexes an empty directory with sensible defaults', async () => {
    const result = await indexCodebase(tempDir)

    expect(result.git).toBeNull()
    expect(result.languages).toEqual([])
    expect(result.primaryLanguage).toBeNull()
    expect(result.manifests).toEqual([])
    expect(result.structure.isMonorepo).toBe(false)
    expect(result.structure.topLevelDirs).toEqual([])
    expect(result.structure.entryPoints).toEqual([])
    expect(result.testing.testDirs).toEqual([])
    expect(result.testing.testCommands).toEqual([])
    expect(result.docs.hasReadme).toBe(false)
    expect(result.docs.hasDocsDir).toBe(false)
    expect(result.commands).toEqual({})
    expect(result.fileCount).toBe(0)
    expect(result.isLargeRepo).toBe(false)
  })

  test('returns null git for non-git directory', async () => {
    writeFileSync(join(tempDir, 'file.txt'), 'hello')

    const result = await indexCodebase(tempDir)

    expect(result.git).toBeNull()
  })

  test('extracts readmeFirstParagraph from README', async () => {
    writeFileSync(
      join(tempDir, 'README.md'),
      '# My Project\n\n![badge](url)\n\nA fantastic library for doing things.\nIt supports multiple platforms.\n\n## Installation\n',
    )

    const result = await indexCodebase(tempDir)

    expect(result.docs.hasReadme).toBe(true)
    expect(result.docs.readmeFirstParagraph).toBe(
      'A fantastic library for doing things. It supports multiple platforms.',
    )
  })

  test('detects test directory in testDirs', async () => {
    mkdirSync(join(tempDir, 'test'))
    writeFileSync(join(tempDir, 'test', 'app.test.ts'), 'test("works", () => {})')

    const result = await indexCodebase(tempDir)

    expect(result.testing.testDirs).toContain('test')
  })

  test('detects monorepo with multiple package.json files', async () => {
    writeFileSync(
      join(tempDir, 'package.json'),
      JSON.stringify({
        name: 'monorepo',
        private: true,
        workspaces: ['packages/*'],
      }),
    )

    mkdirSync(join(tempDir, 'packages', 'api'), { recursive: true })
    writeFileSync(
      join(tempDir, 'packages', 'api', 'package.json'),
      JSON.stringify({ name: '@mono/api' }),
    )

    // Note: detectManifests only scans one level deep, so packages/api won't be found.
    // But root package.json has workspaces, so isMonorepo should be true.
    const result = await indexCodebase(tempDir)

    expect(result.structure.isMonorepo).toBe(true)
    expect(result.structure.workspaces).toEqual(['packages/*'])
  })
})

describe('countFiles', () => {
  let tempDir: string

  beforeEach(() => {
    tempDir = mkdtempSync(join(tmpdir(), 'countfiles-test-'))
  })

  afterEach(() => {
    rmSync(tempDir, { recursive: true, force: true })
  })

  test('detects large repo when file count exceeds threshold', () => {
    // Create a directory structure that simulates a large repo
    // We'll create files in batches across subdirs
    const filesPerDir = 1000
    const numDirs = 11 // 11 * 1000 = 11000 > 10000 threshold
    for (let d = 0; d < numDirs; d++) {
      const subdir = join(tempDir, `dir${d}`)
      mkdirSync(subdir)
      for (let f = 0; f < filesPerDir; f++) {
        writeFileSync(join(subdir, `file${f}.ts`), '')
      }
    }

    const result = countFiles(tempDir)

    expect(result.isLarge).toBe(true)
    // Count stops at threshold+1, so it should be > 10000
    expect(result.count).toBeGreaterThan(10_000)
  })

  test('counts files correctly for small repo', () => {
    writeFileSync(join(tempDir, 'a.ts'), '')
    writeFileSync(join(tempDir, 'b.ts'), '')
    mkdirSync(join(tempDir, 'src'))
    writeFileSync(join(tempDir, 'src', 'c.ts'), '')

    const result = countFiles(tempDir)

    expect(result.count).toBe(3)
    expect(result.isLarge).toBe(false)
  })

  test('skips node_modules and .git directories', () => {
    writeFileSync(join(tempDir, 'a.ts'), '')
    mkdirSync(join(tempDir, 'node_modules', 'pkg'), { recursive: true })
    writeFileSync(join(tempDir, 'node_modules', 'pkg', 'index.js'), '')
    mkdirSync(join(tempDir, '.git', 'objects'), { recursive: true })
    writeFileSync(join(tempDir, '.git', 'objects', 'abc'), '')

    const result = countFiles(tempDir)

    expect(result.count).toBe(1)
  })
})
