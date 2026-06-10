import { c as _c } from "react-compiler-runtime";
import * as React from 'react';
import { Box } from '../ink.js';
import { useAppState } from '../state/AppState.js';
import type { AgentDefinitionsResult } from '../tools/AgentTool/loadAgentsDir.js';
import type { MemoryFileInfo } from '../utils/claudemd.js';
import { getMemoryFiles } from '../utils/claudemd.js';
import { getGlobalConfig } from '../utils/config.js';
import { getActiveNotices, type StatusNoticeContext } from '../utils/statusNoticeDefinitions.js';
import { assembleToolPool } from '../tools.js';
import { checkLocalModelContextLoad, isActiveProviderLocalModel, type LocalModelContextWarning } from '../utils/statusNoticeLocalModel.js';
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
  const mcpTools = useAppState(s => s.mcp.tools);
  const toolPermissionContext = useAppState(s => s.toolPermissionContext);
  const tools = React.useMemo(() => assembleToolPool(toolPermissionContext, mcpTools), [toolPermissionContext, mcpTools]);
  const [memoryFiles, setMemoryFiles] = React.useState(cachedMemoryFiles);
  const [localModelContextLoad, setLocalModelContextLoad] = React.useState<LocalModelContextWarning | null | undefined>(undefined);
  const isLocalModel = isActiveProviderLocalModel();
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
  React.useEffect(() => {
    let cancelled = false;
    if (!isLocalModel) {
      setLocalModelContextLoad(null);
      return;
    }
    void checkLocalModelContextLoad(
      tools,
      agentDefinitions,
      memoryFiles,
      async () => toolPermissionContext,
    ).then(warning => {
      if (!cancelled) {
        setLocalModelContextLoad(warning);
      }
    }).catch(() => {
      if (!cancelled) {
        setLocalModelContextLoad(null);
      }
    });
    return () => {
      cancelled = true;
    };
  }, [agentDefinitions, isLocalModel, memoryFiles, toolPermissionContext, tools]);
  const t2 = getGlobalConfig();
  const permissionMode = useAppState(s => s.toolPermissionContext.mode);
  const mainLoopModel = useAppState(s => s.mainLoopModel);
  const context: StatusNoticeContext = {
    config: t2,
    agentDefinitions,
    memoryFiles,
    isLocalModel,
    localModelContextLoad,
    permissionMode,
    mainLoopModel: mainLoopModel ?? undefined,
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
