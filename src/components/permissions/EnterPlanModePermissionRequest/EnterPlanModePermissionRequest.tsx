import { c as _c } from "react-compiler-runtime";
import React from 'react';
import { handlePlanModeTransition } from '../../../bootstrap/state.js';
import { Box, Text } from '../../../ink.js';
import { type AnalyticsMetadata_I_VERIFIED_THIS_IS_NOT_CODE_OR_FILEPATHS, logEvent } from '../../../services/analytics/index.js';
import { useAppState } from '../../../state/AppState.js';
import { isPlanModeInterviewPhaseEnabled } from '../../../utils/planModeV2.js';
import { Select } from '../../CustomSelect/index.js';
import { PermissionDialog } from '../PermissionDialog.js';
import type { PermissionRequestProps } from '../PermissionRequest.js';
export function EnterPlanModePermissionRequest(t0) {
  const $ = _c(18);
  const {
    toolUseConfirm,
    onDone,
    onReject,
    workerBadge
  } = t0;
  const toolPermissionContextMode = useAppState(_temp);
  let t1;
  if ($[0] !== onDone || $[1] !== onReject || $[2] !== toolPermissionContextMode || $[3] !== toolUseConfirm) {
    t1 = function handleResponse(value) {
      if (value === "yes") {
        logEvent("tengu_plan_enter", {
          interviewPhaseEnabled: isPlanModeInterviewPhaseEnabled(),
          entryMethod: "tool" as AnalyticsMetadata_I_VERIFIED_THIS_IS_NOT_CODE_OR_FILEPATHS
        });
        handlePlanModeTransition(toolPermissionContextMode, "plan");
        onDone();
        toolUseConfirm.onAllow({}, [{
          type: "setMode",
          mode: "plan",
          destination: "session"
        }]);
      } else {
        onDone();
        onReject();
        toolUseConfirm.onReject();
      }
    };
    $[0] = onDone;
    $[1] = onReject;
    $[2] = toolPermissionContextMode;
    $[3] = toolUseConfirm;
    $[4] = t1;
  } else {
    t1 = $[4];
  }
  const handleResponse = t1;
  let t2;
  if ($[5] === Symbol.for("react.memo_cache_sentinel")) {
    t2 = <Text>Нейромережа хоче увійти в режим планування для дослідження та проєктування підходу.</Text>;
    $[5] = t2;
  } else {
    t2 = $[5];
  }
  let t3;
  if ($[6] === Symbol.for("react.memo_cache_sentinel")) {
    t3 = <Box marginTop={1} flexDirection="column"><Text dimColor={true}>In plan mode, the model will:</Text><Text dimColor={true}> · Explore the codebase thoroughly</Text><Text dimColor={true}> · Identify existing patterns</Text><Text dimColor={true}> · Design an implementation strategy</Text><Text dimColor={true}> · Present a plan for your approval</Text></Box>;
    $[6] = t3;
  } else {
    t3 = $[6];
  }
  let t4;
  if ($[7] === Symbol.for("react.memo_cache_sentinel")) {
    t4 = <Box marginTop={1}><Text dimColor={true}>No code changes will be made until you approve the plan.</Text></Box>;
    $[7] = t4;
  } else {
    t4 = $[7];
  }
  let t5;
  if ($[8] === Symbol.for("react.memo_cache_sentinel")) {
    t5 = {
      label: "Yes, enter plan mode",
      value: "yes" as const
    };
    $[8] = t5;
  } else {
    t5 = $[8];
  }
  let t6;
  if ($[9] === Symbol.for("react.memo_cache_sentinel")) {
    t6 = [t5, {
      label: "No, start implementing now",
      value: "no" as const
    }];
    $[9] = t6;
  } else {
    t6 = $[9];
  }
  let t7;
  if ($[10] !== handleResponse) {
    t7 = () => handleResponse("no");
    $[10] = handleResponse;
    $[11] = t7;
  } else {
    t7 = $[11];
  }
  let t8;
  if ($[12] !== handleResponse || $[13] !== t7) {
    t8 = <Box flexDirection="column" marginTop={1} paddingX={1}>{t2}{t3}{t4}<Box marginTop={1}><Select options={t6} onChange={handleResponse} onCancel={t7} /></Box></Box>;
    $[12] = handleResponse;
    $[13] = t7;
    $[14] = t8;
  } else {
    t8 = $[14];
  }
  let t9;
  if ($[15] !== t8 || $[16] !== workerBadge) {
    t9 = <PermissionDialog color="planMode" title="Enter plan mode?" workerBadge={workerBadge}>{t8}</PermissionDialog>;
    $[15] = t8;
    $[16] = workerBadge;
    $[17] = t9;
  } else {
    t9 = $[17];
  }
  return t9;
}
function _temp(s) {
  return s.toolPermissionContext.mode;
}
