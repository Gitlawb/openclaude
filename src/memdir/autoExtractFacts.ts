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

  // Build scrubbed content for downstream extractors so env values (which may
  // contain secrets, paths, or code) are not re-extracted as concept facts.
  const scrubbedContent = content.replace(
    /(?:export\s+)?[A-Z_][A-Z_0-9]{2,}=[^\s\n]+/g,
    match => `${match.split('=')[0]}=[REDACTED]`,
  )

  // 1. Detect Environment Variables (KEY=VALUE) — operates on raw content so
  //    the actual value is available for redaction metadata.
  //    Supports keys with digits and values wrapped in quotes.
  const envMatches = content.matchAll(/(?:export\s+)?([A-Z_][A-Z_0-9]{2,})=[^\s\n]+/g)
  for (const match of envMatches) {
    cappedWrite(dir, 'env', match[1], `${match[1]} environment variable`, { value: '[REDACTED]' })
  }

  // 2. Detect Absolute Paths — strip URLs first so path-like URL segments are not
  //    extracted as filesystem paths, then scan the remaining text.
  const noUrlContent = scrubbedContent.replace(/https?:\/\/[^\s\n]+/g, '')
  const pathMatches = noUrlContent.matchAll(/(\/(?:[\w.-]+\/)+[\w.-]+)/g)
  for (const match of pathMatches) {
    const path = match[1]
    if (path.length > 8 && !path.includes('node_modules') && !path.includes('://')) {
      cappedWrite(dir, 'path', path, `Project path: ${path}`, { type: 'absolute' })
    }
  }

  // 3. Detect Versions
  const versionMatches = scrubbedContent.matchAll(/(?:v|version\s+)(\d+\.\d+(?:\.\d+)?)/gi)
  for (const match of versionMatches) {
    cappedWrite(dir, 'version', match[0].toLowerCase(), `Version ${match[1]}`, { semver: match[1] })
  }

  // 4. Detect Hostnames/URLs
  const urlMatches = scrubbedContent.matchAll(/(https?:\/\/[^\s\n"']+)/g)
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

  // 5. Detect IPv4 — use a local context window for tagging
  const ipMatches = scrubbedContent.matchAll(/\b(\d{1,3}\.\d{1,3}\.\d{1,3}\.\d{1,3})\b/g)
  for (const match of ipMatches) {
    const ip = match[1]
    const start = Math.max(0, (match.index ?? 0) - 80)
    const end = Math.min(scrubbedContent.length, (match.index ?? 0) + ip.length + 80)
    const localContext = scrubbedContent.slice(start, end).toLowerCase()
    const tags: Record<string, string> = { type: 'ipv4' }
    if (/\b(database|db)\b/.test(localContext)) tags.role = 'database'
    if (/\bprod\b/.test(localContext)) tags.env = 'production'
    if (/\bworker\b/.test(localContext)) tags.role = 'worker'
    cappedWrite(dir, 'ip', ip, `Server IP: ${ip}`, tags)
  }

  // 6. Detect backtick symbols
  const backtickMatches = scrubbedContent.matchAll(/`([^`]+)`/g)
  for (const match of backtickMatches) {
    const symbol = match[1]
    if (symbol.length > 2 && symbol.length < 60) {
      cappedWrite(dir, 'concept', symbol, `Technical concept: ${symbol}`, { source: 'backticks' })
    }
  }

  // 7. Detect Technical Concepts (PascalCase, camelCase, hyphenated)
  const technicalMatches = scrubbedContent.matchAll(
    /\b([a-zA-Z0-9]+(?:-[a-zA-Z0-9]+)+|[A-Z][a-z]+[A-Z][\w]*|[a-z]+[A-Z][\w]*)\b/g,
  )
  const seen = new Set<string>()
  for (const match of technicalMatches) {
    const word = match[1]
    if (seen.has(word)) continue
    seen.add(word)
    if (!['The', 'This', 'That', 'With', 'From', 'Here', 'There'].includes(word)) {
      cappedWrite(dir, 'concept', word, `Technical term: ${word}`, { source: 'auto_discovery' })
    }
  }

  // 8. Specific tech detection
  if (scrubbedContent.toLowerCase().includes('redux'))
    cappedWrite(dir, 'tech', 'Redux', 'Redux state management', { category: 'state_management' })
  if (scrubbedContent.toLowerCase().includes('react'))
    cappedWrite(dir, 'tech', 'React', 'React frontend library', { category: 'frontend' })

  // 9. Project File Signatures
  const fileMatches = scrubbedContent.matchAll(/\b([\w.-]+\.(?:xml|json|yaml|yml|gradle|toml|bazel))\b/gi)
  for (const match of fileMatches) {
    cappedWrite(dir, 'file', match[1].toLowerCase(), `Project file: ${match[1]}`, { category: 'configuration' })
  }

}
