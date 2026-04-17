/**
 * Gated note-writer for v2 vaults.
 *
 * Every write goes through this single pipeline:
 *
 *   1. Load conventions (auto-regenerate `_conventions.md` if missing).
 *   2. Validate the draft against the parsed {@link ConventionSchema}.
 *   3. Check filename uniqueness across all note folders.
 *   4. Resolve WikiLinks (body + `related`/`depends_on`/`depended_by`) —
 *      every `[[target]]` must exist on disk, or be listed in
 *      `frontmatter._pendingLinks` (batch escape hatch).
 *   5. Serialize frontmatter via {@link serializeFrontmatter} and prepend to
 *      the body, ensuring the body starts with a `# <title>` heading.
 *   6. Write the file through {@link writeVaultFile}.
 *   7. Count incoming `[[<filename>]]` references; if zero, append an
 *      `orphan-warning` entry to `_log.md` (warning, not a failure).
 *
 * Failures return a structured `{ ok: false, violations }` result and do NOT
 * touch the filesystem — the writer is all-or-nothing.
 */

import {
  existsSync,
  mkdirSync,
  readFileSync,
  readdirSync,
  statSync,
  writeFileSync,
} from 'fs'
import { join } from 'path'
import { serializeFrontmatter } from '../utils/yamlFrontmatter.js'
import {
  CONVENTIONS_MD_DEFAULT,
  type ConventionSchema,
} from './conventions/defaults.js'
import { parseConventions } from './conventions/parser.js'
import {
  validateNote,
  type NoteDraft,
  type Violation,
} from './conventions/validator.js'
import type { VaultConfig } from './types.js'
import { writeVaultFile } from './writer.js'
import type { NeedsInput } from './escapeHatch/contract.js'
import { resolveNeedsInput, type ResolverContext } from './escapeHatch/resolver.js'
import {
  parseWikiLinkTarget,
  type WikiLinkTarget,
} from './wikiLinkParser.js'

export type { NoteDraft, Violation } from './conventions/validator.js'

export type WriteResult =
  | { ok: true; path: string; warnings: string[] }
  | { ok: false; violations: Violation[] }

const NOTE_FOLDERS = [
  'knowledge',
  'maps',
  'decisions',
  'flows',
  'incidents',
  'archive',
] as const

function appendLogEntry(vaultPath: string, kind: string, target = ''): void {
  const ts = new Date().toISOString()
  const middle = target ? `  ${target}` : ''
  const line = `- ${ts}  ${kind}${middle}  source: code-analysis\n`
  const logPath = join(vaultPath, '_log.md')
  if (!existsSync(logPath)) {
    writeFileSync(logPath, `# Vault log\n\n${line}`, 'utf-8')
    return
  }
  const content = readFileSync(logPath, 'utf-8')
  const needsNl = content.length > 0 && !content.endsWith('\n')
  writeFileSync(logPath, content + (needsNl ? '\n' : '') + line, 'utf-8')
}

/**
 * Read `<vaultPath>/_conventions.md` and parse it. If the file is missing,
 * write {@link CONVENTIONS_MD_DEFAULT}, append a `conventions-regenerated`
 * entry to `_log.md`, and then parse.
 */
export function loadConventions(vaultPath: string): ConventionSchema {
  mkdirSync(vaultPath, { recursive: true })
  const conventionsPath = join(vaultPath, '_conventions.md')
  if (!existsSync(conventionsPath)) {
    writeFileSync(conventionsPath, CONVENTIONS_MD_DEFAULT, 'utf-8')
    appendLogEntry(vaultPath, 'conventions-regenerated')
  }
  const md = readFileSync(conventionsPath, 'utf-8')
  return parseConventions(md)
}

/**
 * Recursively collect every `.md` basename (without extension) under `dir`.
 */
