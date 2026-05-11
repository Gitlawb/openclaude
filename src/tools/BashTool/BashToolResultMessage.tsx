import { c as _c } from "react-compiler-runtime";
import React from 'react';
import { removeSandboxViolationTags } from 'src/utils/sandbox/sandbox-ui-utils.js';
import FullWidthRow from '../../components/design-system/FullWidthRow.js';
import { KeyboardShortcutHint } from '../../components/design-system/KeyboardShortcutHint.js';
import { MessageResponse } from '../../components/MessageResponse.js';
import { PRODUCT_DISPLAY_NAME } from '../../constants/product.js';
import { OutputLine } from '../../components/shell/OutputLine.js';
import { ShellTimeDisplay } from '../../components/shell/ShellTimeDisplay.js';
import { Box, Text } from '../../ink.js';
import type { Out as BashOut } from './BashTool.js';
type Props = {
  content: Omit<BashOut, 'interrupted'>;
  verbose: boolean;
  timeoutMs?: number;
};

// Pattern to match "Shell cwd was reset to <path>" message
// Use (?:^|\n) to match either start of string or after a newline
const SHELL_CWD_RESET_PATTERN = /(?:^|\n)(Shell cwd was reset to .+)$/;

/**
 * Extracts sandbox violations from stderr if present
 * Returns both the cleaned stderr and the violations content
 */
function extractSandboxViolations(stderr: string): {
  cleanedStderr: string;
} {
  const violationsMatch = stderr.match(/<sandbox_violations>([\s\S]*?)<\/sandbox_violations>/);
  if (!violationsMatch) {
    return {
      cleanedStderr: stderr
    };
  }

  // Remove the sandbox violations section from stderr
  const cleanedStderr = removeSandboxViolationTags(stderr).trim();
  return {
    cleanedStderr
  };
}

/**
 * Extracts the "Shell cwd was reset" warning message from stderr
 * Returns the cleaned stderr and the warning message separately
 */
function extractCwdResetWarning(stderr: string): {
  cleanedStderr: string;
  cwdResetWarning: string | null;
} {
  const match = stderr.match(SHELL_CWD_RESET_PATTERN);
  if (!match) {
    return {
      cleanedStderr: stderr,
      cwdResetWarning: null
    };
  }

  // Extract the warning message from capture group 1
  const cwdResetWarning = match[1] ?? null;
  // Remove the warning from stderr (replace the full match)
  const cleanedStderr = stderr.replace(SHELL_CWD_RESET_PATTERN, '').trim();
  return {
    cleanedStderr,
    cwdResetWarning
  };
}
export default function BashToolResultMessage(t0) {
  const $ = _c(34);
  const {
    content: t1,
    verbose,
    timeoutMs
  } = t0;
  const {
    stdout: t2,
    stderr: t3,
    isImage,
    returnCodeInterpretation,
    noOutputExpected,
    backgroundTaskId
  } = t1;
  const stdout = t2 === undefined ? "" : t2;
  const stdErrWithViolations = t3 === undefined ? "" : t3;
  let T0;
  let cwdResetWarning;
  let stderr;
  let t4;
  let t5;
  let t6;
  let t7;
  if ($[0] !== isImage || $[1] !== stdErrWithViolations || $[2] !== stdout || $[3] !== verbose) {
    t7 = Symbol.for("react.early_return_sentinel");
    bb0: {
      const {
        cleanedStderr: stderrWithoutViolations
      } = extractSandboxViolations(stdErrWithViolations);
      ({
        cleanedStderr: stderr,
        cwdResetWarning
      } = extractCwdResetWarning(stderrWithoutViolations));
      if (isImage) {
        let t8;
        if ($[11] === Symbol.for("react.memo_cache_sentinel")) {
          t8 = <MessageResponse height={1}><FullWidthRow><Text dimColor={true}>[Image data detected and sent to {PRODUCT_DISPLAY_NAME}]</Text></FullWidthRow></MessageResponse>;
          $[11] = t8;
        } else {
          t8 = $[11];
        }
        t7 = t8;
        break bb0;
      }
      T0 = Box;
      t4 = "column";
      if ($[12] !== stdout || $[13] !== verbose) {
        t5 = stdout !== "" ? <OutputLine content={stdout} verbose={verbose} /> : null;
        $[12] = stdout;
        $[13] = verbose;
        $[14] = t5;
      } else {
        t5 = $[14];
      }
      t6 = stderr.trim() !== "" ? <OutputLine content={stderr} verbose={verbose} isError={true} /> : null;
    }
    $[0] = isImage;
    $[1] = stdErrWithViolations;
    $[2] = stdout;
    $[3] = verbose;
    $[4] = T0;
    $[5] = cwdResetWarning;
    $[6] = stderr;
    $[7] = t4;
    $[8] = t5;
    $[9] = t6;
    $[10] = t7;
  } else {
    T0 = $[4];
    cwdResetWarning = $[5];
    stderr = $[6];
    t4 = $[7];
    t5 = $[8];
    t6 = $[9];
    t7 = $[10];
  }
  if (t7 !== Symbol.for("react.early_return_sentinel")) {
    return t7;
  }
  let t8;
  if ($[15] !== cwdResetWarning) {
    t8 = cwdResetWarning ? <MessageResponse><FullWidthRow><Text dimColor={true}>{cwdResetWarning}</Text></FullWidthRow></MessageResponse> : null;
    $[15] = cwdResetWarning;
    $[16] = t8;
  } else {
    t8 = $[16];
  }
  let t9;
  if ($[17] !== backgroundTaskId || $[18] !== cwdResetWarning || $[19] !== noOutputExpected || $[20] !== returnCodeInterpretation || $[21] !== stderr || $[22] !== stdout) {
    t9 = stdout === "" && stderr.trim() === "" && !cwdResetWarning ? <MessageResponse height={1}><FullWidthRow><Text dimColor={true}>{backgroundTaskId ? <>Running in the background{" "}<KeyboardShortcutHint shortcut={"\u2193"} action="manage" parens={true} /></> : returnCodeInterpretation || (noOutputExpected ? "Done" : "(No output)")}</Text></FullWidthRow></MessageResponse> : null;
    $[17] = backgroundTaskId;
    $[18] = cwdResetWarning;
    $[19] = noOutputExpected;
    $[20] = returnCodeInterpretation;
    $[21] = stderr;
    $[22] = stdout;
    $[23] = t9;
  } else {
    t9 = $[23];
  }
  let t10;
  if ($[24] !== timeoutMs) {
    t10 = timeoutMs && <MessageResponse><ShellTimeDisplay timeoutMs={timeoutMs} /></MessageResponse>;
    $[24] = timeoutMs;
    $[25] = t10;
  } else {
    t10 = $[25];
  }
  let t11;
  if ($[26] !== T0 || $[27] !== t10 || $[28] !== t4 || $[29] !== t5 || $[30] !== t6 || $[31] !== t8 || $[32] !== t9) {
    t11 = <T0 flexDirection={t4} width="100%">{t5}{t6}{t8}{t9}{t10}</T0>;
    $[26] = T0;
    $[27] = t10;
    $[28] = t4;
    $[29] = t5;
    $[30] = t6;
    $[31] = t8;
    $[32] = t9;
    $[33] = t11;
  } else {
    t11 = $[33];
  }
  return t11;
}
