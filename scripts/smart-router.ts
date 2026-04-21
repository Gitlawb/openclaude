#!/usr/bin/env bun
/**
 * Smart Router Launcher
 * ---------------------
 * Spawns the Python smart router as a subprocess and bridges
 * communication between Claude Code terminal and the router.
 *
 * Usage:
 *   bun run scripts/smart-router.ts
 *   bun run scripts/smart-router.ts --strategy=latency
 *   bun run scripts/smart-router.ts --port=8080
 *
 * Environment:
 *   SMART_ROUTER_STRATEGY=latency|cost|balanced
 *   SMART_ROUTER_PORT=8080
 *   SMART_ROUTER_FALLBACK=true
 */

import { spawn } from 'child_process'
import { resolve } from 'path'
import { fileURLToPath } from 'url'

const __dirname = fileURLToPath(new URL('.', import.meta.url))

interface RouterConfig {
  strategy: 'latency' | 'cost' | 'balanced'
  port: number
  fallback: boolean
  verbose: boolean
}

function parseArgs(): RouterConfig {
  const args = process.argv.slice(2)
  const config: RouterConfig = {
    strategy: (process.env.SMART_ROUTER_STRATEGY as RouterConfig['strategy']) || 'balanced',
    port: parseInt(process.env.SMART_ROUTER_PORT || '8080', 10),
    fallback: process.env.SMART_ROUTER_FALLBACK !== 'false',
    verbose: args.includes('--verbose') || args.includes('-v'),
  }

  for (const arg of args) {
    if (arg.startsWith('--strategy=')) {
      config.strategy = arg.split('=')[1] as RouterConfig['strategy']
    }
    if (arg.startsWith('--port=')) {
      config.port = parseInt(arg.split('=')[1], 10)
    }
    if (arg === '--fallback' || arg === '-f') {
      config.fallback = true
    }
  }

  return config
}

async function main() {
  const config = parseArgs()

  console.log('🚀 Starting Smart Router...')
  console.log(`   Strategy: ${config.strategy}`)
  console.log(`   Port: ${config.port}`)
  console.log(`   Fallback: ${config.fallback}`)

  const pythonScript = resolve(__dirname, '../python/smart_router.py')

  // Set environment for Python router
  const env = {
    ...process.env,
    ROUTER_MODE: 'smart',
    ROUTER_STRATEGY: config.strategy,
    ROUTER_FALLBACK: config.fallback ? 'true' : 'false',
    ROUTER_PORT: config.port.toString(),
    PYTHONUNBUFFERED: '1',
  }

  // Spawn Python smart router
  const pythonProcess = spawn('python', ['-u', pythonScript], {
    env,
    stdio: ['pipe', 'pipe', 'pipe'],
  })

  let ready = false

  pythonProcess.stdout.on('data', (data: Buffer) => {
    const lines = data.toString().trim().split('\n')
    for (const line of lines) {
      if (config.verbose || line.includes('ERROR') || line.includes('WARN')) {
        console.log(`[SmartRouter] ${line}`)
      }
      if (line.includes('Router ready') || line.includes('Listening on port')) {
        ready = true
        console.log('✅ Smart Router is ready')
        console.log(`   API: http://localhost:${config.port}/route`)
        console.log(`   Health: http://localhost:${config.port}/health`)
      }
    }
  })

  pythonProcess.stderr.on('data', (data: Buffer) => {
    console.error(`[SmartRouter Error] ${data.toString().trim()}`)
  })

  pythonProcess.on('close', (code) => {
    console.log(`Smart Router exited with code ${code}`)
    process.exit(code || 0)
  })

  pythonProcess.on('error', (err) => {
    console.error('Failed to start Smart Router:', err)
    process.exit(1)
  })

  // Graceful shutdown
  process.on('SIGINT', () => {
    console.log('\n🛑 Shutting down Smart Router...')
    pythonProcess.kill('SIGTERM')
  })

  process.on('SIGTERM', () => {
    pythonProcess.kill('SIGTERM')
  })

  // Wait for router to be ready
  await new Promise<void>((resolve, reject) => {
    const timeout = setTimeout(() => {
      if (!ready) {
        reject(new Error('Smart Router failed to start within 30s'))
      }
    }, 30000)

    const checkReady = setInterval(() => {
      if (ready) {
        clearTimeout(timeout)
        clearInterval(checkReady)
        resolve()
      }
    }, 100)
  })

  // Keep process alive
  await new Promise(() => {})
}

main().catch((err) => {
  console.error('Fatal error:', err)
  process.exit(1)
})
