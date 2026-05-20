import { spawn, type ChildProcess } from 'node:child_process'
import { resolve } from 'node:path'
import { existsSync, openSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { tmpdir } from 'node:os'
import { randomBytes } from 'node:crypto'
import type { ToolUseContext } from '../../Tool.js'
import type {
  LocalJSXCommandContext,
  LocalJSXCommandOnDone,
} from '../../types/command.js'
import { registerCleanup } from '../../utils/cleanupRegistry.js'

let activeServerProcess: ChildProcess | null = null

// Register cleanup once at module level
registerCleanup(async () => {
  if (activeServerProcess) {
    activeServerProcess.kill('SIGTERM')
    activeServerProcess = null
  }
})

export async function call(
  onDone: LocalJSXCommandOnDone,
  _context: ToolUseContext & LocalJSXCommandContext,
  _args: string,
): Promise<null> {
  const lines: string[] = ['🚀 Launching OpenClaude Web Console...']
  
  if (activeServerProcess) {
    lines.push('♻️ Restarting existing web server...')
    activeServerProcess.kill('SIGTERM')
    activeServerProcess = null
  }

  // Robust directory resolution
  const currentDir = fileURLToPath(new URL('.', import.meta.url))
  
  // In the built bundle, cli.mjs and web.mjs are in the same folder
  const builtPath = resolve(currentDir, 'web.mjs')
  // In development, we look for the TS source
  const devPath = resolve(currentDir, '../../entrypoints/web.ts')

  let serverPath = ''
  if (existsSync(builtPath)) {
    serverPath = builtPath
  } else if (existsSync(devPath)) {
    serverPath = devPath
  }

  if (!serverPath) {
    onDone('❌ Could not find web server entrypoint (web.mjs or web.ts).', { display: 'system' })
    return null
  }

  try {
    // Generate a random token for this session
    const token = randomBytes(16).toString('hex')
    const port = process.env.PORT || '3000'

    // If it's a TS file, we need bun. If it's the MJS bundle, we use the current node/bun process.
    const runner = serverPath.endsWith('.ts') ? 'bun' : process.execPath
    const args = serverPath.endsWith('.ts') ? ['run', serverPath] : [serverPath]

    const logFile = resolve(tmpdir(), 'openclaude-web.log')
    const out = openSync(logFile, 'a')

    const child = spawn(runner, args, {
      stdio: ['ignore', out, out],
      env: { 
        ...process.env, 
        PORT: port,
        OPENCLAUDE_WEB_TOKEN: token
      }
    })

    if (!child.pid) {
      throw new Error('Process failed to start (no PID)')
    }

    activeServerProcess = child
    
    const url = `http://localhost:${port}/?token=${token}`
    lines.push(`✨ Web Console is running at ${url}`)
    lines.push('🔒 Security: Token authentication is enabled.')
    lines.push('📱 Mobile: Use Tailscale/Cloudflare and keep the token in the URL!')
    onDone(lines.join('\n'), { display: 'system' })
  } catch (err: any) {
    onDone(`❌ Failed to launch web server: ${err.message}`, { display: 'system' })
  }

  return null
}
