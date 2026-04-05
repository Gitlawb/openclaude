import { c as _c } from "react-compiler-runtime";
import { basename, relative } from 'path';
import React from 'react';
import { FileEditToolDiff } from 'src/components/FileEditToolDiff.js';
import { getCwd } from 'src/utils/cwd.js';
import type { z } from 'zod/v4';
import { Text } from '../../../ink.js';
import { FileEditTool } from '../../../tools/FileEditTool/FileEditTool.js';
import { FilePermissionDialog } from '../FilePermissionDialog/FilePermissionDialog.js';
import { createSingleEditDiffConfig, type FileEdit, type IDEDiffSupport } from '../FilePermissionDialog/ideDiffConfig.js';
import type { PermissionRequestProps } from '../PermissionRequest.js';
type FileEditInput = z.infer<typeof FileEditTool.inputSchema>;
const ideDiffSupport: IDEDiffSupport<FileEditInput> = {
  getConfig: (input: FileEditInput) => createSingleEditDiffConfig(input.file_path, input.old_string, input.new_string, input.replace_all),
  applyChanges: (input: FileEditInput, modifiedEdits: FileEdit[]) => {
    const firstEdit = modifiedEdits[0];
    if (firstEdit) {
      return {
        ...input,
        old_string: firstEdit.old_string,
        new_string: firstEdit.new_string,
        replace_all: firstEdit.replace_all
      };
    }
    return input;
  }
};
export function FileEditPermissionRequest(props) {
  const $ = _c(51);
  const parseInput = _temp;
  let T0;
  let T1;
  let T2;
  let file_path;
  let new_string;
  let old_string;
  let replace_all;
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
    const parsed = parseInput(props.toolUseConfirm.input);
    ({
      file_path,
      old_string,
      new_string,
      replace_all
    } = parsed);
    T2 = FilePermissionDialog;
    t4 = props.toolUseConfirm;
    t5 = props.toolUseContext;
    t6 = props.onDone;
    t7 = props.onReject;
    t8 = props.workerBadge;
    t9 = "Edit file";
    t10 = relative(getCwd(), file_path);
    T1 = Text;
    t2 = "Do you want to make this edit to";
    t3 = " ";
    T0 = Text;
    t0 = true;
    t1 = basename(file_path);
    $[0] = props.onDone;
    $[1] = props.onReject;
    $[2] = props.toolUseConfirm;
    $[3] = props.toolUseContext;
    $[4] = props.workerBadge;
    $[5] = T0;
    $[6] = T1;
    $[7] = T2;
    $[8] = file_path;
    $[9] = new_string;
    $[10] = old_string;
    $[11] = replace_all;
    $[12] = t0;
    $[13] = t1;
    $[14] = t10;
    $[15] = t2;
    $[16] = t3;
    $[17] = t4;
    $[18] = t5;
    $[19] = t6;
    $[20] = t7;
    $[21] = t8;
    $[22] = t9;
  } else {
    T0 = $[5];
    T1 = $[6];
    T2 = $[7];
    file_path = $[8];
    new_string = $[9];
    old_string = $[10];
    replace_all = $[11];
    t0 = $[12];
    t1 = $[13];
    t10 = $[14];
    t2 = $[15];
    t3 = $[16];
    t4 = $[17];
    t5 = $[18];
    t6 = $[19];
    t7 = $[20];
    t8 = $[21];
    t9 = $[22];
  }
  let t11;
  if ($[23] !== T0 || $[24] !== t0 || $[25] !== t1) {
    t11 = <T0 bold={t0}>{t1}</T0>;
    $[23] = T0;
    $[24] = t0;
    $[25] = t1;
    $[26] = t11;
  } else {
    t11 = $[26];
  }
  let t12;
  if ($[27] !== T1 || $[28] !== t11 || $[29] !== t2 || $[30] !== t3) {
    t12 = <T1>{t2}{t3}{t11}?</T1>;
    $[27] = T1;
    $[28] = t11;
    $[29] = t2;
    $[30] = t3;
    $[31] = t12;
  } else {
    t12 = $[31];
  }
  const t13 = replace_all || false;
  let t14;
  if ($[32] !== new_string || $[33] !== old_string || $[34] !== t13) {
    t14 = [{
      old_string,
      new_string,
      replace_all: t13
    }];
    $[32] = new_string;
    $[33] = old_string;
    $[34] = t13;
    $[35] = t14;
  } else {
    t14 = $[35];
  }
  let t15;
  if ($[36] !== file_path || $[37] !== t14) {
    t15 = <FileEditToolDiff file_path={file_path} edits={t14} />;
    $[36] = file_path;
    $[37] = t14;
    $[38] = t15;
  } else {
    t15 = $[38];
  }
  let t16;
  if ($[39] !== T2 || $[40] !== file_path || $[41] !== t10 || $[42] !== t12 || $[43] !== t15 || $[44] !== t4 || $[45] !== t5 || $[46] !== t6 || $[47] !== t7 || $[48] !== t8 || $[49] !== t9) {
    t16 = <T2 toolUseConfirm={t4} toolUseContext={t5} onDone={t6} onReject={t7} workerBadge={t8} title={t9} subtitle={t10} question={t12} content={t15} path={file_path} completionType="str_replace_single" parseInput={parseInput} ideDiffSupport={ideDiffSupport} />;
    $[39] = T2;
    $[40] = file_path;
    $[41] = t10;
    $[42] = t12;
    $[43] = t15;
    $[44] = t4;
    $[45] = t5;
    $[46] = t6;
    $[47] = t7;
    $[48] = t8;
    $[49] = t9;
    $[50] = t16;
  } else {
    t16 = $[50];
  }
  return t16;
}
function _temp(input) {
  return FileEditTool.inputSchema.parse(input);
}