function collectNoteBasenames(dir: string): Set<string> {
  const names = new Set<string>()
  if (!existsSync(dir)) return names
  const walk = (d: string): void => {
    let entries: string[]
    try {
      entries = readdirSync(d)
    } catch {
      return
    }
    for (const entry of entries) {
      const p = join(d, entry)
      let s
      try {
        s = statSync(p)
      } catch {
        continue
      }
      if (s.isDirectory()) {
        walk(p)
      } else if (entry.endsWith('.md')) {
        names.add(entry.slice(0, -3))
      }
    }
  }
  walk(dir)
  return names
}

/**
 * Find every `.md` file under the 6 note folders. Returns Set of basenames
 * (without extension). Ignores top-level `_index.md`, `_conventions.md`,
 * `_log.md`, and `meta/`.
 */
function collectAllNoteBasenames(vaultPath: string): Set<string> {
  const names = new Set<string>()
  for (const folder of NOTE_FOLDERS) {
    const folderPath = join(vaultPath, folder)
    for (const n of collectNoteBasenames(folderPath)) {
      if (!n.startsWith('_')) names.add(n)
    }
  }
  return names
}

const WIKILINK_RE = /\[\[([^\]]+)\]\]/g

function extractWikiLinkTargets(text: string): WikiLinkTarget[] {
  const targets: WikiLinkTarget[] = []
  for (const match of text.matchAll(WIKILINK_RE)) {
    const raw = match[1]
    // Strip `|display` alias suffix.
    const pipeIdx = raw.indexOf('|')
    const left = pipeIdx === -1 ? raw : raw.slice(0, pipeIdx)
    // PIFE-01: parse global:/project: namespace prefix → typed target.
    targets.push(parseWikiLinkTarget(left))
  }
  return targets
}

/**
 * Validate one resolved WikiLink target against the cross-vault rules
 * (PIFE-03/04). Decision matrix by `(scope, target.vault)`:
 *
 *   project → global   SKIP — local validator can't see global vault.
 *                      The link is the dev's read-time promise.
 *   global  → project  REJECT (type-scope-mismatch). Global notes must
 *                      not depend on project-scoped knowledge.
 *   project → project  Treat as local (redundant explicit prefix).
 *   global  → global   Treat as local (writing to global vault, slug
 *                      resolves there).
 *   * → local          Resolve `target.slug` against the in-vault
 *                      `resolvableTargets` set (existing behavior).
 */
function checkLink(
  target: WikiLinkTarget,
  field: string,
  scope: 'project' | 'global',
  resolvableTargets: Set<string>,
  linkViolations: Violation[],
): void {
  // Cross-vault project link (skip): local note → global vault.
  if (scope === 'project' && target.vault === 'global') return

  // Cross-vault project link (reject): global note → project vault.
  if (scope === 'global' && target.vault === 'project') {
    linkViolations.push({
      field,
      expected: 'global or local link (no project: prefix in global notes)',
      got: `project:${target.slug}`,
      rule: 'type-scope-mismatch',
    })
    return
  }

  // Otherwise: target.vault is 'local', or it's a redundant explicit
  // same-vault prefix. Resolve the bare slug against the existing
  // in-vault basenames (existing behavior).
  if (!resolvableTargets.has(target.slug)) {
    linkViolations.push({
      field,
      expected: 'existing note',
      got: target.slug,
      rule: 'hallucinated-link',
    })
  }
}

function extractLinksFromFrontmatterField(value: unknown): WikiLinkTarget[] {
  if (!Array.isArray(value)) return []
  const out: WikiLinkTarget[] = []
  for (const item of value) {
    if (typeof item !== 'string') continue
    // Accept either `[[target]]` or bare `target`.
    const wikiTargets = extractWikiLinkTargets(item)
    if (wikiTargets.length > 0) {
      out.push(...wikiTargets)
    } else {
      // Bare `target` (no fences) — parse as a literal slug. Same prefix
      // rules apply.
      out.push(parseWikiLinkTarget(item))
    }
  }
  return out
}

