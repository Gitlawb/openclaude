import { feature } from 'bun:bundle'
import { toString as qrToString } from 'qrcode'
import * as React from 'react'
import { useEffect, useState } from 'react'
import { getBridgeAccessToken } from '../../bridge/bridgeConfig.js'
import {
  checkBridgeMinVersion,
  getBridgeDisabledReason,
  isEnvLessBridgeEnabled,
} from '../../bridge/bridgeEnabled.js'
import { checkEnvLessBridgeMinVersion } from '../../bridge/envLessBridgeConfig.js'
import {
  BRIDGE_LOGIN_INSTRUCTION,
  REMOTE_CONTROL_DISCONNECTED_MSG,
} from '../../bridge/types.js'
import { Dialog } from '../../components/design-system/Dialog.js'
import { ListItem } from '../../components/design-system/ListItem.js'
import { shouldShowRemoteCallout } from '../../components/RemoteCallout.js'
import { useRegisterOverlay } from '../../context/overlayContext.js'
import { Box, Text } from '../../ink.js'
import { useKeybindings } from '../../keybindings/useKeybinding.js'
import {
  type AnalyticsMetadata_I_VERIFIED_THIS_IS_NOT_CODE_OR_FILEPATHS,
  logEvent,
} from '../../services/analytics/index.js'
import { useAppState, useSetAppState } from '../../state/AppState.js'
import type { ToolUseContext } from '../../Tool.js'
import type {
  LocalJSXCommandContext,
  LocalJSXCommandOnDone,
} from '../../types/command.js'
import { logForDebugging } from '../../utils/debug.js'

type Props = {
  onDone: LocalJSXCommandOnDone
  name?: string
}

function BridgeToggle({ onDone, name }: Props): React.ReactNode {
  const setAppState = useSetAppState()
  const replBridgeConnected = useAppState(s => s.replBridgeConnected)
  const replBridgeEnabled = useAppState(s => s.replBridgeEnabled)
  const replBridgeOutboundOnly = useAppState(s => s.replBridgeOutboundOnly)
  const [showDisconnectDialog, setShowDisconnectDialog] = useState(false)

  useEffect(() => {
    if ((replBridgeConnected || replBridgeEnabled) && !replBridgeOutboundOnly) {
      setShowDisconnectDialog(true)
      return
    }

    let cancelled = false
    void (async () => {
      const error = await checkBridgePrerequisites()
      if (cancelled) return
      if (error) {
        logEvent('tengu_bridge_command', {
          action:
            'preflight_failed' as AnalyticsMetadata_I_VERIFIED_THIS_IS_NOT_CODE_OR_FILEPATHS,
        })
        onDone(error, { display: 'system' })
        return
      }

      if (shouldShowRemoteCallout()) {
        setAppState(prev => {
          if (prev.showRemoteCallout) return prev
          return {
            ...prev,
            showRemoteCallout: true,
            replBridgeInitialName: name,
          }
        })
        onDone('', { display: 'system' })
        return
      }

      logEvent('tengu_bridge_command', {
        action:
          'connect' as AnalyticsMetadata_I_VERIFIED_THIS_IS_NOT_CODE_OR_FILEPATHS,
      })
      setAppState(prev => {
        if (prev.replBridgeEnabled && !prev.replBridgeOutboundOnly) return prev
        return {
          ...prev,
          replBridgeEnabled: true,
          replBridgeExplicit: true,
          replBridgeOutboundOnly: false,
          replBridgeInitialName: name,
        }
      })
      onDone('Remote Control connecting…', {
        display: 'system',
      })
    })()

    return () => {
      cancelled = true
    }
  }, [])

  if (showDisconnectDialog) {
    return <BridgeDisconnectDialog onDone={onDone} />
  }

  return null
}

