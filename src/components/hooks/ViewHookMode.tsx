import { c as _c } from "react-compiler-runtime";
/**
 * ViewHookMode shows read-only details for a single configured hook.
 *
 * The /hooks menu is read-only; this view replaces the former delete-hook
 * confirmation screen and directs users to settings.json or Claude for edits.
 */
import * as React from 'react';
import { PRODUCT_DISPLAY_NAME } from '../../constants/product.js';
import { Box, Text } from '../../ink.js';
import { hookSourceDescriptionDisplayString, type IndividualHookConfig } from '../../utils/hooks/hooksSettings.js';
import { Dialog } from '../design-system/Dialog.js';
type Props = {
  selectedHook: IndividualHookConfig;
  eventSupportsMatcher: boolean;
  onCancel: () => void;
};
export function ViewHookMode(t0) {
  const $ = _c(40);
  const {
    selectedHook,
    eventSupportsMatcher,
    onCancel
  } = t0;
  let t1;
  if ($[0] !== selectedHook.event) {
    t1 = <Text>Event: <Text bold={true}>{selectedHook.event}</Text></Text>;
    $[0] = selectedHook.event;
    $[1] = t1;
  } else {
    t1 = $[1];
  }
  let t2;
  if ($[2] !== eventSupportsMatcher || $[3] !== selectedHook.matcher) {
    t2 = eventSupportsMatcher && <Text>Matcher: <Text bold={true}>{selectedHook.matcher || "(all)"}</Text></Text>;
    $[2] = eventSupportsMatcher;
    $[3] = selectedHook.matcher;
    $[4] = t2;
  } else {
    t2 = $[4];
  }
  let t3;
  if ($[5] !== selectedHook.config.type) {
    t3 = <Text>Type: <Text bold={true}>{selectedHook.config.type}</Text></Text>;
    $[5] = selectedHook.config.type;
    $[6] = t3;
  } else {
    t3 = $[6];
  }
  let t4;
  if ($[7] !== selectedHook.source) {
    t4 = hookSourceDescriptionDisplayString(selectedHook.source);
    $[7] = selectedHook.source;
    $[8] = t4;
  } else {
    t4 = $[8];
  }
  let t5;
  if ($[9] !== t4) {
    t5 = <Text>Source:{" "}<Text dimColor={true}>{t4}</Text></Text>;
    $[9] = t4;
    $[10] = t5;
  } else {
    t5 = $[10];
  }
  let t6;
  if ($[11] !== selectedHook.pluginName) {
    t6 = selectedHook.pluginName && <Text>Plugin: <Text dimColor={true}>{selectedHook.pluginName}</Text></Text>;
    $[11] = selectedHook.pluginName;
    $[12] = t6;
  } else {
    t6 = $[12];
  }
  let t7;
  if ($[13] !== t1 || $[14] !== t2 || $[15] !== t3 || $[16] !== t5 || $[17] !== t6) {
    t7 = <Box flexDirection="column">{t1}{t2}{t3}{t5}{t6}</Box>;
    $[13] = t1;
    $[14] = t2;
    $[15] = t3;
    $[16] = t5;
    $[17] = t6;
    $[18] = t7;
  } else {
    t7 = $[18];
  }
  let t8;
  if ($[19] !== selectedHook.config) {
    t8 = getContentFieldLabel(selectedHook.config);
    $[19] = selectedHook.config;
    $[20] = t8;
  } else {
    t8 = $[20];
  }
  let t9;
  if ($[21] !== t8) {
    t9 = <Text dimColor={true}>{t8}:</Text>;
    $[21] = t8;
    $[22] = t9;
  } else {
    t9 = $[22];
  }
  let t10;
  if ($[23] !== selectedHook.config) {
    t10 = getContentFieldValue(selectedHook.config);
    $[23] = selectedHook.config;
    $[24] = t10;
  } else {
    t10 = $[24];
  }
  let t11;
  if ($[25] !== t10) {
    t11 = <Box borderStyle="round" borderDimColor={true} paddingLeft={1} paddingRight={1}><Text>{t10}</Text></Box>;
    $[25] = t10;
    $[26] = t11;
  } else {
    t11 = $[26];
  }
  let t12;
  if ($[27] !== t11 || $[28] !== t9) {
    t12 = <Box flexDirection="column">{t9}{t11}</Box>;
    $[27] = t11;
    $[28] = t9;
    $[29] = t12;
  } else {
    t12 = $[29];
  }
  let t13;
  if ($[30] !== selectedHook.config) {
    t13 = "statusMessage" in selectedHook.config && selectedHook.config.statusMessage && <Text>Status message:{" "}<Text dimColor={true}>{selectedHook.config.statusMessage}</Text></Text>;
    $[30] = selectedHook.config;
    $[31] = t13;
  } else {
    t13 = $[31];
  }
  let t14;
  if ($[32] === Symbol.for("react.memo_cache_sentinel")) {
    t14 = <Text dimColor={true}>To modify or remove this hook, edit settings.json directly or ask {PRODUCT_DISPLAY_NAME} to help.</Text>;
    $[32] = t14;
  } else {
    t14 = $[32];
  }
  let t15;
  if ($[33] !== t12 || $[34] !== t13 || $[35] !== t7) {
    t15 = <Box flexDirection="column" gap={1}>{t7}{t12}{t13}{t14}</Box>;
    $[33] = t12;
    $[34] = t13;
    $[35] = t7;
    $[36] = t15;
  } else {
    t15 = $[36];
  }
  let t16;
  if ($[37] !== onCancel || $[38] !== t15) {
    t16 = <Dialog title="Hook details" onCancel={onCancel} inputGuide={_temp}>{t15}</Dialog>;
    $[37] = onCancel;
    $[38] = t15;
    $[39] = t16;
  } else {
    t16 = $[39];
  }
  return t16;
}

/**
 * Get a human-readable label for the primary content field of a hook
 * based on its type.
 */
function _temp() {
  return <Text>Esc to go back</Text>;
}
function getContentFieldLabel(config: IndividualHookConfig['config']): string {
  switch (config.type) {
    case 'command':
      return 'Command';
    case 'prompt':
      return 'Prompt';
    case 'agent':
      return 'Prompt';
    case 'http':
      return 'URL';
  }
}

/**
 * Get the actual content value for a hook's primary field, bypassing
 * statusMessage so the detail view always shows the real command/prompt/URL.
 */
function getContentFieldValue(config: IndividualHookConfig['config']): string {
  switch (config.type) {
    case 'command':
      return config.command;
    case 'prompt':
      return config.prompt;
    case 'agent':
      return config.prompt;
    case 'http':
      return config.url;
  }
}
