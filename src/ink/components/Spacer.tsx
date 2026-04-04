import { c as _c } from "react-compiler-runtime";
import React from 'react';
import Box from './Box.js';

/**
 * A flexible space that expands along the major axis of its containing layout.
 * It's useful as a shortcut for filling all the available spaces between elements.
 */
export default function Spacer() {
  const $ = _c(1);
  let t0;
  if ($[0] === Symbol.for("react.memo_cache_sentinel")) {
    t0 = <Box flexGrow={1} />;
    $[0] = t0;
  } else {
    t0 = $[0];
  }
  return t0;
}
