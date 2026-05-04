import { c as _c } from "react-compiler-runtime";
import React, { Suspense, use, useDeferredValue, useEffect, useState } from 'react';
import type { DeepImmutable } from 'src/types/utils.js';
import type { CommandResultDisplay } from '../../commands.js';
import { useTerminalSize } from '../../hooks/useTerminalSize.js';
import type { KeyboardEvent } from '../../ink/events/keyboard-event.js';
import { Box, Text } from '../../ink.js';
import { useKeybindings } from '../../keybindings/useKeybinding.js';
import type { LocalShellTaskState } from '../../tasks/LocalShellTask/guards.js';
import { formatDuration, formatFileSize, truncateToWidth } from '../../utils/format.js';
import { tailFile } from '../../utils/fsOperations.js';
import { getTaskOutputPath } from '../../utils/task/diskOutput.js';
import { Byline } from '../design-system/Byline.js';
import { Dialog } from '../design-system/Dialog.js';
import { KeyboardShortcutHint } from '../design-system/KeyboardShortcutHint.js';
type Props = {
  shell: DeepImmutable<LocalShellTaskState>;
  onDone: (result?: string, options?: {
    display?: CommandResultDisplay;
  }) => void;
  onKillShell?: () => void;
  onBack?: () => void;
};
const SHELL_DETAIL_TAIL_BYTES = 8192;
type TaskOutputResult = {
  content: string;
  bytesTotal: number;
};

/**
 * Read the tail of the task output file. Only reads the last few KB,
 * not the entire file.
 */
