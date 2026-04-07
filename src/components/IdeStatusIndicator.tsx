import { c as _c } from "react-compiler-runtime";
import { basename } from 'path';
import * as React from 'react';
import { useIdeConnectionStatus } from '../hooks/useIdeConnectionStatus.js';
import type { IDESelection } from '../hooks/useIdeSelection.js';
import { Text } from '../ink.js';
import type { MCPServerConnection } from '../services/mcp/types.js';
type IdeStatusIndicatorProps = {
  ideSelection: IDESelection | undefined;
  mcpClients?: MCPServerConnection[];
};
export function IdeStatusIndicator(t0) {
  const $ = _c(7);
  const {
    ideSelection,
    mcpClients
  } = t0;
  const {
    status: ideStatus
  } = useIdeConnectionStatus(mcpClients);
  const shouldShowIdeSelection = ideStatus === "connected" && (ideSelection?.filePath || ideSelection?.text && ideSelection.lineCount > 0);
  if (ideStatus === null || !shouldShowIdeSelection || !ideSelection) {
    return null;
  }
  if (ideSelection.text && ideSelection.lineCount > 0) {
    const t1 = ideSelection.lineCount === 1 ? "line" : "lines";
    let t2;
    if ($[0] !== ideSelection.lineCount || $[1] !== t1) {
      t2 = <Text color="ide" key="selection-indicator" wrap="truncate">⧉ {ideSelection.lineCount}{" "}{t1} selected</Text>;
      $[0] = ideSelection.lineCount;
      $[1] = t1;
      $[2] = t2;
    } else {
      t2 = $[2];
    }
    return t2;
  }
  if (ideSelection.filePath) {
    let t1;
    if ($[3] !== ideSelection.filePath) {
      t1 = basename(ideSelection.filePath);
      $[3] = ideSelection.filePath;
      $[4] = t1;
    } else {
      t1 = $[4];
    }
    let t2;
    if ($[5] !== t1) {
      t2 = <Text color="ide" key="selection-indicator" wrap="truncate">⧉ In {t1}</Text>;
      $[5] = t1;
      $[6] = t2;
    } else {
      t2 = $[6];
    }
    return t2;
  }
}
