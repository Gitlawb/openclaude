import { c as _c } from "react-compiler-runtime";
import * as React from 'react';
import { useState } from 'react';
import { Box, Text } from 'src/ink.js';
import { formatAPIError } from 'src/services/api/errorUtils.js';
import type { SystemAPIErrorMessage } from 'src/types/message.js';
import { useInterval } from 'usehooks-ts';
import { CtrlOToExpand } from '../CtrlOToExpand.js';
import { MessageResponse } from '../MessageResponse.js';
const MAX_API_ERROR_CHARS = 1000;
type Props = {
  message: SystemAPIErrorMessage;
  verbose: boolean;
};
export function SystemAPIErrorMessage(t0) {
  const $ = _c(33);
  const {
    message: t1,
    verbose
  } = t0;
  const {
    retryAttempt,
    error,
    retryInMs,
    maxRetries
  } = t1;
  const hidden = true && retryAttempt < 4;
  const [countdownMs, setCountdownMs] = useState(0);
  const done = countdownMs >= retryInMs;
  let t2;
  if ($[0] === Symbol.for("react.memo_cache_sentinel")) {
    t2 = () => setCountdownMs(_temp);
    $[0] = t2;
  } else {
    t2 = $[0];
  }
  useInterval(t2, hidden || done ? null : 1000);
  if (hidden) {
    return null;
  }
  let t3;
  if ($[1] !== countdownMs || $[2] !== retryInMs) {
    t3 = Math.round((retryInMs - countdownMs) / 1000);
    $[1] = countdownMs;
    $[2] = retryInMs;
    $[3] = t3;
  } else {
    t3 = $[3];
  }
  const retryInSecondsLive = Math.max(0, t3);
  let T0;
  let T1;
  let T2;
  let t4;
  let t5;
  let t6;
  let truncated;
  if ($[4] !== error || $[5] !== verbose) {
    const formatted = formatAPIError(error);
    truncated = !verbose && formatted.length > MAX_API_ERROR_CHARS;
    T2 = MessageResponse;
    T1 = Box;
    t6 = "column";
    T0 = Text;
    t4 = "error";
    t5 = truncated ? formatted.slice(0, MAX_API_ERROR_CHARS) + "\u2026" : formatted;
    $[4] = error;
    $[5] = verbose;
    $[6] = T0;
    $[7] = T1;
    $[8] = T2;
    $[9] = t4;
    $[10] = t5;
    $[11] = t6;
    $[12] = truncated;
  } else {
    T0 = $[6];
    T1 = $[7];
    T2 = $[8];
    t4 = $[9];
    t5 = $[10];
    t6 = $[11];
    truncated = $[12];
  }
  let t7;
  if ($[13] !== T0 || $[14] !== t4 || $[15] !== t5) {
    t7 = <T0 color={t4}>{t5}</T0>;
    $[13] = T0;
    $[14] = t4;
    $[15] = t5;
    $[16] = t7;
  } else {
    t7 = $[16];
  }
  let t8;
  if ($[17] !== truncated) {
    t8 = truncated && <CtrlOToExpand />;
    $[17] = truncated;
    $[18] = t8;
  } else {
    t8 = $[18];
  }
  const t9 = retryInSecondsLive === 1 ? "second" : "seconds";
  let t10;
  if ($[19] !== maxRetries || $[20] !== retryAttempt || $[21] !== retryInSecondsLive || $[22] !== t9) {
    t10 = <Text dimColor={true}>Retrying in {retryInSecondsLive}{" "}{t9}… (attempt{" "}{retryAttempt}/{maxRetries}){process.env.API_TIMEOUT_MS ? ` · API_TIMEOUT_MS=${process.env.API_TIMEOUT_MS}ms, try increasing it` : ""}</Text>;
    $[19] = maxRetries;
    $[20] = retryAttempt;
    $[21] = retryInSecondsLive;
    $[22] = t9;
    $[23] = t10;
  } else {
    t10 = $[23];
  }
  let t11;
  if ($[24] !== T1 || $[25] !== t10 || $[26] !== t6 || $[27] !== t7 || $[28] !== t8) {
    t11 = <T1 flexDirection={t6}>{t7}{t8}{t10}</T1>;
    $[24] = T1;
    $[25] = t10;
    $[26] = t6;
    $[27] = t7;
    $[28] = t8;
    $[29] = t11;
  } else {
    t11 = $[29];
  }
  let t12;
  if ($[30] !== T2 || $[31] !== t11) {
    t12 = <T2>{t11}</T2>;
    $[30] = T2;
    $[31] = t11;
    $[32] = t12;
  } else {
    t12 = $[32];
  }
  return t12;
}
function _temp(ms) {
  return ms + 1000;
}
