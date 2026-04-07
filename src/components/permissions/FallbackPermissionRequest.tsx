import { c as _c } from "react-compiler-runtime";
import React, { useCallback, useMemo } from 'react';
import { getOriginalCwd } from '../../bootstrap/state.js';
import { Box, Text, useTheme } from '../../ink.js';
import { sanitizeToolNameForAnalytics } from '../../services/analytics/metadata.js';
import { env } from '../../utils/env.js';
import { shouldShowAlwaysAllowOptions } from '../../utils/permissions/permissionsLoader.js';
import { truncateToLines } from '../../utils/stringUtils.js';
import { logUnaryEvent } from '../../utils/unaryLogging.js';
import { type UnaryEvent, usePermissionRequestLogging } from './hooks.js';
import { PermissionDialog } from './PermissionDialog.js';
import { PermissionPrompt, type PermissionPromptOption, type ToolAnalyticsContext } from './PermissionPrompt.js';
import type { PermissionRequestProps } from './PermissionRequest.js';
import { PermissionRuleExplanation } from './PermissionRuleExplanation.js';
type FallbackOptionValue = 'yes' | 'yes-dont-ask-again' | 'no';
export function FallbackPermissionRequest(t0) {
  const $ = _c(58);
  const {
    toolUseConfirm,
    onDone,
    onReject,
    workerBadge
  } = t0;
  const [theme] = useTheme();
  let originalUserFacingName;
  let t1;
  if ($[0] !== toolUseConfirm.input || $[1] !== toolUseConfirm.tool) {
    originalUserFacingName = toolUseConfirm.tool.userFacingName(toolUseConfirm.input as never);
    t1 = originalUserFacingName.endsWith(" (MCP)") ? originalUserFacingName.slice(0, -6) : originalUserFacingName;
    $[0] = toolUseConfirm.input;
    $[1] = toolUseConfirm.tool;
    $[2] = originalUserFacingName;
    $[3] = t1;
  } else {
    originalUserFacingName = $[2];
    t1 = $[3];
  }
  const userFacingName = t1;
  let t2;
  if ($[4] === Symbol.for("react.memo_cache_sentinel")) {
    t2 = {
      completion_type: "tool_use_single",
      language_name: "none"
    };
    $[4] = t2;
  } else {
    t2 = $[4];
  }
  const unaryEvent = t2;
  usePermissionRequestLogging(toolUseConfirm, unaryEvent);
  let t3;
  if ($[5] !== onDone || $[6] !== onReject || $[7] !== toolUseConfirm) {
    t3 = (value, feedback) => {
      bb8: switch (value) {
        case "yes":
          {
            logUnaryEvent({
              completion_type: "tool_use_single",
              event: "accept",
              metadata: {
                language_name: "none",
                message_id: toolUseConfirm.assistantMessage.message.id,
                platform: env.platform
              }
            });
            toolUseConfirm.onAllow(toolUseConfirm.input, [], feedback);
            onDone();
            break bb8;
          }
        case "yes-dont-ask-again":
          {
            logUnaryEvent({
              completion_type: "tool_use_single",
              event: "accept",
              metadata: {
                language_name: "none",
                message_id: toolUseConfirm.assistantMessage.message.id,
                platform: env.platform
              }
            });
            toolUseConfirm.onAllow(toolUseConfirm.input, [{
              type: "addRules",
              rules: [{
                toolName: toolUseConfirm.tool.name
              }],
              behavior: "allow",
              destination: "localSettings"
            }]);
            onDone();
            break bb8;
          }
        case "no":
          {
            logUnaryEvent({
              completion_type: "tool_use_single",
              event: "reject",
              metadata: {
                language_name: "none",
                message_id: toolUseConfirm.assistantMessage.message.id,
                platform: env.platform
              }
            });
            toolUseConfirm.onReject(feedback);
            onReject();
            onDone();
          }
      }
    };
    $[5] = onDone;
    $[6] = onReject;
    $[7] = toolUseConfirm;
    $[8] = t3;
  } else {
    t3 = $[8];
  }
  const handleSelect = t3;
  let t4;
  if ($[9] !== onDone || $[10] !== onReject || $[11] !== toolUseConfirm) {
    t4 = () => {
      logUnaryEvent({
        completion_type: "tool_use_single",
        event: "reject",
        metadata: {
          language_name: "none",
          message_id: toolUseConfirm.assistantMessage.message.id,
          platform: env.platform
        }
      });
      toolUseConfirm.onReject();
      onReject();
      onDone();
    };
    $[9] = onDone;
    $[10] = onReject;
    $[11] = toolUseConfirm;
    $[12] = t4;
  } else {
    t4 = $[12];
  }
  const handleCancel = t4;
  let t5;
  if ($[13] === Symbol.for("react.memo_cache_sentinel")) {
    t5 = getOriginalCwd();
    $[13] = t5;
  } else {
    t5 = $[13];
  }
  const originalCwd = t5;
  let t6;
  if ($[14] === Symbol.for("react.memo_cache_sentinel")) {
    t6 = shouldShowAlwaysAllowOptions();
    $[14] = t6;
  } else {
    t6 = $[14];
  }
  const showAlwaysAllowOptions = t6;
  let t7;
  if ($[15] === Symbol.for("react.memo_cache_sentinel")) {
    t7 = {
      label: "Yes",
      value: "yes",
      feedbackConfig: {
        type: "accept"
      }
    };
    $[15] = t7;
  } else {
    t7 = $[15];
  }
  let result;
  if ($[16] !== userFacingName) {
    result = [t7];
    if (showAlwaysAllowOptions) {
      const t8 = <Text bold={true}>{userFacingName}</Text>;
      let t9;
      if ($[18] === Symbol.for("react.memo_cache_sentinel")) {
        t9 = <Text bold={true}>{originalCwd}</Text>;
        $[18] = t9;
      } else {
        t9 = $[18];
      }
      let t10;
      if ($[19] !== t8) {
        t10 = {
          label: <Text>Yes, and don't ask again for {t8}{" "}commands in {t9}</Text>,
          value: "yes-dont-ask-again"
        };
        $[19] = t8;
        $[20] = t10;
      } else {
        t10 = $[20];
      }
      result.push(t10);
    }
    let t8;
    if ($[21] === Symbol.for("react.memo_cache_sentinel")) {
      t8 = {
        label: "No",
        value: "no",
        feedbackConfig: {
          type: "reject"
        }
      };
      $[21] = t8;
    } else {
      t8 = $[21];
    }
    result.push(t8);
    $[16] = userFacingName;
    $[17] = result;
  } else {
    result = $[17];
  }
  const options = result;
  let t8;
  if ($[22] !== toolUseConfirm.tool.name) {
    t8 = sanitizeToolNameForAnalytics(toolUseConfirm.tool.name);
    $[22] = toolUseConfirm.tool.name;
    $[23] = t8;
  } else {
    t8 = $[23];
  }
  const t9 = toolUseConfirm.tool.isMcp ?? false;
  let t10;
  if ($[24] !== t8 || $[25] !== t9) {
    t10 = {
      toolName: t8,
      isMcp: t9
    };
    $[24] = t8;
    $[25] = t9;
    $[26] = t10;
  } else {
    t10 = $[26];
  }
  const toolAnalyticsContext = t10;
  let t11;
  if ($[27] !== theme || $[28] !== toolUseConfirm.input || $[29] !== toolUseConfirm.tool) {
    t11 = toolUseConfirm.tool.renderToolUseMessage(toolUseConfirm.input as never, {
      theme,
      verbose: true
    });
    $[27] = theme;
    $[28] = toolUseConfirm.input;
    $[29] = toolUseConfirm.tool;
    $[30] = t11;
  } else {
    t11 = $[30];
  }
  let t12;
  if ($[31] !== originalUserFacingName) {
    t12 = originalUserFacingName.endsWith(" (MCP)") ? <Text dimColor={true}> (MCP)</Text> : "";
    $[31] = originalUserFacingName;
    $[32] = t12;
  } else {
    t12 = $[32];
  }
  let t13;
  if ($[33] !== t11 || $[34] !== t12 || $[35] !== userFacingName) {
    t13 = <Text>{userFacingName}({t11}){t12}</Text>;
    $[33] = t11;
    $[34] = t12;
    $[35] = userFacingName;
    $[36] = t13;
  } else {
    t13 = $[36];
  }
  let t14;
  if ($[37] !== toolUseConfirm.description) {
    t14 = truncateToLines(toolUseConfirm.description, 3);
    $[37] = toolUseConfirm.description;
    $[38] = t14;
  } else {
    t14 = $[38];
  }
  let t15;
  if ($[39] !== t14) {
    t15 = <Text dimColor={true}>{t14}</Text>;
    $[39] = t14;
    $[40] = t15;
  } else {
    t15 = $[40];
  }
  let t16;
  if ($[41] !== t13 || $[42] !== t15) {
    t16 = <Box flexDirection="column" paddingX={2} paddingY={1}>{t13}{t15}</Box>;
    $[41] = t13;
    $[42] = t15;
    $[43] = t16;
  } else {
    t16 = $[43];
  }
  let t17;
  if ($[44] !== toolUseConfirm.permissionResult) {
    t17 = <PermissionRuleExplanation permissionResult={toolUseConfirm.permissionResult} toolType="tool" />;
    $[44] = toolUseConfirm.permissionResult;
    $[45] = t17;
  } else {
    t17 = $[45];
  }
  let t18;
  if ($[46] !== handleCancel || $[47] !== handleSelect || $[48] !== options || $[49] !== toolAnalyticsContext) {
    t18 = <PermissionPrompt options={options} onSelect={handleSelect} onCancel={handleCancel} toolAnalyticsContext={toolAnalyticsContext} />;
    $[46] = handleCancel;
    $[47] = handleSelect;
    $[48] = options;
    $[49] = toolAnalyticsContext;
    $[50] = t18;
  } else {
    t18 = $[50];
  }
  let t19;
  if ($[51] !== t17 || $[52] !== t18) {
    t19 = <Box flexDirection="column">{t17}{t18}</Box>;
    $[51] = t17;
    $[52] = t18;
    $[53] = t19;
  } else {
    t19 = $[53];
  }
  let t20;
  if ($[54] !== t16 || $[55] !== t19 || $[56] !== workerBadge) {
    t20 = <PermissionDialog title="Tool use" workerBadge={workerBadge}>{t16}{t19}</PermissionDialog>;
    $[54] = t16;
    $[55] = t19;
    $[56] = workerBadge;
    $[57] = t20;
  } else {
    t20 = $[57];
  }
  return t20;
}
