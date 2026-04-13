import { feature } from 'bun:bundle'
import * as React from 'react'

import { resetCostState } from '../../bootstrap/state.js'
import {
  clearTrustedDeviceToken,
  enrollTrustedDevice,
} from '../../bridge/trustedDevice.js'
import type { LocalJSXCommandContext } from '../../commands.js'
import { ConfigurableShortcutHint } from '../../components/ConfigurableShortcutHint.js'
import {
  ConsoleOAuthFlow,
  type ConsoleOAuthFlowResult,
} from '../../components/ConsoleOAuthFlow.js'
import { Dialog } from '../../components/design-system/Dialog.js'
import { useMainLoopModel } from '../../hooks/useMainLoopModel.js'
import { Text } from '../../ink.js'
import { refreshGrowthBookAfterAuthChange } from '../../services/analytics/growthbook.js'
import { refreshPolicyLimits } from '../../services/policyLimits/index.js'
import { refreshRemoteManagedSettings } from '../../services/remoteManagedSettings/index.js'
import type { LocalJSXCommandOnDone } from '../../types/command.js'
import { stripSignatureBlocks } from '../../utils/messages.js'
import {
  checkAndDisableAutoModeIfNeeded,
  checkAndDisableBypassPermissionsIfNeeded,
  resetAutoModeGateCheck,
  resetBypassPermissionsCheck,
} from '../../utils/permissions/bypassPermissionsKillswitch.js'
import { resetUserCache } from '../../utils/user.js'

type LoginCompletion =
  | ConsoleOAuthFlowResult
  | {
      type: 'cancel'
    }

export async function call(
  onDone: LocalJSXCommandOnDone,
  context: LocalJSXCommandContext,
): Promise<React.ReactNode> {
  return (
    <Login
      onDone={async result => {
        if (result.type === 'cancel') {
          onDone('Login interrupted')
          return
        }

        if (result.type === 'provider-setup') {
          onDone(result.message, { display: 'system' })
          return
        }

        context.onChangeAPIKey()
        // Signature-bearing blocks (thinking, connector_text) are bound to the
        // API key. Strip them so the new key doesn't reject stale signatures.
        context.setMessages(stripSignatureBlocks)

        // Post-login refresh logic. Keep in sync with onboarding in
        // src/interactiveHelpers.tsx.
        resetCostState()
        void refreshRemoteManagedSettings()
        void refreshPolicyLimits()
        resetUserCache()
        refreshGrowthBookAfterAuthChange()

        // Clear any stale trusted device token from a previous account before
        // re-enrolling to avoid sending the old token while enrollment is
        // in flight.
        clearTrustedDeviceToken()
        void enrollTrustedDevice()

        resetBypassPermissionsCheck()
        const appState = context.getAppState()
        void checkAndDisableBypassPermissionsIfNeeded(
          appState.toolPermissionContext,
          context.setAppState,
        )

        if (feature('TRANSCRIPT_CLASSIFIER')) {
          resetAutoModeGateCheck()
          void checkAndDisableAutoModeIfNeeded(
            appState.toolPermissionContext,
            context.setAppState,
            appState.fastMode,
          )
        }

        context.setAppState(prev => ({
          ...prev,
          authVersion: prev.authVersion + 1,
        }))

        onDone('Login successful')
      }}
    />
  )
}

export function Login(props: {
  onDone: (result: LoginCompletion, mainLoopModel: string) => void
  startingMessage?: string
}): React.ReactNode {
  const mainLoopModel = useMainLoopModel()

  return (
    <Dialog
      title="Login"
      onCancel={() => props.onDone({ type: 'cancel' }, mainLoopModel)}
      color="permission"
      inputGuide={exitState =>
        exitState.pending ? (
          <Text>Press {exitState.keyName} again to exit</Text>
        ) : (
          <ConfigurableShortcutHint
            action="confirm:no"
            context="Confirmation"
            fallback="Esc"
            description="cancel"
          />
        )
      }
    >
      <ConsoleOAuthFlow
        onDone={result =>
          props.onDone(result ?? { type: 'cancel' }, mainLoopModel)
        }
        startingMessage={props.startingMessage}
      />
    </Dialog>
  )
}
