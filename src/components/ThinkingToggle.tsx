import { c as _c } from "react-compiler-runtime";
import * as React from 'react';
import { useState } from 'react';
import { useExitOnCtrlCDWithKeybindings } from 'src/hooks/useExitOnCtrlCDWithKeybindings.js';
import { Box, Text } from '../ink.js';
import { useKeybinding } from '../keybindings/useKeybinding.js';
import { ConfigurableShortcutHint } from './ConfigurableShortcutHint.js';
import { Select } from './CustomSelect/index.js';
import { Byline } from './design-system/Byline.js';
import { KeyboardShortcutHint } from './design-system/KeyboardShortcutHint.js';
import { Pane } from './design-system/Pane.js';
export type Props = {
  currentValue: boolean;
  onSelect: (enabled: boolean) => void;
  onCancel?: () => void;
  isMidConversation?: boolean;
};
export function ThinkingToggle(t0) {
  const $ = _c(27);
  const {
    currentValue,
    onSelect,
    onCancel,
    isMidConversation
  } = t0;
  const exitState = useExitOnCtrlCDWithKeybindings();
  const [confirmationPending, setConfirmationPending] = useState(null);
  let t1;
  if ($[0] === Symbol.for("react.memo_cache_sentinel")) {
    t1 = [{
      value: "true",
      label: "Enabled",
      description: "Claude will think before responding"
    }, {
      value: "false",
      label: "Disabled",
      description: "Claude will respond without extended thinking"
    }];
    $[0] = t1;
  } else {
    t1 = $[0];
  }
  const options = t1;
  let t2;
  if ($[1] !== confirmationPending || $[2] !== onCancel) {
    t2 = () => {
      if (confirmationPending !== null) {
        setConfirmationPending(null);
      } else {
        onCancel?.();
      }
    };
    $[1] = confirmationPending;
    $[2] = onCancel;
    $[3] = t2;
  } else {
    t2 = $[3];
  }
  let t3;
  if ($[4] === Symbol.for("react.memo_cache_sentinel")) {
    t3 = {
      context: "Confirmation"
    };
    $[4] = t3;
  } else {
    t3 = $[4];
  }
  useKeybinding("confirm:no", t2, t3);
  let t4;
  if ($[5] !== confirmationPending || $[6] !== onSelect) {
    t4 = () => {
      if (confirmationPending !== null) {
        onSelect(confirmationPending);
      }
    };
    $[5] = confirmationPending;
    $[6] = onSelect;
    $[7] = t4;
  } else {
    t4 = $[7];
  }
  const t5 = confirmationPending !== null;
  let t6;
  if ($[8] !== t5) {
    t6 = {
      context: "Confirmation",
      isActive: t5
    };
    $[8] = t5;
    $[9] = t6;
  } else {
    t6 = $[9];
  }
  useKeybinding("confirm:yes", t4, t6);
  let t7;
  if ($[10] !== currentValue || $[11] !== isMidConversation || $[12] !== onSelect) {
    t7 = function handleSelectChange(value) {
      const selected = value === "true";
      if (isMidConversation && selected !== currentValue) {
        setConfirmationPending(selected);
      } else {
        onSelect(selected);
      }
    };
    $[10] = currentValue;
    $[11] = isMidConversation;
    $[12] = onSelect;
    $[13] = t7;
  } else {
    t7 = $[13];
  }
  const handleSelectChange = t7;
  let t8;
  if ($[14] === Symbol.for("react.memo_cache_sentinel")) {
    t8 = <Box marginBottom={1} flexDirection="column"><Text color="remember" bold={true}>Toggle thinking mode</Text><Text dimColor={true}>Enable or disable thinking for this session.</Text></Box>;
    $[14] = t8;
  } else {
    t8 = $[14];
  }
  let t9;
  if ($[15] !== confirmationPending || $[16] !== currentValue || $[17] !== handleSelectChange || $[18] !== onCancel) {
    t9 = <Box flexDirection="column">{t8}{confirmationPending !== null ? <Box flexDirection="column" marginBottom={1} gap={1}><Text color="warning">Changing thinking mode mid-conversation will increase latency and may reduce quality. For best results, set this at the start of a session.</Text><Text color="warning">Do you want to proceed?</Text></Box> : <Box flexDirection="column" marginBottom={1}><Select defaultValue={currentValue ? "true" : "false"} defaultFocusValue={currentValue ? "true" : "false"} options={options} onChange={handleSelectChange} onCancel={onCancel ?? _temp} visibleOptionCount={2} /></Box>}</Box>;
    $[15] = confirmationPending;
    $[16] = currentValue;
    $[17] = handleSelectChange;
    $[18] = onCancel;
    $[19] = t9;
  } else {
    t9 = $[19];
  }
  let t10;
  if ($[20] !== confirmationPending || $[21] !== exitState.keyName || $[22] !== exitState.pending) {
    t10 = <Text dimColor={true} italic={true}>{exitState.pending ? <>Press {exitState.keyName} again to exit</> : confirmationPending !== null ? <Byline><KeyboardShortcutHint shortcut="Enter" action="confirm" /><ConfigurableShortcutHint action="confirm:no" context="Confirmation" fallback="Esc" description="cancel" /></Byline> : <Byline><KeyboardShortcutHint shortcut="Enter" action="confirm" /><ConfigurableShortcutHint action="confirm:no" context="Confirmation" fallback="Esc" description="exit" /></Byline>}</Text>;
    $[20] = confirmationPending;
    $[21] = exitState.keyName;
    $[22] = exitState.pending;
    $[23] = t10;
  } else {
    t10 = $[23];
  }
  let t11;
  if ($[24] !== t10 || $[25] !== t9) {
    t11 = <Pane color="permission">{t9}{t10}</Pane>;
    $[24] = t10;
    $[25] = t9;
    $[26] = t11;
  } else {
    t11 = $[26];
  }
  return t11;
}
function _temp() {}
