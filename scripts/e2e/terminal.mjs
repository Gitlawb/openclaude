import pty from 'node-pty'
import xterm from '@xterm/headless'
import unicode11 from '@xterm/addon-unicode11'
import { mkdir, mkdtemp, writeFile, readFile } from 'node:fs/promises'
import { dirname, join, resolve } from 'node:path'
import { pathToFileURL } from 'node:url'
import { setTimeout as delay } from 'node:timers/promises'
import { spawnSync } from 'node:child_process'
import { createFakeRouter } from './fake-router.mjs'

export async function startCli({ columns = 80, rows = 24, fullscreen = false, args = [], routerOptions } = {}) {
  const consumer = (await readFile(resolve('.artifacts/package/consumer-path.txt'), 'utf8')).trim()
  const root = resolve('.artifacts/pty')
  await mkdir(root, { recursive: true })
  const dir = await mkdtemp(join(root, `${process.platform}-${process.versions.node}-${columns}x${rows}-`))
  const config = join(dir, 'config')
  const project = join(dir, 'project')
  for (const path of [config, project, join(dir, 'tmp')]) await mkdir(path)
  if (routerOptions?.childToolLoop) {
    await mkdir(join(config, 'agents'))
    await writeFile(join(config, 'agents/fixture-limited.md'), '---\nname: fixture-limited\ndescription: Deterministic bounded fixture agent\nmaxTurns: 1\ntools: Read\n---\nInspect README.md and report.\n')
  }
  const git = spawnSync('git', ['init', '-q', project], { encoding: 'utf8' })
  if (git.status !== 0) throw new Error(git.stderr || 'Could not isolate fixture project')
  await writeFile(join(project, 'README.md'), 'A deterministic CLI test fixture. No external services or user files.\n')
  const projectConfigKey = project.replaceAll('\\', '/')
  await writeFile(join(config, '.config.json'), JSON.stringify({ theme: 'dark', hasCompletedOnboarding: true, bypassPermissionsModeAccepted: true, projects: { [projectConfigKey]: { hasTrustDialogAccepted: true } } }))
  const router = await createFakeRouter(routerOptions)
  await writeFile(join(dir, 'unexpected-network.log'), '')
  // Preserve OS runtime directories required by PowerShell/.NET, while keeping
  // provider credentials and user CLI configuration out of the fixture.
  const env = Object.fromEntries(Object.entries(process.env).filter(([key, value]) => value !== undefined && /^(PATH|SystemRoot|SystemDrive|WINDIR|COMSPEC|PATHEXT|USERPROFILE|USERNAME|USERDOMAIN|HOMEDRIVE|HOMEPATH|APPDATA|LOCALAPPDATA|ProgramData|ProgramFiles(?:\(x86\))?|ProgramW6432|CommonProgramFiles(?:\(x86\))?|CommonProgramW6432|PSModulePath|PROCESSOR_ARCHITECTURE|SHELL)$/i.test(key)))
  const inheritedPath = Object.entries(env).find(([key]) => key.toUpperCase() === 'PATH')?.[1] || ''
  for (const key of Object.keys(env)) if (key.toUpperCase() === 'PATH') delete env[key]
  Object.assign(env, {
    PATH: `${dirname(process.execPath)}${process.platform === 'win32' ? ';' : ':'}${inheritedPath}`,
    TERM: 'xterm-256color', LANG: 'en_US.UTF-8', FORCE_COLOR: '1',
    VERBOO_DISABLE_PLUGINS: '1', VERBOO_CONFIG_DIR: config, VERBOO_PROJECTS_DIR: join(dir, 'projects'),
    TMPDIR: join(dir, 'tmp'), TMP: join(dir, 'tmp'), TEMP: join(dir, 'tmp'),
    CLAUDE_CODE_OAUTH_TOKEN: 'fixture-session', CLAUDE_CODE_NO_FLICKER: fullscreen ? '1' : '0',
    DISABLE_AUTOUPDATER: '1', CLAUDE_CODE_DISABLE_NONESSENTIAL_TRAFFIC: '1', DISABLE_TELEMETRY: '1',
    CLAUDE_CODE_DISABLE_OFFICIAL_MARKETPLACE_AUTOINSTALL: '1',
    CLI_E2E_ORIGIN: router.origin, CLI_E2E_NETWORK_LOG: join(dir, 'unexpected-network.log'),
    CLI_E2E_PROCESS_LOG: join(dir, 'startup-processes.jsonl'),
  })
  const terminal = new xterm.Terminal({ cols: columns, rows, allowProposedApi: true, scrollback: 5000 })
  terminal.loadAddon(new unicode11.Unicode11Addon())
  terminal.unicode.activeVersion = '11'
  let child
  try {
    child = pty.spawn(process.execPath, ['--import', pathToFileURL(resolve('scripts/e2e/transport-preload.mjs')).href, join(consumer, 'node_modules/@verboo/code/bin/verboo'), '--model', 'fixture-model', '--dangerously-skip-permissions', '--setting-sources', 'user', '--strict-mcp-config', '--mcp-config', '{"mcpServers":{}}', '--disable-slash-commands', '--debug-file', join(dir, 'debug.log'), ...args], { cwd: project, env, cols: columns, rows, name: 'xterm-256color' })
  } catch (error) { terminal.dispose(); await router.close(); throw error }
  let raw = ''
  let exited
  const frames = []
  const screen = () => Array.from({ length: terminal.rows }, (_, y) => terminal.buffer.active.getLine(terminal.buffer.active.viewportY + y)?.translateToString(true) || '').join('\n')
  terminal.onData(data => { if (!exited) child.write(data) })
  child.onData(data => {
    raw += data
    terminal.write(data, () => frames.push({ at: Date.now(), columns: terminal.cols, rows: terminal.rows, cursorX: terminal.buffer.active.cursorX, cursorY: terminal.buffer.active.cursorY, text: screen() }))
  })
  const exit = new Promise(resolve => child.onExit(value => { exited = value; resolve(value) }))
  return {
    dir, router, frames, screen, get raw() { return raw }, get exited() { return exited }, exit,
    write(data) { child.write(data) },
    resize(cols, rows) { terminal.resize(cols, rows); child.resize(cols, rows) },
    async waitFor(predicate, timeout = 20_000) {
      const start = Date.now()
      while (!await predicate()) {
        if (exited || Date.now() - start > timeout) throw new Error(`CLI condition failed (${JSON.stringify(exited)}); artifacts: ${dir}\n${screen()}`)
        await delay(25)
      }
    },
    async stop() {
      // ConPTY retains its output worker even after the child exits naturally.
      // Release the terminal on Windows as well as stopping live children.
      if (!exited || process.platform === 'win32') child.kill()
      if (!exited) await Promise.race([exit, delay(3000, undefined, { ref: false })])
      await delay(25)
      await writeFile(join(dir, 'terminal.ansi'), raw)
      await writeFile(join(dir, 'frames.json'), JSON.stringify(frames, null, 2))
      await writeFile(join(dir, 'requests.json'), JSON.stringify(router.requests, null, 2))
      await writeFile(join(dir, 'screen.txt'), screen())
      terminal.dispose()
      await router.close()
      const unexpected = await readFile(join(dir, 'unexpected-network.log'), 'utf8')
      if (unexpected || router.unexpected.length) throw new Error(`Unexpected network traffic; artifacts: ${dir}\n${unexpected}${router.unexpected.join('\n')}`)
    },
  }
}
