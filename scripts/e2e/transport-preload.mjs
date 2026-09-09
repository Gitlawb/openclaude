// Test-only Node preload. The installed package, parser, auth and query loop stay real.
import { HttpRequestInterceptor } from '@mswjs/interceptors/http'
import { appendFileSync } from 'node:fs'
import childProcess from 'node:child_process'
import { syncBuiltinESMExports } from 'node:module'

// Trace executable names and timings only; never record arguments or input,
// which may contain credentials. This also locates synchronous startup stalls.
const processLog = process.env.CLI_E2E_PROCESS_LOG
if (processLog) {
  const spawnSync = childProcess.spawnSync
  childProcess.spawnSync = (...args) => {
    const started = Date.now()
    appendFileSync(processLog, `${JSON.stringify({ event: 'spawnSync', file: args[0], at: started })}\n`)
    try { return spawnSync(...args) }
    finally { appendFileSync(processLog, `${JSON.stringify({ event: 'spawnSync:end', file: args[0], durationMs: Date.now() - started })}\n`) }
  }
  const spawn = childProcess.spawn
  childProcess.spawn = (...args) => {
    const child = spawn(...args)
    const started = Date.now()
    appendFileSync(processLog, `${JSON.stringify({ event: 'spawn', file: args[0], pid: child.pid, at: started })}\n`)
    child.once('exit', code => appendFileSync(processLog, `${JSON.stringify({ event: 'spawn:exit', file: args[0], pid: child.pid, code, durationMs: Date.now() - started })}\n`))
    return child
  }
  syncBuiltinESMExports()
}

const origin = process.env.CLI_E2E_ORIGIN
if (!origin?.startsWith('http://127.0.0.1:')) throw new Error('Missing loopback fixture origin')
// Redirect fetch at its URL boundary so its real response stream and abort
// signal reach the local socket. Mock response piping loses post-header aborts.
const realFetch = globalThis.fetch
globalThis.fetch = (input, init) => {
  const request = new Request(input, init)
  const url = new URL(request.url)
  return realFetch(url.hostname === 'code.verboo.ai'
    ? new Request(`${origin}${url.pathname}${url.search}`, request)
    : request)
}
const interceptor = new HttpRequestInterceptor()
interceptor.apply()
interceptor.on('request', async ({ request, controller }) => {
  const url = new URL(request.url)
  if (url.origin === origin) return
  if (url.hostname !== 'code.verboo.ai') {
    appendFileSync(process.env.CLI_E2E_NETWORK_LOG, `${request.method} ${url.origin}${url.pathname}\n`)
    controller.respondWith(new Response('Unexpected external request in CLI fixture', { status: 503 }))
    return
  }
  const body = ['GET', 'HEAD'].includes(request.method) ? undefined : await request.clone().arrayBuffer()
  const response = await fetch(`${origin}${url.pathname}${url.search}`, { method: request.method, body, signal: request.signal, headers: { 'Content-Type': request.headers.get('Content-Type') || 'application/json' } })
  controller.respondWith(response)
})
