import { c as _c } from "react-compiler-runtime";
import * as React from 'react';
import { useState } from 'react';
import { getSlowOperations } from '../bootstrap/state.js';
import { Text, useInterval } from '../ink.js';

// Show DevBar for dev builds or all ants
function shouldShowDevBar(): boolean {
  return "production" === 'development' || "external" === 'ant';
}
export function DevBar() {
  const $ = _c(5);
  const [slowOps, setSlowOps] = useState(getSlowOperations);
  let t0;
  if ($[0] === Symbol.for("react.memo_cache_sentinel")) {
    t0 = () => {
      setSlowOps(getSlowOperations());
    };
    $[0] = t0;
  } else {
    t0 = $[0];
  }
  useInterval(t0, shouldShowDevBar() ? 500 : null);
  if (!shouldShowDevBar() || slowOps.length === 0) {
    return null;
  }
  let t1;
  if ($[1] !== slowOps) {
    t1 = slowOps.slice(-3).map(_temp).join(" \xB7 ");
    $[1] = slowOps;
    $[2] = t1;
  } else {
    t1 = $[2];
  }
  const recentOps = t1;
  let t2;
  if ($[3] !== recentOps) {
    t2 = <Text wrap="truncate-end" color="warning">[ANT-ONLY] slow sync: {recentOps}</Text>;
    $[3] = recentOps;
    $[4] = t2;
  } else {
    t2 = $[4];
  }
  return t2;
}
function _temp(op) {
  return `${op.operation} (${Math.round(op.durationMs)}ms)`;
}
