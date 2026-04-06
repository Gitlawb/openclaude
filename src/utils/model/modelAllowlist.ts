import { getSettings_DEPRECATED } from '../settings/settings.js'
import { isModelAlias, isModelFamilyAlias } from './aliases.js'
import { extractModelIdFromArn } from './bedrock.js'
import { firstPartyNameToCanonical, parseUserSpecifiedModel } from './model.js'
import { resolveOverriddenModel } from './modelStrings.js'

/**
 * Check if a model belongs to a given family.
 *
 * Two conditions must both hold:
 * 1. The model is a recognized first-party Claude ID (starts with "claude-",
 *    is a Bedrock-formatted ID, a Vertex @date ID, or a known alias).
 *    This prevents custom/third-party models like "my-sonnet-deployment" or
 *    "gpt-sonnet-foo" from accidentally matching a Claude family alias.
 * 2. The family name is a distinct hyphen-delimited segment of the model name
 *    (e.g. "opus" in "claude-opus-4-6", but NOT a prefix of "opusplan").
 *
 * Note: isBedrockFormattedModel / isVertexFormattedModel are declared later in
 * this file but are regular function declarations, so they are hoisted.
 */
function modelBelongsToFamily(model: string, family: string): boolean {
  // Guard: non-alias models must be recognized first-party Claude IDs.
  const isRecognizedClaudeId =
    model.startsWith('claude-') ||
    isBedrockFormattedModel(model) ||
    isVertexFormattedModel(model)
  if (!isModelAlias(model) && !isRecognizedClaudeId) {
    return false
  }

  // Segment-boundary match: family must be a complete hyphen-delimited token.
  const segmentRe = new RegExp(`(?:^|-)${family}(?:-|$)`)
  if (segmentRe.test(model)) {
    return true
  }

  // Resolve aliases like "best" → "claude-opus-4-6" to check family membership.
  if (isModelAlias(model)) {
    const resolved = parseUserSpecifiedModel(model).toLowerCase()
    return segmentRe.test(resolved)
  }
  return false
}

/**
 * Check if a model name starts with a prefix at a segment boundary.
 * The prefix must match up to the end of the name or a "-" separator.
 * e.g. "claude-opus-4-5" matches "claude-opus-4-5-20251101" but not "claude-opus-4-50".
 */
function prefixMatchesModel(modelName: string, prefix: string): boolean {
  if (!modelName.startsWith(prefix)) {
    return false
  }
  return modelName.length === prefix.length || modelName[prefix.length] === '-'
}

/**
 * Check if a model matches a version-prefix entry in the allowlist.
 * Supports shorthand like "opus-4-5" (mapped to "claude-opus-4-5") and
 * full prefixes like "claude-opus-4-5". Resolves input aliases before matching.
 */
function modelMatchesVersionPrefix(model: string, entry: string): boolean {
  // Resolve the input model to a full name if it's an alias
  const resolvedModel = isModelAlias(model)
    ? parseUserSpecifiedModel(model).toLowerCase()
    : model

  // Try the entry as-is (e.g. "claude-opus-4-5")
  if (prefixMatchesModel(resolvedModel, entry)) {
    return true
  }
  // Try with "claude-" prefix (e.g. "opus-4-5" → "claude-opus-4-5")
  if (
    !entry.startsWith('claude-') &&
    prefixMatchesModel(resolvedModel, `claude-${entry}`)
  ) {
    return true
  }
  return false
}

/**
 * Check if a family alias is narrowed by more specific entries in the allowlist.
 * When the allowlist contains both "opus" and "opus-4-5", the specific entry
 * takes precedence — "opus" alone would be a wildcard, but "opus-4-5" narrows
 * it to only that version.
 */
function familyHasSpecificEntries(
  family: string,
  allowlist: string[],
): boolean {
  for (const entry of allowlist) {
    if (isModelFamilyAlias(entry)) {
      continue
    }
    // Check if entry is a version-qualified variant of this family
    // e.g., "opus-4-5" or "claude-opus-4-5-20251101" for the "opus" family
    // Must match at a segment boundary (followed by '-' or end) to avoid
    // false positives like "opusplan" matching "opus"
    const idx = entry.indexOf(family)
    if (idx === -1) {
      continue
    }
    const afterFamily = idx + family.length
    if (afterFamily === entry.length || entry[afterFamily] === '-') {
      return true
    }
  }
  return false
}

