/**
 * Vault linter.
 *
 * Walks every note under the 6 canonical note folders and reports issues:
 *
 *   - `orphan`             — no incoming WikiLinks from any other note
 *   - `hallucinated-link`  — a `[[target]]` that doesn't resolve on disk
 *   - `frontmatter`        — convention violations (non-tag rules)
 *   - `stale`              — `last_verified` older than referenced source file mtime
 *   - `missing-index`      — one of the 6 folders is missing `_index.md`
 *   - `tag`                — convention violations with `tag-*` rules
 *   - `duplicate`          — two notes share a case-insensitive basename
 *
 * When `opts.fix === true`, safe autofixes run:
 *   - Missing `_index.md` files are regenerated with a minimal header.
 *   - Frontmatter-order-only violations are rewritten via the canonical
 *     {@link serializeFrontmatter}.
 *
 * Fixed files are listed in `result.fixed`. After fixes, affected files are
 * re-parsed and the now-resolved issues are removed from `result.issues`.
 *
 * The returned {@link LintResult} is JSON-serializable (the CLI wraps this
 * in T11 to implement `--json`).
 */

import {
  existsSync,
  readFileSync,
  readdirSync,
  statSync,
  writeFileSync,
} from 'fs'
import { join, relative } from 'path'
import { parseFrontmatter } from '../utils/frontmatterParser.js'
import { serializeFrontmatter } from '../utils/yamlFrontmatter.js'
import { loadConventions } from './writeNote.js'
import {
  validateNote,
  type NoteDraft,
  type Violation,
} from './conventions/validator.js'
import type { VaultConfig } from './types.js'
import { parseWikiLinkTarget } from './wikiLinkParser.js'

export type LintIssueKind =
  | 'orphan'
  | 'hallucinated-link'
  | 'frontmatter'
  | 'stale'
  | 'missing-index'
  | 'tag'
  | 'duplicate'

export interface LintIssue {
  kind: LintIssueKind
  /** Path relative to `cfg.vaultPath` (POSIX separators). */
  file: string
  detail: string
  autofixable: boolean
}

export interface LintResult {
  issues: LintIssue[]
  fixed: string[]
  exitCode: number
}

export interface LintOptions {
  fix?: boolean
  format?: 'text' | 'json'
}

const NOTE_FOLDERS = [
  'knowledge',
  'maps',
  'decisions',
  'flows',
  'incidents',
  'archive',
] as const

const META_FILENAMES = new Set(['_index.md', '_log.md', '_conventions.md'])
const WIKILINK_RE = /\[\[([^\]]+)\]\]/g
const LINK_FRONTMATTER_FIELDS = ['related', 'depends_on', 'depended_by'] as const

type NoteEntry = {
  /** Absolute filesystem path. */
  abs: string
  /** Path relative to vaultPath, forward-slashed. */
  rel: string
  /** Folder name (one of NOTE_FOLDERS). */
  folder: string
  /** Basename without `.md`. */
  basename: string
  /** Full raw file content. */
  raw: string
  /** Parsed frontmatter. */
  frontmatter: Record<string, unknown>
  /** Markdown body after frontmatter fence. */
  body: string
}

function toPosix(p: string): string {
  return p.split('\\').join('/')
}

/** Walk a single note folder, collecting `.md` files (excluding meta files). */
function walkFolder(vaultPath: string, folder: string): NoteEntry[] {
  const out: NoteEntry[] = []
  const folderAbs = join(vaultPath, folder)
  if (!existsSync(folderAbs)) return out

  const walk = (dir: string): void => {
    let entries: string[]
    try {
      entries = readdirSync(dir)
    } catch {
      return
    }
    for (const entry of entries) {
      const abs = join(dir, entry)
      let s
      try {
        s = statSync(abs)
      } catch {
        continue
      }
      if (s.isDirectory()) {
        // Skip nested meta/ directories.
        if (entry === 'meta') continue
        walk(abs)
        continue
      }
      if (!entry.endsWith('.md')) continue
      if (META_FILENAMES.has(entry)) continue

      let raw = ''
      try {
        raw = readFileSync(abs, 'utf-8')
      } catch {
        continue
      }
      const parsed = parseFrontmatter(raw)
      const rel = toPosix(relative(vaultPath, abs))
      out.push({
        abs,
        rel,
        folder,
        basename: entry.slice(0, -3),
        raw,
        frontmatter: parsed.frontmatter as Record<string, unknown>,
        body: parsed.content,
      })
    }
  }
  walk(folderAbs)
  return out
}

