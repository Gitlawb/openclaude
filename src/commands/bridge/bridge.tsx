import { c as _c } from "react-compiler-runtime";
import { feature } from 'bun:bundle';
import { toString as qrToString } from 'qrcode';
import * as React from 'react';
import { useEffect, useState } from 'react';
import { getBridgeAccessToken } from '../../bridge/bridgeConfig.js';
import { checkBridgeMinVersion, getBridgeDisabledReason, isEnvLessBridgeEnabled } from '../../bridge/bridgeEnabled.js';
import { checkEnvLessBridgeMinVersion } from '../../bridge/envLessBridgeConfig.js';
import { BRIDGE_LOGIN_INSTRUCTION, REMOTE_CONTROL_DISCONNECTED_MSG } from '../../bridge/types.js';
import { Dialog } from '../../components/design-system/Dialog.js';
import { ListItem } from '../../components/design-system/ListItem.js';
import { shouldShowRemoteCallout } from '../../components/RemoteCallout.js';
import { useRegisterOverlay } from '../../context/overlayContext.js';
import { Box, Text } from '../../ink.js';
import { useKeybindings } from '../../keybindings/useKeybinding.js';
import { type AnalyticsMetadata_I_VERIFIED_THIS_IS_NOT_CODE_OR_FILEPATHS, logEvent } from '../../services/analytics/index.js';
import { useAppState, useSetAppState } from '../../state/AppState.js';
import type { ToolUseContext } from '../../Tool.js';
import type { LocalJSXCommandContext, LocalJSXCommandOnDone } from '../../types/command.js';
import { logForDebugging } from '../../utils/debug.js';
type Props = {
  onDone: LocalJSXCommandOnDone;
  name?: string;
};

/**
 * /remote-control command — manages the bidirectional bridge connection.
 *
 * When enabled, sets replBridgeEnabled in AppState, which triggers
 * useReplBridge in REPL.tsx to initialize the bridge connection.
 * The bridge registers an environment, creates a session with the current
 * conversation, polls for work, and connects an ingress WebSocket for
 * bidirectional messaging between the CLI and claude.ai.
 *
 * Running /remote-control when already connected shows a dialog with the session
 * URL and options to disconnect or continue.
 */
function BridgeToggle(t0) {
  const $ = _c(10);
  const {
    onDone,
    name
  } = t0;
  const setAppState = useSetAppState();
  const replBridgeConnected = useAppState(_temp);
  const replBridgeEnabled = useAppState(_temp2);
  const replBridgeOutboundOnly = useAppState(_temp3);
  const [showDisconnectDialog, setShowDisconnectDialog] = useState(false);
  let t1;
  if ($[0] !== name || $[1] !== onDone || $[2] !== replBridgeConnected || $[3] !== replBridgeEnabled || $[4] !== replBridgeOutboundOnly || $[5] !== setAppState) {
    t1 = () => {
      if ((replBridgeConnected || replBridgeEnabled) && !replBridgeOutboundOnly) {
        setShowDisconnectDialog(true);
        return;
      }
      let cancelled = false;
      (async () => {
        const error = await checkBridgePrerequisites();
        if (cancelled) {
          return;
        }
        if (error) {
          logEvent("tengu_bridge_command", {
            action: "preflight_failed" as AnalyticsMetadata_I_VERIFIED_THIS_IS_NOT_CODE_OR_FILEPATHS
          });
          onDone(error, {
            display: "system"
          });
          return;
        }
        if (shouldShowRemoteCallout()) {
          setAppState(prev => {
            if (prev.showRemoteCallout) {
              return prev;
            }
            return {
              ...prev,
              showRemoteCallout: true,
              replBridgeInitialName: name
            };
          });
          onDone("", {
            display: "system"
          });
          return;
        }
        logEvent("tengu_bridge_command", {
          action: "connect" as AnalyticsMetadata_I_VERIFIED_THIS_IS_NOT_CODE_OR_FILEPATHS
        });
        setAppState(prev_0 => {
          if (prev_0.replBridgeEnabled && !prev_0.replBridgeOutboundOnly) {
            return prev_0;
          }
          return {
            ...prev_0,
            replBridgeEnabled: true,
            replBridgeExplicit: true,
            replBridgeOutboundOnly: false,
            replBridgeInitialName: name
          };
        });
        onDone("Remote Control connecting\u2026", {
          display: "system"
        });
      })();
      return () => {
        cancelled = true;
      };
    };
    $[0] = name;
    $[1] = onDone;
    $[2] = replBridgeConnected;
    $[3] = replBridgeEnabled;
    $[4] = replBridgeOutboundOnly;
    $[5] = setAppState;
    $[6] = t1;
  } else {
    t1 = $[6];
  }
  let t2;
  if ($[7] === Symbol.for("react.memo_cache_sentinel")) {
    t2 = [];
    $[7] = t2;
  } else {
    t2 = $[7];
  }
  useEffect(t1, t2);
  if (showDisconnectDialog) {
    let t3;
    if ($[8] !== onDone) {
      t3 = <BridgeDisconnectDialog onDone={onDone} />;
      $[8] = onDone;
      $[9] = t3;
    } else {
      t3 = $[9];
    }
    return t3;
  }
  return null;
}

