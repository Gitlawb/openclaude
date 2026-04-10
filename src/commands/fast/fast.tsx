import * as React from 'react'
import { useState } from 'react'
import type { LocalJSXCommandContext } from '../../commands.js'
import { FastIcon, getFastIconString } from '../../components/FastIcon.js'
import { Dialog } from '../../components/design-system/Dialog.js'
import { Box, Link, Text } from '../../ink.js'
import { useKeybindings } from '../../keybindings/useKeybinding.js'
import {
  type AnalyticsMetadata_I_VERIFIED_THIS_IS_NOT_CODE_OR_FILEPATHS,
  logEvent,
} from '../../services/analytics/index.js'
import { type AppState, useAppState, useSetAppState } from '../../state/AppState.js'
import type { LocalJSXCommandOnDone } from '../../types/command.js'
import {
  clearFastModeCooldown,
  FAST_MODE_MODEL_DISPLAY,
  getFastModeModel,
  getFastModeRuntimeState,
  isFastModeSupportedByModel,
  prefetchFastModeStatus,
} from '../../utils/fastMode.js'
import { formatDuration } from '../../utils/format.js'
import { formatModelPricing, getOpus46CostTier } from '../../utils/modelCost.js'
import {
  buildProviderModelSettingsUpdate,
  type PersistedServiceTier,
} from '../../utils/model/providerModelSettings.js'
import {
  getFastModeUnavailableReasonForProvider,
  isFastModeCooldownForProvider,
  isFastModeToggleEnabled,
  resolveFastModeProvider,
} from '../../utils/providerFastMode.js'
import { getSettingsForSource, updateSettingsForSource } from '../../utils/settings/settings.js'

type FastModeCommandProvider = ReturnType<typeof resolveFastModeProvider>

function setCodexFastModeSelection(
  targetKey: string,
  serviceTier: PersistedServiceTier | null,
): void {
  const userSettings = getSettingsForSource('userSettings') || {}
  updateSettingsForSource(
    'userSettings',
    buildProviderModelSettingsUpdate({
      settings: userSettings,
      provider: 'codex',
      targetKey,
      serviceTier,
    }),
  )
}

function applyFastMode(options: {
  enable: boolean
  provider: FastModeCommandProvider
  targetKey: string
  setAppState: (f: (prev: AppState) => AppState) => void
}): { modelUpdated: boolean } {
  const { enable, provider, targetKey, setAppState } = options

  if (provider === 'codex') {
    setCodexFastModeSelection(targetKey, enable ? 'fast' : null)
    setAppState(prev => ({
      ...prev,
      fastMode: enable,
    }))
    return { modelUpdated: false }
  }

  if (provider !== 'firstParty') {
    return { modelUpdated: false }
  }

  clearFastModeCooldown()
  updateSettingsForSource('userSettings', {
    fastMode: enable ? true : undefined,
  })

  if (enable) {
    let modelUpdated = false
    setAppState(prev => {
      modelUpdated = !isFastModeSupportedByModel(prev.mainLoopModel)
      return {
        ...prev,
        ...(modelUpdated
          ? {
              mainLoopModel: getFastModeModel(),
              mainLoopModelForSession: null,
            }
          : {}),
        fastMode: true,
      }
    })
    return { modelUpdated }
  }

  setAppState(prev => ({
    ...prev,
    fastMode: false,
  }))
  return { modelUpdated: false }
}

function getFastModeSubtitle(provider: FastModeCommandProvider): string {
  if (provider === 'codex') {
    return 'Switch Codex requests between normal and fast.'
  }
  return `High-speed mode for ${FAST_MODE_MODEL_DISPLAY}. Billed as extra usage at a premium rate. Separate rate limits apply.`
}

