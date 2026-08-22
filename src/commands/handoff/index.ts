import { openSync, closeSync, existsSync } from 'fs'
import { basename, isAbsolute, resolve } from 'path'
import { spawn } from 'child_process'
import type { Command, LocalCommandCall } from '../../types/command.js'
import { getOriginalCwd, getSessionId } from '../../bootstrap/state.js'
import {
  generateHandoffId,
  getHandoffLogPath,
  writeHandoffMetadata,
  type HandoffMetadata,
} from '../../utils/handoff/handoffMetadata.js'

function stripWrappingQuotes(s: string): string {
  if (s.length >= 2) {
    const first = s[0]
    const last = s[s.length - 1]
    if ((first === '"' && last === '"') || (first === "'" && last === "'")) {
      return s.slice(1, -1)
    }
  }
  return s
}

function toAbsolute(p: string, cwd: string): string {
  if (!p) return p
  return isAbsolute(p) ? p : resolve(cwd, p)
}

function resolveSpawnTarget(invocationCwd: string): {
  binary: string
  prefixArgs: string[]
} {
  // Three cases to handle:
  //   1. Compiled single-file binary (./cli from `bun run compile`, or
  //      ./cli-dev from `bun run build:dev` which also compiles): argv[0]
  //      is the binary itself; re-invoke it directly. process.execPath
  //      reports the embedded bun runtime, NOT the binary, so we cannot
  //      use execPath here — argv[0] is the right source of truth.
  //   2. Bun-wrapped script: argv[0] is the bun runtime, argv[1] is the
  //      script path. Re-invoke as [bun, script, ...].
  //   3. Node-wrapped script: same as (2) but with node.
  const argv0 = process.argv[0] ?? ''
  const argv1 = process.argv[1] ?? ''
  const argv0Base = basename(argv0)
  if (argv0Base === 'bun' || argv0Base === 'bunx' || argv0Base === 'node') {
    // Runtime invoked from PATH: argv[0] is just "node"/"bun", not a path,
    // so resolving it against cwd yields a bogus /cwd/node. execPath is the
    // absolute runtime location; resolve the script against the original
    // invocation dir, since cwd may have changed (e.g. worktrees).
    return {
      binary: process.execPath,
      prefixArgs: argv1 ? [toAbsolute(argv1, invocationCwd)] : [],
    }
  }
  return { binary: toAbsolute(argv0, invocationCwd), prefixArgs: [] }
}

const call: LocalCommandCall = async (args: string) => {
  const prompt = stripWrappingQuotes(args.trim())
  if (!prompt) {
    return {
      type: 'text',
      value:
        'Usage: /handoff <prompt>\n' +
        'Spawns a detached agent in the background that runs the prompt to completion.\n' +
        'Use /handoffs to list active jobs and /handoff-status <id> to check progress.',
    }
  }

  const handoffId = generateHandoffId()
  const cwd = getOriginalCwd()
  const parentSessionId = getSessionId() ?? null
  const logPath = getHandoffLogPath(handoffId)
  const { binary, prefixArgs } = resolveSpawnTarget(cwd)

  if (!existsSync(binary)) {
    return {
      type: 'text',
      value:
        `Handoff failed: cannot locate the CLI binary to re-invoke.\n` +
        `  Tried: ${binary}\n` +
        `  argv[0]: ${process.argv[0] ?? '<unset>'}\n` +
        `  argv[1]: ${process.argv[1] ?? '<unset>'}\n` +
        `Pass an explicit binary via env var (not yet implemented) or run from an absolute invocation.`,
    }
  }

  const startedAt = Date.now()
  const initial: HandoffMetadata = {
    handoffId,
    parentSessionId,
    pid: null,
    status: 'spawning',
    startedAt,
    finishedAt: null,
    prompt,
    cwd,
    logPath,
    exitCode: null,
    binaryPath: binary,
  }
  writeHandoffMetadata(initial)

  const logFd = openSync(logPath, 'a')

  const childArgs = [
    ...prefixArgs,
    '--print',
    '--dangerously-skip-permissions',
    prompt,
  ]

  const child = spawn(binary, childArgs, {
    cwd,
    detached: true,
    stdio: ['ignore', logFd, logFd],
    env: {
      ...process.env,
      CLAUDE_HANDOFF_ID: handoffId,
      CLAUDE_HANDOFF_PARENT_SESSION: parentSessionId ?? '',
    },
  })

  closeSync(logFd)

  if (child.pid === undefined) {
    const failed: HandoffMetadata = {
      ...initial,
      status: 'failed',
      finishedAt: Date.now(),
    }
    writeHandoffMetadata(failed)
    return {
      type: 'text',
      value: `Handoff ${handoffId} failed to spawn (no pid).`,
    }
  }

  const running: HandoffMetadata = {
    ...initial,
    pid: child.pid,
    status: 'running',
  }
  writeHandoffMetadata(running)

  // Async spawn failures (EACCES/ENOENT) surface as an 'error' event, not
  // 'exit'; without a listener Node would crash the leader process and leave
  // metadata stuck in 'spawning'/'running'. Mark it failed best-effort.
  child.on('error', () => {
    const failed: HandoffMetadata = {
      ...initial,
      status: 'failed',
      finishedAt: Date.now(),
    }
    try {
      writeHandoffMetadata(failed)
    } catch {
      // Best-effort; leader may have exited.
    }
  })

  child.on('exit', (code, signal) => {
    const finalStatus: HandoffMetadata['status'] =
      signal === 'SIGKILL' || signal === 'SIGTERM'
        ? 'killed'
        : code === 0
          ? 'done'
          : 'failed'
    const finalMeta: HandoffMetadata = {
      ...running,
      status: finalStatus,
      finishedAt: Date.now(),
      exitCode: code,
    }
    try {
      writeHandoffMetadata(finalMeta)
    } catch {
      // Best-effort; leader may have exited.
    }
  })

  child.unref()

  const summary = prompt.length > 60 ? prompt.slice(0, 60) + '...' : prompt
  return {
    type: 'text',
    value:
      `Handoff started.\n` +
      `  id:     ${handoffId}\n` +
      `  pid:    ${child.pid}\n` +
      `  prompt: ${summary}\n` +
      `  log:    ${logPath}\n\n` +
      `Check progress: /handoff-status ${handoffId}\n` +
      `List all:       /handoffs`,
  }
}

const handoff = {
  type: 'local',
  name: 'handoff',
  description:
    'Spawn a detached background agent to run a prompt to completion. Survives quitting this CLI. ' +
    'The agent runs non-interactively with --dangerously-skip-permissions, since it cannot answer permission prompts.',
  argumentHint: '<prompt>',
  isEnabled: () => true,
  supportsNonInteractive: true,
  load: () => Promise.resolve({ call }),
} satisfies Command

export default handoff
