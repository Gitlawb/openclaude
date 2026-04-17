/**
 * v1 → v2 vault upgrade transformer.
 *
 * Given a v1-shaped vault (`manifest.json` + flat `<name>.md` docs at the vault
 * root), materialize the v2 tree via {@link bootstrapVault}, move every
 * manifest-listed doc into `knowledge/` under a canonical kebab-cased filename
 * with a `concept-` prefix (default type on upgrade), and backfill required
 * frontmatter fields so the result passes {@link validateNote}. Regenerate
 * `_index.md` from the manifest and append a `vault-upgraded` entry to
 * `_log.md`.
 *
 * Non-destructive: `manifest.json` is preserved; v2 bootstrap only creates
 * missing files; original flat docs are removed only after a successful write
 * of their migrated counterpart.
 *
 * NOTE (SPEC_DEVIATION): The v1 `VaultManifest` type has
 * `docs: string[]` — plain filenames, with no per-entry `source_path`. The
 * {@link inferNoteType} helper therefore accepts an opaque `doc` record where
 * callers can pass whatever metadata they have (e.g. a `source_path` string);
 * real v1 manifests will never carry that field, so `inferNoteType` always
 * returns `'concept'` for them. The helper's module-classification branch
 * exists so future callers with richer metadata can still benefit.
 */

import {
  existsSync,
  mkdirSync,
  readdirSync,
  readFileSync,
  statSync,
  unlinkSync,
  writeFileSync,
} from 'fs'
import { isAbsolute, join, resolve } from 'path'
import { parseFrontmatter } from '../utils/frontmatterParser.js'
import type { NoteType } from './conventions/defaults.js'
import type { Violation } from './conventions/validator.js'
import { loadVaultManifest } from './config.js'
import { bootstrapVault, detectVaultShape, type VaultShape } from './scaffold.js'
import type { VaultConfig } from './types.js'
import { writeNote } from './writeNote.js'

export type UpgradeResult = {
  ok: boolean
  shape: VaultShape
  message: string
  notesMoved: number
  failures?: Violation[]
}

/**
 * Classify whether a v1 doc should become a `module`-type note (source code
 * analogue) or a free-form `concept` note.
 *
 * Returns `'module'` iff `doc.source_path` is set and resolves to an existing
 * path under `projectRoot`. All other cases (no hint, bogus path, non-string
 * value) → `'concept'`.
 */
export function inferNoteType(
  _docPath: string,
  doc: Record<string, unknown>,
  projectRoot: string,
): NoteType {
  const raw = doc?.source_path
  if (typeof raw !== 'string' || raw.trim().length === 0) {
    return 'concept'
  }
  const abs = isAbsolute(raw) ? raw : resolve(projectRoot, raw)
  // Guard: must stay inside projectRoot (cheap prefix check).
  const rootResolved = resolve(projectRoot)
  if (!abs.startsWith(rootResolved)) return 'concept'
  try {
    if (existsSync(abs) && statSync(abs).isFile()) return 'module'
  } catch {
    /* fall through */
  }
  return 'concept'
}

/* ---------- helpers ---------- */

function stripExt(name: string): string {
  return name.endsWith('.md') ? name.slice(0, -3) : name
}

/** Convert an arbitrary filename stem to kebab-case (lowercase, a-z0-9-). */
function toKebab(stem: string): string {
  return stem
    .replace(/\.[a-zA-Z0-9]+$/, '') // strip extension
    .replace(/[_\s]+/g, '-')
    .replace(/([a-z0-9])([A-Z])/g, '$1-$2')
    .toLowerCase()
    .replace(/[^a-z0-9-]+/g, '-')
    .replace(/-+/g, '-')
    .replace(/^-|-$/g, '')
}

/** Convert a kebab slug to Title Case ("my-note" → "My Note"). */
function kebabToTitle(slug: string): string {
  return slug
    .split('-')
    .filter((s) => s.length > 0)
    .map((s) => s[0].toUpperCase() + s.slice(1))
    .join(' ')
}

function isoDate(d: Date = new Date()): string {
  return d.toISOString().slice(0, 10)
}

