import http from 'node:http'
import { getModelOptions } from '../utils/model/modelOptions.js'
import { loadMessageLogs, loadFullLog } from '../utils/sessionStorage.js'
import { detectProvider, jsonResponse } from './provider.js'

export async function handleHttpRequest(
  req: http.IncomingMessage,
  res: http.ServerResponse,
  html: string,
): Promise<boolean> {
  if (req.method === 'GET' && (req.url === '/' || req.url === '')) {
    res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' })
    res.end(html)
    return true
  }

  if (req.method === 'GET' && req.url === '/api/health') {
    jsonResponse(res, { status: 'ok' })
    return true
  }

  if (req.method === 'GET' && req.url === '/api/provider') {
    jsonResponse(res, detectProvider())
    return true
  }

  if (req.method === 'GET' && req.url === '/api/cwd') {
    jsonResponse(res, { cwd: process.cwd() })
    return true
  }

  if (req.method === 'GET' && req.url === '/api/models') {
    try {
      const options = getModelOptions()
      const seen = new Set<string>()
      const models = options
        .filter((o: any) => o.value !== null && o.value !== undefined)
        .map((o: any) => ({ value: o.value, label: o.label, description: o.description }))
        .filter((m: any) => {
          if (seen.has(m.value)) return false
          seen.add(m.value)
          return true
        })
      jsonResponse(res, models)
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : String(err)
      jsonResponse(res, { error: message }, 500)
    }
    return true
  }

  if (req.method === 'GET' && req.url === '/api/sessions') {
    try {
      const logs = await loadMessageLogs(30)
      const sessions = logs.map((log: any) => ({
        id: log.sessionId || String(log.value),
        title: log.firstPrompt || 'Untitled',
        date: log.modified?.toISOString() || log.date,
        messageCount: log.messageCount || 0,
        fullPath: log.fullPath || '',
      }))
      jsonResponse(res, sessions)
    } catch {
      jsonResponse(res, [])
    }
    return true
  }

  const sessionMatch = req.url?.match(/^\/api\/sessions\/(\d+)$/)
  if (req.method === 'GET' && sessionMatch) {
    try {
      const idx = parseInt(sessionMatch[1], 10)
      const logs = await loadMessageLogs(30)
      if (idx < 0 || idx >= logs.length) {
        jsonResponse(res, { error: 'Session not found' }, 404)
        return true
      }
      const fullLog = await loadFullLog(logs[idx])
      const messages = (fullLog.messages || []).map((m: any) => {
        let text = ''
        if (typeof m.content === 'string') {
          text = m.content
        } else if (Array.isArray(m.content)) {
          text = m.content
            .filter((b: any) => b.type === 'text')
            .map((b: any) => b.text || '')
            .join('\n')
        }
        return { role: m.role, content: text }
      }).filter((m: any) => m.content && (m.role === 'user' || m.role === 'assistant'))
      jsonResponse(res, {
        id: fullLog.sessionId || String(fullLog.value),
        title: fullLog.firstPrompt || 'Untitled',
        messages,
      })
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : String(err)
      jsonResponse(res, { error: message || 'Failed to load session' }, 500)
    }
    return true
  }

  return false
}
