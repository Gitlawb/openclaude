import { c as _c } from "react-compiler-runtime";
import React from 'react';
import { Text } from '../../ink.js';
import type { CollapsedReadSearchGroup } from '../../types/message.js';

/**
 * Plain function (not a React component) so the React Compiler won't
 * hoist the teamMemory* property accesses for memoization. This module
 * is only loaded when feature('TEAMMEM') is true.
 */
export function checkHasTeamMemOps(message: CollapsedReadSearchGroup): boolean {
  return (message.teamMemorySearchCount ?? 0) > 0 || (message.teamMemoryReadCount ?? 0) > 0 || (message.teamMemoryWriteCount ?? 0) > 0;
}

/**
 * Renders team memory count parts for the collapsed read/search UI.
 * This module is only loaded when feature('TEAMMEM') is true,
 * so DCE removes it entirely from external builds.
 */
export function TeamMemCountParts(t0) {
  const $ = _c(23);
  const {
    message,
    isActiveGroup,
    hasPrecedingParts
  } = t0;
  const tmReadCount = message.teamMemoryReadCount ?? 0;
  const tmSearchCount = message.teamMemorySearchCount ?? 0;
  const tmWriteCount = message.teamMemoryWriteCount ?? 0;
  if (tmReadCount === 0 && tmSearchCount === 0 && tmWriteCount === 0) {
    return null;
  }
  let t1;
  if ($[0] !== hasPrecedingParts || $[1] !== isActiveGroup || $[2] !== tmReadCount || $[3] !== tmSearchCount || $[4] !== tmWriteCount) {
    const nodes = [];
    let count = hasPrecedingParts ? 1 : 0;
    if (tmReadCount > 0) {
      const verb = isActiveGroup ? count === 0 ? "Recalling" : "recalling" : count === 0 ? "Recalled" : "recalled";
      if (count > 0) {
        let t2;
        if ($[6] === Symbol.for("react.memo_cache_sentinel")) {
          t2 = <Text key="comma-tmr">, </Text>;
          $[6] = t2;
        } else {
          t2 = $[6];
        }
        // @ts-expect-error any-to-never (stub types cause narrowing)
        nodes.push(t2 as any);
      }
      let t2;
      if ($[7] !== tmReadCount) {
        t2 = <Text bold={true}>{tmReadCount}</Text>;
        $[7] = tmReadCount;
        $[8] = t2;
      } else {
        t2 = $[8];
      }
      const t3 = tmReadCount === 1 ? "memory" : "memories";
      let t4;
      if ($[9] !== t2 || $[10] !== t3 || $[11] !== verb) {
        t4 = <Text key="team-mem-read">{verb} {t2} team{" "}{t3}</Text>;
        $[9] = t2;
        $[10] = t3;
        $[11] = verb;
        $[12] = t4;
      } else {
        t4 = $[12];
      }
      // @ts-expect-error any-to-never (stub types cause narrowing)
      nodes.push(t4 as any);
      count++;
    }
    if (tmSearchCount > 0) {
      const verb_0 = isActiveGroup ? count === 0 ? "Searching" : "searching" : count === 0 ? "Searched" : "searched";
      if (count > 0) {
        let t2;
        if ($[13] === Symbol.for("react.memo_cache_sentinel")) {
          t2 = <Text key="comma-tms">, </Text>;
          $[13] = t2;
        } else {
          t2 = $[13];
        }
        // @ts-expect-error any-to-never (stub types cause narrowing)
        nodes.push(t2 as any);
      }
      const t2 = `${verb_0} team memories`;
      let t3;
      if ($[14] !== t2) {
        t3 = <Text key="team-mem-search">{t2}</Text>;
        $[14] = t2;
        $[15] = t3;
      } else {
        t3 = $[15];
      }
      // @ts-expect-error any-to-never (stub types cause narrowing)
      nodes.push(t3 as any);
      count++;
    }
    if (tmWriteCount > 0) {
      const verb_1 = isActiveGroup ? count === 0 ? "Writing" : "writing" : count === 0 ? "Wrote" : "wrote";
      if (count > 0) {
        let t2;
        if ($[16] === Symbol.for("react.memo_cache_sentinel")) {
          t2 = <Text key="comma-tmw">, </Text>;
          $[16] = t2;
        } else {
          t2 = $[16];
        }
        // @ts-expect-error any-to-never (stub types cause narrowing)
        nodes.push(t2 as any);
      }
      let t2;
      if ($[17] !== tmWriteCount) {
        t2 = <Text bold={true}>{tmWriteCount}</Text>;
        $[17] = tmWriteCount;
        $[18] = t2;
      } else {
        t2 = $[18];
      }
      const t3 = tmWriteCount === 1 ? "memory" : "memories";
      let t4;
      if ($[19] !== t2 || $[20] !== t3 || $[21] !== verb_1) {
        t4 = <Text key="team-mem-write">{verb_1} {t2} team{" "}{t3}</Text>;
        $[19] = t2;
        $[20] = t3;
        $[21] = verb_1;
        $[22] = t4;
      } else {
        t4 = $[22];
      }
      // @ts-expect-error any-to-never (stub types cause narrowing)
      nodes.push(t4 as any);
    }
    t1 = <>{nodes}</>;
    $[0] = hasPrecedingParts;
    $[1] = isActiveGroup;
    $[2] = tmReadCount;
    $[3] = tmSearchCount;
    $[4] = tmWriteCount;
    $[5] = t1;
  } else {
    t1 = $[5];
  }
  return t1;
}
