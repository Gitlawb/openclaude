/** Each suite owns its process, configuration and session files. Every failure fails CI. */
import { spawn } from 'node:child_process'
import { mkdtemp, mkdir, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

export type TestResult = { file: string; exitCode: number; stdout: string; stderr: string; durationMs: number; timedOut: boolean }

export function listTestFiles(cwd = process.cwd()): string[] {
  const result = Bun.spawnSync({ cmd: ['git', 'ls-files', '--cached', '--others', '--exclude-standard', '-z'], cwd, stdout: 'pipe', stderr: 'pipe' })
  if (result.exitCode !== 0) throw new Error(`Could not list tests: ${result.stderr}`)
  return [...new Set(result.stdout.toString().split('\0').filter(file => /\.test\.(?:[cm]?[jt]s|[jt]sx)$/.test(file)))].sort()
}

export function selectTestFiles(files: string[], filters: string[]): string[] {
  const selected = filters.length ? files.filter(file => filters.some(filter => filter.endsWith('/') ? file.startsWith(filter) : file === filter)) : files
  if (!selected.length) throw new Error(`No test files matched: ${filters.join(', ')}`)
  return selected
}

function positiveInteger(value: string | undefined, fallback: number): number {
  const n = Number(value)
  return Number.isSafeInteger(n) && n > 0 ? n : fallback
}

export function testEnvironment(dir: string): NodeJS.ProcessEnv {
  const env = { ...process.env }
  for (const key of Object.keys(env)) {
    if (/^(?:VERBOO|CLAUDE|ANTHROPIC|OPENAI|CODEX|GEMINI|GOOGLE|GITHUB|COPILOT|OLLAMA|MISTRAL|MINIMAX|MOONSHOT|DEEPSEEK|AWS|AZURE|BEDROCK|VERTEX)_/.test(key)) delete env[key]
  }
  return { ...env, VERBOO_CONFIG_DIR: join(dir, 'config'), VERBOO_PROJECTS_DIR: join(dir, 'projects'), TMPDIR: dir, TMP: dir, TEMP: dir }
}

export async function runTestFile(file: string): Promise<TestResult> {
  const dir = await mkdtemp(join(tmpdir(), 'verboo-test-'))
  const start = Date.now()
  const limit = positiveInteger(process.env.TEST_FILE_TIMEOUT_MS, 180_000)
  let timedOut = false
  let stdout = ''
  let stderr = ''
  const child = spawn(process.env.BUN_EXEC_PATH || process.execPath, ['test', '--max-concurrency=1', '--only-failures', file], {
    env: testEnvironment(dir), stdio: ['ignore', 'pipe', 'pipe'], detached: process.platform !== 'win32',
  })
  const stop = () => {
    if (!child.pid) return
    if (process.platform === 'win32') {
      Bun.spawnSync(['taskkill', '/pid', String(child.pid), '/T', '/F'])
    } else {
      try { process.kill(-child.pid, 'SIGKILL') } catch { /* already exited */ }
    }
  }
  child.stdout.on('data', chunk => { stdout += chunk })
  child.stderr.on('data', chunk => { stderr += chunk })
  const timer = setTimeout(() => { timedOut = true; stop() }, limit)
  try {
    const exitCode = await new Promise<number>(resolve => {
      child.once('error', error => { stderr += String(error); resolve(1) })
      child.once('exit', () => stop())
      child.once('close', code => resolve(code ?? 1))
    })
    return { file, exitCode: timedOut ? 124 : exitCode, stdout, stderr, durationMs: Date.now() - start, timedOut }
  } finally {
    clearTimeout(timer)
    stop()
    await rm(dir, { recursive: true, force: true })
  }
}

function xml(value: string): string {
  return value.replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&apos;' })[c]!)
}

export async function main(): Promise<void> {
  const files = selectTestFiles(listTestFiles(), process.argv.slice(2))
  const results: TestResult[] = []
  let next = 0
  const worker = async () => {
    for (;;) {
      const file = files[next++]
      if (!file) return
      const result = await runTestFile(file)
      results.push(result)
      process.stdout.write(`[${results.length}/${files.length}] ${result.exitCode ? 'FAIL' : 'PASS'} ${file}\n`)
    }
  }
  await Promise.all(Array.from({ length: Math.min(files.length, positiveInteger(process.env.TEST_ISOLATION_CONCURRENCY, 4)) }, worker))
  const failures = results.filter(r => r.exitCode !== 0)
  const reportDir = process.env.TEST_REPORT_DIR || '.artifacts/test-results'
  await mkdir(reportDir, { recursive: true })
  await writeFile(join(reportDir, 'results.json'), JSON.stringify(results, null, 2))
  await writeFile(join(reportDir, 'junit.xml'), `<testsuite name="isolated" tests="${results.length}" failures="${failures.length}">${results.map(r => `<testcase name="${xml(r.file)}" time="${r.durationMs / 1000}">${r.exitCode ? `<failure message="${r.timedOut ? 'Suite deadline exceeded' : 'Test failure'}">${xml(r.stdout + r.stderr)}</failure>` : ''}</testcase>`).join('')}</testsuite>`)
  for (const failure of failures) process.stderr.write(`\n${failure.file}\n${failure.stdout}${failure.stderr}`)
  process.stdout.write(`\n${results.length - failures.length}/${files.length} test files passed; ${failures.length} failed.\n`)
  if (failures.length) process.exitCode = 1
}

if (import.meta.main) await main()
