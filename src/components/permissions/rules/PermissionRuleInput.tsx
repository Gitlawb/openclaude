import { c as _c } from "react-compiler-runtime";
import figures from 'figures';
import * as React from 'react';
import { useState } from 'react';
import TextInput from '../../../components/TextInput.js';
import { useExitOnCtrlCDWithKeybindings } from '../../../hooks/useExitOnCtrlCDWithKeybindings.js';
import { useTerminalSize } from '../../../hooks/useTerminalSize.js';
import { Box, Newline, Text } from '../../../ink.js';
import { useKeybinding } from '../../../keybindings/useKeybinding.js';
import { BashTool } from '../../../tools/BashTool/BashTool.js';
import { WebFetchTool } from '../../../tools/WebFetchTool/WebFetchTool.js';
import type { PermissionBehavior, PermissionRuleValue } from '../../../utils/permissions/PermissionRule.js';
import { permissionRuleValueFromString, permissionRuleValueToString } from '../../../utils/permissions/permissionRuleParser.js';
export type PermissionRuleInputProps = {
  onCancel: () => void;
  onSubmit: (ruleValue: PermissionRuleValue, ruleBehavior: PermissionBehavior) => void;
  ruleBehavior: PermissionBehavior;
};
export function PermissionRuleInput(t0) {
  const $ = _c(24);
  const {
    onCancel,
    onSubmit,
    ruleBehavior
  } = t0;
  const [inputValue, setInputValue] = useState("");
  const [cursorOffset, setCursorOffset] = useState(0);
  const exitState = useExitOnCtrlCDWithKeybindings();
  let t1;
  if ($[0] === Symbol.for("react.memo_cache_sentinel")) {
    t1 = {
      context: "Settings"
    };
    $[0] = t1;
  } else {
    t1 = $[0];
  }
  useKeybinding("confirm:no", onCancel, t1);
  const {
    columns
  } = useTerminalSize();
  const textInputColumns = columns - 6;
  let t2;
  if ($[1] !== onSubmit || $[2] !== ruleBehavior) {
    t2 = value => {
      const trimmedValue = value.trim();
      if (trimmedValue.length === 0) {
        return;
      }
      const ruleValue = permissionRuleValueFromString(trimmedValue);
      onSubmit(ruleValue, ruleBehavior);
    };
    $[1] = onSubmit;
    $[2] = ruleBehavior;
    $[3] = t2;
  } else {
    t2 = $[3];
  }
  const handleSubmit = t2;
  let t3;
  if ($[4] !== ruleBehavior) {
    t3 = <Text bold={true} color="permission">Add {ruleBehavior} permission rule</Text>;
    $[4] = ruleBehavior;
    $[5] = t3;
  } else {
    t3 = $[5];
  }
  let t4;
  if ($[6] === Symbol.for("react.memo_cache_sentinel")) {
    t4 = <Newline />;
    $[6] = t4;
  } else {
    t4 = $[6];
  }
  let t5;
  let t6;
  if ($[7] === Symbol.for("react.memo_cache_sentinel")) {
    t5 = <Text bold={true}>{permissionRuleValueToString({
        toolName: WebFetchTool.name
      })}</Text>;
    t6 = <Text bold={false}> or </Text>;
    $[7] = t5;
    $[8] = t6;
  } else {
    t5 = $[7];
    t6 = $[8];
  }
  let t7;
  if ($[9] === Symbol.for("react.memo_cache_sentinel")) {
    t7 = <Text>Permission rules are a tool name, optionally followed by a specifier in parentheses.{t4}e.g.,{" "}{t5}{t6}<Text bold={true}>{permissionRuleValueToString({
          toolName: BashTool.name,
          ruleContent: "ls:*"
        })}</Text></Text>;
    $[9] = t7;
  } else {
    t7 = $[9];
  }
  let t8;
  if ($[10] !== cursorOffset || $[11] !== handleSubmit || $[12] !== inputValue || $[13] !== textInputColumns) {
    t8 = <Box flexDirection="column">{t7}<Box borderDimColor={true} borderStyle="round" marginY={1} paddingLeft={1}><TextInput showCursor={true} value={inputValue} onChange={setInputValue} onSubmit={handleSubmit} placeholder={`Enter permission rule${figures.ellipsis}`} columns={textInputColumns} cursorOffset={cursorOffset} onChangeCursorOffset={setCursorOffset} /></Box></Box>;
    $[10] = cursorOffset;
    $[11] = handleSubmit;
    $[12] = inputValue;
    $[13] = textInputColumns;
    $[14] = t8;
  } else {
    t8 = $[14];
  }
  let t9;
  if ($[15] !== t3 || $[16] !== t8) {
    t9 = <Box flexDirection="column" gap={1} borderStyle="round" paddingLeft={1} paddingRight={1} borderColor="permission">{t3}{t8}</Box>;
    $[15] = t3;
    $[16] = t8;
    $[17] = t9;
  } else {
    t9 = $[17];
  }
  let t10;
  if ($[18] !== exitState.keyName || $[19] !== exitState.pending) {
    t10 = <Box marginLeft={3}>{exitState.pending ? <Text dimColor={true}>Press {exitState.keyName} again to exit</Text> : <Text dimColor={true}>Enter to submit · Esc to cancel</Text>}</Box>;
    $[18] = exitState.keyName;
    $[19] = exitState.pending;
    $[20] = t10;
  } else {
    t10 = $[20];
  }
  let t11;
  if ($[21] !== t10 || $[22] !== t9) {
    t11 = <>{t9}{t10}</>;
    $[21] = t10;
    $[22] = t9;
    $[23] = t11;
  } else {
    t11 = $[23];
  }
  return t11;
}
