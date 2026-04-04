import assert from 'node:assert/strict'
import test from 'node:test'

import { extractGitHubRepoSlug } from './repoSlug.ts'

test('keeps owner/repo input as-is', () => {
  assert.equal(extractGitHubRepoSlug('Gitlawb/openclaude'), 'Gitlawb/openclaude')
})

test('extracts slug from https GitHub URLs', () => {
  assert.equal(
    extractGitHubRepoSlug('https://github.com/Gitlawb/openclaude'),
    'Gitlawb/openclaude',
  )
  assert.equal(
    extractGitHubRepoSlug('https://www.github.com/Gitlawb/openclaude.git'),
    'Gitlawb/openclaude',
  )
})

test('extracts slug from ssh GitHub URLs', () => {
  assert.equal(
    extractGitHubRepoSlug('git@github.com:Gitlawb/openclaude.git'),
    'Gitlawb/openclaude',
  )
  assert.equal(
    extractGitHubRepoSlug('ssh://git@github.com/Gitlawb/openclaude'),
    'Gitlawb/openclaude',
  )
})

test('rejects malformed or non-GitHub URLs', () => {
  assert.equal(extractGitHubRepoSlug('https://gitlab.com/Gitlawb/openclaude'), null)
  assert.equal(extractGitHubRepoSlug('https://github.com/Gitlawb'), null)
  assert.equal(extractGitHubRepoSlug('not actually github.com/Gitlawb/openclaude'), null)
  assert.equal(
    extractGitHubRepoSlug('https://evil.example/?next=github.com/Gitlawb/openclaude'),
    null,
  )
  assert.equal(
    extractGitHubRepoSlug('https://github.com.evil.example/Gitlawb/openclaude'),
    null,
  )
  assert.equal(
    extractGitHubRepoSlug('https://example.com/github.com/Gitlawb/openclaude'),
    null,
  )
})