/**
 * Dialog shown when /remote-control is used while the bridge is already connected.
 * Shows the session URL and lets the user disconnect or continue.
 */
function _temp3(s_1) {
  return s_1.replBridgeOutboundOnly;
}
function _temp2(s_0) {
  return s_0.replBridgeEnabled;
}
function _temp(s) {
  return s.replBridgeConnected;
}
function BridgeDisconnectDialog(t0) {
  const $ = _c(61);
  const {
    onDone
  } = t0;
  useRegisterOverlay("bridge-disconnect-dialog");
  const setAppState = useSetAppState();
  const sessionUrl = useAppState(_temp4);
  const connectUrl = useAppState(_temp5);
  const sessionActive = useAppState(_temp6);
  const [focusIndex, setFocusIndex] = useState(2);
  const [showQR, setShowQR] = useState(false);
  const [qrText, setQrText] = useState("");
  const displayUrl = sessionActive ? sessionUrl : connectUrl;
  let t1;
  let t2;
  if ($[0] !== displayUrl || $[1] !== showQR) {
    t1 = () => {
      if (!showQR || !displayUrl) {
        setQrText("");
        return;
      }
      qrToString(displayUrl, {
        type: "utf8",
        errorCorrectionLevel: "L",
        small: true
      }).then(setQrText).catch(() => setQrText(""));
    };
    t2 = [showQR, displayUrl];
    $[0] = displayUrl;
    $[1] = showQR;
    $[2] = t1;
    $[3] = t2;
  } else {
    t1 = $[2];
    t2 = $[3];
  }
  useEffect(t1, t2);
  let t3;
  if ($[4] !== onDone || $[5] !== setAppState) {
    t3 = function handleDisconnect() {
      setAppState(_temp7);
      logEvent("tengu_bridge_command", {
        action: "disconnect" as AnalyticsMetadata_I_VERIFIED_THIS_IS_NOT_CODE_OR_FILEPATHS
      });
      onDone(REMOTE_CONTROL_DISCONNECTED_MSG, {
        display: "system"
      });
    };
    $[4] = onDone;
    $[5] = setAppState;
    $[6] = t3;
  } else {
    t3 = $[6];
  }
  const handleDisconnect = t3;
  let t4;
  if ($[7] === Symbol.for("react.memo_cache_sentinel")) {
    t4 = function handleShowQR() {
      setShowQR(_temp8);
    };
    $[7] = t4;
  } else {
    t4 = $[7];
  }
  const handleShowQR = t4;
  let t5;
  if ($[8] !== onDone) {
    t5 = function handleContinue() {
      onDone(undefined, {
        display: "skip"
      });
    };
    $[8] = onDone;
    $[9] = t5;
  } else {
    t5 = $[9];
  }
  const handleContinue = t5;
  let t6;
  let t7;
  if ($[10] === Symbol.for("react.memo_cache_sentinel")) {
    t6 = () => setFocusIndex(_temp9);
    t7 = () => setFocusIndex(_temp0);
    $[10] = t6;
    $[11] = t7;
  } else {
    t6 = $[10];
    t7 = $[11];
  }
  let t8;
  if ($[12] !== focusIndex || $[13] !== handleContinue || $[14] !== handleDisconnect) {
    t8 = {
      "select:next": t6,
      "select:previous": t7,
      "select:accept": () => {
        if (focusIndex === 0) {
          handleDisconnect();
        } else {
          if (focusIndex === 1) {
            handleShowQR();
          } else {
            handleContinue();
          }
        }
      }
    };
    $[12] = focusIndex;
    $[13] = handleContinue;
    $[14] = handleDisconnect;
    $[15] = t8;
  } else {
    t8 = $[15];
  }
  let t9;
  if ($[16] === Symbol.for("react.memo_cache_sentinel")) {
    t9 = {
      context: "Select"
    };
    $[16] = t9;
  } else {
    t9 = $[16];
  }
  useKeybindings(t8, t9);
  let T0;
  let T1;
  let t10;
  let t11;
  let t12;
  let t13;
  let t14;
  let t15;
  let t16;
  if ($[17] !== displayUrl || $[18] !== handleContinue || $[19] !== qrText || $[20] !== showQR) {
    const qrLines = qrText ? qrText.split("\n").filter(_temp1) : [];
    T1 = Dialog;
    t14 = "Remote Control";
    t15 = handleContinue;
    t16 = true;
    T0 = Box;
    t10 = "column";
    t11 = 1;
    const t17 = displayUrl ? ` at ${displayUrl}` : "";
    if ($[30] !== t17) {
      t12 = <Text>This session is available via Remote Control{t17}.</Text>;
      $[30] = t17;
      $[31] = t12;
    } else {
      t12 = $[31];
    }
    t13 = showQR && qrLines.length > 0 && <Box flexDirection="column">{qrLines.map(_temp10)}</Box>;
    $[17] = displayUrl;
    $[18] = handleContinue;
    $[19] = qrText;
    $[20] = showQR;
    $[21] = T0;
    $[22] = T1;
    $[23] = t10;
    $[24] = t11;
    $[25] = t12;
    $[26] = t13;
    $[27] = t14;
    $[28] = t15;
    $[29] = t16;
  } else {
    T0 = $[21];
    T1 = $[22];
    t10 = $[23];
    t11 = $[24];
    t12 = $[25];
    t13 = $[26];
    t14 = $[27];
    t15 = $[28];
    t16 = $[29];
  }
  const t17 = focusIndex === 0;
  let t18;
  if ($[32] === Symbol.for("react.memo_cache_sentinel")) {
    t18 = <Text>Disconnect this session</Text>;
    $[32] = t18;
  } else {
    t18 = $[32];
  }
  let t19;
  if ($[33] !== t17) {
    t19 = <ListItem isFocused={t17}>{t18}</ListItem>;
    $[33] = t17;
    $[34] = t19;
  } else {
    t19 = $[34];
  }
  const t20 = focusIndex === 1;
  const t21 = showQR ? "Hide QR code" : "Show QR code";
  let t22;
  if ($[35] !== t21) {
    t22 = <Text>{t21}</Text>;
    $[35] = t21;
    $[36] = t22;
  } else {
    t22 = $[36];
  }
  let t23;
  if ($[37] !== t20 || $[38] !== t22) {
    t23 = <ListItem isFocused={t20}>{t22}</ListItem>;
    $[37] = t20;
    $[38] = t22;
    $[39] = t23;
  } else {
    t23 = $[39];
  }
  const t24 = focusIndex === 2;
  let t25;
  if ($[40] === Symbol.for("react.memo_cache_sentinel")) {
    t25 = <Text>Continue</Text>;
    $[40] = t25;
  } else {
    t25 = $[40];
  }
  let t26;
  if ($[41] !== t24) {
    t26 = <ListItem isFocused={t24}>{t25}</ListItem>;
    $[41] = t24;
    $[42] = t26;
  } else {
    t26 = $[42];
  }
  let t27;
  if ($[43] !== t19 || $[44] !== t23 || $[45] !== t26) {
    t27 = <Box flexDirection="column">{t19}{t23}{t26}</Box>;
    $[43] = t19;
    $[44] = t23;
    $[45] = t26;
    $[46] = t27;
  } else {
    t27 = $[46];
  }
  let t28;
  if ($[47] === Symbol.for("react.memo_cache_sentinel")) {
    t28 = <Text dimColor={true}>Enter to select · Esc to continue</Text>;
    $[47] = t28;
  } else {
    t28 = $[47];
  }
  let t29;
  if ($[48] !== T0 || $[49] !== t10 || $[50] !== t11 || $[51] !== t12 || $[52] !== t13 || $[53] !== t27) {
    t29 = <T0 flexDirection={t10} gap={t11}>{t12}{t13}{t27}{t28}</T0>;
    $[48] = T0;
    $[49] = t10;
    $[50] = t11;
    $[51] = t12;
    $[52] = t13;
    $[53] = t27;
    $[54] = t29;
  } else {
    t29 = $[54];
  }
  let t30;
  if ($[55] !== T1 || $[56] !== t14 || $[57] !== t15 || $[58] !== t16 || $[59] !== t29) {
    t30 = <T1 title={t14} onCancel={t15} hideInputGuide={t16}>{t29}</T1>;
    $[55] = T1;
    $[56] = t14;
    $[57] = t15;
    $[58] = t16;
    $[59] = t29;
    $[60] = t30;
  } else {
    t30 = $[60];
  }
  return t30;
}

