#!/usr/bin/env bun
/**
 * Local bridge server entry point.
 *
 * Usage:
 *   bun run packages/bridge-server/index.ts
 *   bun run packages/bridge-server/index.ts --port 8080
 *   bun run packages/bridge-server/index.ts --host 0.0.0.0  # for Tailscale/WireGuard
 *
 * The server emulates the Anthropic CCR v2 protocol so the existing
 * bridge client code connects transparently. Set the CLI to connect:
 *   CLAUDE_BRIDGE_BASE_URL=http://localhost:4080 openclaude
 */

import { randomUUID } from 'crypto'
import { createServer } from './server.js'

function parseArgs(): { port: number; host: string; jwtSecret: string } {
  const args = process.argv.slice(2)
  let port = 4080
  let host = 'localhost'
  let jwtSecret = process.env.BRIDGE_JWT_SECRET ?? randomUUID()

  for (let i = 0; i < args.length; i++) {
    if (args[i] === '--port' && args[i + 1]) {
      port = parseInt(args[++i]!, 10)
    } else if (args[i] === '--host' && args[i + 1]) {
      host = args[++i]!
    } else if (args[i] === '--secret' && args[i + 1]) {
      jwtSecret = args[++i]!
    } else if (args[i] === '--help' || args[i] === '-h') {
      console.log(`
openclaude bridge-server — local CCR v2 bridge

Usage:
  bun run packages/bridge-server/index.ts [options]

Options:
  --port <n>      Port to listen on (default: 4080)
  --host <addr>   Host to bind to (default: localhost)
                  Use 0.0.0.0 for remote access via Tailscale/WireGuard
  --secret <key>  JWT signing secret (default: random per run)
  --help, -h      Show this help

Connect the CLI:
  CLAUDE_BRIDGE_BASE_URL=http://localhost:4080 openclaude
`)
      process.exit(0)
    }
  }

  return { port, host, jwtSecret }
}

const config = parseArgs()
const server = createServer(config)

const displayHost = config.host === '0.0.0.0' ? 'localhost' : config.host
console.log(`
  ╔══════════════════════════════════════════════════╗
  ║  openclaude bridge-server                        ║
  ║  Local CCR v2 protocol emulation                 ║
  ╠══════════════════════════════════════════════════╣
  ║  Listening: http://${displayHost}:${config.port}${' '.repeat(Math.max(0, 24 - displayHost.length - String(config.port).length))}║
  ║  Protocol:  CCR v2 (env-less)                    ║
  ║  Auth:      Local JWT (HS256)                    ║
  ║  Files:     ~/.claude/bridge-files/              ║
  ╠══════════════════════════════════════════════════╣
  ║  Connect:                                        ║
  ║  CLAUDE_BRIDGE_BASE_URL=http://${displayHost}:${config.port}${' '.repeat(Math.max(0, 10 - displayHost.length - String(config.port).length))}║
  ║  openclaude                                      ║
  ╚══════════════════════════════════════════════════╝
`)

// Graceful shutdown
process.on('SIGINT', () => {
  console.log('\nShutting down bridge server...')
  server.stop()
  process.exit(0)
})

process.on('SIGTERM', () => {
  server.stop()
  process.exit(0)
})
