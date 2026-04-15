import { c as _c } from "react-compiler-runtime";
import * as React from 'react';
import { Box, Text } from '../../ink.js';
import { useKeybinding } from '../../keybindings/useKeybinding.js';
import type { PromptRequest } from '../../types/hooks.js';
import { Select } from '../CustomSelect/select.js';
import { PermissionDialog } from '../permissions/PermissionDialog.js';
type Props = {
  title: string;
  toolInputSummary?: string | null;
  request: PromptRequest;
  onRespond: (key: string) => void;
  onAbort: () => void;
};
export function PromptDialog(t0: Props) {
  const $ = _c(15);
  const {
    title,
    toolInputSummary,
    request,
    onRespond,
    onAbort
  } = t0;
  let t1;
  if ($[0] === Symbol.for("react.memo_cache_sentinel")) {
    t1 = {
      isActive: true
    };
    $[0] = t1;
  } else {
    t1 = $[0];
  }
  useKeybinding("app:interrupt", onAbort, t1);
  let t2;
  if ($[1] !== request.options) {
    t2 = request.options.map(_temp);
    $[1] = request.options;
    $[2] = t2;
  } else {
    t2 = $[2];
  }
  const options = t2;
  let t3;
  if ($[3] !== toolInputSummary) {
    t3 = toolInputSummary ? <Text dimColor={true}>{toolInputSummary}</Text> : undefined;
    $[3] = toolInputSummary;
    $[4] = t3;
  } else {
    t3 = $[4];
  }
  let t4;
  if ($[5] !== onRespond) {
    t4 = value => {
      onRespond(value);
    };
    $[5] = onRespond;
    $[6] = t4;
  } else {
    t4 = $[6];
  }
  let t5;
  if ($[7] !== options || $[8] !== t4) {
    t5 = <Box flexDirection="column" paddingY={1}><Select options={options} onChange={t4} /></Box>;
    $[7] = options;
    $[8] = t4;
    $[9] = t5;
  } else {
    t5 = $[9];
  }
  let t6;
  if ($[10] !== request.message || $[11] !== t3 || $[12] !== t5 || $[13] !== title) {
    t6 = <PermissionDialog title={title} subtitle={request.message} titleRight={t3}>{t5}</PermissionDialog>;
    $[10] = request.message;
    $[11] = t3;
    $[12] = t5;
    $[13] = title;
    $[14] = t6;
  } else {
    t6 = $[14];
  }
  return t6;
}
function _temp(opt) {
  return {
    label: opt.label,
    value: opt.key,
    description: opt.description
  };
}