/** Collect all notes in the vault. */
function collectAllNotes(vaultPath: string): NoteEntry[] {
  const all: NoteEntry[] = []
  for (const folder of NOTE_FOLDERS) {
    all.push(...walkFolder(vaultPath, folder))
  }
  return all
}

/**
 * PIFE: lint extracts only LOCAL link targets — namespaced links
 * (`[[global:slug]]`, `[[project:slug]]`) are skipped here because lint
 * operates on a single vault at a time and cannot resolve cross-vault
 * targets. writeNote handles cross-vault link rules at write time.
 */
function extractWikiLinkTargets(text: string): string[] {
  const targets: string[] = []
  for (const match of text.matchAll(WIKILINK_RE)) {
    const raw = match[1]
    const pipeIdx = raw.indexOf('|')
    const left = pipeIdx === -1 ? raw : raw.slice(0, pipeIdx)
    const parsed = parseWikiLinkTarget(left)
    // Cross-vault links are not lint-able from a single vault perspective.
    if (parsed.vault !== 'local') continue
    targets.push(parsed.slug)
  }
  return targets
}

function extractLinksFromFrontmatterField(value: unknown): string[] {
  if (!Array.isArray(value)) return []
  const out: string[] = []
  for (const item of value) {
    if (typeof item !== 'string') continue
    const wiki = extractWikiLinkTargets(item)
    if (wiki.length > 0) {
      out.push(...wiki)
    } else {
      const parsed = parseWikiLinkTarget(item)
      if (parsed.vault !== 'local') continue
      out.push(parsed.slug)
    }
  }
  return out
}

/** Build a NoteDraft-shaped object for the validator. */
function noteEntryToDraft(entry: NoteEntry): NoteDraft {
  return {
    filename: entry.basename,
    folder: entry.folder,
    frontmatter: entry.frontmatter,
    body: entry.body,
  }
}

function classifyViolation(v: Violation): LintIssueKind {
  return v.rule.startsWith('tag-') ? 'tag' : 'frontmatter'
}

function violationDetail(v: Violation): string {
  return `[${v.rule}] ${v.field}: expected ${v.expected}, got ${JSON.stringify(v.got)}`
}

/**
 * Detect whether a violation is "reorder-only" — i.e. would go away if we
 * rewrote the frontmatter with the canonical field order. For now we treat
 * no violations as reorder-only (all reported frontmatter issues are real),
 * since the canonical serializer never affects the set of fields or their
 * values. This is a placeholder hook for future structural-only rules.
 */
function isReorderOnly(_v: Violation): boolean {
  return false
}

function subfolderIndexContent(name: string): string {
  return `# ${name}\n\n> _No notes yet._\n`
}

/**
 * Lint the vault.
 */