async function getTaskOutput(shell: DeepImmutable<LocalShellTaskState>): Promise<TaskOutputResult> {
  const path = getTaskOutputPath(shell.id);
  try {
    const result = await tailFile(path, SHELL_DETAIL_TAIL_BYTES);
    return {
      content: result.content,
      bytesTotal: result.bytesTotal
    };
  } catch {
    return {
      content: '',
      bytesTotal: 0
    };
  }
}
export function ShellDetailDialog(t0) {
  const $ = _c(57);
  const {
    shell,
    onDone,
    onKillShell,
    onBack
  } = t0;
  const {
    columns
  } = useTerminalSize();
  let t1;
  if ($[0] !== shell) {
    t1 = () => getTaskOutput(shell);
    $[0] = shell;
    $[1] = t1;
  } else {
    t1 = $[1];
  }
  const [outputPromise, setOutputPromise] = useState(t1);
  const deferredOutputPromise = useDeferredValue(outputPromise);
  let t2;
  if ($[2] !== shell) {
    t2 = () => {
      if (shell.status !== "running") {
        return;
      }
      const timer = setInterval(_temp, 1000, setOutputPromise, shell);
      return () => clearInterval(timer);
    };
    $[2] = shell;
    $[3] = t2;
  } else {
    t2 = $[3];
  }
  let t3;
  if ($[4] !== shell.id || $[5] !== shell.status) {
    t3 = [shell.id, shell.status];
    $[4] = shell.id;
    $[5] = shell.status;
    $[6] = t3;
  } else {
    t3 = $[6];
  }
  useEffect(t2, t3);
  let t4;
  if ($[7] !== onDone) {
    t4 = () => onDone("Shell details dismissed", {
      display: "system"
    });
    $[7] = onDone;
    $[8] = t4;
  } else {
    t4 = $[8];
  }
  const handleClose = t4;
  let t5;
  if ($[9] !== handleClose) {
    t5 = {
      "confirm:yes": handleClose
    };
    $[9] = handleClose;
    $[10] = t5;
  } else {
    t5 = $[10];
  }
  let t6;
  if ($[11] === Symbol.for("react.memo_cache_sentinel")) {
    t6 = {
      context: "Confirmation"
    };
    $[11] = t6;
  } else {
    t6 = $[11];
  }
  useKeybindings(t5, t6);
  let t7;
  if ($[12] !== onBack || $[13] !== onDone || $[14] !== onKillShell || $[15] !== shell.status) {
    t7 = e => {
      if (e.key === " ") {
        e.preventDefault();
        onDone("Shell details dismissed", {
          display: "system"
        });
      } else {
        if (e.key === "left" && onBack) {
          e.preventDefault();
          onBack();
        } else {
          if (e.key === "x" && shell.status === "running" && onKillShell) {
            e.preventDefault();
            onKillShell();
          }
        }
      }
    };
    $[12] = onBack;
    $[13] = onDone;
    $[14] = onKillShell;
    $[15] = shell.status;
    $[16] = t7;
  } else {
    t7 = $[16];
  }
  const handleKeyDown = t7;
  const isMonitor = shell.kind === "monitor";
  let t8;
  if ($[17] !== shell.command) {
    t8 = truncateToWidth(shell.command, 280);
    $[17] = shell.command;
    $[18] = t8;
  } else {
    t8 = $[18];
  }
  const displayCommand = t8;
  const t9 = isMonitor ? "Monitor details" : "Shell details";
  let t10;
  if ($[19] !== onBack || $[20] !== onKillShell || $[21] !== shell.status) {
    t10 = exitState => exitState.pending ? <Text>Press {exitState.keyName} again to exit</Text> : <Byline>{onBack && <KeyboardShortcutHint shortcut={"\u2190"} action="go back" />}<KeyboardShortcutHint shortcut="Esc/Enter/Space" action="close" />{shell.status === "running" && onKillShell && <KeyboardShortcutHint shortcut="x" action="stop" />}</Byline>;
    $[19] = onBack;
    $[20] = onKillShell;
    $[21] = shell.status;
    $[22] = t10;
  } else {
    t10 = $[22];
  }
  let t11;
  if ($[23] === Symbol.for("react.memo_cache_sentinel")) {
    t11 = <Text bold={true}>Status:</Text>;
    $[23] = t11;
  } else {
    t11 = $[23];
  }
  let t12;
  if ($[24] !== shell.result || $[25] !== shell.status) {
    t12 = <Text>{t11}{" "}{shell.status === "running" ? <Text color="background">{shell.status}{shell.result?.code !== undefined && ` (exit code: ${shell.result.code})`}</Text> : shell.status === "completed" ? <Text color="success">{shell.status}{shell.result?.code !== undefined && ` (exit code: ${shell.result.code})`}</Text> : <Text color="error">{shell.status}{shell.result?.code !== undefined && ` (exit code: ${shell.result.code})`}</Text>}</Text>;
    $[24] = shell.result;
    $[25] = shell.status;
    $[26] = t12;
  } else {
    t12 = $[26];
  }
  let t13;
  if ($[27] === Symbol.for("react.memo_cache_sentinel")) {
    t13 = <Text bold={true}>Runtime:</Text>;
    $[27] = t13;
  } else {
    t13 = $[27];
  }
  let t14;
  if ($[28] !== shell.endTime) {
    t14 = shell.endTime ?? Date.now();
    $[28] = shell.endTime;
    $[29] = t14;
  } else {
    t14 = $[29];
  }
  const t15 = t14 - shell.startTime;
  let t16;
  if ($[30] !== t15) {
    t16 = formatDuration(t15);
    $[30] = t15;
    $[31] = t16;
  } else {
    t16 = $[31];
  }
  let t17;
  if ($[32] !== t16) {
    t17 = <Text>{t13}{" "}{t16}</Text>;
    $[32] = t16;
    $[33] = t17;
  } else {
    t17 = $[33];
  }
  const t18 = isMonitor ? "Script:" : "Command:";
  let t19;
  if ($[34] !== t18) {
    t19 = <Text bold={true}>{t18}</Text>;
    $[34] = t18;
    $[35] = t19;
  } else {
    t19 = $[35];
  }
  let t20;
  if ($[36] !== displayCommand || $[37] !== t19) {
    t20 = <Text wrap="wrap">{t19}{" "}{displayCommand}</Text>;
    $[36] = displayCommand;
    $[37] = t19;
    $[38] = t20;
  } else {
    t20 = $[38];
  }
  let t21;
  if ($[39] !== t12 || $[40] !== t17 || $[41] !== t20) {
    t21 = <Box flexDirection="column">{t12}{t17}{t20}</Box>;
    $[39] = t12;
    $[40] = t17;
    $[41] = t20;
    $[42] = t21;
  } else {
    t21 = $[42];
  }
  let t22;
  if ($[43] === Symbol.for("react.memo_cache_sentinel")) {
    t22 = <Text bold={true}>Output:</Text>;
    $[43] = t22;
  } else {
    t22 = $[43];
  }
  let t23;
  if ($[44] === Symbol.for("react.memo_cache_sentinel")) {
    t23 = <Text dimColor={true}>Loading output…</Text>;
    $[44] = t23;
  } else {
    t23 = $[44];
  }
  let t24;
  if ($[45] !== columns || $[46] !== deferredOutputPromise) {
    t24 = <Box flexDirection="column">{t22}<Suspense fallback={t23}><ShellOutputContent outputPromise={deferredOutputPromise} columns={columns} /></Suspense></Box>;
    $[45] = columns;
    $[46] = deferredOutputPromise;
    $[47] = t24;
  } else {
    t24 = $[47];
  }
  let t25;
  if ($[48] !== handleClose || $[49] !== t10 || $[50] !== t21 || $[51] !== t24 || $[52] !== t9) {
    t25 = <Dialog title={t9} onCancel={handleClose} color="background" inputGuide={t10}>{t21}{t24}</Dialog>;
    $[48] = handleClose;
    $[49] = t10;
    $[50] = t21;
    $[51] = t24;
    $[52] = t9;
    $[53] = t25;
  } else {
    t25 = $[53];
  }
  let t26;
  if ($[54] !== handleKeyDown || $[55] !== t25) {
    t26 = <Box flexDirection="column" tabIndex={0} autoFocus={true} onKeyDown={handleKeyDown}>{t25}</Box>;
    $[54] = handleKeyDown;
    $[55] = t25;
    $[56] = t26;
  } else {
    t26 = $[56];
  }
  return t26;
}
function _temp(setOutputPromise_0, shell_0) {
  return setOutputPromise_0(getTaskOutput(shell_0));
}
type ShellOutputContentProps = {
  outputPromise: Promise<TaskOutputResult>;
  columns: number;
};
function ShellOutputContent(t0) {
  const $ = _c(19);
  const {
    outputPromise,
    columns
  } = t0;
  const {
    // @ts-expect-error property does not exist on inferred type
    content,
    // @ts-expect-error property does not exist on inferred type
    bytesTotal
  } = use(outputPromise);
  if (!content) {
    let t1;
    if ($[0] === Symbol.for("react.memo_cache_sentinel")) {
      t1 = <Text dimColor={true}>No output available</Text>;
      $[0] = t1;
    } else {
      t1 = $[0];
    }
    return t1;
  }
  let isIncomplete;
  let rendered;
  if ($[1] !== bytesTotal || $[2] !== content) {
    const starts = [];
    let pos = content.length;
    for (let i = 0; i < 10 && pos > 0; i++) {
      const prev = content.lastIndexOf("\n", pos - 1);
      // @ts-expect-error any-to-never (stub types cause narrowing)
      starts.push(prev + 1 as any);
      pos = prev;
    }
    starts.reverse();
    isIncomplete = bytesTotal > content.length;
    rendered = [];
    for (let i_0 = 0; i_0 < starts.length; i_0++) {
      const start = starts[i_0];
      const end = i_0 < starts.length - 1 ? starts[i_0 + 1] - 1 : content.length;
      const line = content.slice(start, end);
      if (line) {
        rendered.push(line);
      }
    }
    $[1] = bytesTotal;
    $[2] = content;
    $[3] = isIncomplete;
    $[4] = rendered;
  } else {
    isIncomplete = $[3];
    rendered = $[4];
  }
  const t1 = columns - 6;
  let t2;
  if ($[5] !== rendered) {
    t2 = rendered.map(_temp2);
    $[5] = rendered;
    $[6] = t2;
  } else {
    t2 = $[6];
  }
  let t3;
  if ($[7] !== t1 || $[8] !== t2) {
    t3 = <Box borderStyle="round" paddingX={1} flexDirection="column" height={12} maxWidth={t1}>{t2}</Box>;
    $[7] = t1;
    $[8] = t2;
    $[9] = t3;
  } else {
    t3 = $[9];
  }
  const t4 = `Showing ${rendered.length} lines`;
  let t5;
  if ($[10] !== bytesTotal || $[11] !== isIncomplete) {
    t5 = isIncomplete ? ` of ${formatFileSize(bytesTotal)}` : "";
    $[10] = bytesTotal;
    $[11] = isIncomplete;
    $[12] = t5;
  } else {
    t5 = $[12];
  }
  let t6;
  if ($[13] !== t4 || $[14] !== t5) {
    t6 = <Text dimColor={true} italic={true}>{t4}{t5}</Text>;
    $[13] = t4;
    $[14] = t5;
    $[15] = t6;
  } else {
    t6 = $[15];
  }
  let t7;
  if ($[16] !== t3 || $[17] !== t6) {
    t7 = <>{t3}{t6}</>;
    $[16] = t3;
    $[17] = t6;
    $[18] = t7;
  } else {
    t7 = $[18];
  }
  return t7;
}
function _temp2(line_0, i_1) {
  return <Text key={i_1} wrap="truncate-end">{line_0}</Text>;
}
