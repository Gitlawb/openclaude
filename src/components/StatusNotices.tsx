import { c as _c } from "react-compiler-runtime";
import * as React from 'react';
import { Box } from '../ink.js';
import type { AgentDefinitionsResult } from '../tools/AgentTool/loadAgentsDir.js';
import type { MemoryFileInfo } from '../utils/claudemd.js';
import { getMemoryFiles } from '../utils/claudemd.js';
import { getGlobalConfig } from '../utils/config.js';
import { getActiveNotices, type StatusNoticeContext } from '../utils/statusNoticeDefinitions.js';
type Props = {
  agentDefinitions?: AgentDefinitionsResult;
};

let cachedMemoryFiles: MemoryFileInfo[] = [];
let memoryFilesPromise: Promise<void> | null = null;

async function loadMemoryFiles(): Promise<void> {
  if (memoryFilesPromise) {
    return memoryFilesPromise;
  }
  memoryFilesPromise = getMemoryFiles().then(files => {
    cachedMemoryFiles = files;
  }).finally(() => {
    memoryFilesPromise = null;
  });
  return memoryFilesPromise;
}

/**
 * StatusNotices contains the information displayed to users at startup. We have
 * moved neutral or positive status to src/components/Status.tsx instead, which
 * users can access through /status.
 */
export function StatusNotices(t0) {
  const $ = _c(8);
  const {
    agentDefinitions
  } = t0 === undefined ? {} : t0;
  const [memoryFiles, setMemoryFiles] = React.useState(cachedMemoryFiles);
  let t1;
  if ($[0] === Symbol.for("react.memo_cache_sentinel")) {
    t1 = () => {
      if (cachedMemoryFiles.length > 0) {
        setMemoryFiles(cachedMemoryFiles);
        return;
      }
      void loadMemoryFiles().then(() => {
        setMemoryFiles(cachedMemoryFiles);
      });
    };
    $[0] = t1;
  } else {
    t1 = $[0];
  }
  React.useEffect(t1, [t1]);
  const t2 = getGlobalConfig();
  const context = {
    config: t2,
    agentDefinitions,
    memoryFiles
  };
  const activeNotices = getActiveNotices(context);
  if (activeNotices.length === 0) {
    return null;
  }
  const T0 = Box;
  const t3 = "column";
  const t4 = 1;
  const t5 = activeNotices.map(notice => <React.Fragment key={notice.id}>{notice.render(context)}</React.Fragment>);
  let t6;
  if ($[1] !== T0 || $[2] !== t5) {
    t6 = <T0 flexDirection={t3} paddingLeft={t4}>{t5}</T0>;
    $[1] = T0;
    $[2] = t5;
    $[3] = t6;
  } else {
    t6 = $[3];
  }
  return t6;
}
