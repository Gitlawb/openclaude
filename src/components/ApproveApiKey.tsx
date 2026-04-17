import { c as _c } from "react-compiler-runtime";
import { Text } from '../ink.js';
import { saveGlobalConfig } from '../utils/config.js';
import { Select } from './CustomSelect/index.js';
import { Dialog } from './design-system/Dialog.js';
type Props = {
  customApiKeyTruncated: string;
  onDone(approved: boolean): void;
};
export function ApproveApiKey(t0: Props) {
  const $ = _c(17);
  const {
    customApiKeyTruncated,
    onDone
  } = t0;
  let t1;
  if ($[0] !== customApiKeyTruncated || $[1] !== onDone) {
    t1 = function onChange(value: 'yes' | 'no') {
      bb2: switch (value) {
        case "yes":
          {
            saveGlobalConfig(current_0 => ({
              ...current_0,
              customApiKeyResponses: {
                ...current_0.customApiKeyResponses,
                approved: [...(current_0.customApiKeyResponses?.approved ?? []), customApiKeyTruncated]
              }
            }));
            onDone(true);
            break bb2;
          }
        case "no":
          {
            saveGlobalConfig(current => ({
              ...current,
              customApiKeyResponses: {
                ...current.customApiKeyResponses,
                rejected: [...(current.customApiKeyResponses?.rejected ?? []), customApiKeyTruncated]
              }
            }));
            onDone(false);
          }
      }
    };
    $[0] = customApiKeyTruncated;
    $[1] = onDone;
    $[2] = t1;
  } else {
    t1 = $[2];
  }
  const onChange = t1;
  let t2;
  if ($[3] !== onChange) {
    t2 = () => onChange("no");
    $[3] = onChange;
    $[4] = t2;
  } else {
    t2 = $[4];
  }
  let t3;
  if ($[5] === Symbol.for("react.memo_cache_sentinel")) {
    t3 = <Text bold={true}>ANTHROPIC_API_KEY</Text>;
    $[5] = t3;
  } else {
    t3 = $[5];
  }
  let t4;
  if ($[6] !== customApiKeyTruncated) {
    t4 = <Text>{t3}<Text>: sk-ant-...{customApiKeyTruncated}</Text></Text>;
    $[6] = customApiKeyTruncated;
    $[7] = t4;
  } else {
    t4 = $[7];
  }
  let t5;
  if ($[8] === Symbol.for("react.memo_cache_sentinel")) {
    t5 = <Text>Використати цей API ключ?</Text>;
    $[8] = t5;
  } else {
    t5 = $[8];
  }
  let t6;
  if ($[9] === Symbol.for("react.memo_cache_sentinel")) {
    t6 = {
      label: "Так",
      value: "yes"
    };
    $[9] = t6;
  } else {
    t6 = $[9];
  }
  let t7;
  if ($[10] === Symbol.for("react.memo_cache_sentinel")) {
    t7 = [t6, {
      label: <Text>Ні (<Text bold={true}>рекомендовано</Text>)</Text>,
      value: "no"
    }];
    $[10] = t7;
  } else {
    t7 = $[10];
  }
  let t8;
  if ($[11] !== onChange) {
    t8 = <Select defaultValue="no" defaultFocusValue="no" options={t7} onChange={(value_0: string) => onChange(value_0 as 'yes' | 'no')} onCancel={() => onChange("no")} />;
    $[11] = onChange;
    $[12] = t8;
  } else {
    t8 = $[12];
  }
  let t9;
  if ($[13] !== t2 || $[14] !== t4 || $[15] !== t8) {
    t9 = <Dialog title="Виявлено свій API ключ у вашому середовищі" color="warning" onCancel={t2}>{t4}{t5}{t8}</Dialog>;
    $[13] = t2;
    $[14] = t4;
    $[15] = t8;
    $[16] = t9;
  } else {
    t9 = $[16];
  }
  return t9;
}
