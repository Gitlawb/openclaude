import { c as _c } from "react-compiler-runtime";
import React from 'react';
import { Link, Text } from '../ink.js';
import type { PrReviewState } from '../utils/ghPrStatus.js';
type Props = {
  number: number;
  url: string;
  reviewState?: PrReviewState;
  bold?: boolean;
};
export function PrBadge(t0: Props): React.ReactNode {
  const $ = _c(21);
  const {
    number,
    url,
    reviewState,
    bold
  } = t0;
  let t1;
  if ($[0] !== reviewState) {
    t1 = getPrStatusColor(reviewState);
    $[0] = reviewState;
    $[1] = t1;
  } else {
    t1 = $[1];
  }
  const statusColor = t1;
  const t2 = !statusColor && !bold;
  let t3;
  if ($[2] !== bold || $[3] !== number || $[4] !== statusColor || $[5] !== t2) {
    t3 = <Text color={statusColor} dimColor={t2} bold={bold}>#{number}</Text>;
    $[2] = bold;
    $[3] = number;
    $[4] = statusColor;
    $[5] = t2;
    $[6] = t3;
  } else {
    t3 = $[6];
  }
  const label = t3;
  const t4 = !bold;
  let t5;
  if ($[7] !== t4) {
    t5 = <Text dimColor={t4}>PR</Text>;
    $[7] = t4;
    $[8] = t5;
  } else {
    t5 = $[8];
  }
  const t6 = !statusColor && !bold;
  let t7;
  if ($[9] !== bold || $[10] !== number || $[11] !== statusColor || $[12] !== t6) {
    t7 = <Text color={statusColor} dimColor={t6} underline={true} bold={bold}>#{number}</Text>;
    $[9] = bold;
    $[10] = number;
    $[11] = statusColor;
    $[12] = t6;
    $[13] = t7;
  } else {
    t7 = $[13];
  }
  let t8;
  if ($[14] !== label || $[15] !== t7 || $[16] !== url) {
    t8 = <Link url={url} fallback={label}>{t7}</Link>;
    $[14] = label;
    $[15] = t7;
    $[16] = url;
    $[17] = t8;
  } else {
    t8 = $[17];
  }
  let t9;
  if ($[18] !== t5 || $[19] !== t8) {
    t9 = <Text>{t5}{" "}{t8}</Text>;
    $[18] = t5;
    $[19] = t8;
    $[20] = t9;
  } else {
    t9 = $[20];
  }
  return t9;
}
function getPrStatusColor(state?: PrReviewState): 'success' | 'error' | 'warning' | 'merged' | undefined {
  switch (state) {
    case 'approved':
      return 'success';
    case 'changes_requested':
      return 'error';
    case 'pending':
      return 'warning';
    case 'merged':
      return 'merged';
    default:
      return undefined;
  }
}
