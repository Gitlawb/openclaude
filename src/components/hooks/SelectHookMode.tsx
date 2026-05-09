import { c as _c } from "react-compiler-runtime";
/**
 * SelectHookMode shows all hooks configured for a given event+matcher pair.
 *
 * The /hooks menu is read-only: this view no longer offers "add new hook"
 * and selecting a hook shows its read-only details instead of a delete
 * confirmation.
 */
import * as React from 'react';
import { PRODUCT_DISPLAY_NAME } from '../../constants/product.js';
import type { HookEvent } from 'src/entrypoints/agentSdkTypes.js';
import type { HookEventMetadata } from 'src/utils/hooks/hooksConfigManager.js';
import { Box, Text } from '../../ink.js';
import { getHookDisplayText, hookSourceHeaderDisplayString, type IndividualHookConfig } from '../../utils/hooks/hooksSettings.js';
import { Select } from '../CustomSelect/select.js';
import { Dialog } from '../design-system/Dialog.js';
type Props = {
  selectedEvent: HookEvent;
  selectedMatcher: string | null;
  hooksForSelectedMatcher: IndividualHookConfig[];
  hookEventMetadata: HookEventMetadata;
  onSelect: (hook: IndividualHookConfig) => void;
  onCancel: () => void;
};
export function SelectHookMode(t0) {
  const $ = _c(19);
  const {
    selectedEvent,
    selectedMatcher,
    hooksForSelectedMatcher,
    hookEventMetadata,
    onSelect,
    onCancel
  } = t0;
  const title = hookEventMetadata.matcherMetadata !== undefined ? `${selectedEvent} - Matcher: ${selectedMatcher || "(all)"}` : selectedEvent;
  if (hooksForSelectedMatcher.length === 0) {
    let t1;
    if ($[0] === Symbol.for("react.memo_cache_sentinel")) {
      t1 = <Box flexDirection="column" gap={1}><Text dimColor={true}>No hooks configured for this event.</Text><Text dimColor={true}>To add hooks, edit settings.json directly or ask {PRODUCT_DISPLAY_NAME}.</Text></Box>;
      $[0] = t1;
    } else {
      t1 = $[0];
    }
    let t2;
    if ($[1] !== hookEventMetadata.description || $[2] !== onCancel || $[3] !== title) {
      t2 = <Dialog title={title} subtitle={hookEventMetadata.description} onCancel={onCancel} inputGuide={_temp}>{t1}</Dialog>;
      $[1] = hookEventMetadata.description;
      $[2] = onCancel;
      $[3] = title;
      $[4] = t2;
    } else {
      t2 = $[4];
    }
    return t2;
  }
  const t1 = hookEventMetadata.description;
  let t2;
  if ($[5] !== hooksForSelectedMatcher) {
    t2 = hooksForSelectedMatcher.map(_temp2);
    $[5] = hooksForSelectedMatcher;
    $[6] = t2;
  } else {
    t2 = $[6];
  }
  let t3;
  if ($[7] !== hooksForSelectedMatcher || $[8] !== onSelect) {
    t3 = value => {
      const index_0 = parseInt(value, 10);
      const hook_0 = hooksForSelectedMatcher[index_0];
      if (hook_0) {
        onSelect(hook_0);
      }
    };
    $[7] = hooksForSelectedMatcher;
    $[8] = onSelect;
    $[9] = t3;
  } else {
    t3 = $[9];
  }
  let t4;
  if ($[10] !== onCancel || $[11] !== t2 || $[12] !== t3) {
    t4 = <Box flexDirection="column"><Select options={t2} onChange={t3} onCancel={onCancel} /></Box>;
    $[10] = onCancel;
    $[11] = t2;
    $[12] = t3;
    $[13] = t4;
  } else {
    t4 = $[13];
  }
  let t5;
  if ($[14] !== hookEventMetadata.description || $[15] !== onCancel || $[16] !== t4 || $[17] !== title) {
    t5 = <Dialog title={title} subtitle={t1} onCancel={onCancel}>{t4}</Dialog>;
    $[14] = hookEventMetadata.description;
    $[15] = onCancel;
    $[16] = t4;
    $[17] = title;
    $[18] = t5;
  } else {
    t5 = $[18];
  }
  return t5;
}
function _temp2(hook, index) {
  return {
    label: `[${hook.config.type}] ${getHookDisplayText(hook.config)}`,
    value: index.toString(),
    description: hook.source === "pluginHook" && hook.pluginName ? `${hookSourceHeaderDisplayString(hook.source)} (${hook.pluginName})` : hookSourceHeaderDisplayString(hook.source)
  };
}
function _temp() {
  return <Text>Esc to go back</Text>;
}
