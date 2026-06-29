/**
 * Auto-extract facts from message content into memdir memory files.
 *
 * Ported from the knowledgeGraph-based fact extraction in conversationArc.ts.
 * Instead of calling addGlobalEntity(), this writes structured .md files
 * into the auto-memory directory with proper frontmatter.
 */

import { writeFileSync, existsSync, mkdirSync, readFileSync } from 'fs'
import { join, dirname } from 'path'
import { sanitizePath } from '../utils/path.js'
import { getAutoMemPath } from './paths.js'

const FACTS_SUBDIR = '.facts'

function ensureFactsDir(memoryDir: string): string {
  const dir = join(memoryDir, FACTS_SUBDIR)
  if (!existsSync(dir)) {
    mkdirSync(dir, { recursive: true })
  }
  return dir
}

function slugify(text: string): string {
  return text
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-|-$/g, '')
    .slice(0, 80)
}

function yamlQuote(val: string): string {
  const escaped = val.replace(/\\/g, '\\\\').replace(/"/g, '\\"').replace(/\n/g, ' ')
  return `"${escaped}"`
}

function writeFactMemory(
  memoryDir: string,
  factType: string,
  name: string,
  description: string,
  attributes: Record<string, string> = {},
): void {
  const factsDir = ensureFactsDir(memoryDir)
  const slug = slugify(name)
  const filename = `fact-${factType}-${slug}.md`
  const filePath = join(factsDir, filename)

  const now = new Date().toISOString()
  const attrLines = Object.entries(attributes)
    .map(([k, v]) => `${k}: ${yamlQuote(v)}`)
    .join('\n')

  const content = `---
type: reference
title: ${yamlQuote(name)}
description: ${yamlQuote(description)}
factType: ${yamlQuote(factType)}
detectedAt: ${now}
${attrLines ? `attributes:\n${Object.entries(attributes).map(([k, v]) => `  ${k}: ${yamlQuote(v)}`).join('\n')}` : ''}
---

Auto-detected fact: **${name}**

${description}

${Object.entries(attributes).length > 0 ? `**Details:**\n${Object.entries(attributes).map(([k, v]) => `- ${k}: ${v}`).join('\n')}` : ''}
`

  writeFileSync(filePath, content, 'utf-8')
}

const MAX_FACTS_PER_CALL = 20

export async function extractFactsIntoMemdir(
  content: string,
  memoryDir?: string,
): Promise<void> {
  const dir = memoryDir || getAutoMemPath()
  if (!dir) return

  let factsWritten = 0

  function cappedWrite(
    ...args: Parameters<typeof writeFactMemory>
  ): void {
    if (factsWritten >= MAX_FACTS_PER_CALL) return
    factsWritten++
    writeFactMemory(...args)
  }

  // 1. Detect Environment Variables (KEY=VALUE)
  const envMatches = content.matchAll(/(?:export\s+)?([A-Z_]{3,})=([^\s\n"']+)/g)
  for (const match of envMatches) {
    cappedWrite(dir, 'env', match[1], `${match[1]} environment variable`, { value: '[REDACTED]' })
  }

  // 2. Detect Versions
  const versionMatches = content.matchAll(/(?:v|version\s+)(\d+\.\d+(?:\.\d+)?)/gi)
  for (const match of versionMatches) {
    cappedWrite(dir, 'version', match[0].toLowerCase(), `Version ${match[1]}`, { semver: match[1] })
  }

  // 4. Detect Hostnames/URLs
  const urlMatches = content.matchAll(/(https?:\/\/[^\s\n"']+)/g)
  for (const match of urlMatches) {
    try {
      const url = new URL(match[1])
      if (url.hostname.includes('.')) {
        const safeUrl = `${url.protocol}//${url.host}${url.pathname}`
        cappedWrite(dir, 'endpoint', url.hostname, `Endpoint: ${url.hostname}`, { url: safeUrl })
      }
    } catch {
      /* ignore */
    }
  }

  // 5. Specific tech detection
  if (content.toLowerCase().includes('redux'))
    cappedWrite(dir, 'tech', 'Redux', 'Redux state management', { category: 'state_management' })
  if (content.toLowerCase().includes('react'))
    cappedWrite(dir, 'tech', 'React', 'React frontend library', { category: 'frontend' })

}
