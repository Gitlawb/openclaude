#!/usr/bin/env node

/**
 * OpenClaude — Claude Code with any LLM
 *
 * If dist/cli.mjs exists (built), run that.
 * Otherwise, tell the user to build first or use `bun run dev`.
 */

import { existsSync } from 'fs'
import { join, dirname } from 'path'
import { fileURLToPath, pathToFileURL } from 'url'

const __dirname = dirname(fileURLToPath(import.meta.url))
const distPath = join(__dirname, '..', 'dist', 'cli.mjs')

if (existsSync(distPath)) {
  await import(pathToFileURL(distPath).href)
} else {
  console.error(`
  openclaude: dist/cli.mjs not found.

  Build first:
    bun run build

  Or run directly with Bun:
    bun run dev

  See README.md for setup instructions.
`)
  process.exit(1)
}
