import { existsSync, readFileSync, writeFileSync, mkdirSync } from 'fs'
import { join, dirname } from 'path'

export type VaultState = {
  lastUpdated: string
  currentWork: string
  decisions: Array<{
    date: string
    title: string
    context: string
    tradeoffs: string
  }>
  blockers: Array<{ id: string; description: string; date: string }>
  lessons: Array<{
    date: string
    context: string
    problem: string
    solution: string
  }>
  todos: Array<{ done: boolean; text: string }>
  deferredIdeas: Array<{ text: string }>
}

const STATE_FILE = 'STATE.md'

function statePath(vaultPath: string): string {
  return join(vaultPath, STATE_FILE)
}

function now(): string {
  return new Date().toISOString()
}

function emptyTemplate(timestamp: string): string {
  return `# Project State

**Last Updated:** ${timestamp}
**Current Work:** None

---

## Recent Decisions

---

## Active Blockers

---

## Lessons Learned

---

## Todos

---

## Deferred Ideas
`
}

/**
 * Create STATE.md with empty sections.
 */
export function initializeState(vaultPath: string): void {
  mkdirSync(vaultPath, { recursive: true })
  const fp = statePath(vaultPath)
  writeFileSync(fp, emptyTemplate(now()), 'utf-8')
}

/**
 * Return raw STATE.md content as string. Return null if not found.
 */
export function readStateRaw(vaultPath: string): string | null {
  const fp = statePath(vaultPath)
  if (!existsSync(fp)) {
    return null
  }
  return readFileSync(fp, 'utf-8')
}

/**
 * Parse STATE.md into structured object. Return null if file doesn't exist.
 */
export function readState(vaultPath: string): VaultState | null {
  const raw = readStateRaw(vaultPath)
  if (raw === null) {
    return null
  }

  const lastUpdatedMatch = raw.match(/\*\*Last Updated:\*\*\s*(.+)/)
  const currentWorkMatch = raw.match(/\*\*Current Work:\*\*\s*(.+)/)

  const lastUpdated = lastUpdatedMatch ? lastUpdatedMatch[1].trim() : ''
  const currentWork = currentWorkMatch ? currentWorkMatch[1].trim() : 'None'

  const sections = splitSections(raw)

  return {
    lastUpdated,
    currentWork,
    decisions: parseDecisions(sections['Recent Decisions'] ?? ''),
    blockers: parseBlockers(sections['Active Blockers'] ?? ''),
    lessons: parseLessons(sections['Lessons Learned'] ?? ''),
    todos: parseTodos(sections['Todos'] ?? ''),
    deferredIdeas: parseDeferredIdeas(sections['Deferred Ideas'] ?? ''),
  }
}

/**
 * Split raw content into sections keyed by header name.
 */
