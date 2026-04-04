import { c as _c } from "react-compiler-runtime";
import * as React from 'react';
import { useExitOnCtrlCDWithKeybindings } from '../../hooks/useExitOnCtrlCDWithKeybindings.js';
import { Box, Text } from '../../ink.js';
type Props = {
  instructions?: string;
};
export function AgentNavigationFooter(t0) {
  const $ = _c(2);
  const {
    instructions: t1
  } = t0;
  const instructions = t1 === undefined ? "Press \u2191\u2193 to navigate \xB7 Enter to select \xB7 Esc to go back" : t1;
  const exitState = useExitOnCtrlCDWithKeybindings();
  const t2 = exitState.pending ? `Press ${exitState.keyName} again to exit` : instructions;
  let t3;
  if ($[0] !== t2) {
    t3 = <Box marginLeft={2}><Text dimColor={true}>{t2}</Text></Box>;
    $[0] = t2;
    $[1] = t3;
  } else {
    t3 = $[1];
  }
  return t3;
}