export async function lintVault(
  cfg: VaultConfig,
  opts: LintOptions = {},
): Promise<LintResult> {
  const vaultPath = cfg.vaultPath
  const issues: LintIssue[] = []
  const fixed: string[] = []

  // 1. Load conventions (regenerates _conventions.md if missing).
  const schema = loadConventions(vaultPath)

  // 2. Collect every note.
  const notes = collectAllNotes(vaultPath)

  // Lookup sets.
  const basenameSet = new Set<string>()
  for (const n of notes) basenameSet.add(n.basename)

  // 3. Missing _index.md per folder.
  for (const folder of NOTE_FOLDERS) {
    const idx = join(vaultPath, folder, '_index.md')
    if (!existsSync(idx)) {
      issues.push({
        kind: 'missing-index',
        file: `${folder}/_index.md`,
        detail: `folder \`${folder}\` is missing its \`_index.md\``,
        autofixable: true,
      })
    }
  }

  // 4. Duplicate filenames across folders (case-insensitive).
  const byLowerName = new Map<string, NoteEntry[]>()
  for (const n of notes) {
    const key = n.basename.toLowerCase()
    const list = byLowerName.get(key)
    if (list) list.push(n)
    else byLowerName.set(key, [n])
  }
  for (const [name, group] of byLowerName) {
    if (group.length < 2) continue
    // Report one issue per duplicate occurrence beyond the first, pointing at each dup.
    for (const entry of group) {
      issues.push({
        kind: 'duplicate',
        file: entry.rel,
        detail: `duplicate basename \`${name}\` appears in: ${group.map((g) => g.rel).join(', ')}`,
        autofixable: false,
      })
    }
  }

  // 5. For each note: validator + hallucinated links + stale check.
  // First, build the incoming-link map for orphan detection.
  const incoming = new Map<string, number>()
  for (const n of notes) incoming.set(n.basename, 0)

  for (const src of notes) {
    const targets = new Set<string>()
    for (const t of extractWikiLinkTargets(src.body)) targets.add(t)
    for (const field of LINK_FRONTMATTER_FIELDS) {
      for (const t of extractLinksFromFrontmatterField(src.frontmatter[field])) {
        targets.add(t)
      }
    }
    for (const t of targets) {
      if (t === src.basename) continue // self-links don't count as incoming
      if (incoming.has(t)) {
        incoming.set(t, (incoming.get(t) ?? 0) + 1)
      }
    }
  }

  for (const note of notes) {
    // Validator → frontmatter + tag issues.
    const vres = validateNote(schema, noteEntryToDraft(note))
    for (const v of vres.violations) {
      issues.push({
        kind: classifyViolation(v),
        file: note.rel,
        detail: violationDetail(v),
        autofixable: isReorderOnly(v),
      })
    }

    // Hallucinated links.
    const linkTargets = new Set<string>()
    for (const t of extractWikiLinkTargets(note.body)) linkTargets.add(t)
    for (const field of LINK_FRONTMATTER_FIELDS) {
      for (const t of extractLinksFromFrontmatterField(note.frontmatter[field])) {
        linkTargets.add(t)
      }
    }
    for (const t of linkTargets) {
      if (t === note.basename) continue
      if (!basenameSet.has(t)) {
        issues.push({
          kind: 'hallucinated-link',
          file: note.rel,
          detail: `unresolved WikiLink target \`${t}\``,
          autofixable: false,
        })
      }
    }

    // Orphan: zero incoming links.
    if ((incoming.get(note.basename) ?? 0) === 0) {
      issues.push({
        kind: 'orphan',
        file: note.rel,
        detail: `no incoming WikiLinks reference \`${note.basename}\``,
        autofixable: false,
      })
    }

    // Stale: compare last_verified vs source_path mtime.
    const srcPath = note.frontmatter.source_path
    const lastVerified = note.frontmatter.last_verified
    if (
      typeof srcPath === 'string' &&
      srcPath.trim() !== '' &&
      lastVerified != null
    ) {
      const srcAbs = join(cfg.projectRoot, srcPath)
      if (existsSync(srcAbs)) {
        let srcMtime: Date | null = null
        try {
          srcMtime = statSync(srcAbs).mtime
        } catch {
          srcMtime = null
        }
        const verifiedDate = new Date(String(lastVerified))
        if (
          srcMtime &&
          !Number.isNaN(verifiedDate.getTime()) &&
          verifiedDate.getTime() < srcMtime.getTime()
        ) {
          issues.push({
            kind: 'stale',
            file: note.rel,
            detail: `last_verified (${String(lastVerified)}) is older than source mtime (${srcMtime.toISOString()})`,
            autofixable: false,
          })
        }
      }
    }
  }

  // 6. Autofixes.
  if (opts.fix === true) {
    const resolvedIssueIds = new Set<number>()

    issues.forEach((issue, idx) => {
      if (!issue.autofixable) return

      if (issue.kind === 'missing-index') {
        const [folder] = issue.file.split('/')
        const dest = join(vaultPath, folder, '_index.md')
        try {
          writeFileSync(dest, subfolderIndexContent(folder), 'utf-8')
          if (!fixed.includes(issue.file)) fixed.push(issue.file)
          resolvedIssueIds.add(idx)
        } catch {
          /* leave issue as-is */
        }
        return
      }

      if (issue.kind === 'frontmatter') {
        // Reorder-only path (reserved; currently no violations qualify).
        const abs = join(vaultPath, issue.file)
        try {
          const raw = readFileSync(abs, 'utf-8')
          const parsed = parseFrontmatter(raw)
          const rewritten = `${serializeFrontmatter(
            parsed.frontmatter as Record<string, unknown>,
          )}${parsed.content}`
          if (rewritten !== raw) {
            writeFileSync(abs, rewritten, 'utf-8')
            if (!fixed.includes(issue.file)) fixed.push(issue.file)
            resolvedIssueIds.add(idx)
          }
        } catch {
          /* leave issue as-is */
        }
        return
      }
    })

    // Strip resolved issues.
    if (resolvedIssueIds.size > 0) {
      for (let i = issues.length - 1; i >= 0; i--) {
        if (resolvedIssueIds.has(i)) issues.splice(i, 1)
      }
    }
  }

  return {
    issues,
    fixed,
    exitCode: issues.length === 0 ? 0 : 1,
  }
}