/**
 * Check bridge prerequisites. Returns an error message if a precondition
 * fails, or null if all checks pass. Awaits GrowthBook init if the disk
 * cache is stale, so a user who just became entitled (e.g. upgraded to Max,
 * or the flag just launched) gets an accurate result on the first try.
 */
function _temp10(line, i_1) {
  return <Text key={i_1}>{line}</Text>;
}
function _temp1(l) {
  return l.length > 0;
}
function _temp0(i_0) {
  return (i_0 - 1 + 3) % 3;
}
function _temp9(i) {
  return (i + 1) % 3;
}
function _temp8(prev_0) {
  return !prev_0;
}
function _temp7(prev) {
  if (!prev.replBridgeEnabled) {
    return prev;
  }
  return {
    ...prev,
    replBridgeEnabled: false,
    replBridgeExplicit: false,
    replBridgeOutboundOnly: false
  };
}
function _temp6(s_1) {
  return s_1.replBridgeSessionActive;
}
function _temp5(s_0) {
  return s_0.replBridgeConnectUrl;
}
function _temp4(s) {
  return s.replBridgeSessionUrl;
}
async function checkBridgePrerequisites(): Promise<string | null> {
  // Check organization policy — remote control may be disabled
  const {
    waitForPolicyLimitsToLoad,
    isPolicyAllowed
  } = await import('../../services/policyLimits/index.js');
  await waitForPolicyLimitsToLoad();
  if (!isPolicyAllowed('allow_remote_control')) {
    return "Remote Control is disabled by your organization's policy.";
  }
  const disabledReason = await getBridgeDisabledReason();
  if (disabledReason) {
    return disabledReason;
  }

  // Mirror the v1/v2 branching logic in initReplBridge: env-less (v2) is used
  // only when the flag is on AND the session is not perpetual.  In assistant
  // mode (KAIROS) useReplBridge sets perpetual=true, which forces
  // initReplBridge onto the v1 path — so the prerequisite check must match.
  let useV2 = isEnvLessBridgeEnabled();
  if (feature('KAIROS') && useV2) {
    const {
      isAssistantMode
    } = await import('../../assistant/index.js');
    if (isAssistantMode()) {
      useV2 = false;
    }
  }
  const versionError = useV2 ? await checkEnvLessBridgeMinVersion() : checkBridgeMinVersion();
  if (versionError) {
    return versionError;
  }
  if (!getBridgeAccessToken()) {
    return BRIDGE_LOGIN_INSTRUCTION;
  }
  logForDebugging('[bridge] Prerequisites passed, enabling bridge');
  return null;
}
export async function call(onDone: LocalJSXCommandOnDone, _context: ToolUseContext & LocalJSXCommandContext, args: string): Promise<React.ReactNode> {
  const name = args.trim() || undefined;
  return <BridgeToggle onDone={onDone} name={name} />;
}