function getFastModeConfirmMessage(options: {
  enable: boolean
  provider: FastModeCommandProvider
  modelUpdated: boolean
}): string {
  if (!options.enable) {
    return 'Fast mode OFF'
  }

  const fastIcon = getFastIconString(true)
  if (options.provider === 'codex') {
    return `${fastIcon} Fast mode ON`
  }

  const pricing = formatModelPricing(getOpus46CostTier(true))
  const modelUpdated = options.modelUpdated
    ? ` · model set to ${FAST_MODE_MODEL_DISPLAY}`
    : ''
  return `${fastIcon} Fast mode ON${modelUpdated} · ${pricing}`
}

export function FastModePicker({
  onDone,
  provider,
  unavailableReason,
}: {
  onDone: LocalJSXCommandOnDone
  provider: FastModeCommandProvider
  unavailableReason: string | null
}): React.ReactNode {
  const model = useAppState((s: AppState) => s.mainLoopModel)
  const initialFastMode = useAppState((s: AppState) => s.fastMode ?? false)
  const providerSelectionTargetKey = useAppState(
    (s: AppState) => s.providerSelectionTargetKey,
  )
  const setAppState = useSetAppState()
  const [enableFastMode, setEnableFastMode] = useState(initialFastMode)

  const runtimeState = getFastModeRuntimeState()
  const isCooldown =
    provider === 'firstParty' &&
    isFastModeCooldownForProvider({ provider }) &&
    runtimeState.status === 'cooldown'
  const pricing =
    provider === 'firstParty'
      ? formatModelPricing(getOpus46CostTier(true))
      : undefined

  const handleConfirm = React.useCallback(() => {
    if (unavailableReason) {
      return
    }

    const { modelUpdated } = applyFastMode({
      enable: enableFastMode,
      provider,
      targetKey: providerSelectionTargetKey,
      setAppState,
    })

    logEvent('tengu_fast_mode_toggled', {
      enabled: enableFastMode,
      source: 'picker' as AnalyticsMetadata_I_VERIFIED_THIS_IS_NOT_CODE_OR_FILEPATHS,
    })

    if (
      provider === 'firstParty' &&
      !enableFastMode &&
      !isFastModeSupportedByModel(model)
    ) {
      setAppState((prev: AppState) => ({
        ...prev,
        fastMode: false,
      }))
    }

    onDone(
      getFastModeConfirmMessage({
        enable: enableFastMode,
        provider,
        modelUpdated,
      }),
    )
  }, [
    enableFastMode,
    model,
    onDone,
    provider,
    providerSelectionTargetKey,
    setAppState,
    unavailableReason,
  ])

  const handleCancel = React.useCallback(() => {
    if (unavailableReason) {
      if (initialFastMode) {
        applyFastMode({
          enable: false,
          provider,
          targetKey: providerSelectionTargetKey,
          setAppState,
        })
      }
      onDone('Fast mode OFF', { display: 'system' })
      return
    }

    onDone(
      initialFastMode
        ? `${getFastIconString()} Kept Fast mode ON`
        : 'Kept Fast mode OFF',
      { display: 'system' },
    )
  }, [
    initialFastMode,
    onDone,
    provider,
    providerSelectionTargetKey,
    setAppState,
    unavailableReason,
  ])

  const handleToggle = React.useCallback(() => {
    if (unavailableReason) {
      return
    }
    setEnableFastMode((prev: boolean) => !prev)
  }, [unavailableReason])

  useKeybindings(
    {
      'confirm:yes': handleConfirm,
      'confirm:nextField': handleToggle,
      'confirm:next': handleToggle,
      'confirm:previous': handleToggle,
      'confirm:cycleMode': handleToggle,
      'confirm:toggle': handleToggle,
    },
    { context: 'Confirmation' },
  )

  return (
    <Dialog
      title={
        <Text>
          <FastIcon cooldown={isCooldown} /> Fast mode
          {provider === 'firstParty' ? ' (research preview)' : ''}
        </Text>
      }
      subtitle={getFastModeSubtitle(provider)}
      onCancel={handleCancel}
      color="fastMode"
      inputGuide={(exitState: { pending: boolean; keyName: string }) =>
        exitState.pending ? (
          <Text>Press {exitState.keyName} again to exit</Text>
        ) : unavailableReason ? (
          <Text>Esc to cancel</Text>
        ) : (
          <Text>Tab to toggle · Enter to confirm · Esc to cancel</Text>
        )
      }
    >
      {unavailableReason ? (
        <Box marginLeft={2}>
          <Text color="error">{unavailableReason}</Text>
        </Box>
      ) : (
        <>
          <Box marginLeft={2} flexDirection="column">
            <Box flexDirection="row" gap={2}>
              <Text bold>Fast mode</Text>
              <Text color={enableFastMode ? 'fastMode' : undefined} bold={enableFastMode}>
                {enableFastMode ? 'ON' : 'OFF'}
              </Text>
              {pricing ? <Text dimColor>{pricing}</Text> : null}
            </Box>
            {provider === 'codex' ? (
              <Text dimColor>Normal or fast, applied to the current Codex target.</Text>
            ) : null}
          </Box>
          {isCooldown ? (
            <Box marginLeft={2}>
              <Text color="warning">
                {runtimeState.reason === 'overloaded'
                  ? 'Fast mode overloaded and is temporarily unavailable'
                  : "You've hit your fast limit"}
                {' · resets in '}
                {formatDuration(runtimeState.resetAt - Date.now(), {
                  hideTrailingZeros: true,
                })}
              </Text>
            </Box>
          ) : null}
          {provider === 'firstParty' ? (
            <Text dimColor>
              Learn more:{' '}
              <Link url="https://code.claude.com/docs/en/fast-mode">
                https://code.claude.com/docs/en/fast-mode
              </Link>
            </Text>
          ) : null}
        </>
      )}
    </Dialog>
  )
}

