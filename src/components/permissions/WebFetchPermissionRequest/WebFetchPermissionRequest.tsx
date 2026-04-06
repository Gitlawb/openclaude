import { c as _c } from "react-compiler-runtime";
import React, { useMemo } from 'react';
import { Box, Text, useTheme } from '../../../ink.js';
import { WebFetchTool } from '../../../tools/WebFetchTool/WebFetchTool.js';
import { shouldShowAlwaysAllowOptions } from '../../../utils/permissions/permissionsLoader.js';
import { type OptionWithDescription, Select } from '../../CustomSelect/select.js';
import { type UnaryEvent, usePermissionRequestLogging } from '../hooks.js';
import { PermissionDialog } from '../PermissionDialog.js';
import type { PermissionRequestProps } from '../PermissionRequest.js';
import { PermissionRuleExplanation } from '../PermissionRuleExplanation.js';
import { logUnaryPermissionEvent } from '../utils.js';
function inputToPermissionRuleContent(input: {
  [k: string]: unknown;
}): string {
  try {
    const parsedInput = WebFetchTool.inputSchema.safeParse(input);
    if (!parsedInput.success) {
      return `input:${input.toString()}`;
    }
    const {
      url
    } = parsedInput.data;
    const hostname = new URL(url).hostname;
    return `domain:${hostname}`;
  } catch {
    return `input:${input.toString()}`;
  }
}
export function WebFetchPermissionRequest(t0) {
  const $ = _c(41);
  const {
    toolUseConfirm,
    onDone,
    onReject,
    verbose,
    workerBadge
  } = t0;
  const [theme] = useTheme();
  const {
    url
  } = toolUseConfirm.input as {
    url: string;
  };
  let t1;
  if ($[0] !== url) {
    t1 = new URL(url);
    $[0] = url;
    $[1] = t1;
  } else {
    t1 = $[1];
  }
  const hostname = t1.hostname;
  let t2;
  if ($[2] === Symbol.for("react.memo_cache_sentinel")) {
    t2 = {
      completion_type: "tool_use_single",
      language_name: "none"
    };
    $[2] = t2;
  } else {
    t2 = $[2];
  }
  const unaryEvent = t2;
  usePermissionRequestLogging(toolUseConfirm, unaryEvent);
  let t3;
  if ($[3] === Symbol.for("react.memo_cache_sentinel")) {
    t3 = shouldShowAlwaysAllowOptions();
    $[3] = t3;
  } else {
    t3 = $[3];
  }
  const showAlwaysAllowOptions = t3;
  let t4;
  if ($[4] === Symbol.for("react.memo_cache_sentinel")) {
    t4 = {
      label: "Yes",
      value: "yes"
    };
    $[4] = t4;
  } else {
    t4 = $[4];
  }
  let result;
  if ($[5] !== hostname) {
    result = [t4];
    if (showAlwaysAllowOptions) {
      const t5 = <Text bold={true}>{hostname}</Text>;
      let t6;
      if ($[7] !== t5) {
        t6 = {
          label: <Text>Yes, and don't ask again for {t5}</Text>,
          value: "yes-dont-ask-again-domain"
        };
        $[7] = t5;
        $[8] = t6;
      } else {
        t6 = $[8];
      }
      result.push(t6);
    }
    let t5;
    if ($[9] === Symbol.for("react.memo_cache_sentinel")) {
      t5 = {
        label: <Text>No, and tell Claude what to do differently <Text bold={true}>(esc)</Text></Text>,
        value: "no"
      };
      $[9] = t5;
    } else {
      t5 = $[9];
    }
    result.push(t5);
    $[5] = hostname;
    $[6] = result;
  } else {
    result = $[6];
  }
  const options = result;
  let t5;
  if ($[10] !== onDone || $[11] !== onReject || $[12] !== toolUseConfirm) {
    t5 = function onChange(newValue) {
      bb8: switch (newValue) {
        case "yes":
          {
            logUnaryPermissionEvent("tool_use_single", toolUseConfirm, "accept");
            toolUseConfirm.onAllow(toolUseConfirm.input, []);
            onDone();
            break bb8;
          }
        case "yes-dont-ask-again-domain":
          {
            logUnaryPermissionEvent("tool_use_single", toolUseConfirm, "accept");
            const ruleContent = inputToPermissionRuleContent(toolUseConfirm.input);
            const ruleValue = {
              toolName: toolUseConfirm.tool.name,
              ruleContent
            };
            toolUseConfirm.onAllow(toolUseConfirm.input, [{
              type: "addRules",
              rules: [ruleValue],
              behavior: "allow",
              destination: "localSettings"
            }]);
            onDone();
            break bb8;
          }
        case "no":
          {
            logUnaryPermissionEvent("tool_use_single", toolUseConfirm, "reject");
            toolUseConfirm.onReject();
            onReject();
            onDone();
          }
      }
    };
    $[10] = onDone;
    $[11] = onReject;
    $[12] = toolUseConfirm;
    $[13] = t5;
  } else {
    t5 = $[13];
  }
  const onChange = t5;
  let t6;
  if ($[14] !== theme || $[15] !== toolUseConfirm.input || $[16] !== verbose) {
    t6 = WebFetchTool.renderToolUseMessage(toolUseConfirm.input as {
      url: string;
      prompt: string;
    }, {
      theme,
      verbose
    });
    $[14] = theme;
    $[15] = toolUseConfirm.input;
    $[16] = verbose;
    $[17] = t6;
  } else {
    t6 = $[17];
  }
  let t7;
  if ($[18] !== t6) {
    t7 = <Text>{t6}</Text>;
    $[18] = t6;
    $[19] = t7;
  } else {
    t7 = $[19];
  }
  let t8;
  if ($[20] !== toolUseConfirm.description) {
    t8 = <Text dimColor={true}>{toolUseConfirm.description}</Text>;
    $[20] = toolUseConfirm.description;
    $[21] = t8;
  } else {
    t8 = $[21];
  }
  let t9;
  if ($[22] !== t7 || $[23] !== t8) {
    t9 = <Box flexDirection="column" paddingX={2} paddingY={1}>{t7}{t8}</Box>;
    $[22] = t7;
    $[23] = t8;
    $[24] = t9;
  } else {
    t9 = $[24];
  }
  let t10;
  if ($[25] !== toolUseConfirm.permissionResult) {
    t10 = <PermissionRuleExplanation permissionResult={toolUseConfirm.permissionResult} toolType="tool" />;
    $[25] = toolUseConfirm.permissionResult;
    $[26] = t10;
  } else {
    t10 = $[26];
  }
  let t11;
  if ($[27] === Symbol.for("react.memo_cache_sentinel")) {
    t11 = <Text>Do you want to allow Claude to fetch this content?</Text>;
    $[27] = t11;
  } else {
    t11 = $[27];
  }
  let t12;
  if ($[28] !== onChange) {
    t12 = () => onChange("no");
    $[28] = onChange;
    $[29] = t12;
  } else {
    t12 = $[29];
  }
  let t13;
  if ($[30] !== onChange || $[31] !== options || $[32] !== t12) {
    t13 = <Select options={options} onChange={onChange} onCancel={t12} />;
    $[30] = onChange;
    $[31] = options;
    $[32] = t12;
    $[33] = t13;
  } else {
    t13 = $[33];
  }
  let t14;
  if ($[34] !== t10 || $[35] !== t13) {
    t14 = <Box flexDirection="column">{t10}{t11}{t13}</Box>;
    $[34] = t10;
    $[35] = t13;
    $[36] = t14;
  } else {
    t14 = $[36];
  }
  let t15;
  if ($[37] !== t14 || $[38] !== t9 || $[39] !== workerBadge) {
    t15 = <PermissionDialog title="Fetch" workerBadge={workerBadge}>{t9}{t14}</PermissionDialog>;
    $[37] = t14;
    $[38] = t9;
    $[39] = workerBadge;
    $[40] = t15;
  } else {
    t15 = $[40];
  }
  return t15;
}
