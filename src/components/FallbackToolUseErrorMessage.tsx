import { c as _c } from "react-compiler-runtime";
import type { ToolResultBlockParam } from '@anthropic-ai/sdk/resources/messages/messages.mjs';
import * as React from 'react';
import { stripUnderlineAnsi } from 'src/components/shell/OutputLine.js';
import { extractTag } from 'src/utils/messages.js';
import { removeSandboxViolationTags } from 'src/utils/sandbox/sandbox-ui-utils.js';
import { Box, Text } from '../ink.js';
import { useShortcutDisplay } from '../keybindings/useShortcutDisplay.js';
import { countCharInString } from '../utils/stringUtils.js';
import { MessageResponse } from './MessageResponse.js';
const MAX_RENDERED_LINES = 10;
type Props = {
  result: ToolResultBlockParam['content'];
  verbose: boolean;
};
export function FallbackToolUseErrorMessage(t0) {
  const $ = _c(25);
  const {
    result,
    verbose
  } = t0;
  const transcriptShortcut = useShortcutDisplay("app:toggleTranscript", "Global", "ctrl+o");
  let T0;
  let T1;
  let T2;
  let plusLines;
  let t1;
  let t2;
  let t3;
  if ($[0] !== result || $[1] !== verbose) {
    let error;
    if (typeof result !== "string") {
      error = "Tool execution failed";
    } else {
      const extractedError = extractTag(result, "tool_use_error") ?? result;
      const withoutSandboxViolations = removeSandboxViolationTags(extractedError);
      const withoutErrorTags = withoutSandboxViolations.replace(/<\/?error>/g, "");
      const trimmed = withoutErrorTags.trim();
      if (!verbose && trimmed.includes("InputValidationError: ")) {
        error = "Invalid tool parameters";
      } else {
        if (trimmed.startsWith("Error: ") || trimmed.startsWith("Cancelled: ")) {
          error = trimmed;
        } else {
          error = `Error: ${trimmed}`;
        }
      }
    }
    plusLines = countCharInString(error, "\n") + 1 - MAX_RENDERED_LINES;
    T2 = MessageResponse;
    T1 = Box;
    t3 = "column";
    T0 = Text;
    t1 = "error";
    t2 = stripUnderlineAnsi(verbose ? error : error.split("\n").slice(0, MAX_RENDERED_LINES).join("\n"));
    $[0] = result;
    $[1] = verbose;
    $[2] = T0;
    $[3] = T1;
    $[4] = T2;
    $[5] = plusLines;
    $[6] = t1;
    $[7] = t2;
    $[8] = t3;
  } else {
    T0 = $[2];
    T1 = $[3];
    T2 = $[4];
    plusLines = $[5];
    t1 = $[6];
    t2 = $[7];
    t3 = $[8];
  }
  let t4;
  if ($[9] !== T0 || $[10] !== t1 || $[11] !== t2) {
    t4 = <T0 color={t1}>{t2}</T0>;
    $[9] = T0;
    $[10] = t1;
    $[11] = t2;
    $[12] = t4;
  } else {
    t4 = $[12];
  }
  let t5;
  if ($[13] !== plusLines || $[14] !== transcriptShortcut || $[15] !== verbose) {
    t5 = !verbose && plusLines > 0 && <Box><Text dimColor={true}>… +{plusLines} {plusLines === 1 ? "line" : "lines"} (</Text><Text dimColor={true} bold={true}>{transcriptShortcut}</Text><Text> </Text><Text dimColor={true}>to see all)</Text></Box>;
    $[13] = plusLines;
    $[14] = transcriptShortcut;
    $[15] = verbose;
    $[16] = t5;
  } else {
    t5 = $[16];
  }
  let t6;
  if ($[17] !== T1 || $[18] !== t3 || $[19] !== t4 || $[20] !== t5) {
    t6 = <T1 flexDirection={t3}>{t4}{t5}</T1>;
    $[17] = T1;
    $[18] = t3;
    $[19] = t4;
    $[20] = t5;
    $[21] = t6;
  } else {
    t6 = $[21];
  }
  let t7;
  if ($[22] !== T2 || $[23] !== t6) {
    t7 = <T2>{t6}</T2>;
    $[22] = T2;
    $[23] = t6;
    $[24] = t7;
  } else {
    t7 = $[24];
  }
  return t7;
}
