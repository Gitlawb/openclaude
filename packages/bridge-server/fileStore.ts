/**
 * Local file store for bridge file uploads.
 *
 * Stores uploaded files in ~/.claude/bridge-files/ keyed by UUID.
 * Provides upload (multipart) and serve (GET by UUID) handlers.
 */

import { existsSync, mkdirSync } from 'fs'
import { homedir } from 'os'
import { join } from 'path'
import { randomUUID } from 'crypto'

const STORE_DIR = join(homedir(), '.claude', 'bridge-files')

function ensureDir(): void {
  if (!existsSync(STORE_DIR)) {
    mkdirSync(STORE_DIR, { recursive: true })
  }
}

export async function storeFile(file: Blob): Promise<string> {
  ensureDir()
  const uuid = randomUUID()
  const path = join(STORE_DIR, uuid)
  await Bun.write(path, file)
  return uuid
}

export function getFilePath(uuid: string): string | null {
  // Sanitize: only allow UUID-shaped strings (no path traversal)
  if (!/^[a-f0-9-]{36}$/.test(uuid)) return null
  const path = join(STORE_DIR, uuid)
  return existsSync(path) ? path : null
}