/**
 * Detect whether a model ID is a standard Bedrock-formatted inference profile
 * or foundation model (as opposed to a custom deployment name that may
 * coincidentally contain a Claude model substring).
 *
 * Recognized patterns:
 *   - Bedrock ARN: arn:aws[...]:bedrock:... (with extracted ID matching the pattern below)
 *   - Cross-region inference profile with version: {region}.anthropic.claude-*-v{N}[:{N}]
 *   - Foundation model with version: anthropic.claude-*-v{N}[:{N}]
 *   - New-style IDs without version suffix: [{region}.]anthropic.claude-{name}
 *     where {name} is lowercase alphanumeric segments (e.g. us.anthropic.claude-sonnet-4-6)
 *
 * The no-version-suffix alternative is restricted to lowercase alphanumeric+hyphen
 * segments to avoid matching arbitrary custom deployment names (which may use
 * uppercase, underscores, or dots).
 */

// Matches arn:aws[...]:bedrock:... — restricts to AWS Bedrock ARNs only.
const BEDROCK_ARN_PATTERN = /^arn:aws(?:-[^:]+)?:bedrock:/

// Matches (optional region.)anthropic.claude-{name}-v{N}[:{N}] (versioned)
// OR     (optional region.)anthropic.claude-{name}            (no-version suffix).
// The versioned branch restricts intermediate segments between the base model
// name and -vN to numeric version tokens (\d+) or 8-digit dates (\d{8}), so
// custom deployment names with arbitrary segments (e.g. -prod-, -custom-) are
// not recognized as first-party Bedrock IDs.
// The no-version suffix branch requires the name to end with a numeric version
// segment (e.g. claude-sonnet-4-6) to avoid matching arbitrary custom names.
// This ensures custom deployment names that use uppercase, underscores, or dots
// (e.g. us.anthropic.claude-MyCustom-v1) are not recognised and cannot be
// accidentally normalized to a canonical Claude name.
const BEDROCK_ANTHROPIC_MODEL_ID_PATTERN =
  /^(?:(?:us|eu|apac|global)\.)?anthropic\.claude-(?:[a-z0-9]+(?:-[a-z0-9]+)*-(?:\d+(?:-\d+)*|\d{8})-v\d+(?::\d+)?|[a-z0-9]+(?:-\d+)+)$/

function isRecognizedBedrockModelId(model: string): boolean {
  return BEDROCK_ANTHROPIC_MODEL_ID_PATTERN.test(model)
}

function isBedrockFormattedModel(model: string): boolean {
  if (BEDROCK_ARN_PATTERN.test(model)) {
    // Only treat the ARN as Bedrock-formatted if the extracted model ID
    // matches the expected anthropic.claude-* pattern — prevents non-Bedrock
    // or custom ARNs that happen to contain Claude substrings from bypassing
    // allowlist checks.
    return isRecognizedBedrockModelId(extractModelIdFromArn(model))
  }
  return isRecognizedBedrockModelId(model)
}

/**
 * Detect whether a model ID carries a Vertex AI `@YYYYMMDD` date suffix
 * (e.g. "claude-sonnet-4-5@20250929"). Only recognized Claude model IDs
 * (starting with "claude-") are matched to prevent accidental normalization
 * of arbitrary custom deployment names.
 */
function isVertexFormattedModel(model: string): boolean {
  return /^claude-.*@\d{8}$/.test(model)
}

/**
 * Normalize a provider-specific model ID to its canonical first-party form
 * for allowlist comparison.
 *
 * Handles two provider formats:
 *   - Bedrock: "eu.anthropic.claude-sonnet-4-5-v1:0" → "claude-sonnet-4-5"
 *   - Vertex:  "claude-sonnet-4-5@20250929"          → "claude-sonnet-4-5"
 *
 * Custom/unknown model IDs are returned unchanged to prevent accidental
 * allowlist bypasses.
 */
function normalizeForAllowlist(model: string): string {
  // Bedrock normalization (ARN, region-prefixed inference profiles, foundation models)
  if (isBedrockFormattedModel(model)) {
    // 1. Strip ARN wrapper if present
    let id = extractModelIdFromArn(model)
    // 2. Strip region prefix (eu., us., apac., global.)
    id = id.replace(/^(?:us|eu|apac|global)\./, '')
    // 3. Strip vendor prefix (anthropic.)
    id = id.replace(/^anthropic\./, '')
    // 4. Resolve to canonical first-party short name (handles date/version suffixes)
    return firstPartyNameToCanonical(id)
  }

  // Vertex normalization: strip @YYYYMMDD date suffix from recognized Claude IDs
  if (isVertexFormattedModel(model)) {
    return firstPartyNameToCanonical(model.replace(/@\d{8}$/, ''))
  }

  return model
}

