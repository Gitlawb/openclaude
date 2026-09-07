import { spawn } from 'node:child_process'
import { once } from 'node:events'
import { mkdtemp, readFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { expect, test } from 'bun:test'
import type { AppState } from '../state/AppState.js'
import { wrapSpawn } from '../utils/ShellCommand.js'
import { TaskOutput } from '../utils/task/TaskOutput.js'
import { cancelSessionTasks } from './cancelSessionTasks.js'

const processTest = process.platform === 'win32' ? test.skip : test
processTest('session cancellation kills a real background shell and its descendant', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'verboo-cancel-process-'))
  const pidFile = join(dir, 'child.pid')
  const child = spawn('sh', ['-c', 'sleep 30 & child=$!; echo "$child" > "$1"; wait', 'fixture', pidFile], { stdio: 'ignore' })
  const exited = once(child, 'exit')
  const controller = new AbortController()
  const command = wrapSpawn(child, controller.signal, 30000, new TaskOutput('cancel-process-test', null))
  let descendant: number | undefined
  const isAlive = (pid: number) => {
    try { process.kill(pid, 0); return true } catch { return false }
  }
  try {
    for (let i = 0; i < 100 && !descendant; i++) {
      try { descendant = Number(await readFile(pidFile, 'utf8')) } catch { await Bun.sleep(10) }
    }
    expect(descendant).toBeGreaterThan(0)
    expect(command.background('cancel-process-test')).toBe(true)
    controller.abort('user-cancel')
    expect(command.status).toBe('backgrounded') // Backgrounding detached its listener.
    let state = { tasks: {
      'cancel-process-test': { id: 'cancel-process-test', type: 'local_bash', status: 'running',
        description: 'test shell', shellCommand: command, notified: false },
    } } as unknown as AppState
    await cancelSessionTasks(() => state, update => { state = update(state) })
    await exited
    for (let i = 0; i < 100 && isAlive(descendant!); i++) await Bun.sleep(10)
    expect(isAlive(descendant!)).toBe(false)
    expect(state.tasks['cancel-process-test']?.status).toBe('killed')
  } finally {
    if (descendant && isAlive(descendant)) process.kill(descendant, 'SIGKILL')
    if (child.pid && isAlive(child.pid)) child.kill('SIGKILL')
    command.cleanup()
    await rm(dir, { recursive: true, force: true })
  }
}, 4000)