function BridgeDisconnectDialog({ onDone }: Props): React.ReactNode {
  useRegisterOverlay('bridge-disconnect-dialog')
  const setAppState = useSetAppState()
  const sessionUrl = useAppState(s => s.replBridgeSessionUrl)
  const connectUrl = useAppState(s => s.replBridgeConnectUrl)
  const sessionActive = useAppState(s => s.replBridgeSessionActive)
  const [focusIndex, setFocusIndex] = useState(2)
  const [showQR, setShowQR] = useState(false)
  const [qrText, setQrText] = useState('')

  const displayUrl = sessionActive ? sessionUrl : connectUrl

  useEffect(() => {
    if (!showQR || !displayUrl) {
      setQrText('')
      return
    }
    qrToString(displayUrl, {
      type: 'utf8',
      errorCorrectionLevel: 'L',
      small: true,
    })
      .then(setQrText)
      .catch(() => setQrText(''))
  }, [showQR, displayUrl])

  function handleDisconnect(): void {
    setAppState(prev => {
      if (!prev.replBridgeEnabled) return prev
      return {
        ...prev,
        replBridgeEnabled: false,
        replBridgeExplicit: false,
        replBridgeOutboundOnly: false,
      }
    })
    logEvent('tengu_bridge_command', {
      action:
        'disconnect' as AnalyticsMetadata_I_VERIFIED_THIS_IS_NOT_CODE_OR_FILEPATHS,
    })
    onDone(REMOTE_CONTROL_DISCONNECTED_MSG, { display: 'system' })
  }

  function handleShowQR(): void {
    setShowQR(prev => !prev)
  }

  function handleContinue(): void {
    onDone(undefined, { display: 'skip' })
  }

  const ITEM_COUNT = 3

  useKeybindings(
    {
      'select:next': () => setFocusIndex(i => (i + 1) % ITEM_COUNT),
      'select:previous': () =>
        setFocusIndex(i => (i - 1 + ITEM_COUNT) % ITEM_COUNT),
      'select:accept': () => {
        if (focusIndex === 0) {
          handleDisconnect()
        } else if (focusIndex === 1) {
          handleShowQR()
        } else {
          handleContinue()
        }
      },
    },
    { context: 'Select' },
  )

  const qrLines = qrText ? qrText.split('\n').filter(l => l.length > 0) : []

  return (
    <Dialog title="Remote Control" onCancel={handleContinue} hideInputGuide>
      <Box flexDirection="column" gap={1}>
        <Text>
          This session is available via Remote Control
          {displayUrl ? ` at ${displayUrl}` : ''}.
        </Text>
        {showQR && qrLines.length > 0 && (
          <Box flexDirection="column">
            {qrLines.map((line, i) => (
              <Text key={i}>{line}</Text>
            ))}
          </Box>
        )}
        <Box flexDirection="column">
          <ListItem isFocused={focusIndex === 0}>
            <Text>Disconnect this session</Text>
          </ListItem>
          <ListItem isFocused={focusIndex === 1}>
            <Text>{showQR ? 'Hide QR code' : 'Show QR code'}</Text>
          </ListItem>
          <ListItem isFocused={focusIndex === 2}>
            <Text>Continue</Text>
          </ListItem>
        </Box>
        <Text dimColor>Enter to select · Esc to continue</Text>
      </Box>
    </Dialog>
  )
}

async function checkBridgePrerequisites(): Promise<string | null> {
  const { waitForPolicyLimitsToLoad, isPolicyAllowed } = await import(
    '../../services/policyLimits/index.js'
  )
  await waitForPolicyLimitsToLoad()
  if (!isPolicyAllowed('allow_remote_control')) {
    return "Remote Control is disabled by your organization's policy."
  }

  const disabledReason = await getBridgeDisabledReason()
  if (disabledReason) {
    return disabledReason
  }

  let useV2 = isEnvLessBridgeEnabled()
  if (feature('KAIROS') && useV2) {
    const { isAssistantMode } = await import('../../assistant/index.js')
    if (isAssistantMode()) {
      useV2 = false
    }
  }
  const versionError = useV2
    ? await checkEnvLessBridgeMinVersion()
    : checkBridgeMinVersion()
  if (versionError) {
    return versionError
  }

  if (!getBridgeAccessToken()) {
    return BRIDGE_LOGIN_INSTRUCTION
  }

  logForDebugging('[bridge] Prerequisites passed, enabling bridge')
  return null
}

export async function call(
  onDone: LocalJSXCommandOnDone,
  _context: ToolUseContext & LocalJSXCommandContext,
  args: string,
): Promise<React.ReactNode> {
  const name = args.trim() || undefined
  return <BridgeToggle onDone={onDone} name={name} />
}