/**
 * Count how many `.md` files under the 6 note folders (excluding
 * `<selfFilename>.md`) contain `[[<selfFilename>]]`.
 */
function countIncomingLinks(vaultPath: string, selfFilename: string): number {
  const needle = `[[${selfFilename}]]`
  let count = 0
  const walk = (d: string): void => {
    let entries: string[]
    try {
      entries = readdirSync(d)
    } catch {
      return
    }
    for (const entry of entries) {
      const p = join(d, entry)
      let s
      try {
        s = statSync(p)
      } catch {
        continue
      }
      if (s.isDirectory()) {
        walk(p)
      } else if (entry.endsWith('.md') && entry !== `${selfFilename}.md`) {
        try {
          const content = readFileSync(p, 'utf-8')
          if (content.includes(needle)) count++
        } catch {
          /* ignore unreadable files */
        }
      }
    }
  }
  for (const folder of NOTE_FOLDERS) {
    walk(join(vaultPath, folder))
  }
  return count
}

export interface WriteNoteOptions {
  /**
   * PIFC-07: when set + `draft.scope === 'global'` + `confirmedGlobal !== true`,
   * the writer asks the dev (via the resolver) before committing the global
   * write. The resolver decides between prompt / auto-accept / abort.
   */
  escapeHatch?: ResolverContext
  /**
   * Skip the escape-hatch prompt for THIS write. Lets bulk callers
   * (e.g. mapper preset, bridgeai map) bulk-confirm once at the start
   * instead of per-note.
   */
  confirmedGlobal?: boolean
}

/**
 * Write a note draft to the vault, enforcing every convention and write-time
 * rule. Returns either a success descriptor or a structured list of
 * violations. On failure, the filesystem is NOT mutated.
 *
 * PIFA-02..04: dispatches by `draft.frontmatter.scope` to the local or
 * global vault. Missing scope defaults to `'project'`. `'global'` with
 * `cfg.global == null` returns a structured violation without mutating
 * disk.
 *
 * PIFC-07: when called with `opts.escapeHatch` + `scope === 'global'` AND
 * `opts.confirmedGlobal !== true`, the writer asks the dev for confirmation
 * before mutating the global vault. The dev's decision is recorded in the
 * global vault's `_log.md`.
 */
