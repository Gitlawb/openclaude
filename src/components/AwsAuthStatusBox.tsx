import { c as _c } from "react-compiler-runtime";
import React, { useEffect, useState } from 'react';
import { Box, Link, Text } from '../ink.js';
import { type AwsAuthStatus, AwsAuthStatusManager } from '../utils/awsAuthStatusManager.js';
const URL_RE = /https?:\/\/\S+/;
export function AwsAuthStatusBox() {
  const $ = _c(11);
  let t0;
  if ($[0] === Symbol.for("react.memo_cache_sentinel")) {
    t0 = AwsAuthStatusManager.getInstance().getStatus();
    $[0] = t0;
  } else {
    t0 = $[0];
  }
  const [status, setStatus] = useState(t0);
  let t1;
  let t2;
  if ($[1] === Symbol.for("react.memo_cache_sentinel")) {
    t1 = () => {
      const unsubscribe = AwsAuthStatusManager.getInstance().subscribe(setStatus);
      return unsubscribe;
    };
    t2 = [];
    $[1] = t1;
    $[2] = t2;
  } else {
    t1 = $[1];
    t2 = $[2];
  }
  useEffect(t1, t2);
  if (!status.isAuthenticating && !status.error && status.output.length === 0) {
    return null;
  }
  if (!status.isAuthenticating && !status.error) {
    return null;
  }
  let t3;
  if ($[3] === Symbol.for("react.memo_cache_sentinel")) {
    t3 = <Text bold={true} color="permission">Cloud Authentication</Text>;
    $[3] = t3;
  } else {
    t3 = $[3];
  }
  let t4;
  if ($[4] !== status.output) {
    t4 = status.output.length > 0 && <Box flexDirection="column" marginTop={1}>{status.output.slice(-5).map(_temp)}</Box>;
    $[4] = status.output;
    $[5] = t4;
  } else {
    t4 = $[5];
  }
  let t5;
  if ($[6] !== status.error) {
    t5 = status.error && <Box marginTop={1}><Text color="error">{status.error}</Text></Box>;
    $[6] = status.error;
    $[7] = t5;
  } else {
    t5 = $[7];
  }
  let t6;
  if ($[8] !== t4 || $[9] !== t5) {
    t6 = <Box flexDirection="column" borderStyle="round" borderColor="permission" paddingX={1} marginY={1}>{t3}{t4}{t5}</Box>;
    $[8] = t4;
    $[9] = t5;
    $[10] = t6;
  } else {
    t6 = $[10];
  }
  return t6;
}
function _temp(line, index) {
  const m = line.match(URL_RE);
  if (!m) {
    return <Text key={index} dimColor={true}>{line}</Text>;
  }
  const url = m[0];
  const start = m.index ?? 0;
  const before = line.slice(0, start);
  const after = line.slice(start + url.length);
  return <Text key={index} dimColor={true}>{before}<Link url={url}>{url}</Link>{after}</Text>;
}
