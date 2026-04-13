import { c as _c } from "react-compiler-runtime";
import React from 'react';
import { Box, Text } from '../../ink.js';
import { SandboxManager } from '../../utils/sandbox/sandbox-adapter.js';
export function SandboxDoctorSection() {
  const $ = _c(2);
  if (!SandboxManager.isSupportedPlatform()) {
    return null;
  }
  if (!SandboxManager.isSandboxEnabledInSettings()) {
    return null;
  }
  let t0;
  let t1;
  if ($[0] === Symbol.for("react.memo_cache_sentinel")) {
    t1 = Symbol.for("react.early_return_sentinel");
    bb0: {
      const depCheck = SandboxManager.checkDependencies();
      const hasErrors = depCheck.errors.length > 0;
      const hasWarnings = depCheck.warnings.length > 0;
      if (!hasErrors && !hasWarnings) {
        t1 = null;
        break bb0;
      }
      const statusColor = hasErrors ? "error" as const : "warning" as const;
      const statusText = hasErrors ? "Missing dependencies" : "Available (with warnings)";
      t0 = <Box flexDirection="column"><Text bold={true}>Sandbox</Text><Text>└ Status: <Text color={statusColor}>{statusText}</Text></Text>{depCheck.errors.map(_temp)}{depCheck.warnings.map(_temp2)}{hasErrors && <Text dimColor={true}>└ Run /sandbox for install instructions</Text>}</Box>;
    }
    $[0] = t0;
    $[1] = t1;
  } else {
    t0 = $[0];
    t1 = $[1];
  }
  if (t1 !== Symbol.for("react.early_return_sentinel")) {
    return t1;
  }
  return t0;
}
function _temp2(w, i_0) {
  return <Text key={i_0} color="warning">└ {w}</Text>;
}
function _temp(e, i) {
  return <Text key={i} color="error">└ {e}</Text>;
}
