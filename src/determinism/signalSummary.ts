export type ArtifactHashEntry = {
  file: string
  sha256: string
}

export type ArtifactManifest = {
  schemaVersion: number
  artifacts: ArtifactHashEntry[]
}

export type RepeatabilityStatus =
  | 'repeatable'
  | 'changed'
  | 'missing_in_left'
  | 'missing_in_right'

export type HistoricalSample = {
  sampleId: string
  manifest: ArtifactManifest
}

type SummaryInput = {
  leftSampleId: string
  rightSampleId: string
  leftManifest: ArtifactManifest
  rightManifest: ArtifactManifest
  historicalSamples?: HistoricalSample[]
}

function toHashMap(manifest: ArtifactManifest): Map<string, string> {
  const map = new Map<string, string>()
  for (const artifact of manifest.artifacts) {
    map.set(artifact.file, artifact.sha256)
  }
  return map
}

function sortedUnion(keysA: Iterable<string>, keysB: Iterable<string>): string[] {
  return [...new Set([...keysA, ...keysB])].sort((a, b) => a.localeCompare(b))
}

function computeRecurrence(samples: HistoricalSample[]) {
  const byFile = new Map<string, string[]>()
  for (const sample of samples) {
    const hashes = toHashMap(sample.manifest)
    for (const [file, hash] of hashes.entries()) {
      const series = byFile.get(file) ?? []
      series.push(hash)
      byFile.set(file, series)
    }
  }

  const files = [...byFile.keys()].sort((a, b) => a.localeCompare(b))
  const perSurface = files.map(file => {
    const hashes = byFile.get(file) ?? []
    const counts = new Map<string, number>()
    for (const hash of hashes) {
      counts.set(hash, (counts.get(hash) ?? 0) + 1)
    }
    const modes = [...counts.entries()].sort((a, b) => {
      if (a[1] !== b[1]) return b[1] - a[1]
      return a[0].localeCompare(b[0])
    })
    const [modeHash, modeCount] = modes[0] ?? ['', 0]
    const sampleCount = hashes.length
    return {
      surface: file,
      sampleCount,
      uniqueHashCount: counts.size,
      modeHash,
      modeCount,
      modeRecurrence: sampleCount === 0 ? 0 : Number((modeCount / sampleCount).toFixed(6)),
    }
  })

  const weightedSamples = perSurface.reduce((sum, s) => sum + s.sampleCount, 0)
  const weightedModes = perSurface.reduce((sum, s) => sum + s.modeCount, 0)

  return {
    sampleCount: samples.length,
    surfaces: perSurface,
    aggregateModeRecurrence:
      weightedSamples === 0 ? 0 : Number((weightedModes / weightedSamples).toFixed(6)),
  }
}

export function buildSignalSummary(input: SummaryInput) {
  const leftHashes = toHashMap(input.leftManifest)
  const rightHashes = toHashMap(input.rightManifest)
  const surfaces = sortedUnion(leftHashes.keys(), rightHashes.keys())

  const perSurface = surfaces.map(surface => {
    const leftHash = leftHashes.get(surface)
    const rightHash = rightHashes.get(surface)

    let repeatabilityStatus: RepeatabilityStatus
    if (leftHash === undefined) {
      repeatabilityStatus = 'missing_in_left'
    } else if (rightHash === undefined) {
      repeatabilityStatus = 'missing_in_right'
    } else if (leftHash === rightHash) {
      repeatabilityStatus = 'repeatable'
    } else {
      repeatabilityStatus = 'changed'
    }

    return {
      surface,
      hashes: {
        left: leftHash ?? null,
        right: rightHash ?? null,
      },
      repeatabilityStatus,
    }
  })

  const changedSurfaceCount = perSurface.filter(
    surface => surface.repeatabilityStatus !== 'repeatable',
  ).length
  const comparedSurfaceCount = perSurface.length
  const deltaDensity =
    comparedSurfaceCount === 0
      ? 0
      : Number((changedSurfaceCount / comparedSurfaceCount).toFixed(6))

  const summary: Record<string, unknown> = {
    metadata: {
      schemaVersion: 1,
      observedComparison: {
        leftSampleId: input.leftSampleId,
        rightSampleId: input.rightSampleId,
      },
    },
    signals: {
      perArtifactHashSummary: perSurface,
      observedRepeatability: {
        comparedSurfaceCount,
        changedSurfaceCount,
        deltaDensity,
      },
      temporalClassification: {
        status: 'insufficient_history',
      },
    },
  }

  const historical = input.historicalSamples ?? []
  if (historical.length >= 2) {
    const recurrence = computeRecurrence(historical)
    ;(summary.signals as Record<string, unknown>).recurrence = recurrence
    ;(summary.signals as Record<string, unknown>).temporalClassification = {
      status: 'history_available',
      sampleCount: historical.length,
    }
  }

  return summary
}