export async function writeNote(
  cfg: VaultConfig,
  draft: NoteDraft,
  opts: WriteNoteOptions = {},
): Promise<WriteResult> {
  // 0. Default scope to 'project' when absent. Persists into the
  //    serialized frontmatter so reads round-trip with the value.
  if (draft.frontmatter.scope === undefined || draft.frontmatter.scope === null) {
    draft.frontmatter.scope = 'project'
  }
  const scope = draft.frontmatter.scope

  // 0a. Dispatch by scope to the right vault.
  let vaultPath: string
  if (scope === 'global') {
    if (!cfg.global) {
      return {
        ok: false,
        violations: [
          {
            field: 'scope',
            expected: 'configured global vault',
            got: null,
            rule: 'no-global-vault-configured',
          },
        ],
      }
    }
    vaultPath = cfg.global.path
  } else {
    vaultPath = cfg.local.path
  }

  // 1. Load (or regenerate) conventions for the target vault.
  const schema = loadConventions(vaultPath)

  // 2. Structural validation.
  const validation = validateNote(schema, draft)
  if (!validation.ok) {
    return { ok: false, violations: validation.violations }
  }

  // 3. Filename uniqueness across the 6 note folders.
  const existingBasenames = collectAllNoteBasenames(vaultPath)
  if (existingBasenames.has(draft.filename)) {
    return {
      ok: false,
      violations: [
        {
          field: 'filename',
          expected: 'unique',
          got: draft.filename,
          rule: 'duplicate',
        },
      ],
    }
  }

  // 4. WikiLink resolution.
  const pendingLinksRaw = draft.frontmatter._pendingLinks
  const pendingLinks =
    Array.isArray(pendingLinksRaw) &&
    pendingLinksRaw.every((v) => typeof v === 'string')
      ? new Set(pendingLinksRaw as string[])
      : new Set<string>()

  const resolvableTargets = new Set<string>([
    ...existingBasenames,
    ...pendingLinks,
    // The note being written is also considered to exist (for self-links).
    draft.filename,
  ])

  const linkViolations: Violation[] = []
  // Narrow scope to the validated NoteScope union for the link check.
  // Garbage values were already caught by validateNote (T4 invalid-value
  // rule); treat anything that isn't 'global' as 'project' here.
  const effectiveScope: 'project' | 'global' = scope === 'global' ? 'global' : 'project'

  // Body links.
  for (const target of extractWikiLinkTargets(draft.body)) {
    checkLink(target, 'body', effectiveScope, resolvableTargets, linkViolations)
  }

  // Frontmatter link-bearing fields.
  const LINK_FIELDS = ['related', 'depends_on', 'depended_by'] as const
  for (const field of LINK_FIELDS) {
    const targets = extractLinksFromFrontmatterField(draft.frontmatter[field])
    for (const target of targets) {
      checkLink(target, field, effectiveScope, resolvableTargets, linkViolations)
    }
  }

  if (linkViolations.length > 0) {
    return { ok: false, violations: linkViolations }
  }

  // 4a. PIFC-07: escape-hatch confirmation for `scope: 'global'` writes.
  // Only fires when the caller opted in via `opts.escapeHatch` AND has not
  // already confirmed via `confirmedGlobal: true`. Default suggested answer
  // is 'no' (NOT 'yes') because a wrong global write contaminates every
  // future project — auto-confirm should default to NOT writing.
  if (
    scope === 'global' &&
    cfg.global &&
    opts.escapeHatch &&
    opts.confirmedGlobal !== true
  ) {
    const needs: NeedsInput = {
      status: 'needs-input',
      kind: 'global-write-confirm',
      question: `Write note "${draft.filename}" to the global vault? It will be visible in every project.`,
      suggestedAnswers: ['no', 'yes'],
      affectedVault: 'global',
      context: { filename: draft.filename, folder: draft.folder },
    }
    const resolution = await resolveNeedsInput(needs, opts.escapeHatch)
    const accepted = resolution.resolved && resolution.answer === 'yes'
    if (!accepted) {
      return {
        ok: false,
        violations: [
          {
            field: 'scope',
            expected: 'dev confirmation',
            got: 'global',
            rule: 'aborted-by-dev',
          },
        ],
      }
    }
  }

  // 5. Serialize — strip `_pendingLinks` before emitting.
  const fmForSerialize: Record<string, unknown> = { ...draft.frontmatter }
  delete fmForSerialize._pendingLinks

  const frontmatterBlock = serializeFrontmatter(fmForSerialize)

  const title = String(draft.frontmatter.title ?? draft.filename)
  const titleHeading = `# ${title}`
  const bodyText = draft.body.trimStart()
  const bodyHasHeading =
    bodyText.startsWith('# ') || bodyText.startsWith(`${titleHeading}`)
  const body = bodyHasHeading ? draft.body : `${titleHeading}\n\n${draft.body}`

  const content = `${frontmatterBlock}${body}`

  // 6. Write.
  const relPath = `${draft.folder}/${draft.filename}.md`
  writeVaultFile(vaultPath, relPath, content)

  // 7. Orphan check (warning only).
  const warnings: string[] = []
  const incoming = countIncomingLinks(vaultPath, draft.filename)
  if (incoming === 0) {
    appendLogEntry(vaultPath, 'orphan-warning', relPath)
    warnings.push(`orphan: ${relPath} has no incoming links`)
  }

  return { ok: true, path: relPath, warnings }
}
