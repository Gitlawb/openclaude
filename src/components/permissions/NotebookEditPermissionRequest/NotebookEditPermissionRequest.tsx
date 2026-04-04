import { c as _c } from "react-compiler-runtime";
import { basename } from 'path';
import React from 'react';
import type { z } from 'zod/v4';
import { Text } from '../../../ink.js';
import { NotebookEditTool } from '../../../tools/NotebookEditTool/NotebookEditTool.js';
import { logError } from '../../../utils/log.js';
import { FilePermissionDialog } from '../FilePermissionDialog/FilePermissionDialog.js';
import type { PermissionRequestProps } from '../PermissionRequest.js';
import { NotebookEditToolDiff } from './NotebookEditToolDiff.js';
type NotebookEditInput = z.infer<typeof NotebookEditTool.inputSchema>;
export function NotebookEditPermissionRequest(props) {
  const $ = _c(52);
  const parseInput = _temp;
  let T0;
  let T1;
  let T2;
  let language;
  let notebook_path;
  let parsed;
  let t0;
  let t1;
  let t10;
  let t2;
  let t3;
  let t4;
  let t5;
  let t6;
  let t7;
  let t8;
  let t9;
  if ($[0] !== props.onDone || $[1] !== props.onReject || $[2] !== props.toolUseConfirm || $[3] !== props.toolUseContext || $[4] !== props.workerBadge) {
    parsed = parseInput(props.toolUseConfirm.input);
    const {
      notebook_path: t11,
      edit_mode,
      cell_type
    } = parsed;
    notebook_path = t11;
    language = cell_type === "markdown" ? "markdown" : "python";
    const editTypeText = edit_mode === "insert" ? "insert this cell into" : edit_mode === "delete" ? "delete this cell from" : "make this edit to";
    T2 = FilePermissionDialog;
    t5 = props.toolUseConfirm;
    t6 = props.toolUseContext;
    t7 = props.onDone;
    t8 = props.onReject;
    t9 = props.workerBadge;
    t10 = "Edit notebook";
    T1 = Text;
    t2 = "Do you want to ";
    t3 = editTypeText;
    t4 = " ";
    T0 = Text;
    t0 = true;
    t1 = basename(notebook_path);
    $[0] = props.onDone;
    $[1] = props.onReject;
    $[2] = props.toolUseConfirm;
    $[3] = props.toolUseContext;
    $[4] = props.workerBadge;
    $[5] = T0;
    $[6] = T1;
    $[7] = T2;
    $[8] = language;
    $[9] = notebook_path;
    $[10] = parsed;
    $[11] = t0;
    $[12] = t1;
    $[13] = t10;
    $[14] = t2;
    $[15] = t3;
    $[16] = t4;
    $[17] = t5;
    $[18] = t6;
    $[19] = t7;
    $[20] = t8;
    $[21] = t9;
  } else {
    T0 = $[5];
    T1 = $[6];
    T2 = $[7];
    language = $[8];
    notebook_path = $[9];
    parsed = $[10];
    t0 = $[11];
    t1 = $[12];
    t10 = $[13];
    t2 = $[14];
    t3 = $[15];
    t4 = $[16];
    t5 = $[17];
    t6 = $[18];
    t7 = $[19];
    t8 = $[20];
    t9 = $[21];
  }
  let t11;
  if ($[22] !== T0 || $[23] !== t0 || $[24] !== t1) {
    t11 = <T0 bold={t0}>{t1}</T0>;
    $[22] = T0;
    $[23] = t0;
    $[24] = t1;
    $[25] = t11;
  } else {
    t11 = $[25];
  }
  let t12;
  if ($[26] !== T1 || $[27] !== t11 || $[28] !== t2 || $[29] !== t3 || $[30] !== t4) {
    t12 = <T1>{t2}{t3}{t4}{t11}?</T1>;
    $[26] = T1;
    $[27] = t11;
    $[28] = t2;
    $[29] = t3;
    $[30] = t4;
    $[31] = t12;
  } else {
    t12 = $[31];
  }
  const t13 = props.verbose ? 120 : 80;
  let t14;
  if ($[32] !== parsed.cell_id || $[33] !== parsed.cell_type || $[34] !== parsed.edit_mode || $[35] !== parsed.new_source || $[36] !== parsed.notebook_path || $[37] !== props.verbose || $[38] !== t13) {
    t14 = <NotebookEditToolDiff notebook_path={parsed.notebook_path} cell_id={parsed.cell_id} new_source={parsed.new_source} cell_type={parsed.cell_type} edit_mode={parsed.edit_mode} verbose={props.verbose} width={t13} />;
    $[32] = parsed.cell_id;
    $[33] = parsed.cell_type;
    $[34] = parsed.edit_mode;
    $[35] = parsed.new_source;
    $[36] = parsed.notebook_path;
    $[37] = props.verbose;
    $[38] = t13;
    $[39] = t14;
  } else {
    t14 = $[39];
  }
  let t15;
  if ($[40] !== T2 || $[41] !== language || $[42] !== notebook_path || $[43] !== t10 || $[44] !== t12 || $[45] !== t14 || $[46] !== t5 || $[47] !== t6 || $[48] !== t7 || $[49] !== t8 || $[50] !== t9) {
    t15 = <T2 toolUseConfirm={t5} toolUseContext={t6} onDone={t7} onReject={t8} workerBadge={t9} title={t10} question={t12} content={t14} path={notebook_path} completionType="tool_use_single" languageName={language} parseInput={parseInput} />;
    $[40] = T2;
    $[41] = language;
    $[42] = notebook_path;
    $[43] = t10;
    $[44] = t12;
    $[45] = t14;
    $[46] = t5;
    $[47] = t6;
    $[48] = t7;
    $[49] = t8;
    $[50] = t9;
    $[51] = t15;
  } else {
    t15 = $[51];
  }
  return t15;
}
function _temp(input) {
  const result = NotebookEditTool.inputSchema.safeParse(input);
  if (!result.success) {
    logError(new Error(`Failed to parse notebook edit input: ${result.error.message}`));
    return {
      notebook_path: "",
      new_source: "",
      cell_id: ""
    } as NotebookEditInput;
  }
  return result.data;
}
