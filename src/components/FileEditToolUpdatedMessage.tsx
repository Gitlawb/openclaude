import { c as _c } from "react-compiler-runtime";
import type { StructuredPatchHunk } from 'diff';
import * as React from 'react';
import { useTerminalSize } from '../hooks/useTerminalSize.js';
import { Box, Text } from '../ink.js';
import { count } from '../utils/array.js';
import { MessageResponse } from './MessageResponse.js';
import { StructuredDiffList } from './StructuredDiffList.js';
type Props = {
  filePath: string;
  structuredPatch: StructuredPatchHunk[];
  firstLine: string | null;
  fileContent?: string;
  style?: 'condensed';
  verbose: boolean;
  previewHint?: string;
};
export function FileEditToolUpdatedMessage(t0) {
  const $ = _c(22);
  const {
    filePath,
    structuredPatch,
    firstLine,
    fileContent,
    style,
    verbose,
    previewHint
  } = t0;
  const {
    columns
  } = useTerminalSize();
  const numAdditions = structuredPatch.reduce(_temp2, 0);
  const numRemovals = structuredPatch.reduce(_temp4, 0);
  let t1;
  if ($[0] !== numAdditions) {
    t1 = numAdditions > 0 ? <>Added <Text bold={true}>{numAdditions}</Text>{" "}{numAdditions > 1 ? "lines" : "line"}</> : null;
    $[0] = numAdditions;
    $[1] = t1;
  } else {
    t1 = $[1];
  }
  const t2 = numAdditions > 0 && numRemovals > 0 ? ", " : null;
  let t3;
  if ($[2] !== numAdditions || $[3] !== numRemovals) {
    t3 = numRemovals > 0 ? <>{numAdditions === 0 ? "R" : "r"}emoved <Text bold={true}>{numRemovals}</Text>{" "}{numRemovals > 1 ? "lines" : "line"}</> : null;
    $[2] = numAdditions;
    $[3] = numRemovals;
    $[4] = t3;
  } else {
    t3 = $[4];
  }
  let t4;
  if ($[5] !== t1 || $[6] !== t2 || $[7] !== t3) {
    t4 = <Text>{t1}{t2}{t3}</Text>;
    $[5] = t1;
    $[6] = t2;
    $[7] = t3;
    $[8] = t4;
  } else {
    t4 = $[8];
  }
  const text = t4;
  if (previewHint) {
    if (style !== "condensed" && !verbose) {
      let t5;
      if ($[9] !== previewHint) {
        t5 = <MessageResponse><Text dimColor={true}>{previewHint}</Text></MessageResponse>;
        $[9] = previewHint;
        $[10] = t5;
      } else {
        t5 = $[10];
      }
      return t5;
    }
  } else {
    if (style === "condensed" && !verbose) {
      return text;
    }
  }
  let t5;
  if ($[11] !== text) {
    t5 = <Text>{text}</Text>;
    $[11] = text;
    $[12] = t5;
  } else {
    t5 = $[12];
  }
  const t6 = columns - 12;
  let t7;
  if ($[13] !== fileContent || $[14] !== filePath || $[15] !== firstLine || $[16] !== structuredPatch || $[17] !== t6) {
    t7 = <StructuredDiffList hunks={structuredPatch} dim={false} width={t6} filePath={filePath} firstLine={firstLine} fileContent={fileContent} />;
    $[13] = fileContent;
    $[14] = filePath;
    $[15] = firstLine;
    $[16] = structuredPatch;
    $[17] = t6;
    $[18] = t7;
  } else {
    t7 = $[18];
  }
  let t8;
  if ($[19] !== t5 || $[20] !== t7) {
    t8 = <MessageResponse><Box flexDirection="column">{t5}{t7}</Box></MessageResponse>;
    $[19] = t5;
    $[20] = t7;
    $[21] = t8;
  } else {
    t8 = $[21];
  }
  return t8;
}
function _temp4(acc_0, hunk_0) {
  return acc_0 + count(hunk_0.lines, _temp3);
}
function _temp3(__0) {
  return __0.startsWith("-");
}
function _temp2(acc, hunk) {
  return acc + count(hunk.lines, _temp);
}
function _temp(_) {
  return _.startsWith("+");
}
