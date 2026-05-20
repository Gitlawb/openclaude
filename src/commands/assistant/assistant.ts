// Stub - assistant command not included in source snapshot
import React from 'react'

export async function computeDefaultInstallDir(): Promise<string> {
  return process.cwd()
}

export function NewInstallWizard(_props: {
  defaultDir: string
  onInstalled: (dir: string) => void
  onCancel: () => void
  onError: (message: string) => void
}) {
  return null
}

export default null
