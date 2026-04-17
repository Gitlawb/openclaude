import { c as _c } from "react-compiler-runtime";
import React from 'react';
import { Box, Text } from '../ink.js';
import { formatTokens } from '../utils/format.js';
import { Select } from './CustomSelect/index.js';
import { Dialog } from './design-system/Dialog.js';
type IdleReturnAction = 'continue' | 'clear' | 'dismiss' | 'never';
type Props = {
  idleMinutes: number;
  totalInputTokens: number;
  onDone: (action: IdleReturnAction) => void;
};
export function IdleReturnDialog(t0) {
  const $ = _c(16);
  const {
    idleMinutes,
    totalInputTokens,
    onDone
  } = t0;
  let t1;
  if ($[0] !== idleMinutes) {
    t1 = formatIdleDuration(idleMinutes);
    $[0] = idleMinutes;
    $[1] = t1;
  } else {
    t1 = $[1];
  }
  const formattedIdle = t1;
  let t2;
  if ($[2] !== totalInputTokens) {
    t2 = formatTokens(totalInputTokens);
    $[2] = totalInputTokens;
    $[3] = t2;
  } else {
    t2 = $[3];
  }
  const formattedTokens = t2;
  const t3 = `Вас не було ${formattedIdle}, а ця розмова містить ${formattedTokens} токенів.`;
  let t4;
  if ($[4] !== onDone) {
    t4 = () => onDone("dismiss");
    $[4] = onDone;
    $[5] = t4;
  } else {
    t4 = $[5];
  }
  let t5;
  if ($[6] === Symbol.for("react.memo_cache_sentinel")) {
    t5 = <Box flexDirection="column"><Text>Якщо це нова задача, очищення контексту заощадить використання і буде швидшим.</Text></Box>;
    $[6] = t5;
  } else {
    t5 = $[6];
  }
  let t6;
  if ($[7] === Symbol.for("react.memo_cache_sentinel")) {
    t6 = {
      value: "continue" as const,
      label: "Продовжити цю розмову"
    };
    $[7] = t6;
  } else {
    t6 = $[7];
  }
  let t7;
  if ($[8] === Symbol.for("react.memo_cache_sentinel")) {
    t7 = {
      value: "clear" as const,
      label: "Відправити повідомлення як нову розмову"
    };
    $[8] = t7;
  } else {
    t7 = $[8];
  }
  let t8;
  if ($[9] === Symbol.for("react.memo_cache_sentinel")) {
    t8 = [t6, t7, {
      value: "never" as const,
      label: "Більше не запитувати"
    }];
    $[9] = t8;
  } else {
    t8 = $[9];
  }
  let t9;
  if ($[10] !== onDone) {
    t9 = <Select options={t8} onChange={value => onDone(value)} />;
    $[10] = onDone;
    $[11] = t9;
  } else {
    t9 = $[11];
  }
  let t10;
  if ($[12] !== t3 || $[13] !== t4 || $[14] !== t9) {
    t10 = <Dialog title={t3} onCancel={t4}>{t5}{t9}</Dialog>;
    $[12] = t3;
    $[13] = t4;
    $[14] = t9;
    $[15] = t10;
  } else {
    t10 = $[15];
  }
  return t10;
}
function formatIdleDuration(minutes: number): string {
  if (minutes < 1) {
    return '< 1m';
  }
  if (minutes < 60) {
    return `${Math.floor(minutes)}m`;
  }
  const hours = Math.floor(minutes / 60);
  const remainingMinutes = Math.floor(minutes % 60);
  if (remainingMinutes === 0) {
    return `${hours}h`;
  }
  return `${hours}h ${remainingMinutes}m`;
}
