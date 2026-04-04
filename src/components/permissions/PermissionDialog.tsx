import { c as _c } from "react-compiler-runtime";
import * as React from 'react';
import { Box } from '../../ink.js';
import type { Theme } from '../../utils/theme.js';
import { PermissionRequestTitle } from './PermissionRequestTitle.js';
import type { WorkerBadgeProps } from './WorkerBadge.js';
type Props = {
  title: string;
  subtitle?: React.ReactNode;
  color?: keyof Theme;
  titleColor?: keyof Theme;
  innerPaddingX?: number;
  workerBadge?: WorkerBadgeProps;
  titleRight?: React.ReactNode;
  children: React.ReactNode;
};
export function PermissionDialog(t0) {
  const $ = _c(15);
  const {
    title,
    subtitle,
    color: t1,
    titleColor,
    innerPaddingX: t2,
    workerBadge,
    titleRight,
    children
  } = t0;
  const color = t1 === undefined ? "permission" : t1;
  const innerPaddingX = t2 === undefined ? 1 : t2;
  let t3;
  if ($[0] !== subtitle || $[1] !== title || $[2] !== titleColor || $[3] !== workerBadge) {
    t3 = <PermissionRequestTitle title={title} subtitle={subtitle} color={titleColor} workerBadge={workerBadge} />;
    $[0] = subtitle;
    $[1] = title;
    $[2] = titleColor;
    $[3] = workerBadge;
    $[4] = t3;
  } else {
    t3 = $[4];
  }
  let t4;
  if ($[5] !== t3 || $[6] !== titleRight) {
    t4 = <Box paddingX={1} flexDirection="column"><Box justifyContent="space-between">{t3}{titleRight}</Box></Box>;
    $[5] = t3;
    $[6] = titleRight;
    $[7] = t4;
  } else {
    t4 = $[7];
  }
  let t5;
  if ($[8] !== children || $[9] !== innerPaddingX) {
    t5 = <Box flexDirection="column" paddingX={innerPaddingX}>{children}</Box>;
    $[8] = children;
    $[9] = innerPaddingX;
    $[10] = t5;
  } else {
    t5 = $[10];
  }
  let t6;
  if ($[11] !== color || $[12] !== t4 || $[13] !== t5) {
    t6 = <Box flexDirection="column" borderStyle="round" borderColor={color} borderLeft={false} borderRight={false} borderBottom={false} marginTop={1}>{t4}{t5}</Box>;
    $[11] = color;
    $[12] = t4;
    $[13] = t5;
    $[14] = t6;
  } else {
    t6 = $[14];
  }
  return t6;
}
