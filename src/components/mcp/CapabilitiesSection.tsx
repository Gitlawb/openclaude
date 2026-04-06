import { c as _c } from "react-compiler-runtime";
import React from 'react';
import { Box, Text } from '../../ink.js';
import { Byline } from '../design-system/Byline.js';
type Props = {
  serverToolsCount: number;
  serverPromptsCount: number;
  serverResourcesCount: number;
};
export function CapabilitiesSection(t0) {
  const $ = _c(9);
  const {
    serverToolsCount,
    serverPromptsCount,
    serverResourcesCount
  } = t0;
  let capabilities;
  if ($[0] !== serverPromptsCount || $[1] !== serverResourcesCount || $[2] !== serverToolsCount) {
    capabilities = [];
    if (serverToolsCount > 0) {
      capabilities.push("tools");
    }
    if (serverResourcesCount > 0) {
      capabilities.push("resources");
    }
    if (serverPromptsCount > 0) {
      capabilities.push("prompts");
    }
    $[0] = serverPromptsCount;
    $[1] = serverResourcesCount;
    $[2] = serverToolsCount;
    $[3] = capabilities;
  } else {
    capabilities = $[3];
  }
  let t1;
  if ($[4] === Symbol.for("react.memo_cache_sentinel")) {
    t1 = <Text bold={true}>Capabilities: </Text>;
    $[4] = t1;
  } else {
    t1 = $[4];
  }
  let t2;
  if ($[5] !== capabilities) {
    t2 = capabilities.length > 0 ? <Byline>{capabilities}</Byline> : "none";
    $[5] = capabilities;
    $[6] = t2;
  } else {
    t2 = $[6];
  }
  let t3;
  if ($[7] !== t2) {
    t3 = <Box>{t1}<Text color="text">{t2}</Text></Box>;
    $[7] = t2;
    $[8] = t3;
  } else {
    t3 = $[8];
  }
  return t3;
}
