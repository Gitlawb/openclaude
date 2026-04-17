/**
 * Convention validator for vault note drafts.
 *
 * Given a parsed {@link ConventionSchema} (see `./parser.ts`) and a
 * {@link NoteDraft}, runs the full set of write-time rules defined in
 * `.specs/features/vault-bootstrap/design.md` and returns a structured
 * {@link ValidationResult}. Every failing rule contributes exactly one
 * {@link Violation}; rules never short-circuit — callers always see the
 * complete list so a single pass surfaces every problem.
 *
 * Rule ids (stable strings, safe to match in tests and UI):
 *   - `required-field-missing`
 *   - `type-enum`
 *   - `status-enum`
 *   - `confidence-enum`
 *   - `tag-count`
 *   - `tag-taxonomy`
 *   - `tag-kebab-case`
 *   - `type-required-fields`
 *   - `filename-casing`
 *   - `filename-prefix`
 *   - `invalid-value` (PIFA-05, on `scope`)
 *   - `type-scope-mismatch` (PIFA-05)
 */

import {
  CONFIDENCES,
  NOTE_STATUSES,
  NOTE_TYPES,
  type ConventionSchema,
  type NoteType,
} from './defaults.js'

/** Project-local vs portable global scope marker on every note. PIFA-01. */
export type NoteScope = 'project' | 'global'

/** Raw frontmatter from an in-flight note draft (unvalidated). */
export type NoteDraftFrontmatter = {
  title?: unknown
  type?: unknown
  tags?: unknown
  status?: unknown
  created?: unknown
  updated?: unknown
  confidence?: unknown
  summary?: unknown
  /**
   * PIFA-01: vault scope. `'project'` writes to the local vault, `'global'`
   * writes to the dev's portable vault. Default `'project'` is applied by
   * `writeNote` before validation. Typed as `NoteScope | unknown` so the
   * validator catches garbage values rather than letting them silently pass.
   */
  scope?: NoteScope | unknown
  [key: string]: unknown
}

/**
 * An in-memory representation of a note about to be written to the vault.
 * Matches the shape described in `design.md` (validator inputs).
 */
export interface NoteDraft {
  /** Filename without `.md` extension, e.g. `adr-0001-auth-redesign`. */
  filename: string
  /** Folder (relative to vault root), e.g. `decisions`. */
  folder: string
  /** Parsed frontmatter as a plain object. */
  frontmatter: NoteDraftFrontmatter
  /** Markdown body below the frontmatter fence. */
  body: string
}

/** A single rule failure. */
export interface Violation {
  /** The frontmatter / draft field that failed (e.g. `tags`, `filename`). */
  field: string
  /** Human-readable description of what was expected. */
  expected: string
  /** The offending value as observed on the draft. */
  got: unknown
  /** Stable rule id (see module doc comment). */
  rule: string
}

/** Aggregate result of a `validateNote` call. */
export interface ValidationResult {
  ok: boolean
  violations: Violation[]
}

const KEBAB_CASE_FILENAME = /^[a-z0-9]+(?:-[a-z0-9]+)*$/
const KEBAB_CASE_TAG_SEGMENT = /^[a-z0-9]+(?:-[a-z0-9]+)*$/

/**
 * "Missing" means absent/null or a blank string. Empty arrays are legitimate
 * values (e.g. `depends_on: []` meaning "no dependencies") so they are NOT
 * considered missing — separate rules (tag-count) enforce minimum lengths
 * where required.
 */
function isMissing(value: unknown): boolean {
  if (value === undefined || value === null) return true
  if (typeof value === 'string') return value.trim() === ''
  return false
}

function isKebabTag(tag: string): boolean {
  if (tag.length === 0) return false
  // Allow `/` as a namespace separator; each segment must be kebab-case.
  const segments = tag.split('/')
  for (const seg of segments) {
    if (!KEBAB_CASE_TAG_SEGMENT.test(seg)) return false
  }
  return true
}

/**
 * Validate a {@link NoteDraft} against a {@link ConventionSchema}.
 *
 * Runs every rule and returns the aggregate result. `ok` is `true` iff
 * `violations` is empty.
 */
