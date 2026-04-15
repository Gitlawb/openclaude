import React from 'react'
import { Box, Text } from '../ink.js'
import { Select } from './CustomSelect/index.js'
import { Dialog } from './design-system/Dialog.js'
import type { OnboardingResult } from '../vault/onboard.js'

export type BridgeAIOnboardDialogResult =
  | { kind: 'onboarded'; result: OnboardingResult }
  | { kind: 'declined' }
  | { kind: 'error'; error: Error }

type Props = {
  projectRoot: string
  onDone: (result: BridgeAIOnboardDialogResult) => void
}

type Phase = 'confirm' | 'running' | 'done' | 'error'

/**
 * First-run dialog: detects an un-onboarded repo and offers to generate
 * vault docs inline. Declining proceeds to REPL without changes.
 */
export function BridgeAIOnboardDialog({ projectRoot, onDone }: Props) {
  const [phase, setPhase] = React.useState<Phase>('confirm')
  const [messages, setMessages] = React.useState<string[]>([])
  const [finalResult, setFinalResult] = React.useState<OnboardingResult | null>(null)
  const [error, setError] = React.useState<Error | null>(null)

  const handleSelect = React.useCallback(
    (value: 'yes' | 'no') => {
      if (value === 'no') {
        onDone({ kind: 'declined' })
        return
      }
      setPhase('running')
      void (async () => {
        try {
          const { runOnboarding } = await import('../vault/onboard.js')
          const result = await runOnboarding(projectRoot, {
            onProgress: (msg) => setMessages((prev) => [...prev, msg]),
          })
          setFinalResult(result)
          setPhase('done')
          // Small delay so the user sees the completion summary before dialog closes.
          setTimeout(() => onDone({ kind: 'onboarded', result }), 600)
        } catch (err) {
          const e = err instanceof Error ? err : new Error(String(err))
          setError(e)
          setPhase('error')
          setTimeout(() => onDone({ kind: 'error', error: e }), 1200)
        }
      })()
    },
    [projectRoot, onDone],
  )

  const handleCancel = React.useCallback(() => {
    if (phase === 'confirm') onDone({ kind: 'declined' })
  }, [phase, onDone])

  if (phase === 'confirm') {
    return (
      <Dialog title="Onboard this repo to bridge-ai?" color="permission" onCancel={handleCancel}>
        <Box flexDirection="column" gap={1}>
          <Text>
            No vault was detected in this project. bridge-ai can analyze the repo and generate
            structured project docs (stack, architecture, conventions, commands) so every AI
            interaction starts with context.
          </Text>
          <Text dimColor>This may take 15–30s on larger repos. Writes to .bridgeai/vault/.</Text>
        </Box>
        <Select
          options={[
            { label: 'Yes, onboard this repo now', value: 'yes' as const },
            { label: 'No, skip for now (run /onboard later)', value: 'no' as const },
          ]}
          onChange={handleSelect}
          onCancel={handleCancel}
        />
      </Dialog>
    )
  }

  if (phase === 'running') {
    return (
      <Dialog title="Onboarding…" color="permission" onCancel={() => {}} hideInputGuide>
        <Box flexDirection="column">
          {messages.map((msg, idx) => (
            <Text key={idx} dimColor={idx < messages.length - 1}>
              {idx === messages.length - 1 ? '› ' : '  '}
              {msg}
            </Text>
          ))}
        </Box>
      </Dialog>
    )
  }

  if (phase === 'done' && finalResult) {
    return (
      <Dialog title="Onboarding complete" color="success" onCancel={() => {}} hideInputGuide>
        <Box flexDirection="column" gap={1}>
          <Text>Vault: {finalResult.vaultPath}</Text>
          <Text dimColor>
            Provider: {finalResult.provider} · Docs: {finalResult.docsGenerated.length}
          </Text>
        </Box>
      </Dialog>
    )
  }

  if (phase === 'error' && error) {
    return (
      <Dialog title="Onboarding failed" color="error" onCancel={() => {}} hideInputGuide>
        <Box flexDirection="column">
          <Text color="error">{error.message}</Text>
          <Text dimColor>Proceeding to REPL — run /onboard to retry.</Text>
        </Box>
      </Dialog>
    )
  }

  return null
}
