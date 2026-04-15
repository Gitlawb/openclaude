import { describe, test, expect } from 'bun:test'
import type { IndexResult } from '../types'
import {
  generateOverview,
  generateStack,
  generateArchitecture,
  generateConventions,
  generateTesting,
  generateCommands,
} from './templates'

/** Minimal IndexResult with all required fields set to empty/defaults. */
function emptyIndex(overrides: Partial<IndexResult> = {}): IndexResult {
  return {
    git: null,
    languages: [],
    primaryLanguage: null,
    manifests: [],
    structure: { isMonorepo: false, topLevelDirs: [], entryPoints: [] },
    testing: { testDirs: [], testCommands: [] },
    docs: { hasReadme: false, hasDocsDir: false, hasExistingClaudeMd: false },
    commands: {},
    fileCount: 0,
    isLargeRepo: false,
    ...overrides,
  }
}

describe('generateOverview', () => {
  test('returns VaultDoc with readme excerpt and repo URL', () => {
    const index = emptyIndex({
      docs: {
        hasReadme: true,
        readmePath: 'README.md',
        readmeFirstParagraph: 'A CLI tool for project onboarding.',
        hasDocsDir: false,
        hasExistingClaudeMd: false,
      },
      git: { remoteUrl: 'https://github.com/user/repo', branch: 'main', isDirty: false },
      primaryLanguage: 'TypeScript',
      manifests: [{ path: 'package.json', type: 'npm', language: 'TypeScript', framework: 'NestJS' }],
    })

    const doc = generateOverview(index)

    expect(doc).not.toBeNull()
    expect(doc!.title).toBe('Project Overview')
    expect(doc!.filename).toBe('overview.md')
    expect(doc!.content).toContain('A CLI tool for project onboarding.')
    expect(doc!.content).toContain('https://github.com/user/repo')
    expect(doc!.content).toContain('TypeScript')
    expect(doc!.content).toContain('NestJS')
  })

  test('returns null when no readme and no git info', () => {
    const index = emptyIndex()
    const doc = generateOverview(index)
    expect(doc).toBeNull()
  })
})

describe('generateStack', () => {
  test('includes language, framework, and dependency table for npm manifest', () => {
    const index = emptyIndex({
      languages: ['TypeScript', 'JavaScript'],
      primaryLanguage: 'TypeScript',
      manifests: [
        {
          path: 'package.json',
          type: 'npm',
          language: 'TypeScript',
          framework: 'Express',
          dependencies: {
            express: '^4.18.0',
            typescript: '^5.0.0',
            zod: '^3.22.0',
          },
        },
      ],
    })

    const doc = generateStack(index)

    expect(doc).not.toBeNull()
    expect(doc!.title).toBe('Technology Stack')
    expect(doc!.content).toContain('TypeScript (primary)')
    expect(doc!.content).toContain('Express')
    expect(doc!.content).toContain('| express | ^4.18.0 | npm |')
    expect(doc!.content).toContain('| Package | Version | Source |')
  })

  test('returns null with no manifests', () => {
    const index = emptyIndex()
    const doc = generateStack(index)
    expect(doc).toBeNull()
  })
})

describe('generateArchitecture', () => {
  test('includes directory listing for top-level dirs', () => {
    const index = emptyIndex({
      structure: {
        isMonorepo: false,
        topLevelDirs: ['src', 'tests', 'docs'],
        entryPoints: ['src/index.ts'],
      },
    })

    const doc = generateArchitecture(index)

    expect(doc).not.toBeNull()
    expect(doc!.title).toBe('Architecture')
    expect(doc!.content).toContain('`src/`')
    expect(doc!.content).toContain('`tests/`')
    expect(doc!.content).toContain('`docs/`')
    expect(doc!.content).toContain('`src/index.ts`')
  })
})

describe('generateTesting', () => {
  test('includes framework, dirs, and commands when present', () => {
    const index = emptyIndex({
      testing: {
        framework: 'vitest',
        testDirs: ['tests', 'src/__tests__'],
        testCommands: ['npm test', 'npm run test:watch'],
        coverageConfig: 'vitest.config.ts',
      },
    })

    const doc = generateTesting(index)

    expect(doc).not.toBeNull()
    expect(doc!.title).toBe('Testing')
    expect(doc!.content).toContain('vitest')
    expect(doc!.content).toContain('`tests`')
    expect(doc!.content).toContain('`src/__tests__`')
    expect(doc!.content).toContain('`npm test`')
    expect(doc!.content).toContain('`vitest.config.ts`')
  })

  test('returns null with no testing info', () => {
    const index = emptyIndex()
    const doc = generateTesting(index)
    expect(doc).toBeNull()
  })
})

describe('generateCommands', () => {
  test('includes command table when scripts exist', () => {
    const index = emptyIndex({
      commands: {
        build: 'tsc -b',
        test: 'bun test',
        lint: 'eslint .',
        dev: 'bun run dev',
      },
    })

    const doc = generateCommands(index)

    expect(doc).not.toBeNull()
    expect(doc!.title).toBe('Commands')
    expect(doc!.content).toContain('| `build` | `tsc -b` |')
    expect(doc!.content).toContain('| `test` | `bun test` |')
    expect(doc!.content).toContain('| `lint` | `eslint .` |')
    expect(doc!.content).toContain('| `dev` | `bun run dev` |')
    expect(doc!.content).toContain('| Command | Script |')
  })

  test('returns null with no commands', () => {
    const index = emptyIndex()
    const doc = generateCommands(index)
    expect(doc).toBeNull()
  })
})

describe('generateConventions', () => {
  test('mentions linter and formatter when eslint/prettier in deps', () => {
    const index = emptyIndex({
      languages: ['TypeScript'],
      manifests: [
        {
          path: 'package.json',
          type: 'npm',
          language: 'TypeScript',
          dependencies: {
            eslint: '^8.0.0',
            prettier: '^3.0.0',
          },
        },
      ],
    })

    const doc = generateConventions(index)

    expect(doc).not.toBeNull()
    expect(doc!.title).toBe('Conventions')
    expect(doc!.content).toContain('eslint')
    expect(doc!.content).toContain('Linter')
    expect(doc!.content).toContain('prettier')
    expect(doc!.content).toContain('Formatter')
  })
})
