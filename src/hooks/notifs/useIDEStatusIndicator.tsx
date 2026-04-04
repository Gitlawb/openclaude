import { c as _c } from "react-compiler-runtime";
import React, { useEffect, useRef } from 'react';
import { useNotifications } from 'src/context/notifications.js';
import { Text } from 'src/ink.js';
import type { MCPServerConnection } from 'src/services/mcp/types.js';
import { getGlobalConfig, saveGlobalConfig } from 'src/utils/config.js';
import { detectIDEs, type IDEExtensionInstallationStatus, isJetBrainsIde, isSupportedTerminal } from 'src/utils/ide.js';
import { getIsRemoteMode } from '../../bootstrap/state.js';
import { useIdeConnectionStatus } from '../useIdeConnectionStatus.js';
import type { IDESelection } from '../useIdeSelection.js';
const MAX_IDE_HINT_SHOW_COUNT = 5;
type Props = {
  ideInstallationStatus: IDEExtensionInstallationStatus | null;
  ideSelection: IDESelection | undefined;
  mcpClients: MCPServerConnection[];
};
export function useIDEStatusIndicator(t0) {
  const $ = _c(26);
  const {
    ideSelection,
    mcpClients,
    ideInstallationStatus
  } = t0;
  const {
    addNotification,
    removeNotification
  } = useNotifications();
  const {
    status: ideStatus,
    ideName
  } = useIdeConnectionStatus(mcpClients);
  const hasShownHintRef = useRef(false);
  let t1;
  if ($[0] !== ideInstallationStatus) {
    t1 = ideInstallationStatus ? isJetBrainsIde(ideInstallationStatus?.ideType) : false;
    $[0] = ideInstallationStatus;
    $[1] = t1;
  } else {
    t1 = $[1];
  }
  const isJetBrains = t1;
  const showIDEInstallErrorOrJetBrainsInfo = ideInstallationStatus?.error || isJetBrains;
  const shouldShowIdeSelection = ideStatus === "connected" && (ideSelection?.filePath || ideSelection?.text && ideSelection.lineCount > 0);
  const shouldShowConnected = ideStatus === "connected" && !shouldShowIdeSelection;
  const showIDEInstallError = showIDEInstallErrorOrJetBrainsInfo && !isJetBrains && !shouldShowConnected && !shouldShowIdeSelection;
  const showJetBrainsInfo = showIDEInstallErrorOrJetBrainsInfo && isJetBrains && !shouldShowConnected && !shouldShowIdeSelection;
  let t2;
  let t3;
  if ($[2] !== addNotification || $[3] !== ideStatus || $[4] !== removeNotification || $[5] !== showJetBrainsInfo) {
    t2 = () => {
      if (getIsRemoteMode()) {
        return;
      }
      if (isSupportedTerminal() || ideStatus !== null || showJetBrainsInfo) {
        removeNotification("ide-status-hint");
        return;
      }
      if (hasShownHintRef.current || (getGlobalConfig().ideHintShownCount ?? 0) >= MAX_IDE_HINT_SHOW_COUNT) {
        return;
      }
      const timeoutId = setTimeout(_temp2, 3000, hasShownHintRef, addNotification);
      return () => clearTimeout(timeoutId);
    };
    t3 = [addNotification, removeNotification, ideStatus, showJetBrainsInfo];
    $[2] = addNotification;
    $[3] = ideStatus;
    $[4] = removeNotification;
    $[5] = showJetBrainsInfo;
    $[6] = t2;
    $[7] = t3;
  } else {
    t2 = $[6];
    t3 = $[7];
  }
  useEffect(t2, t3);
  let t4;
  let t5;
  if ($[8] !== addNotification || $[9] !== ideName || $[10] !== ideStatus || $[11] !== removeNotification || $[12] !== showIDEInstallError || $[13] !== showJetBrainsInfo) {
    t4 = () => {
      if (getIsRemoteMode()) {
        return;
      }
      if (showIDEInstallError || showJetBrainsInfo || ideStatus !== "disconnected" || !ideName) {
        removeNotification("ide-status-disconnected");
        return;
      }
      addNotification({
        key: "ide-status-disconnected",
        text: `${ideName} disconnected`,
        color: "error",
        priority: "medium"
      });
    };
    t5 = [addNotification, removeNotification, ideStatus, ideName, showIDEInstallError, showJetBrainsInfo];
    $[8] = addNotification;
    $[9] = ideName;
    $[10] = ideStatus;
    $[11] = removeNotification;
    $[12] = showIDEInstallError;
    $[13] = showJetBrainsInfo;
    $[14] = t4;
    $[15] = t5;
  } else {
    t4 = $[14];
    t5 = $[15];
  }
  useEffect(t4, t5);
  let t6;
  let t7;
  if ($[16] !== addNotification || $[17] !== removeNotification || $[18] !== showJetBrainsInfo) {
    t6 = () => {
      if (getIsRemoteMode()) {
        return;
      }
      if (!showJetBrainsInfo) {
        removeNotification("ide-status-jetbrains-disconnected");
        return;
      }
      addNotification({
        key: "ide-status-jetbrains-disconnected",
        text: "IDE plugin not connected \xB7 /status for info",
        priority: "medium"
      });
    };
    t7 = [addNotification, removeNotification, showJetBrainsInfo];
    $[16] = addNotification;
    $[17] = removeNotification;
    $[18] = showJetBrainsInfo;
    $[19] = t6;
    $[20] = t7;
  } else {
    t6 = $[19];
    t7 = $[20];
  }
  useEffect(t6, t7);
  let t8;
  let t9;
  if ($[21] !== addNotification || $[22] !== removeNotification || $[23] !== showIDEInstallError) {
    t8 = () => {
      if (getIsRemoteMode()) {
        return;
      }
      if (!showIDEInstallError) {
        removeNotification("ide-status-install-error");
        return;
      }
      addNotification({
        key: "ide-status-install-error",
        text: "IDE extension install failed (see /status for info)",
        color: "error",
        priority: "medium"
      });
    };
    t9 = [addNotification, removeNotification, showIDEInstallError];
    $[21] = addNotification;
    $[22] = removeNotification;
    $[23] = showIDEInstallError;
    $[24] = t8;
    $[25] = t9;
  } else {
    t8 = $[24];
    t9 = $[25];
  }
  useEffect(t8, t9);
}
function _temp2(hasShownHintRef_0, addNotification_0) {
  detectIDEs(true).then(infos => {
    const ideName_0 = infos[0]?.name;
    if (ideName_0 && !hasShownHintRef_0.current) {
      hasShownHintRef_0.current = true;
      saveGlobalConfig(_temp);
      addNotification_0({
        key: "ide-status-hint",
        jsx: <Text dimColor={true}>/ide for <Text color="ide">{ideName_0}</Text></Text>,
        priority: "low"
      });
    }
  });
}
function _temp(current) {
  return {
    ...current,
    ideHintShownCount: (current.ideHintShownCount ?? 0) + 1
  };
}
