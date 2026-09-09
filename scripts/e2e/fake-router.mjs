import { createServer } from 'node:http'
import { setTimeout as delay } from 'node:timers/promises'

export async function createFakeRouter({ agents = 2, omitUsage = false, zeroUsage = false, partialUsage = false, stall = false, background = false, childFailure = false, childToolLoop = false } = {}) {
  const requests = []
  const unexpected = []
  let sequence = 0
  const activeAgents = new Set()
  const activeRequests = new Set()
  async function handleRequest(req, res) {
    const path = new URL(req.url, 'http://fixture').pathname
    const json = value => { res.setHeader('Content-Type', 'application/json'); res.end(JSON.stringify(value)) }
    if (path === '/') return json({ ok: true })
    if (path === '/api/claude_code/settings') return json({ settings: {} })
    if (path === '/api/plugins/marketplace.json') return json({ name: 'fixture', owner: { name: 'Fixture' }, plugins: [] })
    if (path.endsWith('/models')) return json({ data: [{ id: 'fixture-model', object: 'model' }], agent_model_roles: { explore: 'fixture-model', balanced: 'fixture-model', powerful: 'fixture-model' } })
    if (path === '/api/me') return json({ data: { id: '11111111-1111-4111-8111-111111111111', email: 'fixture@example.test', name: 'Fixture', confirmed: true } })
    if (path === '/api/me/subscriptions') return json({ data: [{ id: '11111111-1111-4111-8111-111111111111', groupId: '22222222-2222-4222-8222-222222222222', status: 'active', currentPeriodEnd: '2099-01-01T00:00:00Z' }] })
    if (path === '/api/me/terms/status') return json({ data: { configured: false, mustAccept: false, pendingReacceptance: false } })
    if (path !== '/router/v1/chat/completions') { unexpected.push(path); res.statusCode = 404; return json({ error: { message: `Unknown fixture endpoint: ${path}` } }) }
    const chunks = []
    for await (const chunk of req) chunks.push(chunk)
    const body = JSON.parse(Buffer.concat(chunks).toString())
    requests.push(body)
    const id = `fixture-${++sequence}`
    const prompt = body.messages.filter(message => message.role === 'user').map(message => JSON.stringify(message.content)).join('\n')
    const isChild = prompt.includes('AGENT_FIXTURE_')
    if (isChild && childFailure) {
      res.statusCode = 400
      return json({ error: { type: 'invalid_request_error', message: 'Fixture child request rejected' } })
    }
    if (isChild) { activeAgents.add(id); res.once('close', () => activeAgents.delete(id)) }
    const hasResult = body.messages.some(message => message.role === 'tool')
    res.writeHead(200, { 'Content-Type': 'text/event-stream', 'Cache-Control': 'no-cache' })
    const emit = (delta, finish_reason = null, usage) => res.write(`data: ${JSON.stringify({ id, object: 'chat.completion.chunk', model: 'fixture-model', choices: [{ index: 0, delta, finish_reason }], ...(usage && { usage }) })}\n\n`)
    emit({ role: 'assistant' })
    if (isChild && childToolLoop) {
      emit({ tool_calls: [{ index: 0, id: `read-${sequence}`, type: 'function', function: { name: 'Read', arguments: JSON.stringify({ file_path: 'README.md' }) } }] })
      emit({}, 'tool_calls', { prompt_tokens: 120, completion_tokens: 24 })
    } else if (!isChild && !hasResult && body.tools?.length) {
      const name = body.tools.find(tool => ['Agent', 'Task'].includes(tool.function.name))?.function.name
      if (!name) { unexpected.push('Agent tool missing from actual query'); res.end(); return }
      for (let index = 0; index < agents; index++) {
        const args = JSON.stringify({ description: `Worker ${index} 日本語 🚀`, subagent_type: childToolLoop ? 'fixture-limited' : 'general-purpose', prompt: `AGENT_FIXTURE_${index}: inspect the fixture and report.`, ...(background && { run_in_background: true }) })
        emit({ tool_calls: [{ index, id: `call-${index}`, type: 'function', function: { name, arguments: args.slice(0, 25) } }] })
        emit({ tool_calls: [{ index, function: { arguments: args.slice(25) } }] })
      }
      emit({}, 'tool_calls', { prompt_tokens: 120, completion_tokens: 24 })
    } else {
      const content = !body.tools?.length ? '{"title":"Fixture agent test"}' : isChild ? `Worker report 日本語 🚀 ${'reading fixture safely. '.repeat(12)}` : 'E2E_COMPLETE'
      for (let index = 0; index < content.length; index += 16) {
        if (res.destroyed) break
        emit({ content: content.slice(index, index + 16) })
        await delay(isChild ? 100 : 5)
      }
      if (stall && isChild) return
      emit({}, 'stop', omitUsage ? undefined : zeroUsage ? { prompt_tokens: 0, completion_tokens: 0 } : partialUsage ? { prompt_tokens: 120 } : { prompt_tokens: 120, completion_tokens: 24, prompt_tokens_details: { cached_tokens: 5 } })
    }
    res.end('data: [DONE]\n\n')
  }
  const server = createServer((req, res) => {
    const handling = handleRequest(req, res).catch(error => {
      // Stopping the CLI may abort a request while its body is arriving.
      // HTTP event listeners do not consume rejected async promises themselves.
      if (req.aborted && error?.code === 'ECONNRESET') return
      unexpected.push(`Fixture handler failed: ${error?.message ?? String(error)}`)
      res.destroy()
    }).finally(() => activeRequests.delete(handling))
    activeRequests.add(handling)
  })
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve))
  return {
    origin: `http://127.0.0.1:${server.address().port}`, requests, unexpected, activeAgents, activeRequests,
    async close() {
      const closed = new Promise(resolve => server.close(resolve))
      server.closeAllConnections()
      await closed
      await Promise.all([...activeRequests])
    },
  }
}
