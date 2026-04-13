import { c as _c } from "react-compiler-runtime";
import { homedir } from 'os';
import { relative } from 'path';
import React from 'react';
import { Box, Text } from '../../ink.js';
import { getCwd } from '../../utils/cwd.js';
export function getRelativeMemoryPath(path: string): string {
  const homeDir = homedir();
  const cwd = getCwd();

  // Calculate relative paths
  const relativeToHome = path.startsWith(homeDir) ? '~' + path.slice(homeDir.length) : null;
  const relativeToCwd = path.startsWith(cwd) ? './' + relative(cwd, path) : null;

  // Return the shorter path, or absolute if neither is applicable
  if (relativeToHome && relativeToCwd) {
    return relativeToHome.length <= relativeToCwd.length ? relativeToHome : relativeToCwd;
  }
  return relativeToHome || relativeToCwd || path;
}
export function MemoryUpdateNotification(t0) {
  const $ = _c(4);
  const {
    memoryPath
  } = t0;
  let t1;
  if ($[0] !== memoryPath) {
    t1 = getRelativeMemoryPath(memoryPath);
    $[0] = memoryPath;
    $[1] = t1;
  } else {
    t1 = $[1];
  }
  const displayPath = t1;
  let t2;
  if ($[2] !== displayPath) {
    t2 = <Box flexDirection="column" flexGrow={1}><Text color="text">Memory updated in {displayPath} · /memory to edit</Text></Box>;
    $[2] = displayPath;
    $[3] = t2;
  } else {
    t2 = $[3];
  }
  return t2;
}