function firstNonEmptyLine(body: string, max = 120): string {
  for (const raw of body.split('\n')) {
    const line = raw.replace(/^#+\s*/, '').trim()
    if (line.length === 0) continue
    return line.length > max ? `${line.slice(0, max - 1)}…` : line
  }
  return ''
}

function appendLogEntry(vaultPath: string, line: string): void {
  const logPath = join(vaultPath, '_log.md')
  if (!existsSync(logPath)) {
    writeFileSync(logPath, `# Vault log\n\n${line}\n`, 'utf-8')
    return
  }
  const content = readFileSync(logPath, 'utf-8')
  const needsNl = content.length > 0 && !content.endsWith('\n')
  writeFileSync(logPath, content + (needsNl ? '\n' : '') + line + '\n', 'utf-8')
}

/* ---------- main ---------- */

export async function upgradeVault(cfg: VaultConfig): Promise<UpgradeResult> {
  const shape = detectVaultShape(cfg.vaultPath)

  if (shape === 'v2') {
    return {
      ok: true,
      shape: 'v2',
      message: 'Vault already on v2 schema',
      notesMoved: 0,
    }
  }

  if (shape === 'none') {
    return {
      ok: false,
      shape: 'none',
      message: `No vault found at ${cfg.vaultPath}. Run onboarding first.`,
      notesMoved: 0,
    }
  }

  // shape === 'v1' — proceed with upgrade.
  await bootstrapVault(cfg, { gitignore: false })

  const manifest = loadVaultManifest(cfg.vaultPath)
  if (!manifest) {
    // Should not happen for v1-shape, but guard anyway.
    return {
      ok: false,
      shape: 'v1',
      message: 'Could not load manifest.json during upgrade',
      notesMoved: 0,
    }
  }

  const failures: Violation[] = []
  const movedSlugs: string[] = []
  let notesMoved = 0

  for (const docEntry of manifest.docs) {
    const docRelPath = typeof docEntry === 'string' ? docEntry : ''
    if (!docRelPath) continue

    const srcPath = join(cfg.vaultPath, docRelPath)
    if (!existsSync(srcPath)) continue

    const raw = readFileSync(srcPath, 'utf-8')
    const { frontmatter: existingFm, content: existingBody } = parseFrontmatter(raw)
    const hadFrontmatter = Object.keys(existingFm).length > 0
    const body = hadFrontmatter ? existingBody : raw

    const stem = stripExt(docRelPath).split('/').pop() ?? 'untitled'
    const slug = toKebab(stem) || 'untitled'

    // Inference (concept in practice for v1 since manifest carries no source_path).
    const inferredType = inferNoteType(docRelPath, {}, cfg.projectRoot)

    const filename =
      inferredType === 'concept' ? `concept-${slug}` : `module-${slug}`

    // Stat for last_verified.
    let mtimeIso: string
    try {
      mtimeIso = new Date(statSync(srcPath).mtime).toISOString().slice(0, 10)
    } catch {
      mtimeIso = isoDate()
    }

    const title =
      typeof existingFm.title === 'string' && existingFm.title.trim().length > 0
        ? existingFm.title
        : kebabToTitle(slug)

    const created =
      typeof existingFm.created === 'string' && existingFm.created.trim().length > 0
        ? existingFm.created
        : isoDate()

    const summary =
      typeof existingFm.summary === 'string' && existingFm.summary.trim().length > 0
        ? existingFm.summary
        : firstNonEmptyLine(body) || 'Imported from v1 vault.'

    const defaultTags =
      inferredType === 'module'
        ? ['module', 'lang/unknown', 'layer/unknown']
        : ['concept', 'domain/unknown', 'code/architecture']

    const tags = Array.isArray(existingFm.tags) && existingFm.tags.length >= 3
      ? existingFm.tags
      : defaultTags

    const frontmatter: Record<string, unknown> = {
      title,
      type: inferredType,
      tags,
      status:
        typeof existingFm.status === 'string' && existingFm.status.length > 0
          ? existingFm.status
          : 'active',
      created,
      updated: isoDate(),
      confidence:
        typeof existingFm.confidence === 'string' && existingFm.confidence.length > 0
          ? existingFm.confidence
          : 'medium',
      summary,
      last_verified: mtimeIso,
    }

    // For module type, the validator requires additional fields. We don't have
    // reliable metadata for v1 docs, so v1 upgrades always classify as concept
    // in practice; but if the inference ever returns module, synthesize safe
    // placeholders so the write doesn't fail purely on type-required-fields.
    if (inferredType === 'module') {
      frontmatter.source_path = ''
      frontmatter.language = 'unknown'
      frontmatter.layer = 'unknown'
      frontmatter.domain = 'unknown'
      frontmatter.depends_on = []
      frontmatter.depended_by = []
      frontmatter.exports = []
    }

    const result = await writeNote(cfg, {
      filename,
      folder: 'knowledge',
      frontmatter,
      body,
    })

    if (result.ok) {
      notesMoved++
      movedSlugs.push(filename)
      try {
        unlinkSync(srcPath)
      } catch {
        /* best-effort */
      }
    } else {
      failures.push(...result.violations)
    }
  }

  // Regenerate _index.md from manifest-derived catalog of moved docs.
  regenerateIndex(cfg.vaultPath, movedSlugs)

  // Append vault-upgraded log entry.
  const ts = new Date().toISOString()
  appendLogEntry(
    cfg.vaultPath,
    `- ${ts}  vault-upgraded  moved=${notesMoved} source: code-analysis`,
  )

  return {
    ok: failures.length === 0,
    shape: 'v1',
    message: 'Upgraded',
    notesMoved,
    failures: failures.length > 0 ? failures : undefined,
  }
}

/* ---------- PIFA-10..12: scope backfill (--add-scope) ---------- */

const NOTE_FOLDERS = [
  'knowledge',
  'maps',
  'decisions',
  'flows',
  'incidents',
  'archive',
] as const

export type AddScopeResult = {
  notesAdded: number
  notesUntouched: number
  notesSkipped: number
  skippedFiles: string[]
}

/**
 * PIFA-10..12: backfill `scope: project` to every note's frontmatter that
 * doesn't already declare a `scope`. Idempotent — notes that already carry
 * `scope: project` or `scope: global` are left untouched. Bodies are
 * byte-identical post-write; only the frontmatter block changes.
 *
 * Files with malformed frontmatter (no fences, parse failure) are skipped
 * and logged.
 */
export function addScopeToVault(cfg: VaultConfig): AddScopeResult {
  const vaultPath = cfg.local.path
  const result: AddScopeResult = {
    notesAdded: 0,
    notesUntouched: 0,
    notesSkipped: 0,
    skippedFiles: [],
  }

  const skippedDetails: string[] = []
  for (const folder of NOTE_FOLDERS) {
    const folderPath = join(vaultPath, folder)
    if (!existsSync(folderPath)) continue
    walkAndAddScope(folderPath, folder, result, skippedDetails)
  }

  if (result.notesAdded > 0) {
    appendLogEntry(
      vaultPath,
      `- ${new Date().toISOString()}  vault-upgrade: scope-added (${result.notesAdded} notes)  source: code-analysis`,
    )
  }
  for (const detail of skippedDetails) {
    appendLogEntry(
      vaultPath,
      `- ${new Date().toISOString()}  upgrade-skipped  ${detail}  source: code-analysis`,
    )
  }

  return result
}

function walkAndAddScope(
  dir: string,
  folderRel: string,
  result: AddScopeResult,
  skippedDetails: string[],
): void {
  let entries: string[]
  try {
    entries = readdirSync(dir)
  } catch {
    return
  }
  for (const entry of entries) {
    const full = join(dir, entry)
    let s
    try {
      s = statSync(full)
    } catch {
      continue
    }
    if (s.isDirectory()) {
      walkAndAddScope(full, `${folderRel}/${entry}`, result, skippedDetails)
      continue
    }
    if (!entry.endsWith('.md') || entry.startsWith('_')) continue
    processOneNote(full, `${folderRel}/${entry}`, result, skippedDetails)
  }
}

function processOneNote(
  absPath: string,
  relPath: string,
  result: AddScopeResult,
  skippedDetails: string[],
): void {
  const raw = readFileSync(absPath, 'utf-8')
  // Match the leading frontmatter block: ---\n...\n---
  const fenceMatch = raw.match(/^---\n([\s\S]*?)\n---\n?/)
  if (!fenceMatch) {
    result.notesSkipped++
    result.skippedFiles.push(relPath)
    skippedDetails.push(`${relPath} (no-frontmatter-fence)`)
    return
  }
  const frontmatterText = fenceMatch[1]
  // Quick presence check: a line that starts with `scope:` (any indentation 0).
  if (/^scope:\s*\S/m.test(frontmatterText)) {
    result.notesUntouched++
    return
  }
  // Insert `scope: project` after the line that starts with `type:`. If `type:`
  // is absent, append at the end of the frontmatter block.
  const lines = frontmatterText.split('\n')
  let insertIdx = -1
  for (let i = 0; i < lines.length; i++) {
    if (/^type:\s*\S/.test(lines[i])) {
      insertIdx = i + 1
      break
    }
  }
  if (insertIdx === -1) insertIdx = lines.length
  lines.splice(insertIdx, 0, 'scope: project')
  const newFrontmatter = lines.join('\n')
  const rest = raw.slice(fenceMatch[0].length)
  const newRaw = `---\n${newFrontmatter}\n---\n${rest.startsWith('\n') ? rest.slice(1) : rest}`
  writeFileSync(absPath, newRaw, 'utf-8')
  result.notesAdded++
}

function regenerateIndex(vaultPath: string, movedSlugs: string[]): void {
  const lines: string[] = []
  lines.push('# Vault')
  lines.push('')
  lines.push('> Master catalog. Regenerated by vault upgrade.')
  lines.push('')
  lines.push('## Knowledge')
  lines.push('')
  if (movedSlugs.length === 0) {
    lines.push('_No notes yet._')
  } else {
    for (const slug of movedSlugs) {
      lines.push(`- [[${slug}]]`)
    }
  }
  lines.push('')
  lines.push('## Meta')
  lines.push('')
  lines.push('- [[_conventions]] — vault constitution')
  lines.push('- [[_log]] — append-only mutation log')
  lines.push('')

  mkdirSync(vaultPath, { recursive: true })
  writeFileSync(join(vaultPath, '_index.md'), lines.join('\n'), 'utf-8')
}
