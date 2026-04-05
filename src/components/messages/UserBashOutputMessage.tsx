import { c as _c } from "react-compiler-runtime";
import * as React from 'react';
import BashToolResultMessage from '../../tools/BashTool/BashToolResultMessage.js';
import { extractTag } from '../../utils/messages.js';
export function UserBashOutputMessage(t0) {
  const $ = _c(10);
  const {
    content,
    verbose
  } = t0;
  let t1;
  if ($[0] !== content) {
    const rawStdout = extractTag(content, "bash-stdout") ?? "";
    t1 = extractTag(rawStdout, "persisted-output") ?? rawStdout;
    $[0] = content;
    $[1] = t1;
  } else {
    t1 = $[1];
  }
  const stdout = t1;
  let t2;
  if ($[2] !== content) {
    t2 = extractTag(content, "bash-stderr") ?? "";
    $[2] = content;
    $[3] = t2;
  } else {
    t2 = $[3];
  }
  const stderr = t2;
  let t3;
  if ($[4] !== stderr || $[5] !== stdout) {
    t3 = {
      stdout,
      stderr
    };
    $[4] = stderr;
    $[5] = stdout;
    $[6] = t3;
  } else {
    t3 = $[6];
  }
  const t4 = !!verbose;
  let t5;
  if ($[7] !== t3 || $[8] !== t4) {
    t5 = <BashToolResultMessage content={t3} verbose={t4} />;
    $[7] = t3;
    $[8] = t4;
    $[9] = t5;
  } else {
    t5 = $[9];
  }
  return t5;
}
