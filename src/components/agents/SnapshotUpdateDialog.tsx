// Stub
import React from 'react'

export function SnapshotUpdateDialog(_props: {
  agentType: string
  scope: unknown
  snapshotTimestamp: string
  onComplete: (result: 'replace' | 'merge' | 'keep') => void
  onCancel: () => void
}) {
  return null
}

export function buildMergePrompt(
  agentType: string,
  _memory: unknown,
): string {
  return `Merge the latest memory snapshot for ${agentType}.`
}
