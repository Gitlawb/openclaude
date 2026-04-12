import { describe, expect, test } from 'bun:test'
import { join } from 'node:path'

import type { MemoryFileInfo } from '../../utils/claudemd.js'
import { getProjectMemoryPathForSelector } from './memoryFileSelectorPaths.js'

function projectFile(path: string): MemoryFileInfo {
  return {
    path,
    type: 'Project',
    content: '',
  }
}

describe('getProjectMemoryPathForSelector', () => {
  test('uses the loaded repo-level AGENTS.md from a nested cwd', () => {
    const repoDir = '/repo'
    const nestedDir = join(repoDir, 'packages', 'app')

    expect(
      getProjectMemoryPathForSelector(
        [projectFile(join(repoDir, 'AGENTS.md'))],
        nestedDir,
      ),
    ).toBe(join(repoDir, 'AGENTS.md'))
  })

  test('uses the loaded repo-level CLAUDE.md fallback from a nested cwd', () => {
    const repoDir = '/repo'
    const nestedDir = join(repoDir, 'packages', 'app')

    expect(
      getProjectMemoryPathForSelector(
        [projectFile(join(repoDir, 'CLAUDE.md'))],
        nestedDir,
      ),
    ).toBe(join(repoDir, 'CLAUDE.md'))
  })

  test('prefers the closest loaded ancestor instruction file', () => {
    const repoDir = '/repo'
    const nestedProjectDir = join(repoDir, 'packages', 'app')

    expect(
      getProjectMemoryPathForSelector(
        [
          projectFile(join(repoDir, 'AGENTS.md')),
          projectFile(join(nestedProjectDir, 'CLAUDE.md')),
        ],
        join(nestedProjectDir, 'src'),
      ),
    ).toBe(join(nestedProjectDir, 'CLAUDE.md'))
  })

  test('defaults to a new AGENTS.md in the current cwd when no project file is loaded', () => {
    expect(getProjectMemoryPathForSelector([], '/repo/packages/app')).toBe(
      '/repo/packages/app/AGENTS.md',
    )
  })

  test('ignores loaded project instruction files outside the current cwd ancestry', () => {
    expect(
      getProjectMemoryPathForSelector(
        [projectFile('/other-worktree/AGENTS.md')],
        '/repo/packages/app',
      ),
    ).toBe('/repo/packages/app/AGENTS.md')
  })
})