/**
 * Check if a model is allowed by the availableModels allowlist in settings.
 * If availableModels is not set, all models are allowed.
 *
 * Matching tiers:
 * 1. Family aliases ("opus", "sonnet", "haiku") — wildcard for the entire family,
 *    UNLESS more specific entries for that family also exist (e.g., "opus-4-5").
 *    In that case, the family wildcard is ignored and only the specific entries apply.
 * 2. Version prefixes ("opus-4-5", "claude-opus-4-5") — any build of that version
 * 3. Full model IDs ("claude-opus-4-5-20251101") — exact match only
 */
export function isModelAllowed(model: string): boolean {
  const settings = getSettings_DEPRECATED() || {}
  const { availableModels } = settings
  if (!availableModels) {
    return true // No restrictions
  }
  if (availableModels.length === 0) {
    return false // Empty allowlist blocks all user-specified models
  }

  const resolvedModel = resolveOverriddenModel(model)
  // Keep the trimmed-but-original-case string for normalizeForAllowlist so that
  // the pattern's [a-z0-9] guards against custom deployment names can use
  // uppercase as a signal. Lowercasing happens *after* normalization.
  const trimmedModel = resolvedModel.trim()
  const normalizedModel = trimmedModel.toLowerCase()
  const normalizedAllowlist = availableModels.map(m => m.trim().toLowerCase())

  // For provider-specific model IDs, also derive the canonical first-party form
  // so that allowlist entries like "claude-sonnet-4-5" or "sonnet" match correctly
  // even when the resolved model carries provider-specific formatting:
  //   Bedrock: "eu.anthropic.claude-sonnet-4-5-v1:0" → "claude-sonnet-4-5"
  //   Vertex:  "claude-sonnet-4-5@20250929"           → "claude-sonnet-4-5"
  // normalizeForAllowlist receives the original-case trimmed string so that
  // its uppercase-detecting guards work correctly; the result is lowercased here.
  const canonicalModel = normalizeForAllowlist(trimmedModel).toLowerCase()

  // Direct match (alias-to-alias or full-name-to-full-name)
  // Skip family aliases that have been narrowed by specific entries —
  // e.g., "opus" in ["opus", "opus-4-5"] should NOT directly match,
  // because the admin intends to restrict to opus 4.5 only.
  if (
    normalizedAllowlist.includes(normalizedModel) ||
    normalizedAllowlist.includes(canonicalModel)
  ) {
    const matchedModel = normalizedAllowlist.includes(normalizedModel)
      ? normalizedModel
      : canonicalModel
    if (
      !isModelFamilyAlias(matchedModel) ||
      !familyHasSpecificEntries(matchedModel, normalizedAllowlist)
    ) {
      return true
    }
  }

  // Family-level aliases in the allowlist match any model in that family,
  // but only if no more specific entries exist for that family.
  // e.g., ["opus"] allows all opus, but ["opus", "opus-4-5"] only allows opus 4.5.
  for (const entry of normalizedAllowlist) {
    if (
      isModelFamilyAlias(entry) &&
      !familyHasSpecificEntries(entry, normalizedAllowlist) &&
      (modelBelongsToFamily(normalizedModel, entry) ||
        modelBelongsToFamily(canonicalModel, entry))
    ) {
      return true
    }
  }

  // For non-family entries, do bidirectional alias resolution
  // If model is an alias, resolve it and check if the resolved name is in the list
  if (isModelAlias(normalizedModel)) {
    const resolved = parseUserSpecifiedModel(normalizedModel).toLowerCase()
    if (normalizedAllowlist.includes(resolved)) {
      return true
    }
  }

  // If any non-family alias in the allowlist resolves to the input model
  for (const entry of normalizedAllowlist) {
    if (!isModelFamilyAlias(entry) && isModelAlias(entry)) {
      const resolved = parseUserSpecifiedModel(entry).toLowerCase()
      if (resolved === normalizedModel || resolved === canonicalModel) {
        return true
      }
    }
  }

  // Version-prefix matching: "opus-4-5" or "claude-opus-4-5" matches
  // "claude-opus-4-5-20251101" at a segment boundary.
  // Check both the raw model and its canonical form for Bedrock compatibility.
  for (const entry of normalizedAllowlist) {
    if (!isModelFamilyAlias(entry) && !isModelAlias(entry)) {
      if (
        modelMatchesVersionPrefix(normalizedModel, entry) ||
        modelMatchesVersionPrefix(canonicalModel, entry)
      ) {
        return true
      }
    }
  }

  return false
}
