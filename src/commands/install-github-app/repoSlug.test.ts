import assert from 'node:assert/strict'
import test from 'node:test'

import { extractGitHubRepoSlug } from './repoSlug.ts'

test('keeps owner/repo input as-is', () => {
  assert.equal(extractGitHubRepoSlug('Gitlawb/openlawb'), 'Gitlawb/openlawb')
})

test('extracts slug from https GitHub URLs', () => {
  assert.equal(
    extractGitHubRepoSlug('https://github.com/Gitlawb/openlawb'),
    'Gitlawb/openlawb',
  )
  assert.equal(
    extractGitHubRepoSlug('https://www.github.com/Gitlawb/openlawb.git'),
    'Gitlawb/openlawb',
  )
})

test('extracts slug from ssh GitHub URLs', () => {
  assert.equal(
    extractGitHubRepoSlug('git@github.com:Gitlawb/openlawb.git'),
    'Gitlawb/openlawb',
  )
  assert.equal(
    extractGitHubRepoSlug('ssh://git@github.com/Gitlawb/openlawb'),
    'Gitlawb/openlawb',
  )
})

test('rejects malformed or non-GitHub URLs', () => {
  assert.equal(extractGitHubRepoSlug('https://gitlab.com/Gitlawb/openlawb'), null)
  assert.equal(extractGitHubRepoSlug('https://github.com/Gitlawb'), null)
  assert.equal(extractGitHubRepoSlug('not actually github.com/Gitlawb/openlawb'), null)
  assert.equal(
    extractGitHubRepoSlug('https://evil.example/?next=github.com/Gitlawb/openlawb'),
    null,
  )
  assert.equal(
    extractGitHubRepoSlug('https://github.com.evil.example/Gitlawb/openlawb'),
    null,
  )
  assert.equal(
    extractGitHubRepoSlug('https://example.com/github.com/Gitlawb/openlawb'),
    null,
  )
})
