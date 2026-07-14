import { c as _c } from "react-compiler-runtime";
import * as React from 'react';
import { stringWidth } from '../../ink/stringWidth.js';
import { Box, Text } from '../../ink.js';
import TextInput from '../TextInput.js';
type Props = {
  value: string;
  onChange: (value: string) => void;
  historyFailedMatch: boolean;
  focus: boolean;
};
function HistorySearchInput(t0) {
  const $ = _c(10);
  const {
    value,
    onChange,
    historyFailedMatch,
    focus
  } = t0;
  const t1 = historyFailedMatch ? "no matching prompt:" : "search prompts:";
  let t2;
  if ($[0] !== t1) {
    t2 = <Text dimColor={true}>{t1}</Text>;
    $[0] = t1;
    $[1] = t2;
  } else {
    t2 = $[1];
  }
  const t3 = stringWidth(value) + 1;
  let t4;
  if ($[2] !== focus || $[3] !== onChange || $[4] !== t3 || $[5] !== value) {
    t4 = <TextInput value={value} onChange={onChange} cursorOffset={value.length} onChangeCursorOffset={_temp} columns={t3} focus={focus} showCursor={true} multiline={false} dimColor={true} />;
    $[2] = focus;
    $[3] = onChange;
    $[4] = t3;
    $[5] = value;
    $[6] = t4;
  } else {
    t4 = $[6];
  }
  let t5;
  if ($[7] !== t2 || $[8] !== t4) {
    t5 = <Box gap={1}>{t2}{t4}</Box>;
    $[7] = t2;
    $[8] = t4;
    $[9] = t5;
  } else {
    t5 = $[9];
  }
  return t5;
}
function _temp() {}
export default HistorySearchInput;
