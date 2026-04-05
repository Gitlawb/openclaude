import { c as _c } from "react-compiler-runtime";
import React from 'react';
import { Box, Text, useTheme } from '../../../ink.js';
import { FallbackPermissionRequest } from '../FallbackPermissionRequest.js';
import { FilePermissionDialog } from '../FilePermissionDialog/FilePermissionDialog.js';
import type { ToolInput } from '../FilePermissionDialog/useFilePermissionDialog.js';
import type { PermissionRequestProps, ToolUseConfirm } from '../PermissionRequest.js';
function pathFromToolUse(toolUseConfirm: ToolUseConfirm): string | null {
  const tool = toolUseConfirm.tool;
  if ('getPath' in tool && typeof tool.getPath === 'function') {
    try {
      return tool.getPath(toolUseConfirm.input);
    } catch {
      return null;
    }
  }
  return null;
}
export function FilesystemPermissionRequest(t0) {
  const $ = _c(30);
  const {
    toolUseConfirm,
    onDone,
    onReject,
    verbose,
    toolUseContext,
    workerBadge
  } = t0;
  const [theme] = useTheme();
  let t1;
  if ($[0] !== toolUseConfirm) {
    t1 = pathFromToolUse(toolUseConfirm);
    $[0] = toolUseConfirm;
    $[1] = t1;
  } else {
    t1 = $[1];
  }
  const path = t1;
  let t2;
  if ($[2] !== toolUseConfirm.input || $[3] !== toolUseConfirm.tool) {
    t2 = toolUseConfirm.tool.userFacingName(toolUseConfirm.input as never);
    $[2] = toolUseConfirm.input;
    $[3] = toolUseConfirm.tool;
    $[4] = t2;
  } else {
    t2 = $[4];
  }
  const userFacingName = t2;
  const isReadOnly = toolUseConfirm.tool.isReadOnly(toolUseConfirm.input);
  const userFacingReadOrEdit = isReadOnly ? "Read" : "Edit";
  const title = `${userFacingReadOrEdit} file`;
  const parseInput = _temp;
  if (!path) {
    let t3;
    if ($[5] !== onDone || $[6] !== onReject || $[7] !== toolUseConfirm || $[8] !== toolUseContext || $[9] !== verbose || $[10] !== workerBadge) {
      t3 = <FallbackPermissionRequest toolUseConfirm={toolUseConfirm} toolUseContext={toolUseContext} onDone={onDone} onReject={onReject} verbose={verbose} workerBadge={workerBadge} />;
      $[5] = onDone;
      $[6] = onReject;
      $[7] = toolUseConfirm;
      $[8] = toolUseContext;
      $[9] = verbose;
      $[10] = workerBadge;
      $[11] = t3;
    } else {
      t3 = $[11];
    }
    return t3;
  }
  let t3;
  if ($[12] !== theme || $[13] !== toolUseConfirm.input || $[14] !== toolUseConfirm.tool || $[15] !== verbose) {
    t3 = toolUseConfirm.tool.renderToolUseMessage(toolUseConfirm.input as never, {
      theme,
      verbose
    });
    $[12] = theme;
    $[13] = toolUseConfirm.input;
    $[14] = toolUseConfirm.tool;
    $[15] = verbose;
    $[16] = t3;
  } else {
    t3 = $[16];
  }
  let t4;
  if ($[17] !== t3 || $[18] !== userFacingName) {
    t4 = <Box flexDirection="column" paddingX={2} paddingY={1}><Text>{userFacingName}({t3})</Text></Box>;
    $[17] = t3;
    $[18] = userFacingName;
    $[19] = t4;
  } else {
    t4 = $[19];
  }
  const content = t4;
  const t5 = isReadOnly ? "read" : "write";
  let t6;
  if ($[20] !== content || $[21] !== onDone || $[22] !== onReject || $[23] !== path || $[24] !== t5 || $[25] !== title || $[26] !== toolUseConfirm || $[27] !== toolUseContext || $[28] !== workerBadge) {
    t6 = <FilePermissionDialog toolUseConfirm={toolUseConfirm} toolUseContext={toolUseContext} onDone={onDone} onReject={onReject} workerBadge={workerBadge} title={title} content={content} path={path} parseInput={parseInput} operationType={t5} completionType="tool_use_single" />;
    $[20] = content;
    $[21] = onDone;
    $[22] = onReject;
    $[23] = path;
    $[24] = t5;
    $[25] = title;
    $[26] = toolUseConfirm;
    $[27] = toolUseContext;
    $[28] = workerBadge;
    $[29] = t6;
  } else {
    t6 = $[29];
  }
  return t6;
}
function _temp(input) {
  return input as ToolInput;
}
