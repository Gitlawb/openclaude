import { getSettings_DEPRECATED } from '../settings/settings.js'
import { isModelAlias, isModelFamilyAlias } from './aliases.js'
import { extractModelIdFromArn } from './bedrock.js'
import { firstPartyNameToCanonical, parseUserSpecifiedModel } from './model.js'
import { resolveOverriddenModel } from './modelStrings.js'

/**
 * Check if a model belongs to a given family by checking if its name
 * (or resolved name) contains the family identifier.
 */
function modelBelongsToFamily(model: string, family: string): boolean {
  if (model.includes(family)) {
    return true
  }
  // Resolve aliases like "best" → "claude-opus-4-6" to check family membership
  if (isModelAlias(model)) {
    const resolved = parseUserSpecifiedModel(model).toLowerCase()
    return resolved.includes(family)
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
 *   - ARN: arn:aws:bedrock:...
 *   - Cross-region inference profile: {region}.anthropic.claude-*-v{N}:{N}
 *   - Foundation model: anthropic.claude-*-v{N}:{N}
 */
function isBedrockFormattedModel(model: string): boolean {
  if (model.startsWith('arn:')) return true
  // Match (optional region prefix.)anthropic.claude-...-v{digits}:{digits}
  return /^(?:(?:us|eu|apac|global)\.)?anthropic\.claude-.*-v\d+:\d+$/.test(
    model,
  )
}

/**
 * Normalize a Bedrock-formatted model ID to its canonical first-party form
 * for allowlist comparison. Only applies to recognized Bedrock patterns
 * (ARN, region-prefixed inference profiles, foundation models with version
 * suffixes like -v1:0). Custom/unknown model IDs are returned unchanged to
 * prevent accidental allowlist bypasses.
 *
 * Example: "eu.anthropic.claude-sonnet-4-5-v1:0" → "claude-sonnet-4-5"
 */
function normalizeForAllowlist(model: string): string {
  if (!isBedrockFormattedModel(model)) {
    return model
  }
  // 1. Strip ARN wrapper if present
  let id = extractModelIdFromArn(model)
  // 2. Strip region prefix (eu., us., apac., global.)
  id = id.replace(/^(?:us|eu|apac|global)\./, '')
  // 3. Strip vendor prefix (anthropic.)
  id = id.replace(/^anthropic\./, '')
  // 4. Resolve to canonical first-party short name (handles date/version suffixes)
  return firstPartyNameToCanonical(id)
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
  const normalizedModel = resolvedModel.trim().toLowerCase()
  const normalizedAllowlist = availableModels.map(m => m.trim().toLowerCase())

  // For Bedrock/Vertex model IDs (e.g. "eu.anthropic.claude-sonnet-4-5-v1:0"),
  // also derive the canonical first-party form ("claude-sonnet-4-5") so that
  // allowlist entries like "claude-sonnet-4-5" or "sonnet" match correctly
  // even when the resolved model carries provider-specific formatting.
  const canonicalModel = normalizeForAllowlist(normalizedModel)

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
