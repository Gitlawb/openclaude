import { c as _c } from "react-compiler-runtime";
import chalk from 'chalk';
import { LIGHTNING_BOLT } from '../constants/figures.js';
import { Text } from '../ink.js';
import { getGlobalConfig } from '../utils/config.js';
import { resolveThemeSetting } from '../utils/systemTheme.js';
import { color } from './design-system/color.js';
type Props = {
  cooldown?: boolean;
};
export function FastIcon(t0: Props) {
  const $ = _c(2);
  const {
    cooldown
  } = t0;
  if (cooldown) {
    let t1;
    if ($[0] === Symbol.for("react.memo_cache_sentinel")) {
      t1 = <Text color="promptBorder" dimColor={true}>{LIGHTNING_BOLT}</Text>;
      $[0] = t1;
    } else {
      t1 = $[0];
    }
    return t1;
  }
  let t1;
  if ($[1] === Symbol.for("react.memo_cache_sentinel")) {
    t1 = <Text color="fastMode">{LIGHTNING_BOLT}</Text>;
    $[1] = t1;
  } else {
    t1 = $[1];
  }
  return t1;
}
export function getFastIconString(applyColor = true, cooldown = false): string {
  if (!applyColor) {
    return LIGHTNING_BOLT;
  }
  const themeName = resolveThemeSetting(getGlobalConfig().theme);
  if (cooldown) {
    return chalk.dim(color('promptBorder', themeName)(LIGHTNING_BOLT));
  }
  return color('fastMode', themeName)(LIGHTNING_BOLT);
}
