// Stub — assistant command not included in source snapshot
import { homedir } from 'os'
import { join } from 'path'
import { useEffect } from 'react'

type NewInstallWizardProps = {
  defaultDir: string
  onInstalled: (dir: string) => void
  onCancel: () => void
  onError: (message: string) => void
}

/**
 * Stub install wizard: the assistant feature is not included in this
 * snapshot. Cancel immediately so launchAssistantInstallWizard resolves
 * null (user-cancelled) instead of rendering an empty dialog that never
 * settles.
 */
export function NewInstallWizard(props: NewInstallWizardProps): null {
  const { onCancel } = props
  useEffect(() => {
    onCancel()
  }, [onCancel])
  return null
}

export async function computeDefaultInstallDir(): Promise<string> {
  return join(homedir(), '.openclaude', 'assistant')
}

export default null
