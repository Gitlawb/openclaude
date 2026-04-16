import http from 'node:http'

export function detectProvider(): { provider: string; model: string } {
  const env = process.env
  if (env.CLAUDE_CODE_USE_GEMINI) return { provider: 'gemini', model: env.GEMINI_MODEL || env.OPENAI_MODEL || 'gemini' }
  if (env.CLAUDE_CODE_USE_GITHUB) return { provider: 'github', model: env.OPENAI_MODEL || 'github-models' }
  if (env.CLAUDE_CODE_USE_OPENAI) return { provider: 'openai', model: env.OPENAI_MODEL || 'openai' }
  if (env.CLAUDE_CODE_USE_BEDROCK) return { provider: 'bedrock', model: env.ANTHROPIC_MODEL || 'bedrock' }
  if (env.CLAUDE_CODE_USE_VERTEX) return { provider: 'vertex', model: env.ANTHROPIC_MODEL || 'vertex' }
  if (env.ANTHROPIC_API_KEY) return { provider: 'anthropic', model: env.ANTHROPIC_MODEL || 'claude' }
  if (env.OPENAI_API_KEY) return { provider: 'openai', model: env.OPENAI_MODEL || 'openai' }
  return { provider: 'unknown', model: 'none' }
}

export function jsonResponse(res: http.ServerResponse, data: unknown, status = 200) {
  res.writeHead(status, { 'Content-Type': 'application/json' })
  res.end(JSON.stringify(data))
}