function splitSections(raw: string): Record<string, string> {
  const result: Record<string, string> = {}
  const parts = raw.split(/^## /m)
  for (const part of parts) {
    if (!part.trim()) continue
    const newlineIdx = part.indexOf('\n')
    if (newlineIdx === -1) {
      const header = part.trim()
      result[header] = ''
      continue
    }
    const header = part.slice(0, newlineIdx).trim()
    const body = part.slice(newlineIdx + 1)
    // Strip trailing --- separator
    result[header] = body.replace(/\n---\s*$/, '').trim()
  }
  return result
}

function parseDecisions(
  section: string,
): VaultState['decisions'] {
  if (!section.trim()) return []
  const entries: VaultState['decisions'] = []
  const blocks = section.split(/^### /m).filter((b) => b.trim())
  for (const block of blocks) {
    const lines = block.split('\n')
    const titleLine = lines[0]?.trim() ?? ''
    const dateMatch = block.match(/\*\*Date:\*\*\s*(.+)/)
    const contextMatch = block.match(/\*\*Context:\*\*\s*(.+)/)
    const tradeoffsMatch = block.match(/\*\*Trade-offs:\*\*\s*(.+)/)
    entries.push({
      title: titleLine,
      date: dateMatch ? dateMatch[1].trim() : '',
      context: contextMatch ? contextMatch[1].trim() : '',
      tradeoffs: tradeoffsMatch ? tradeoffsMatch[1].trim() : '',
    })
  }
  return entries
}

function parseBlockers(section: string): VaultState['blockers'] {
  if (!section.trim()) return []
  const entries: VaultState['blockers'] = []
  const lines = section.split('\n')
  for (const line of lines) {
    const match = line.match(
      /^- \*\*\[(.+?)\]\*\*:\s*(.+?)(?:\s*\((\d{4}-\d{2}-\d{2})\))?$/,
    )
    if (match) {
      entries.push({
        id: match[1],
        description: match[2].trim(),
        date: match[3] ?? '',
      })
    }
  }
  return entries
}

function parseLessons(section: string): VaultState['lessons'] {
  if (!section.trim()) return []
  const entries: VaultState['lessons'] = []
  const blocks = section.split(/^### /m).filter((b) => b.trim())
  for (const block of blocks) {
    const dateMatch = block.match(/\*\*Date:\*\*\s*(.+)/)
    const contextMatch = block.match(/\*\*Context:\*\*\s*(.+)/)
    const problemMatch = block.match(/\*\*Problem:\*\*\s*(.+)/)
    const solutionMatch = block.match(/\*\*Solution:\*\*\s*(.+)/)
    entries.push({
      date: dateMatch ? dateMatch[1].trim() : '',
      context: contextMatch ? contextMatch[1].trim() : '',
      problem: problemMatch ? problemMatch[1].trim() : '',
      solution: solutionMatch ? solutionMatch[1].trim() : '',
    })
  }
  return entries
}

function parseTodos(section: string): VaultState['todos'] {
  if (!section.trim()) return []
  const entries: VaultState['todos'] = []
  const lines = section.split('\n')
  for (const line of lines) {
    const match = line.match(/^- \[([ x])\] (.+)$/)
    if (match) {
      entries.push({ done: match[1] === 'x', text: match[2].trim() })
    }
  }
  return entries
}

function parseDeferredIdeas(section: string): VaultState['deferredIdeas'] {
  if (!section.trim()) return []
  const entries: VaultState['deferredIdeas'] = []
  const lines = section.split('\n')
  for (const line of lines) {
    const match = line.match(/^- \[ \] (.+)$/)
    if (match) {
      entries.push({ text: match[1].trim() })
    }
  }
  return entries
}

// --- Mutation helpers ---

/**
 * Read STATE.md, apply a transform, write it back with updated timestamp.
 */
function mutateState(
  vaultPath: string,
  transform: (content: string) => string,
): void {
  const fp = statePath(vaultPath)
  let content = readFileSync(fp, 'utf-8')
  content = content.replace(
    /\*\*Last Updated:\*\*\s*.+/,
    `**Last Updated:** ${now()}`,
  )
  content = transform(content)
  writeFileSync(fp, content, 'utf-8')
}

/**
 * Insert content at the end of a named section (before the next --- separator or ## header).
 */
function appendToSection(
  content: string,
  sectionName: string,
  entry: string,
): string {
  const sectionHeader = `## ${sectionName}`
  const headerIdx = content.indexOf(sectionHeader)
  if (headerIdx === -1) return content

  const afterHeader = headerIdx + sectionHeader.length
  // Find the next section boundary: a line starting with ---
  // that precedes a ## header, or end of file
  const rest = content.slice(afterHeader)

  // Find next "---" that's followed by a "## " header
  const nextSectionMatch = rest.match(/\n---\n+## /)
  if (nextSectionMatch && nextSectionMatch.index !== undefined) {
    const insertPoint = afterHeader + nextSectionMatch.index
    const before = content.slice(0, insertPoint)
    const after = content.slice(insertPoint)
    return before.trimEnd() + '\n\n' + entry + '\n' + after
  }

  // Last section — append before trailing newline
  const trimmed = content.trimEnd()
  return trimmed + '\n\n' + entry + '\n'
}

/**
 * Replace the Current Work line and update Last Updated timestamp.
 */
export function updateCurrentWork(vaultPath: string, work: string): void {
  mutateState(vaultPath, (content) =>
    content.replace(
      /\*\*Current Work:\*\*\s*.+/,
      `**Current Work:** ${work}`,
    ),
  )
}

/**
 * Set Current Work to "None" and update timestamp.
 */
export function clearCurrentWork(vaultPath: string): void {
  updateCurrentWork(vaultPath, 'None')
}

/**
 * Append a decision entry under ## Recent Decisions with current date.
 */
export function appendDecision(
  vaultPath: string,
  decision: { title: string; context: string; tradeoffs: string },
): void {
  const date = now().slice(0, 10)
  const entry = [
    `### ${decision.title}`,
    `**Date:** ${date}`,
    `**Context:** ${decision.context}`,
    `**Trade-offs:** ${decision.tradeoffs}`,
  ].join('\n')

  mutateState(vaultPath, (content) =>
    appendToSection(content, 'Recent Decisions', entry),
  )
}

/**
 * Append a blocker entry under ## Active Blockers.
 */
export function appendBlocker(
  vaultPath: string,
  blocker: { id: string; description: string },
): void {
  const date = now().slice(0, 10)
  const entry = `- **[${blocker.id}]**: ${blocker.description} (${date})`

  mutateState(vaultPath, (content) =>
    appendToSection(content, 'Active Blockers', entry),
  )
}

/**
 * Remove a blocker by ID from ## Active Blockers.
 */
export function removeBlocker(vaultPath: string, id: string): void {
  const escapedId = id.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
  const pattern = new RegExp(
    `\\n?- \\*\\*\\[${escapedId}\\]\\*\\*:.+`,
    'g',
  )

  mutateState(vaultPath, (content) => content.replace(pattern, ''))
}

/**
 * Append a lesson entry under ## Lessons Learned with current date.
 */
export function appendLesson(
  vaultPath: string,
  lesson: { context: string; problem: string; solution: string },
): void {
  const date = now().slice(0, 10)
  const entry = [
    `### Lesson`,
    `**Date:** ${date}`,
    `**Context:** ${lesson.context}`,
    `**Problem:** ${lesson.problem}`,
    `**Solution:** ${lesson.solution}`,
  ].join('\n')

  mutateState(vaultPath, (content) =>
    appendToSection(content, 'Lessons Learned', entry),
  )
}

/**
 * Append a todo item under ## Todos.
 */
export function appendTodo(vaultPath: string, todo: string): void {
  const entry = `- [ ] ${todo}`

  mutateState(vaultPath, (content) =>
    appendToSection(content, 'Todos', entry),
  )
}

/**
 * Append a deferred idea under ## Deferred Ideas.
 */
export function appendDeferredIdea(vaultPath: string, idea: string): void {
  const entry = `- [ ] ${idea}`

  mutateState(vaultPath, (content) =>
    appendToSection(content, 'Deferred Ideas', entry),
  )
}
