import { c as _c } from "react-compiler-runtime";
import { relative } from 'path';
import * as React from 'react';
import { getCwd } from 'src/utils/cwd.js';
import { Box, Text } from '../ink.js';
import { HighlightedCode } from './HighlightedCode.js';
import { MessageResponse } from './MessageResponse.js';
type Props = {
  notebook_path: string;
  cell_id: string | undefined;
  new_source: string;
  cell_type?: 'code' | 'markdown';
  edit_mode?: 'replace' | 'insert' | 'delete';
  verbose: boolean;
};
export function NotebookEditToolUseRejectedMessage(t0) {
  const $ = _c(20);
  const {
    notebook_path,
    cell_id,
    new_source,
    cell_type,
    edit_mode: t1,
    verbose
  } = t0;
  const edit_mode = t1 === undefined ? "replace" : t1;
  const operation = edit_mode === "delete" ? "delete" : `${edit_mode} cell in`;
  let t2;
  if ($[0] !== operation) {
    t2 = <Text color="subtle">User rejected {operation} </Text>;
    $[0] = operation;
    $[1] = t2;
  } else {
    t2 = $[1];
  }
  let t3;
  if ($[2] !== notebook_path || $[3] !== verbose) {
    t3 = verbose ? notebook_path : relative(getCwd(), notebook_path);
    $[2] = notebook_path;
    $[3] = verbose;
    $[4] = t3;
  } else {
    t3 = $[4];
  }
  let t4;
  if ($[5] !== t3) {
    t4 = <Text bold={true} color="subtle">{t3}</Text>;
    $[5] = t3;
    $[6] = t4;
  } else {
    t4 = $[6];
  }
  let t5;
  if ($[7] !== cell_id) {
    t5 = <Text color="subtle"> at cell {cell_id}</Text>;
    $[7] = cell_id;
    $[8] = t5;
  } else {
    t5 = $[8];
  }
  let t6;
  if ($[9] !== t2 || $[10] !== t4 || $[11] !== t5) {
    t6 = <Box flexDirection="row">{t2}{t4}{t5}</Box>;
    $[9] = t2;
    $[10] = t4;
    $[11] = t5;
    $[12] = t6;
  } else {
    t6 = $[12];
  }
  let t7;
  if ($[13] !== cell_type || $[14] !== edit_mode || $[15] !== new_source) {
    t7 = edit_mode !== "delete" && <Box marginTop={1} flexDirection="column"><HighlightedCode code={new_source} filePath={cell_type === "markdown" ? "file.md" : "file.py"} dim={true} /></Box>;
    $[13] = cell_type;
    $[14] = edit_mode;
    $[15] = new_source;
    $[16] = t7;
  } else {
    t7 = $[16];
  }
  let t8;
  if ($[17] !== t6 || $[18] !== t7) {
    t8 = <MessageResponse><Box flexDirection="column">{t6}{t7}</Box></MessageResponse>;
    $[17] = t6;
    $[18] = t7;
    $[19] = t8;
  } else {
    t8 = $[19];
  }
  return t8;
}
