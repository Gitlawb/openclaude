import { c as _c } from "react-compiler-runtime";
import type { ChannelEntry } from '../bootstrap/state.js';
import { Box, Text } from '../ink.js';
import { gracefulShutdownSync } from '../utils/gracefulShutdown.js';
import { Select } from './CustomSelect/index.js';
import { Dialog } from './design-system/Dialog.js';
type Props = {
  channels: ChannelEntry[];
  onAccept(): void;
};
export function DevChannelsDialog(t0: Props) {
  const $ = _c(14);
  const {
    channels,
    onAccept
  } = t0;
  let t1;
  if ($[0] !== onAccept) {
    t1 = function onChange(value: 'accept' | 'exit') {
      bb2: switch (value) {
        case "accept":
          {
            onAccept();
            break bb2;
          }
        case "exit":
          {
            gracefulShutdownSync(1);
          }
      }
    };
    $[0] = onAccept;
    $[1] = t1;
  } else {
    t1 = $[1];
  }
  const onChange = t1;
  const handleEscape = _temp;
  let t2;
  let t3;
  if ($[2] === Symbol.for("react.memo_cache_sentinel")) {
    t2 = <Text>--dangerously-load-development-channels is for local channel development only. Do not use this option to run channels you have downloaded off the internet.</Text>;
    t3 = <Text>Please use --channels to run a list of approved channels.</Text>;
    $[2] = t2;
    $[3] = t3;
  } else {
    t2 = $[2];
    t3 = $[3];
  }
  let t4;
  if ($[4] !== channels) {
    t4 = channels.map(_temp2).join(", ");
    $[4] = channels;
    $[5] = t4;
  } else {
    t4 = $[5];
  }
  let t5;
  if ($[6] !== t4) {
    t5 = <Box flexDirection="column" gap={1}>{t2}{t3}<Text dimColor={true}>Channels:{" "}{t4}</Text></Box>;
    $[6] = t4;
    $[7] = t5;
  } else {
    t5 = $[7];
  }
  let t6;
  if ($[8] === Symbol.for("react.memo_cache_sentinel")) {
    t6 = [{
      label: "I am using this for local development",
      value: "accept"
    }, {
      label: "Exit",
      value: "exit"
    }];
    $[8] = t6;
  } else {
    t6 = $[8];
  }
  let t7;
  if ($[9] !== onChange) {
    t7 = <Select options={t6} onChange={(value_0: string) => onChange(value_0 as 'accept' | 'exit')} />;
    $[9] = onChange;
    $[10] = t7;
  } else {
    t7 = $[10];
  }
  let t8;
  if ($[11] !== t5 || $[12] !== t7) {
    t8 = <Dialog title="WARNING: Loading development channels" color="error" onCancel={handleEscape}>{t5}{t7}</Dialog>;
    $[11] = t5;
    $[12] = t7;
    $[13] = t8;
  } else {
    t8 = $[13];
  }
  return t8;
}
function _temp2(c: ChannelEntry) {
  return c.kind === "plugin" ? `plugin:${c.name}@${c.marketplace}` : `server:${c.name}`;
}
function _temp() {
  gracefulShutdownSync(0);
}
