import { c as _c } from "react-compiler-runtime";
import React, { useCallback, useMemo } from 'react';
import { logError } from 'src/utils/log.js';
import { getOriginalCwd } from '../../../bootstrap/state.js';
import { PRODUCT_DISPLAY_NAME } from '../../../constants/product.js';
import { Box, Text } from '../../../ink.js';
import { sanitizeToolNameForAnalytics } from '../../../services/analytics/metadata.js';
import { SKILL_TOOL_NAME } from '../../../tools/SkillTool/constants.js';
import { SkillTool } from '../../../tools/SkillTool/SkillTool.js';
import { env } from '../../../utils/env.js';
import { shouldShowAlwaysAllowOptions } from '../../../utils/permissions/permissionsLoader.js';
import { logUnaryEvent } from '../../../utils/unaryLogging.js';
import { type UnaryEvent, usePermissionRequestLogging } from '../hooks.js';
import { PermissionDialog } from '../PermissionDialog.js';
import { PermissionPrompt, type PermissionPromptOption, type ToolAnalyticsContext } from '../PermissionPrompt.js';
import type { PermissionRequestProps } from '../PermissionRequest.js';
import { PermissionRuleExplanation } from '../PermissionRuleExplanation.js';
type SkillOptionValue = 'yes' | 'yes-exact' | 'yes-prefix' | 'no';
export function SkillPermissionRequest(props) {
  const $ = _c(51);
  const {
    toolUseConfirm,
    onDone,
    onReject,
    workerBadge
  } = props;
  const parseInput = _temp;
  let t0;
  if ($[0] !== toolUseConfirm.input) {
    t0 = parseInput(toolUseConfirm.input);
    $[0] = toolUseConfirm.input;
    $[1] = t0;
  } else {
    t0 = $[1];
  }
  const skill = t0;
  const commandObj = toolUseConfirm.permissionResult.behavior === "ask" && toolUseConfirm.permissionResult.metadata && "command" in toolUseConfirm.permissionResult.metadata ? toolUseConfirm.permissionResult.metadata.command : undefined;
  let t1;
  if ($[2] === Symbol.for("react.memo_cache_sentinel")) {
    t1 = {
      completion_type: "tool_use_single",
      language_name: "none"
    };
    $[2] = t1;
  } else {
    t1 = $[2];
  }
  const unaryEvent = t1;
  usePermissionRequestLogging(toolUseConfirm, unaryEvent);
  let t2;
  if ($[3] === Symbol.for("react.memo_cache_sentinel")) {
    t2 = getOriginalCwd();
    $[3] = t2;
  } else {
    t2 = $[3];
  }
  const originalCwd = t2;
  let t3;
  if ($[4] === Symbol.for("react.memo_cache_sentinel")) {
    t3 = shouldShowAlwaysAllowOptions();
    $[4] = t3;
  } else {
    t3 = $[4];
  }
  const showAlwaysAllowOptions = t3;
  let t4;
  if ($[5] === Symbol.for("react.memo_cache_sentinel")) {
    t4 = [{
      label: "Yes",
      value: "yes",
      feedbackConfig: {
        type: "accept"
      }
    }];
    $[5] = t4;
  } else {
    t4 = $[5];
  }
  const baseOptions = t4;
  let alwaysAllowOptions;
  if ($[6] !== skill) {
    alwaysAllowOptions = [];
    if (showAlwaysAllowOptions) {
      const t5 = <Text bold={true}>{skill}</Text>;
      let t6;
      if ($[8] === Symbol.for("react.memo_cache_sentinel")) {
        t6 = <Text bold={true}>{originalCwd}</Text>;
        $[8] = t6;
      } else {
        t6 = $[8];
      }
      let t7;
      if ($[9] !== t5) {
        t7 = {
          label: <Text>Yes, and don't ask again for {t5} in{" "}{t6}</Text>,
          value: "yes-exact"
        };
        $[9] = t5;
        $[10] = t7;
      } else {
        t7 = $[10];
      }
      alwaysAllowOptions.push(t7);
      const spaceIndex = skill.indexOf(" ");
      if (spaceIndex > 0) {
        const commandPrefix = skill.substring(0, spaceIndex);
        const t8 = commandPrefix + ":*";
        let t9;
        if ($[11] !== t8) {
          t9 = <Text bold={true}>{t8}</Text>;
          $[11] = t8;
          $[12] = t9;
        } else {
          t9 = $[12];
        }
        let t10;
        if ($[13] === Symbol.for("react.memo_cache_sentinel")) {
          t10 = <Text bold={true}>{originalCwd}</Text>;
          $[13] = t10;
        } else {
          t10 = $[13];
        }
        let t11;
        if ($[14] !== t9) {
          t11 = {
            label: <Text>Yes, and don't ask again for{" "}{t9} commands in{" "}{t10}</Text>,
            value: "yes-prefix"
          };
          $[14] = t9;
          $[15] = t11;
        } else {
          t11 = $[15];
        }
        alwaysAllowOptions.push(t11);
      }
    }
    $[6] = skill;
    $[7] = alwaysAllowOptions;
  } else {
    alwaysAllowOptions = $[7];
  }
  let t5;
  if ($[16] === Symbol.for("react.memo_cache_sentinel")) {
    t5 = {
      label: "No",
      value: "no",
      feedbackConfig: {
        type: "reject"
      }
    };
    $[16] = t5;
  } else {
    t5 = $[16];
  }
  const noOption = t5;
  let t6;
  if ($[17] !== alwaysAllowOptions) {
    t6 = [...baseOptions, ...alwaysAllowOptions, noOption];
    $[17] = alwaysAllowOptions;
    $[18] = t6;
  } else {
    t6 = $[18];
  }
  const options = t6;
  let t7;
  if ($[19] !== toolUseConfirm.tool.name) {
    t7 = sanitizeToolNameForAnalytics(toolUseConfirm.tool.name);
    $[19] = toolUseConfirm.tool.name;
    $[20] = t7;
  } else {
    t7 = $[20];
  }
  const t8 = toolUseConfirm.tool.isMcp ?? false;
  let t9;
  if ($[21] !== t7 || $[22] !== t8) {
    t9 = {
      toolName: t7,
      isMcp: t8
    };
    $[21] = t7;
    $[22] = t8;
    $[23] = t9;
  } else {
    t9 = $[23];
  }
  const toolAnalyticsContext = t9;
  let t10;
  if ($[24] !== onDone || $[25] !== onReject || $[26] !== skill || $[27] !== toolUseConfirm) {
    t10 = (value, feedback) => {
      bb33: switch (value) {
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
            break bb33;
          }
        case "yes-exact":
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
                toolName: SKILL_TOOL_NAME,
                ruleContent: skill
              }],
              behavior: "allow",
              destination: "localSettings"
            }]);
            onDone();
            break bb33;
          }
        case "yes-prefix":
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
            const spaceIndex_0 = skill.indexOf(" ");
            const commandPrefix_0 = spaceIndex_0 > 0 ? skill.substring(0, spaceIndex_0) : skill;
            toolUseConfirm.onAllow(toolUseConfirm.input, [{
              type: "addRules",
              rules: [{
                toolName: SKILL_TOOL_NAME,
                ruleContent: `${commandPrefix_0}:*`
              }],
              behavior: "allow",
              destination: "localSettings"
            }]);
            onDone();
            break bb33;
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
    $[24] = onDone;
    $[25] = onReject;
    $[26] = skill;
    $[27] = toolUseConfirm;
    $[28] = t10;
  } else {
    t10 = $[28];
  }
  const handleSelect = t10;
  let t11;
  if ($[29] !== onDone || $[30] !== onReject || $[31] !== toolUseConfirm) {
    t11 = () => {
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
    $[29] = onDone;
    $[30] = onReject;
    $[31] = toolUseConfirm;
    $[32] = t11;
  } else {
    t11 = $[32];
  }
  const handleCancel = t11;
  const t12 = `Use skill "${skill}"?`;
  let t13;
  if ($[33] === Symbol.for("react.memo_cache_sentinel")) {
    t13 = <Text>{PRODUCT_DISPLAY_NAME} may use instructions, code, or files from this Skill.</Text>;
    $[33] = t13;
  } else {
    t13 = $[33];
  }
  const t14 = commandObj?.description;
  let t15;
  if ($[34] !== t14) {
    t15 = <Box flexDirection="column" paddingX={2} paddingY={1}><Text dimColor={true}>{t14}</Text></Box>;
    $[34] = t14;
    $[35] = t15;
  } else {
    t15 = $[35];
  }
  let t16;
  if ($[36] !== toolUseConfirm.permissionResult) {
    t16 = <PermissionRuleExplanation permissionResult={toolUseConfirm.permissionResult} toolType="tool" />;
    $[36] = toolUseConfirm.permissionResult;
    $[37] = t16;
  } else {
    t16 = $[37];
  }
  let t17;
  if ($[38] !== handleCancel || $[39] !== handleSelect || $[40] !== options || $[41] !== toolAnalyticsContext) {
    t17 = <PermissionPrompt options={options} onSelect={handleSelect} onCancel={handleCancel} toolAnalyticsContext={toolAnalyticsContext} />;
    $[38] = handleCancel;
    $[39] = handleSelect;
    $[40] = options;
    $[41] = toolAnalyticsContext;
    $[42] = t17;
  } else {
    t17 = $[42];
  }
  let t18;
  if ($[43] !== t16 || $[44] !== t17) {
    t18 = <Box flexDirection="column">{t16}{t17}</Box>;
    $[43] = t16;
    $[44] = t17;
    $[45] = t18;
  } else {
    t18 = $[45];
  }
  let t19;
  if ($[46] !== t12 || $[47] !== t15 || $[48] !== t18 || $[49] !== workerBadge) {
    t19 = <PermissionDialog title={t12} workerBadge={workerBadge}>{t13}{t15}{t18}</PermissionDialog>;
    $[46] = t12;
    $[47] = t15;
    $[48] = t18;
    $[49] = workerBadge;
    $[50] = t19;
  } else {
    t19 = $[50];
  }
  return t19;
}
function _temp(input) {
  const result = SkillTool.inputSchema.safeParse(input);
  if (!result.success) {
    logError(new Error(`Failed to parse skill tool input: ${result.error.message}`));
    return "";
  }
  return result.data.skill;
}
