import { describe, expect, test } from 'bun:test'
import {
  buildSignalSummary,
  type ArtifactManifest,
} from '../../signalSummary.ts'

function manifest(entries: Array<[string, string]>): ArtifactManifest {
  return {
    schemaVersion: 1,
    artifacts: entries.map(([file, sha256]) => ({ file, sha256 })),
  }
}

describe('signal summary generation', () => {
  test('reports observed repeatability and insufficient history by default', () => {
    const summary = buildSignalSummary({
      leftSampleId: 'run1',
      rightSampleId: 'run2',
      leftManifest: manifest([
        ['a.json', '111'],
        ['b.json', '222'],
      ]),
      rightManifest: manifest([
        ['a.json', '111'],
        ['b.json', '333'],
      ]),
    }) as {
      signals: {
        perArtifactHashSummary: Array<{ surface: string; repeatabilityStatus: string }>
        observedRepeatability: { comparedSurfaceCount: number; changedSurfaceCount: number; deltaDensity: number }
        temporalClassification: { status: string }
        recurrence?: unknown
      }
    }

    expect(
      summary.signals.perArtifactHashSummary.map(({ surface, repeatabilityStatus }) => ({
        surface,
        repeatabilityStatus,
      })),
    ).toEqual([
      { surface: 'a.json', repeatabilityStatus: 'repeatable' },
      { surface: 'b.json', repeatabilityStatus: 'changed' },
    ])
    expect(summary.signals.observedRepeatability).toEqual({
      comparedSurfaceCount: 2,
      changedSurfaceCount: 1,
      deltaDensity: 0.5,
    })
    expect(summary.signals.temporalClassification.status).toBe(
      'insufficient_history',
    )
    expect(summary.signals.recurrence).toBeUndefined()
  })

  test('adds recurrence only when historical samples are available', () => {
    const summary = buildSignalSummary({
      leftSampleId: 'run1',
      rightSampleId: 'run2',
      leftManifest: manifest([['a.json', '111']]),
      rightManifest: manifest([['a.json', '111']]),
      historicalSamples: [
        { sampleId: 'h1', manifest: manifest([['a.json', '111']]) },
        { sampleId: 'h2', manifest: manifest([['a.json', '111']]) },
        { sampleId: 'h3', manifest: manifest([['a.json', '222']]) },
      ],
    }) as {
      signals: {
        temporalClassification: { status: string; sampleCount: number }
        recurrence?: { sampleCount: number; aggregateModeRecurrence: number }
      }
    }

    expect(summary.signals.temporalClassification).toEqual({
      status: 'history_available',
      sampleCount: 3,
    })
    expect(summary.signals.recurrence).toBeDefined()
    expect(summary.signals.recurrence?.sampleCount).toBe(3)
    expect(summary.signals.recurrence?.aggregateModeRecurrence).toBeCloseTo(
      0.666667,
      6,
    )
  })
})