async function handleFastModeShortcut(options: {
  enable: boolean
  provider: FastModeCommandProvider
  getAppState: () => AppState
  setAppState: (f: (prev: AppState) => AppState) => void
}): Promise<string> {
  const unavailableReason = getFastModeUnavailableReasonForProvider({
    provider: options.provider ?? undefined,
  })
  if (unavailableReason) {
    return `Fast mode unavailable: ${unavailableReason}`
  }

  const appState = options.getAppState()
  const { modelUpdated } = applyFastMode({
    enable: options.enable,
    provider: options.provider,
    targetKey: appState.providerSelectionTargetKey,
    setAppState: options.setAppState,
  })

  logEvent('tengu_fast_mode_toggled', {
    enabled: options.enable,
    source: 'shortcut' as AnalyticsMetadata_I_VERIFIED_THIS_IS_NOT_CODE_OR_FILEPATHS,
  })

  return getFastModeConfirmMessage({
    enable: options.enable,
    provider: options.provider,
    modelUpdated,
  })
}

export async function call(
  onDone: LocalJSXCommandOnDone,
  context: LocalJSXCommandContext,
  args?: string,
): Promise<React.ReactNode | null> {
  const provider = resolveFastModeProvider({
    targetKey: context.getAppState().providerSelectionTargetKey,
  })

  if (!provider || !isFastModeToggleEnabled({ provider })) {
    return null
  }

  if (provider === 'firstParty') {
    await prefetchFastModeStatus()
  }

  const arg = args?.trim().toLowerCase()
  if (arg === 'on' || arg === 'off') {
    const result = await handleFastModeShortcut({
      enable: arg === 'on',
      provider,
      getAppState: context.getAppState,
      setAppState: context.setAppState,
    })
    onDone(result)
    return null
  }

  const unavailableReason = getFastModeUnavailableReasonForProvider({ provider })
  logEvent('tengu_fast_mode_picker_shown', {
    unavailable_reason: (unavailableReason ?? '') as AnalyticsMetadata_I_VERIFIED_THIS_IS_NOT_CODE_OR_FILEPATHS,
  })

  return (
    <FastModePicker
      onDone={onDone}
      provider={provider}
      unavailableReason={unavailableReason}
    />
  )
}

export default FastModePicker
