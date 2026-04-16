import http from 'node:http'
import { getModelOptions } from '../utils/model/modelOptions.js'
import { loadMessageLogs, loadFullLog } from '../utils/sessionStorage.js'
import { detectProvider, jsonResponse } from './provider.js'

export async function handleHttpRequest(
  req: http.IncomingMessage,
  res: http.ServerResponse,
  html: string,
): Promise<boolean> {
  const pathname = (req.url || '/').split('?')[0]

  if (req.method === 'GET' && (pathname === '/' || pathname === '')) {
    res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' })
    res.end(html)
    return true
  }

  if (req.method === 'GET' && pathname === '/api/health') {
    jsonResponse(res, { status: 'ok' })
    return true
  }

  if (req.method === 'GET' && pathname === '/api/provider') {
    jsonResponse(res, detectProvider())
    return true
  }

  if (req.method === 'GET' && pathname === '/api/cwd') {
    jsonResponse(res, { cwd: process.cwd() })
    return true
  }

  if (req.method === 'GET' && pathname === '/api/models') {
    try {
      const options = getModelOptions()
      const seen = new Set<string>()
      const models = options
        .filter((o: Record<string, unknown>) => o.value !== null && o.value !== undefined)
        .map((o: Record<string, unknown>) => ({ value: o.value as string, label: o.label as string, description: o.description as string }))
        .filter((m) => {
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

  if (req.method === 'GET' && pathname === '/api/sessions') {
    try {
      const logs = await loadMessageLogs(30)
      const sessions = logs.map((log: Record<string, unknown>) => ({
        id: (log.sessionId as string) || String(log.value),
        title: (log.firstPrompt as string) || 'Untitled',
        date: (log.modified instanceof Date ? log.modified.toISOString() : log.date) as string,
        messageCount: (log.messageCount as number) || 0,
      }))
      jsonResponse(res, sessions)
    } catch {
      jsonResponse(res, [])
    }
    return true
  }

  const sessionMatch = pathname.match(/^\/api\/sessions\/([^/?]+)/)
  if (req.method === 'GET' && sessionMatch) {
    try {
      const requestedId = decodeURIComponent(sessionMatch[1])
      const logs = await loadMessageLogs(30)
      const logEntry = logs.find(
        (log: Record<string, unknown>) =>
          (log.sessionId && String(log.sessionId) === requestedId) ||
          String(log.value) === requestedId,
      )
      if (!logEntry) {
        jsonResponse(res, { error: 'Session not found' }, 404)
        return true
      }
      const fullLog = await loadFullLog(logEntry)
      interface MessageLike { role?: string; content?: string | { type?: string; text?: string }[] }
      const messages = ((fullLog.messages || []) as MessageLike[]).map((m) => {
        let text = ''
        if (typeof m.content === 'string') {
          text = m.content
        } else if (Array.isArray(m.content)) {
          text = m.content
            .filter((b) => b.type === 'text')
            .map((b) => b.text || '')
            .join('\n')
        }
        return { role: m.role, content: text }
      }).filter((m) => m.content && (m.role === 'user' || m.role === 'assistant'))
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
