import { c as _c } from "react-compiler-runtime";
import chalk from 'chalk';
import React from 'react';
import { Ansi, Box, Text } from '../../ink.js';
import { useAppState } from '../../state/AppState.js';
import type { PermissionDecision, PermissionDecisionReason } from '../../utils/permissions/PermissionResult.js';
import { permissionRuleValueToString } from '../../utils/permissions/permissionRuleParser.js';
import type { Theme } from '../../utils/theme.js';
import ThemedText from '../design-system/ThemedText.js';
export type PermissionRuleExplanationProps = {
  permissionResult: PermissionDecision;
  toolType: 'tool' | 'command' | 'edit' | 'read';
};
type DecisionReasonStrings = {
  reasonString: string;
  configString?: string;
  /** When set, reasonString is plain text rendered with this theme color instead of <Ansi>. */
  themeColor?: keyof Theme;
};
function stringsForDecisionReason(reason: PermissionDecisionReason | undefined, toolType: 'tool' | 'command' | 'edit' | 'read'): DecisionReasonStrings | null {
  if (!reason) {
    return null;
  }
  if ((false || true) && reason.type === 'classifier') {
    if (reason.classifier === 'auto-mode') {
      return {
        reasonString: `Auto mode classifier requires confirmation for this ${toolType}.\n${reason.reason}`,
        configString: undefined,
        themeColor: 'error'
      };
    }
    return {
      reasonString: `Classifier ${chalk.bold(reason.classifier)} requires confirmation for this ${toolType}.\n${reason.reason}`,
      configString: undefined
    };
  }
  switch (reason.type) {
    case 'rule':
      return {
        reasonString: `Permission rule ${chalk.bold(permissionRuleValueToString(reason.rule.ruleValue))} requires confirmation for this ${toolType}.`,
        configString: reason.rule.source === 'policySettings' ? undefined : '/permissions to update rules'
      };
    case 'hook':
      {
        const hookReasonString = reason.reason ? `:\n${reason.reason}` : '.';
        const sourceLabel = reason.hookSource ? ` ${chalk.dim(`[${reason.hookSource}]`)}` : '';
        return {
          reasonString: `Hook ${chalk.bold(reason.hookName)} requires confirmation for this ${toolType}${hookReasonString}${sourceLabel}`,
          configString: '/hooks to update'
        };
      }
    case 'safetyCheck':
    case 'other':
      return {
        reasonString: reason.reason,
        configString: undefined
      };
    case 'workingDir':
      return {
        reasonString: reason.reason,
        configString: '/permissions to update rules'
      };
    default:
      return null;
  }
}
export function PermissionRuleExplanation(t0) {
  const $ = _c(11);
  const {
    permissionResult,
    toolType
  } = t0;
  const permissionMode = useAppState(_temp);
  const t1 = permissionResult?.decisionReason;
  let t2;
  if ($[0] !== t1 || $[1] !== toolType) {
    t2 = stringsForDecisionReason(t1, toolType);
    $[0] = t1;
    $[1] = toolType;
    $[2] = t2;
  } else {
    t2 = $[2];
  }
  const strings = t2;
  if (!strings) {
    return null;
  }
  const themeColor = strings.themeColor ?? (permissionResult?.decisionReason?.type === "hook" && permissionMode === "auto" ? "warning" : undefined);
  let t3;
  if ($[3] !== strings.reasonString || $[4] !== themeColor) {
    t3 = themeColor ? <ThemedText color={themeColor}>{strings.reasonString}</ThemedText> : <Text><Ansi>{strings.reasonString}</Ansi></Text>;
    $[3] = strings.reasonString;
    $[4] = themeColor;
    $[5] = t3;
  } else {
    t3 = $[5];
  }
  let t4;
  if ($[6] !== strings.configString) {
    t4 = strings.configString && <Text dimColor={true}>{strings.configString}</Text>;
    $[6] = strings.configString;
    $[7] = t4;
  } else {
    t4 = $[7];
  }
  let t5;
  if ($[8] !== t3 || $[9] !== t4) {
    t5 = <Box marginBottom={1} flexDirection="column">{t3}{t4}</Box>;
    $[8] = t3;
    $[9] = t4;
    $[10] = t5;
  } else {
    t5 = $[10];
  }
  return t5;
}
function _temp(s) {
  return s.toolPermissionContext.mode;
}
