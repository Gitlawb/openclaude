/**
 * Local JWT signing and validation.
 *
 * The CLI decodes JWT claims (exp, session_id) for refresh scheduling
 * but does NOT validate the signature. The server validates on each
 * request using HMAC-SHA256 with a local secret.
 */

import { createHmac } from 'crypto'

function base64url(data: string | Buffer): string {
  const buf = typeof data === 'string' ? Buffer.from(data) : data
  return buf.toString('base64url')
}

export function signJwt(
  sessionId: string,
  epoch: number,
  secret: string,
  expiresInSeconds = 3600,
): string {
  const header = base64url(JSON.stringify({ alg: 'HS256', typ: 'JWT' }))
  const now = Math.floor(Date.now() / 1000)
  const payload = base64url(
    JSON.stringify({
      session_id: sessionId,
      role: 'worker',
      epoch,
      iat: now,
      exp: now + expiresInSeconds,
    }),
  )
  const signature = createHmac('sha256', secret)
    .update(`${header}.${payload}`)
    .digest('base64url')
  return `${header}.${payload}.${signature}`
}

export function verifyJwt(
  token: string,
  secret: string,
): { sessionId: string; epoch: number } | null {
  const parts = token.split('.')
  if (parts.length !== 3) return null

  const [header, payload, signature] = parts
  const expected = createHmac('sha256', secret)
    .update(`${header}.${payload}`)
    .digest('base64url')

  if (signature !== expected) return null

  try {
    const claims = JSON.parse(Buffer.from(payload!, 'base64url').toString())
    if (claims.exp && claims.exp < Math.floor(Date.now() / 1000)) return null
    return { sessionId: claims.session_id, epoch: claims.epoch }
  } catch {
    return null
  }
}
