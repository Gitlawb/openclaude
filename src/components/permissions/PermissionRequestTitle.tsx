import { c as _c } from "react-compiler-runtime";
import * as React from 'react';
import { Box, Text } from '../../ink.js';
import type { Theme } from '../../utils/theme.js';
import type { WorkerBadgeProps } from './WorkerBadge.js';
type Props = {
  title: string;
  subtitle?: React.ReactNode;
  color?: keyof Theme;
  workerBadge?: WorkerBadgeProps;
};
export function PermissionRequestTitle(t0) {
  const $ = _c(13);
  const {
    title,
    subtitle,
    color: t1,
    workerBadge
  } = t0;
  const color = t1 === undefined ? "permission" : t1;
  let t2;
  if ($[0] !== color || $[1] !== title) {
    t2 = <Text bold={true} color={color}>{title}</Text>;
    $[0] = color;
    $[1] = title;
    $[2] = t2;
  } else {
    t2 = $[2];
  }
  let t3;
  if ($[3] !== workerBadge) {
    t3 = workerBadge && <Text dimColor={true}>{"\xB7 "}@{workerBadge.name}</Text>;
    $[3] = workerBadge;
    $[4] = t3;
  } else {
    t3 = $[4];
  }
  let t4;
  if ($[5] !== t2 || $[6] !== t3) {
    t4 = <Box flexDirection="row" gap={1}>{t2}{t3}</Box>;
    $[5] = t2;
    $[6] = t3;
    $[7] = t4;
  } else {
    t4 = $[7];
  }
  let t5;
  if ($[8] !== subtitle) {
    t5 = subtitle != null && (typeof subtitle === "string" ? <Text dimColor={true} wrap="truncate-start">{subtitle}</Text> : subtitle);
    $[8] = subtitle;
    $[9] = t5;
  } else {
    t5 = $[9];
  }
  let t6;
  if ($[10] !== t4 || $[11] !== t5) {
    t6 = <Box flexDirection="column">{t4}{t5}</Box>;
    $[10] = t4;
    $[11] = t5;
    $[12] = t6;
  } else {
    t6 = $[12];
  }
  return t6;
}
