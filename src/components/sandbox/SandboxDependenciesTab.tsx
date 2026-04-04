import { c as _c } from "react-compiler-runtime";
import React from 'react';
import { Box, Text } from '../../ink.js';
import { getPlatform } from '../../utils/platform.js';
import type { SandboxDependencyCheck } from '../../utils/sandbox/sandbox-adapter.js';
type Props = {
  depCheck: SandboxDependencyCheck;
};
export function SandboxDependenciesTab(t0) {
  const $ = _c(24);
  const {
    depCheck
  } = t0;
  let t1;
  if ($[0] === Symbol.for("react.memo_cache_sentinel")) {
    t1 = getPlatform();
    $[0] = t1;
  } else {
    t1 = $[0];
  }
  const platform = t1;
  const isMac = platform === "macos";
  let t2;
  if ($[1] !== depCheck.errors) {
    t2 = depCheck.errors.some(_temp);
    $[1] = depCheck.errors;
    $[2] = t2;
  } else {
    t2 = $[2];
  }
  const rgMissing = t2;
  let t3;
  if ($[3] !== depCheck.errors) {
    t3 = depCheck.errors.some(_temp2);
    $[3] = depCheck.errors;
    $[4] = t3;
  } else {
    t3 = $[4];
  }
  const bwrapMissing = t3;
  let t4;
  if ($[5] !== depCheck.errors) {
    t4 = depCheck.errors.some(_temp3);
    $[5] = depCheck.errors;
    $[6] = t4;
  } else {
    t4 = $[6];
  }
  const socatMissing = t4;
  const seccompMissing = depCheck.warnings.length > 0;
  let t5;
  if ($[7] !== bwrapMissing || $[8] !== depCheck.errors || $[9] !== rgMissing || $[10] !== seccompMissing || $[11] !== socatMissing) {
    const otherErrors = depCheck.errors.filter(_temp4);
    const rgInstallHint = isMac ? "brew install ripgrep" : "apt install ripgrep";
    let t6;
    if ($[13] === Symbol.for("react.memo_cache_sentinel")) {
      t6 = isMac && <Box flexDirection="column"><Text>seatbelt: <Text color="success">built-in (macOS)</Text></Text></Box>;
      $[13] = t6;
    } else {
      t6 = $[13];
    }
    let t7;
    let t8;
    if ($[14] !== rgMissing) {
      t7 = <Text>ripgrep (rg):{" "}{rgMissing ? <Text color="error">not found</Text> : <Text color="success">found</Text>}</Text>;
      t8 = rgMissing && <Text dimColor={true}>{"  "}· {rgInstallHint}</Text>;
      $[14] = rgMissing;
      $[15] = t7;
      $[16] = t8;
    } else {
      t7 = $[15];
      t8 = $[16];
    }
    let t9;
    if ($[17] !== t7 || $[18] !== t8) {
      t9 = <Box flexDirection="column">{t7}{t8}</Box>;
      $[17] = t7;
      $[18] = t8;
      $[19] = t9;
    } else {
      t9 = $[19];
    }
    let t10;
    if ($[20] !== bwrapMissing || $[21] !== seccompMissing || $[22] !== socatMissing) {
      t10 = !isMac && <><Box flexDirection="column"><Text>bubblewrap (bwrap):{" "}{bwrapMissing ? <Text color="error">not installed</Text> : <Text color="success">installed</Text>}</Text>{bwrapMissing && <Text dimColor={true}>{"  "}· apt install bubblewrap</Text>}</Box><Box flexDirection="column"><Text>socat:{" "}{socatMissing ? <Text color="error">not installed</Text> : <Text color="success">installed</Text>}</Text>{socatMissing && <Text dimColor={true}>{"  "}· apt install socat</Text>}</Box><Box flexDirection="column"><Text>seccomp filter:{" "}{seccompMissing ? <Text color="warning">not installed</Text> : <Text color="success">installed</Text>}{seccompMissing && <Text dimColor={true}> (required to block unix domain sockets)</Text>}</Text>{seccompMissing && <Box flexDirection="column"><Text dimColor={true}>{"  "}· npm install -g @anthropic-ai/sandbox-runtime</Text><Text dimColor={true}>{"  "}· or copy vendor/seccomp/* from sandbox-runtime and set</Text><Text dimColor={true}>{"    "}sandbox.seccomp.bpfPath and applyPath in settings.json</Text></Box>}</Box></>;
      $[20] = bwrapMissing;
      $[21] = seccompMissing;
      $[22] = socatMissing;
      $[23] = t10;
    } else {
      t10 = $[23];
    }
    t5 = <Box flexDirection="column" paddingY={1} gap={1}>{t6}{t9}{t10}{otherErrors.map(_temp5)}</Box>;
    $[7] = bwrapMissing;
    $[8] = depCheck.errors;
    $[9] = rgMissing;
    $[10] = seccompMissing;
    $[11] = socatMissing;
    $[12] = t5;
  } else {
    t5 = $[12];
  }
  return t5;
}
function _temp5(err) {
  return <Text key={err} color="error">{err}</Text>;
}
function _temp4(e_2) {
  return !e_2.includes("ripgrep") && !e_2.includes("bwrap") && !e_2.includes("socat");
}
function _temp3(e_1) {
  return e_1.includes("socat");
}
function _temp2(e_0) {
  return e_0.includes("bwrap");
}
function _temp(e) {
  return e.includes("ripgrep");
}
