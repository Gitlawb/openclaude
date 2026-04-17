import { c as _c } from "react-compiler-runtime";
import React from 'react';
import { Box, Text } from '../ink.js';
import { getCachedKeybindingWarnings, getKeybindingsPath, isKeybindingCustomizationEnabled } from '../keybindings/loadUserBindings.js';

/**
 * Displays keybinding validation warnings in the UI.
 * Similar to McpParsingWarnings, this provides persistent visibility
 * of configuration issues.
 *
 * Only shown when keybinding customization is enabled (ant users + feature gate).
 */
export function KeybindingWarnings() {
  const $ = _c(2);
  if (!isKeybindingCustomizationEnabled()) {
    return null;
  }
  let t0;
  let t1;
  if ($[0] === Symbol.for("react.memo_cache_sentinel")) {
    t1 = Symbol.for("react.early_return_sentinel");
    bb0: {
      const warnings = getCachedKeybindingWarnings();
      if (warnings.length === 0) {
        t1 = null;
        break bb0;
      }
      const errors = warnings.filter(_temp);
      const warns = warnings.filter(_temp2);
      t0 = <Box flexDirection="column" marginTop={1} marginBottom={1}><Text bold={true} color={errors.length > 0 ? "error" : "warning"}>Проблеми з налаштуванням гарячих клавіш</Text><Box><Text dimColor={true}>Розташування: </Text><Text dimColor={true}>{getKeybindingsPath()}</Text></Box><Box marginLeft={1} flexDirection="column" marginTop={1}>{errors.map(_temp3)}{warns.map(_temp4)}</Box></Box>;
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
function _temp4(warning, i_0) {
  return <Box key={`warning-${i_0}`} flexDirection="column"><Box><Text dimColor={true}>└ </Text><Text color="warning">[Попередження]</Text><Text dimColor={true}> {warning.message}</Text></Box>{warning.suggestion && <Box marginLeft={3}><Text dimColor={true}>→ {warning.suggestion}</Text></Box>}</Box>;
}
function _temp3(error, i) {
  return <Box key={`error-${i}`} flexDirection="column"><Box><Text dimColor={true}>└ </Text><Text color="error">[Помилка]</Text><Text dimColor={true}> {error.message}</Text></Box>{error.suggestion && <Box marginLeft={3}><Text dimColor={true}>→ {error.suggestion}</Text></Box>}</Box>;
}
function _temp2(w_0) {
  return w_0.severity === "warning";
}
function _temp(w) {
  return w.severity === "error";
}
