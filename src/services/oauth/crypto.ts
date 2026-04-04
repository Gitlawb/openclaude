import { randomBytes, webcrypto } from 'crypto'

function base64URLEncode(buffer: Buffer): string {
  return buffer
    .toString('base64')
    .replace(/\+/g, '-')
    .replace(/\//g, '_')
    .replace(/=/g, '')
}

export function generateCodeVerifier(): string {
  return base64URLEncode(randomBytes(32))
}

export async function generateCodeChallenge(verifier: string): Promise<string> {
  const encoded = new TextEncoder().encode(verifier)
  const digest = await webcrypto.subtle.digest('SHA-256', encoded)
  return base64URLEncode(Buffer.from(digest))
}

export function generateState(): string {
  return base64URLEncode(randomBytes(32))
}
