import { c as _c } from "react-compiler-runtime";
import React from 'react';
import { Box } from '../ink.js';
import { BashTool } from '../tools/BashTool/BashTool.js';
import type { ShellProgress } from '../types/tools.js';
import { UserBashInputMessage } from './messages/UserBashInputMessage.js';
import { ShellProgressMessage } from './shell/ShellProgressMessage.js';
type Props = {
  input: string;
  progress: ShellProgress | null;
  verbose: boolean;
};
export function BashModeProgress(t0) {
  const $ = _c(8);
  const {
    input,
    progress,
    verbose
  } = t0;
  const t1 = `<bash-input>${input}</bash-input>`;
  let t2;
  if ($[0] !== t1) {
    t2 = <UserBashInputMessage addMargin={false} param={{
      text: t1,
      type: "text"
    }} />;
    $[0] = t1;
    $[1] = t2;
  } else {
    t2 = $[1];
  }
  let t3;
  if ($[2] !== progress || $[3] !== verbose) {
    t3 = progress ? <ShellProgressMessage fullOutput={progress.fullOutput} output={progress.output} elapsedTimeSeconds={progress.elapsedTimeSeconds} totalLines={progress.totalLines} verbose={verbose} /> : BashTool.renderToolUseProgressMessage?.([], {
      verbose,
      tools: [],
      terminalSize: undefined
    });
    $[2] = progress;
    $[3] = verbose;
    $[4] = t3;
  } else {
    t3 = $[4];
  }
  let t4;
  if ($[5] !== t2 || $[6] !== t3) {
    t4 = <Box flexDirection="column" marginTop={1}>{t2}{t3}</Box>;
    $[5] = t2;
    $[6] = t3;
    $[7] = t4;
  } else {
    t4 = $[7];
  }
  return t4;
}
