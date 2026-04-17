import { c as _c } from "react-compiler-runtime";
import figures from 'figures';
import * as React from 'react';
import { Box, Text } from '../../ink.js';
import { getPluginTrustMessage } from '../../utils/plugins/marketplaceHelpers.js';
export function PluginTrustWarning() {
  const $ = _c(3);
  let t0;
  if ($[0] === Symbol.for("react.memo_cache_sentinel")) {
    t0 = getPluginTrustMessage();
    $[0] = t0;
  } else {
    t0 = $[0];
  }
  const customMessage = t0;
  let t1;
  if ($[1] === Symbol.for("react.memo_cache_sentinel")) {
    t1 = <Text color="claude">{figures.warning} </Text>;
    $[1] = t1;
  } else {
    t1 = $[1];
  }
  let t2;
  if ($[2] === Symbol.for("react.memo_cache_sentinel")) {
    t2 = <Box marginBottom={1}>{t1}<Text dimColor={true} italic={true}>Переконайтесь, що довіряєте плагіну, перш ніж встановлювати, оновлювати чи використовувати його. Anthropic не контролює MCP сервери, файли чи інше ПЗ, включене у плагіни, і не може гарантувати їхню роботу чи незмінність. Дивіться домашню сторінку кожного плагіна для докладнішої інформації.{customMessage ? ` ${customMessage}` : ""}</Text></Box>;
    $[2] = t2;
  } else {
    t2 = $[2];
  }
  return t2;
}
