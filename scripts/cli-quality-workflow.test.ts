import { expect, test } from 'bun:test'
import { readFileSync, existsSync } from 'node:fs'
import { parse } from 'yaml'

test('PRs and every publication surface require the shared quality gate', () => {
  const pr = parse(readFileSync('.github/workflows/pr-checks.yml', 'utf8'))
  const release = parse(readFileSync('.github/workflows/release.yml', 'utf8'))
  expect(pr.jobs['cli-quality'].uses).toBe('./.github/workflows/cli-quality.yml')
  expect(pr.jobs['smoke-and-tests'].needs).toBe('cli-quality')
  expect(pr.jobs['smoke-and-tests'].if).toBe('${{ always() }}')
  expect(pr.jobs['smoke-and-tests'].steps[0].env.QUALITY_RESULT).toBe('${{ needs.cli-quality.result }}')
  expect(pr.jobs['smoke-and-tests'].steps[0].run).toBe('test "$QUALITY_RESULT" = success')
  expect(release.jobs['cli-quality'].uses).toBe(pr.jobs['cli-quality'].uses)
  expect(release.jobs['cli-quality'].with.ref).toBe('${{ needs.verify.outputs.tag }}')
  for (const job of ['publish-npm', 'docker', 'desktop-cli-artifacts', 'publish-desktop-cli']) {
    expect(release.jobs[job].needs).toContain('cli-quality')
  }
  const npm = release.jobs['publish-npm'].steps
  expect(npm.some(step => step.with?.name === 'tested-npm-package')).toBe(true)
  expect(npm.some(step => step.run?.includes('--verify-only'))).toBe(true)
  const publish = npm.find(step => step.name === 'Publish to npm')
  expect(publish.run).toContain('*.tgz --ignore-scripts')
  expect(npm.some(step => /bun run build|npm run build|npm pack/.test(step.run ?? ''))).toBe(false)
  expect(existsSync('.github/test-baseline.txt')).toBe(false)
})

test('the release package is exercised on Linux, macOS and Windows with both supported Node lines', () => {
  const workflow = parse(readFileSync('.github/workflows/cli-quality.yml', 'utf8'))
  expect(workflow.jobs.terminal.strategy.matrix).toEqual({ os: ['ubuntu-24.04', 'macos-15', 'windows-latest'], node: [22, 24] })
  expect(workflow.jobs.terminal.strategy['fail-fast']).toBe(false)
  expect(workflow.jobs.terminal.needs).toBe('suite')
  for (const job of Object.values(workflow.jobs) as Array<{ steps: Array<{ 'continue-on-error'?: boolean }> }>) {
    expect(job.steps.some(step => step['continue-on-error'])).toBe(false)
  }
  expect(workflow.jobs.python).toBeDefined()
  expect(workflow.jobs.web).toBeDefined()
})
