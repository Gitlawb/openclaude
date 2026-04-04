import { c as _c } from "react-compiler-runtime";
import figures from 'figures';
import * as React from 'react';
import { Box, Text } from 'src/ink.js';
type Props = {
  hasStash: boolean;
};
export function PromptInputStashNotice(t0) {
  const $ = _c(1);
  const {
    hasStash
  } = t0;
  if (!hasStash) {
    return null;
  }
  let t1;
  if ($[0] === Symbol.for("react.memo_cache_sentinel")) {
    t1 = <Box paddingLeft={2}><Text dimColor={true}>{figures.pointerSmall} Stashed (auto-restores after submit)</Text></Box>;
    $[0] = t1;
  } else {
    t1 = $[0];
  }
  return t1;
}
