/**
 * Settings type surface for SDK consumers.
 *
 * Upstream this file is generated from the settings JSON schema. The
 * generator output was not mirrored into this snapshot, so we alias the
 * Zod-derived settings type from utils/settings/types.ts, which is built
 * from the same source of truth (SettingsSchema).
 *
 * Type-only module — must stay runtime-inert (re-exported by
 * agentSdkTypes.ts, the public SDK type entrypoint).
 */

export type { SettingsJson as Settings } from '../../utils/settings/types.js'
