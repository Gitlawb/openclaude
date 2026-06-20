import type { PermissionMode } from '../../../utils/permissions/PermissionMode.js'
import type { SettingsJson } from '../../../utils/settings/types.js'
import type { SmartRoutingConfig } from '../smartModelRouting.js'
import { isProviderOverride, resolveAgentModelProvider, resolveModelOnlyModel } from '../agentRouting.js'
import { readSmartRouting } from './settings.js'

export interface ResolveSmartRoutingConfigInput {
  settings: SettingsJson | null
  parentModel: string
  permissionMode?: PermissionMode
}

/**
 * Resolve a single role (an agentModels key or a bare model id) to the concrete
 * model string smart routing should send.
 *
 * Returns `null` when the role resolves to a cross-provider `ProviderOverride`:
 * B1 is model-only within the current provider, so cross-provider routes are
 * deferred. The whole override object is discarded — no field (`apiKey`,
 * `baseURL`) is ever read or surfaced.
 */
function resolveRoleToModelOnly(
  roleKey: string,
  settings: SettingsJson | null,
  parentModel: string,
  permissionMode?: PermissionMode,
): string | null {
  const route = resolveAgentModelProvider(roleKey, settings)
  if (route) {
    // Cross-provider override: discard the whole object, defer to strong default.
    if (isProviderOverride(route)) return null
    return resolveModelOnlyModel(route.model, parentModel, permissionMode)
  }
  // Not an agentModels key — treat as a bare model id (alias/inherit aware).
  return resolveModelOnlyModel(roleKey, parentModel, permissionMode)
}

/**
 * Build a `SmartRoutingConfig` (concrete model strings) from `settings.smartRouting`.
 *
 * Strong-default rules:
 * - Disabled or misconfigured settings → `{ enabled: false }`-shaped config; the
 *   caller must fall back to today's model resolution rather than route.
 * - `strongModel` unresolvable (missing, or a cross-provider override) → disabled,
 *   because there is no safe model to fall back to.
 * - `simpleModel` unresolvable → collapsed to the strong model, which `routeModel`
 *   treats as "always strong" (`simpleModel === strongModel`).
 *
 * Never throws.
 */
export function resolveSmartRoutingConfig({
  settings,
  parentModel,
  permissionMode,
}: ResolveSmartRoutingConfigInput): SmartRoutingConfig {
  const norm = readSmartRouting(settings)

  const disabled = (strongModel = ''): SmartRoutingConfig => ({
    enabled: false,
    simpleModel: strongModel,
    strongModel,
  })

  if (!norm.enabled || !norm.strongModel) return disabled(norm.strongModel ?? '')

  const strong = resolveRoleToModelOnly(norm.strongModel, settings, parentModel, permissionMode)
  // No usable strong model (e.g. strong role is a cross-provider override) — do
  // not route; the caller uses today's resolution.
  if (!strong) return disabled(norm.strongModel)

  const simple = norm.simpleModel
    ? resolveRoleToModelOnly(norm.simpleModel, settings, parentModel, permissionMode)
    : null

  return {
    enabled: true,
    // Unresolvable simple → collapse to strong (routeModel then always picks strong).
    simpleModel: simple ?? strong,
    strongModel: strong,
    simpleMaxChars: norm.simpleMaxChars,
    simpleMaxWords: norm.simpleMaxWords,
  }
}
