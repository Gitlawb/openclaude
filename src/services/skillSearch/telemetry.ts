// Stub — skillSearch not included in source snapshot (feature-gated).

export type RemoteSkillLoadedEvent = {
  slug: string
  cacheHit: boolean
  latencyMs: number
  urlScheme: string
  fileCount?: number
  totalBytes?: number
  fetchMethod?: string
  error?: string
}

/** Telemetry for remote skill loads. No-op in this snapshot. */
export function logRemoteSkillLoaded(_event: RemoteSkillLoadedEvent): void {}
