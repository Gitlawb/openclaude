import { c as _c } from "react-compiler-runtime";
import * as React from 'react';
import { useEffect, useRef } from 'react';
import { KeyboardShortcutHint } from '../components/design-system/KeyboardShortcutHint.js';
import { Box, Text } from '../ink.js';
import { useKeybinding } from '../keybindings/useKeybinding.js';
type Props = {
  onRun: () => void;
  onCancel: () => void;
  reason: string;
};

/**
 * Component that shows a notification about running /issue command
 * with the ability to cancel via ESC key
 */
export function AutoRunIssueNotification(t0) {
  const $ = _c(8);
  const {
    onRun,
    onCancel,
    reason
  } = t0;
  const hasRunRef = useRef(false);
  let t1;
  if ($[0] === Symbol.for("react.memo_cache_sentinel")) {
    t1 = {
      context: "Confirmation"
    };
    $[0] = t1;
  } else {
    t1 = $[0];
  }
  useKeybinding("confirm:no", onCancel, t1);
  let t2;
  let t3;
  if ($[1] !== onRun) {
    t2 = () => {
      if (!hasRunRef.current) {
        hasRunRef.current = true;
        onRun();
      }
    };
    t3 = [onRun];
    $[1] = onRun;
    $[2] = t2;
    $[3] = t3;
  } else {
    t2 = $[2];
    t3 = $[3];
  }
  useEffect(t2, t3);
  let t4;
  if ($[4] === Symbol.for("react.memo_cache_sentinel")) {
    t4 = <Box><Text bold={true}>Running feedback capture...</Text></Box>;
    $[4] = t4;
  } else {
    t4 = $[4];
  }
  let t5;
  if ($[5] === Symbol.for("react.memo_cache_sentinel")) {
    t5 = <Box><Text dimColor={true}>Press <KeyboardShortcutHint shortcut="Esc" action="cancel" /> anytime</Text></Box>;
    $[5] = t5;
  } else {
    t5 = $[5];
  }
  let t6;
  if ($[6] !== reason) {
    t6 = <Box flexDirection="column" marginTop={1}>{t4}{t5}<Box><Text dimColor={true}>Reason: {reason}</Text></Box></Box>;
    $[6] = reason;
    $[7] = t6;
  } else {
    t6 = $[7];
  }
  return t6;
}
export type AutoRunIssueReason = 'feedback_survey_bad' | 'feedback_survey_good';

/**
 * Determines if /issue should auto-run for Ant users
 */
export function shouldAutoRunIssue(reason: AutoRunIssueReason): boolean {
  // Only for Ant users
  if ("external" !== 'ant') {
    return false;
  }
  switch (reason) {
    case 'feedback_survey_bad':
      return false;
    case 'feedback_survey_good':
      return false;
    default:
      return false;
  }
}

/**
 * Returns the appropriate command to auto-run based on the reason
 * ANT-ONLY: good-claude command only exists in ant builds
 */
export function getAutoRunCommand(reason: AutoRunIssueReason): string {
  // Only ant builds have the /good-claude command
  if ("external" === 'ant' && reason === 'feedback_survey_good') {
    return '/good-claude';
  }
  return '/issue';
}

/**
 * Gets a human-readable description of why /issue is being auto-run
 */
export function getAutoRunIssueReasonText(reason: AutoRunIssueReason): string {
  switch (reason) {
    case 'feedback_survey_bad':
      return 'You responded "Bad" to the feedback survey';
    case 'feedback_survey_good':
      return 'You responded "Good" to the feedback survey';
    default:
      return 'Unknown reason';
  }
}