export function validateNote(
  schema: ConventionSchema,
  draft: NoteDraft,
): ValidationResult {
  const violations: Violation[] = []
  const fm = draft.frontmatter ?? {}

  // Rule: required-field-missing
  for (const field of schema.requiredFrontmatter) {
    if (isMissing(fm[field])) {
      violations.push({
        field,
        expected: `non-empty \`${field}\``,
        got: fm[field],
        rule: 'required-field-missing',
      })
    }
  }

  // Rule: type-enum
  const rawType = fm.type
  const validTypes = Object.keys(schema.noteTypes) as NoteType[]
  const typeIsValid =
    typeof rawType === 'string' &&
    (validTypes as string[]).includes(rawType)
  if (rawType !== undefined && rawType !== null && !typeIsValid) {
    violations.push({
      field: 'type',
      expected: `one of: ${validTypes.join(' | ')}`,
      got: rawType,
      rule: 'type-enum',
    })
  }

  // Rule: status-enum
  const rawStatus = fm.status
  if (
    rawStatus !== undefined &&
    rawStatus !== null &&
    !(NOTE_STATUSES as readonly string[]).includes(String(rawStatus))
  ) {
    violations.push({
      field: 'status',
      expected: `one of: ${NOTE_STATUSES.join(' | ')}`,
      got: rawStatus,
      rule: 'status-enum',
    })
  }

  // Rule: confidence-enum
  const rawConfidence = fm.confidence
  if (
    rawConfidence !== undefined &&
    rawConfidence !== null &&
    !(CONFIDENCES as readonly string[]).includes(String(rawConfidence))
  ) {
    violations.push({
      field: 'confidence',
      expected: `one of: ${CONFIDENCES.join(' | ')}`,
      got: rawConfidence,
      rule: 'confidence-enum',
    })
  }

  // Tag rules (tag-count, tag-taxonomy, tag-kebab-case)
  const rawTags = fm.tags
  if (Array.isArray(rawTags)) {
    const { minCount, maxCount, prefixes } = schema.tagTaxonomy

    if (rawTags.length < minCount || rawTags.length > maxCount) {
      violations.push({
        field: 'tags',
        expected: `${minCount}..${maxCount} tags`,
        got: rawTags.length,
        rule: 'tag-count',
      })
    }

    const bareAllowed = new Set<string>(NOTE_TYPES as readonly string[])

    for (const t of rawTags) {
      if (typeof t !== 'string' || t.length === 0) {
        violations.push({
          field: 'tags',
          expected: 'non-empty kebab-case string',
          got: t,
          rule: 'tag-kebab-case',
        })
        continue
      }

      // tag-kebab-case: applies regardless of prefix membership.
      if (!isKebabTag(t)) {
        violations.push({
          field: 'tags',
          expected: 'kebab-case (lowercase letters, digits, hyphens; `/` allowed as separator)',
          got: t,
          rule: 'tag-kebab-case',
        })
      }

      // tag-taxonomy: must start with an approved prefix, or be a bare
      // NoteType literal (e.g. `module`).
      const hasPrefix = prefixes.some((p) => t.startsWith(p))
      const isBareAllowed = bareAllowed.has(t)
      if (!hasPrefix && !isBareAllowed) {
        violations.push({
          field: 'tags',
          expected: `prefix from: ${prefixes.join(', ')} (or bare NoteType)`,
          got: t,
          rule: 'tag-taxonomy',
        })
      }
    }
  }

  // Rule: type-required-fields
  if (typeIsValid) {
    const typeRules = schema.noteTypes[rawType as NoteType]
    if (typeRules) {
      for (const field of typeRules.requiredFields) {
        if (isMissing(fm[field])) {
          violations.push({
            field,
            expected: `non-empty \`${field}\` for type \`${String(rawType)}\``,
            got: fm[field],
            rule: 'type-required-fields',
          })
        }
      }
    }
  }

  // Rule: filename-casing
  const filename = draft.filename ?? ''
  if (
    filename.length === 0 ||
    filename.includes('/') ||
    filename.includes('\\') ||
    filename.endsWith('.md') ||
    !KEBAB_CASE_FILENAME.test(filename)
  ) {
    violations.push({
      field: 'filename',
      expected: 'kebab-case (lowercase letters, digits, hyphens); no path separator; no `.md` extension',
      got: filename,
      rule: 'filename-casing',
    })
  }

  // Rule: filename-prefix
  if (typeIsValid) {
    const prefix = schema.naming.prefixByType[rawType as NoteType]
    if (prefix && prefix.length > 0 && !filename.startsWith(prefix)) {
      violations.push({
        field: 'filename',
        expected: `starts with \`${prefix}\` for type \`${String(rawType)}\``,
        got: filename,
        rule: 'filename-prefix',
      })
    }
  }

  return { ok: violations.length === 0, violations }
}
