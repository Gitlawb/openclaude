import { c as _c } from "react-compiler-runtime";
import figures from 'figures';
import React, { useMemo, useState } from 'react';
import type { SDKMessage } from 'src/entrypoints/agentSdkTypes.js';
import type { ToolUseContext } from 'src/Tool.js';
import type { DeepImmutable } from 'src/types/utils.js';
import type { CommandResultDisplay } from '../../commands.js';
import { DIAMOND_FILLED, DIAMOND_OPEN } from '../../constants/figures.js';
import { useElapsedTime } from '../../hooks/useElapsedTime.js';
import type { KeyboardEvent } from '../../ink/events/keyboard-event.js';
import { Box, Link, Text } from '../../ink.js';
import type { RemoteAgentTaskState } from '../../tasks/RemoteAgentTask/RemoteAgentTask.js';
import { getRemoteTaskSessionUrl } from '../../tasks/RemoteAgentTask/RemoteAgentTask.js';
import { AGENT_TOOL_NAME, LEGACY_AGENT_TOOL_NAME } from '../../tools/AgentTool/constants.js';
import { ASK_USER_QUESTION_TOOL_NAME } from '../../tools/AskUserQuestionTool/prompt.js';
import { EXIT_PLAN_MODE_V2_TOOL_NAME } from '../../tools/ExitPlanModeTool/constants.js';
import { openBrowser } from '../../utils/browser.js';
import { errorMessage } from '../../utils/errors.js';
import { formatDuration, truncateToWidth } from '../../utils/format.js';
import { toInternalMessages } from '../../utils/messages/mappers.js';
import { EMPTY_LOOKUPS, normalizeMessages } from '../../utils/messages.js';
import { plural } from '../../utils/stringUtils.js';
import { teleportResumeCodeSession } from '../../utils/teleport.js';
import { Select } from '../CustomSelect/select.js';
import { Byline } from '../design-system/Byline.js';
import { Dialog } from '../design-system/Dialog.js';
import { KeyboardShortcutHint } from '../design-system/KeyboardShortcutHint.js';
import { Message } from '../Message.js';
import { formatReviewStageCounts, RemoteSessionProgress } from './RemoteSessionProgress.js';
type Props = {
  session: DeepImmutable<RemoteAgentTaskState>;
  toolUseContext: ToolUseContext;
  onDone: (result?: string, options?: {
    display?: CommandResultDisplay;
  }) => void;
  onBack?: () => void;
  onKill?: () => void;
};

// Compact one-line summary: tool name + first meaningful string arg.
// Lighter than tool.renderToolUseMessage (no registry lookup / schema parse).
// Collapses whitespace so multi-line inputs (e.g. Bash command text)
// render on one line.
export function formatToolUseSummary(name: string, input: unknown): string {
  // plan_ready phase is only reached via ExitPlanMode tool
  if (name === EXIT_PLAN_MODE_V2_TOOL_NAME) {
    return 'Review the plan in Claude Code on the web';
  }
  if (!input || typeof input !== 'object') return name;
  // AskUserQuestion: show the question text as a CTA, not the tool name.
  // Input shape is {questions: [{question, header, options}]}.
  if (name === ASK_USER_QUESTION_TOOL_NAME && 'questions' in input) {
    const qs = input.questions;
    if (Array.isArray(qs) && qs[0] && typeof qs[0] === 'object') {
      // Prefer question (full text) over header (max-12-char tag). header
      // is a required schema field so checking it first would make the
      // question fallback dead code.
      const q = 'question' in qs[0] && typeof qs[0].question === 'string' && qs[0].question ? qs[0].question : 'header' in qs[0] && typeof qs[0].header === 'string' ? qs[0].header : null;
      if (q) {
        const oneLine = q.replace(/\s+/g, ' ').trim();
        return `Answer in browser: ${truncateToWidth(oneLine, 50)}`;
      }
    }
  }
  for (const v of Object.values(input)) {
    if (typeof v === 'string' && v.trim()) {
      const oneLine = v.replace(/\s+/g, ' ').trim();
      return `${name} ${truncateToWidth(oneLine, 60)}`;
    }
  }
  return name;
}
const PHASE_LABEL = {
  needs_input: 'input required',
  plan_ready: 'ready'
} as const;
const AGENT_VERB = {
  needs_input: 'waiting',
  plan_ready: 'done'
} as const;
function UltraplanSessionDetail(t0) {
  const $ = _c(70);
  const {
    session,
    onDone,
    onBack,
    onKill
  } = t0;
  const running = session.status === "running" || session.status === "pending";
  const phase = session.ultraplanPhase;
  const statusText = running ? phase ? PHASE_LABEL[phase] : "running" : session.status;
  const elapsedTime = useElapsedTime(session.startTime, running, 1000, 0, session.endTime);
  let spawns = 0;
  let calls = 0;
  let lastBlock = null;
  for (const msg of session.log) {
    if (msg.type !== "assistant") {
      continue;
    }
    for (const block of msg.message.content) {
      if (block.type !== "tool_use") {
        continue;
      }
      calls++;
      lastBlock = block;
      if (block.name === AGENT_TOOL_NAME || block.name === LEGACY_AGENT_TOOL_NAME) {
        spawns++;
      }
    }
  }
  const t1 = 1 + spawns;
  let t2;
  if ($[0] !== lastBlock) {
    t2 = lastBlock ? formatToolUseSummary(lastBlock.name, lastBlock.input) : null;
    $[0] = lastBlock;
    $[1] = t2;
  } else {
    t2 = $[1];
  }
  let t3;
  if ($[2] !== calls || $[3] !== t1 || $[4] !== t2) {
    t3 = {
      agentsWorking: t1,
      toolCalls: calls,
      lastToolCall: t2
    };
    $[2] = calls;
    $[3] = t1;
    $[4] = t2;
    $[5] = t3;
  } else {
    t3 = $[5];
  }
  const {
    agentsWorking,
    toolCalls,
    lastToolCall
  } = t3;
  let t4;
  if ($[6] !== session.sessionId) {
    t4 = getRemoteTaskSessionUrl(session.sessionId);
    $[6] = session.sessionId;
    $[7] = t4;
  } else {
    t4 = $[7];
  }
  const sessionUrl = t4;
  let t5;
  if ($[8] !== onBack || $[9] !== onDone) {
    t5 = onBack ?? (() => onDone("Remote session details dismissed", {
      display: "system"
    }));
    $[8] = onBack;
    $[9] = onDone;
    $[10] = t5;
  } else {
    t5 = $[10];
  }
  const goBackOrClose = t5;
  const [confirmingStop, setConfirmingStop] = useState(false);
  if (confirmingStop) {
    let t6;
    if ($[11] === Symbol.for("react.memo_cache_sentinel")) {
      t6 = () => setConfirmingStop(false);
      $[11] = t6;
    } else {
      t6 = $[11];
    }
    let t7;
    if ($[12] === Symbol.for("react.memo_cache_sentinel")) {
      t7 = <Text dimColor={true}>This will terminate the Claude Code on the web session.</Text>;
      $[12] = t7;
    } else {
      t7 = $[12];
    }
    let t8;
    if ($[13] === Symbol.for("react.memo_cache_sentinel")) {
      t8 = {
        label: "Terminate session",
        value: "stop" as const
      };
      $[13] = t8;
    } else {
      t8 = $[13];
    }
    let t9;
    if ($[14] === Symbol.for("react.memo_cache_sentinel")) {
      t9 = [t8, {
        label: "Back",
        value: "back" as const
      }];
      $[14] = t9;
    } else {
      t9 = $[14];
    }
    let t10;
    if ($[15] !== goBackOrClose || $[16] !== onKill) {
      t10 = <Dialog title="Stop ultraplan?" onCancel={t6} color="background"><Box flexDirection="column" gap={1}>{t7}<Select options={t9} onChange={v => {
            if (v === "stop") {
              onKill?.();
              goBackOrClose();
            } else {
              setConfirmingStop(false);
            }
          }} /></Box></Dialog>;
      $[15] = goBackOrClose;
      $[16] = onKill;
      $[17] = t10;
    } else {
      t10 = $[17];
    }
    return t10;
  }
  const t6 = phase === "plan_ready" ? DIAMOND_FILLED : DIAMOND_OPEN;
  let t7;
  if ($[18] !== t6) {
    t7 = <Text color="background">{t6}{" "}</Text>;
    $[18] = t6;
    $[19] = t7;
  } else {
    t7 = $[19];
  }
  let t8;
  if ($[20] === Symbol.for("react.memo_cache_sentinel")) {
    t8 = <Text bold={true}>ultraplan</Text>;
    $[20] = t8;
  } else {
    t8 = $[20];
  }
  let t9;
  if ($[21] !== elapsedTime || $[22] !== statusText) {
    t9 = <Text dimColor={true}>{" \xB7 "}{elapsedTime}{" \xB7 "}{statusText}</Text>;
    $[21] = elapsedTime;
    $[22] = statusText;
    $[23] = t9;
  } else {
    t9 = $[23];
  }
  let t10;
  if ($[24] !== t7 || $[25] !== t9) {
    t10 = <Text>{t7}{t8}{t9}</Text>;
    $[24] = t7;
    $[25] = t9;
    $[26] = t10;
  } else {
    t10 = $[26];
  }
  let t11;
  if ($[27] !== phase) {
    t11 = phase === "plan_ready" && <Text color="success">{figures.tick} </Text>;
    $[27] = phase;
    $[28] = t11;
  } else {
    t11 = $[28];
  }
  let t12;
  if ($[29] !== agentsWorking) {
    t12 = plural(agentsWorking, "agent");
    $[29] = agentsWorking;
    $[30] = t12;
  } else {
    t12 = $[30];
  }
  const t13 = phase ? AGENT_VERB[phase] : "working";
  let t14;
  if ($[31] !== toolCalls) {
    t14 = plural(toolCalls, "call");
    $[31] = toolCalls;
    $[32] = t14;
  } else {
    t14 = $[32];
  }
  let t15;
  if ($[33] !== agentsWorking || $[34] !== t11 || $[35] !== t12 || $[36] !== t13 || $[37] !== t14 || $[38] !== toolCalls) {
    t15 = <Text>{t11}{agentsWorking} {t12}{" "}{t13} · {toolCalls} tool{" "}{t14}</Text>;
    $[33] = agentsWorking;
    $[34] = t11;
    $[35] = t12;
    $[36] = t13;
    $[37] = t14;
    $[38] = toolCalls;
    $[39] = t15;
  } else {
    t15 = $[39];
  }
  let t16;
  if ($[40] !== lastToolCall) {
    t16 = lastToolCall && <Text dimColor={true}>{lastToolCall}</Text>;
    $[40] = lastToolCall;
    $[41] = t16;
  } else {
    t16 = $[41];
  }
  let t17;
  if ($[42] !== sessionUrl) {
    t17 = <Text dimColor={true}>{sessionUrl}</Text>;
    $[42] = sessionUrl;
    $[43] = t17;
  } else {
    t17 = $[43];
  }
  let t18;
  if ($[44] !== sessionUrl || $[45] !== t17) {
    t18 = <Link url={sessionUrl}>{t17}</Link>;
    $[44] = sessionUrl;
    $[45] = t17;
    $[46] = t18;
  } else {
    t18 = $[46];
  }
  let t19;
  if ($[47] === Symbol.for("react.memo_cache_sentinel")) {
    t19 = {
      label: "Review in Claude Code on the web",
      value: "open" as const
    };
    $[47] = t19;
  } else {
    t19 = $[47];
  }
  let t20;
  if ($[48] !== onKill || $[49] !== running) {
    t20 = onKill && running ? [{
      label: "Stop ultraplan",
      value: "stop" as const
    }] : [];
    $[48] = onKill;
    $[49] = running;
    $[50] = t20;
  } else {
    t20 = $[50];
  }
  let t21;
  if ($[51] === Symbol.for("react.memo_cache_sentinel")) {
    t21 = {
      label: "Back",
      value: "back" as const
    };
    $[51] = t21;
  } else {
    t21 = $[51];
  }
  let t22;
  if ($[52] !== t20) {
    t22 = [t19, ...t20, t21];
    $[52] = t20;
    $[53] = t22;
  } else {
    t22 = $[53];
  }
  let t23;
  if ($[54] !== goBackOrClose || $[55] !== onDone || $[56] !== sessionUrl) {
    t23 = v_0 => {
      switch (v_0) {
        case "open":
          {
            openBrowser(sessionUrl);
            onDone();
            return;
          }
        case "stop":
          {
            setConfirmingStop(true);
            return;
          }
        case "back":
          {
            goBackOrClose();
            return;
          }
      }
    };
    $[54] = goBackOrClose;
    $[55] = onDone;
    $[56] = sessionUrl;
    $[57] = t23;
  } else {
    t23 = $[57];
  }
  let t24;
  if ($[58] !== t22 || $[59] !== t23) {
    t24 = <Select options={t22} onChange={t23} />;
    $[58] = t22;
    $[59] = t23;
    $[60] = t24;
  } else {
    t24 = $[60];
  }
  let t25;
  if ($[61] !== t15 || $[62] !== t16 || $[63] !== t18 || $[64] !== t24) {
    t25 = <Box flexDirection="column" gap={1}>{t15}{t16}{t18}{t24}</Box>;
    $[61] = t15;
    $[62] = t16;
    $[63] = t18;
    $[64] = t24;
    $[65] = t25;
  } else {
    t25 = $[65];
  }
  let t26;
  if ($[66] !== goBackOrClose || $[67] !== t10 || $[68] !== t25) {
    t26 = <Dialog title={t10} onCancel={goBackOrClose} color="background">{t25}</Dialog>;
    $[66] = goBackOrClose;
    $[67] = t10;
    $[68] = t25;
    $[69] = t26;
  } else {
    t26 = $[69];
  }
  return t26;
}
const STAGES = ['finding', 'verifying', 'synthesizing'] as const;
const STAGE_LABELS: Record<(typeof STAGES)[number], string> = {
  finding: 'Find',
  verifying: 'Verify',
  synthesizing: 'Dedupe'
};

// Setup → Find → Verify → Dedupe pipeline. Current stage in cloud teal,
// rest dim. When completed, all stages dim with a trailing green ✓. The
// "Setup" label shows before the orchestrator writes its first progress
// snapshot (container boot + repo clone), so the 0-found display doesn't
// look like a hung finder.
function StagePipeline(t0) {
  const $ = _c(15);
  const {
    stage,
    completed,
    hasProgress
  } = t0;
  let t1;
  if ($[0] !== stage) {
    t1 = stage ? STAGES.indexOf(stage) : -1;
    $[0] = stage;
    $[1] = t1;
  } else {
    t1 = $[1];
  }
  const currentIdx = t1;
  const inSetup = !completed && !hasProgress;
  let t2;
  if ($[2] !== inSetup) {
    t2 = inSetup ? <Text color="background">Setup</Text> : <Text dimColor={true}>Setup</Text>;
    $[2] = inSetup;
    $[3] = t2;
  } else {
    t2 = $[3];
  }
  let t3;
  if ($[4] === Symbol.for("react.memo_cache_sentinel")) {
    t3 = <Text dimColor={true}> → </Text>;
    $[4] = t3;
  } else {
    t3 = $[4];
  }
  let t4;
  if ($[5] !== completed || $[6] !== currentIdx || $[7] !== inSetup) {
    t4 = STAGES.map((s, i) => {
      const isCurrent = !completed && !inSetup && i === currentIdx;
      return <React.Fragment key={s}>{i > 0 && <Text dimColor={true}> → </Text>}{isCurrent ? <Text color="background">{STAGE_LABELS[s]}</Text> : <Text dimColor={true}>{STAGE_LABELS[s]}</Text>}</React.Fragment>;
    });
    $[5] = completed;
    $[6] = currentIdx;
    $[7] = inSetup;
    $[8] = t4;
  } else {
    t4 = $[8];
  }
  let t5;
  if ($[9] !== completed) {
    t5 = completed && <Text color="success"> ✓</Text>;
    $[9] = completed;
    $[10] = t5;
  } else {
    t5 = $[10];
  }
  let t6;
  if ($[11] !== t2 || $[12] !== t4 || $[13] !== t5) {
    t6 = <Text>{t2}{t3}{t4}{t5}</Text>;
    $[11] = t2;
    $[12] = t4;
    $[13] = t5;
    $[14] = t6;
  } else {
    t6 = $[14];
  }
  return t6;
}

// Stage-appropriate counts line. Running-state formatting delegates to
// formatReviewStageCounts (shared with the pill) so the two views can't
// drift; completed state is dialog-specific (findings summary).
function reviewCountsLine(session: DeepImmutable<RemoteAgentTaskState>): string {
  const p = session.reviewProgress;
  // No progress data — the orchestrator never wrote a snapshot. Don't
  // claim "0 findings" when completed; we just don't know.
  if (!p) return session.status === 'completed' ? 'done' : 'setting up';
  const verified = p.bugsVerified;
  const refuted = p.bugsRefuted ?? 0;
  if (session.status === 'completed') {
    const parts = [`${verified} ${plural(verified, 'finding')}`];
    if (refuted > 0) parts.push(`${refuted} refuted`);
    return parts.join(' · ');
  }
  return formatReviewStageCounts(p.stage, p.bugsFound, verified, refuted);
}
type MenuAction = 'open' | 'stop' | 'back' | 'dismiss';
function ReviewSessionDetail(t0) {
  const $ = _c(56);
  const {
    session,
    onDone,
    onBack,
    onKill
  } = t0;
  const completed = session.status === "completed";
  const running = session.status === "running" || session.status === "pending";
  const [confirmingStop, setConfirmingStop] = useState(false);
  const elapsedTime = useElapsedTime(session.startTime, running, 1000, 0, session.endTime);
  let t1;
  if ($[0] !== onDone) {
    t1 = () => onDone("Remote session details dismissed", {
      display: "system"
    });
    $[0] = onDone;
    $[1] = t1;
  } else {
    t1 = $[1];
  }
  const handleClose = t1;
  const goBackOrClose = onBack ?? handleClose;
  let t2;
  if ($[2] !== session.sessionId) {
    t2 = getRemoteTaskSessionUrl(session.sessionId);
    $[2] = session.sessionId;
    $[3] = t2;
  } else {
    t2 = $[3];
  }
  const sessionUrl = t2;
  const statusLabel = completed ? "ready" : running ? "running" : session.status;
  if (confirmingStop) {
    let t3;
    if ($[4] === Symbol.for("react.memo_cache_sentinel")) {
      t3 = () => setConfirmingStop(false);
      $[4] = t3;
    } else {
      t3 = $[4];
    }
    let t4;
    if ($[5] === Symbol.for("react.memo_cache_sentinel")) {
      t4 = <Text dimColor={true}>This archives the remote session and stops local tracking. The review will not complete and any findings so far are discarded.</Text>;
      $[5] = t4;
    } else {
      t4 = $[5];
    }
    let t5;
    if ($[6] === Symbol.for("react.memo_cache_sentinel")) {
      t5 = {
        label: "Stop ultrareview",
        value: "stop" as const
      };
      $[6] = t5;
    } else {
      t5 = $[6];
    }
    let t6;
    if ($[7] === Symbol.for("react.memo_cache_sentinel")) {
      t6 = [t5, {
        label: "Back",
        value: "back" as const
      }];
      $[7] = t6;
    } else {
      t6 = $[7];
    }
    let t7;
    if ($[8] !== goBackOrClose || $[9] !== onKill) {
      t7 = <Dialog title="Stop ultrareview?" onCancel={t3} color="background"><Box flexDirection="column" gap={1}>{t4}<Select options={t6} onChange={v => {
            if (v === "stop") {
              onKill?.();
              goBackOrClose();
            } else {
              setConfirmingStop(false);
            }
          }} /></Box></Dialog>;
      $[8] = goBackOrClose;
      $[9] = onKill;
      $[10] = t7;
    } else {
      t7 = $[10];
    }
    return t7;
  }
  let t3;
  if ($[11] !== completed || $[12] !== onKill || $[13] !== running) {
    t3 = completed ? [{
      label: "Open in Claude Code on the web",
      value: "open"
    }, {
      label: "Dismiss",
      value: "dismiss"
    }] : [{
      label: "Open in Claude Code on the web",
      value: "open"
    }, ...(onKill && running ? [{
      label: "Stop ultrareview",
      value: "stop" as const
    }] : []), {
      label: "Back",
      value: "back"
    }];
    $[11] = completed;
    $[12] = onKill;
    $[13] = running;
    $[14] = t3;
  } else {
    t3 = $[14];
  }
  const options = t3;
  let t4;
  if ($[15] !== goBackOrClose || $[16] !== handleClose || $[17] !== onDone || $[18] !== sessionUrl) {
    t4 = action => {
      bb45: switch (action) {
        case "open":
          {
            openBrowser(sessionUrl);
            onDone();
            break bb45;
          }
        case "stop":
          {
            setConfirmingStop(true);
            break bb45;
          }
        case "back":
          {
            goBackOrClose();
            break bb45;
          }
        case "dismiss":
          {
            handleClose();
          }
      }
    };
    $[15] = goBackOrClose;
    $[16] = handleClose;
    $[17] = onDone;
    $[18] = sessionUrl;
    $[19] = t4;
  } else {
    t4 = $[19];
  }
  const handleSelect = t4;
  const t5 = completed ? DIAMOND_FILLED : DIAMOND_OPEN;
  let t6;
  if ($[20] !== t5) {
    t6 = <Text color="background">{t5}{" "}</Text>;
    $[20] = t5;
    $[21] = t6;
  } else {
    t6 = $[21];
  }
  let t7;
  if ($[22] === Symbol.for("react.memo_cache_sentinel")) {
    t7 = <Text bold={true}>ultrareview</Text>;
    $[22] = t7;
  } else {
    t7 = $[22];
  }
  let t8;
  if ($[23] !== elapsedTime || $[24] !== statusLabel) {
    t8 = <Text dimColor={true}>{" \xB7 "}{elapsedTime}{" \xB7 "}{statusLabel}</Text>;
    $[23] = elapsedTime;
    $[24] = statusLabel;
    $[25] = t8;
  } else {
    t8 = $[25];
  }
  let t9;
  if ($[26] !== t6 || $[27] !== t8) {
    t9 = <Text>{t6}{t7}{t8}</Text>;
    $[26] = t6;
    $[27] = t8;
    $[28] = t9;
  } else {
    t9 = $[28];
  }
  const t10 = session.reviewProgress?.stage;
  const t11 = !!session.reviewProgress;
  let t12;
  if ($[29] !== completed || $[30] !== t10 || $[31] !== t11) {
    t12 = <StagePipeline stage={t10} completed={completed} hasProgress={t11} />;
    $[29] = completed;
    $[30] = t10;
    $[31] = t11;
    $[32] = t12;
  } else {
    t12 = $[32];
  }
  let t13;
  if ($[33] !== session) {
    t13 = reviewCountsLine(session);
    $[33] = session;
    $[34] = t13;
  } else {
    t13 = $[34];
  }
  let t14;
  if ($[35] !== t13) {
    t14 = <Text>{t13}</Text>;
    $[35] = t13;
    $[36] = t14;
  } else {
    t14 = $[36];
  }
  let t15;
  if ($[37] !== sessionUrl) {
    t15 = <Text dimColor={true}>{sessionUrl}</Text>;
    $[37] = sessionUrl;
    $[38] = t15;
  } else {
    t15 = $[38];
  }
  let t16;
  if ($[39] !== sessionUrl || $[40] !== t15) {
    t16 = <Link url={sessionUrl}>{t15}</Link>;
    $[39] = sessionUrl;
    $[40] = t15;
    $[41] = t16;
  } else {
    t16 = $[41];
  }
  let t17;
  if ($[42] !== t14 || $[43] !== t16) {
    t17 = <Box flexDirection="column">{t14}{t16}</Box>;
    $[42] = t14;
    $[43] = t16;
    $[44] = t17;
  } else {
    t17 = $[44];
  }
  let t18;
  if ($[45] !== handleSelect || $[46] !== options) {
    t18 = <Select options={options} onChange={handleSelect} />;
    $[45] = handleSelect;
    $[46] = options;
    $[47] = t18;
  } else {
    t18 = $[47];
  }
  let t19;
  if ($[48] !== t12 || $[49] !== t17 || $[50] !== t18) {
    t19 = <Box flexDirection="column" gap={1}>{t12}{t17}{t18}</Box>;
    $[48] = t12;
    $[49] = t17;
    $[50] = t18;
    $[51] = t19;
  } else {
    t19 = $[51];
  }
  let t20;
  if ($[52] !== goBackOrClose || $[53] !== t19 || $[54] !== t9) {
    t20 = <Dialog title={t9} onCancel={goBackOrClose} color="background" inputGuide={_temp}>{t19}</Dialog>;
    $[52] = goBackOrClose;
    $[53] = t19;
    $[54] = t9;
    $[55] = t20;
  } else {
    t20 = $[55];
  }
  return t20;
}
function _temp(exitState) {
  return exitState.pending ? <Text>Press {exitState.keyName} again to exit</Text> : <Byline><KeyboardShortcutHint shortcut="Enter" action="select" /><KeyboardShortcutHint shortcut="Esc" action="go back" /></Byline>;
}
export function RemoteSessionDetailDialog({
  session,
  toolUseContext,
  onDone,
  onBack,
  onKill
}: Props): React.ReactNode {
  const [isTeleporting, setIsTeleporting] = useState(false);
  const [teleportError, setTeleportError] = useState<string | null>(null);

  // Get last few messages from remote session for display.
  // Scan all messages (not just the last 3 raw entries) because the tail of
  // the log is often thinking-only blocks that normalise to 'progress' type.
  // Placed before the early returns so hook call order is stable (Rules of Hooks).
  // Ultraplan/review sessions never read this — skip the normalize work for them.
  const lastMessages = useMemo(() => {
    if (session.isUltraplan || session.isRemoteReview) return [];
    return normalizeMessages(toInternalMessages(session.log as SDKMessage[])).filter(_ => _.type !== 'progress').slice(-3);
  }, [session]);
  if (session.isUltraplan) {
    return <UltraplanSessionDetail session={session} onDone={onDone} onBack={onBack} onKill={onKill} />;
  }

  // Review sessions get the stage-pipeline view; everything else keeps the
  // generic label/value + recent-messages dialog below.
  if (session.isRemoteReview) {
    return <ReviewSessionDetail session={session} onDone={onDone} onBack={onBack} onKill={onKill} />;
  }
  const handleClose = () => onDone('Remote session details dismissed', {
    display: 'system'
  });

  // Component-specific shortcuts shown in UI hints (t=teleport, space=dismiss,
  // left=back). These are state-dependent actions, not standard dialog keybindings.
  const handleKeyDown = (e: KeyboardEvent) => {
    if (e.key === ' ') {
      e.preventDefault();
      onDone('Remote session details dismissed', {
        display: 'system'
      });
    } else if (e.key === 'left' && onBack) {
      e.preventDefault();
      onBack();
    } else if (e.key === 't' && !isTeleporting) {
      e.preventDefault();
      void handleTeleport();
    } else if (e.key === 'return') {
      e.preventDefault();
      handleClose();
    }
  };

  // Handle teleporting to remote session
  async function handleTeleport(): Promise<void> {
    setIsTeleporting(true);
    setTeleportError(null);
    try {
      await teleportResumeCodeSession(session.sessionId);
    } catch (err) {
      setTeleportError(errorMessage(err));
    } finally {
      setIsTeleporting(false);
    }
  }

  // Truncate title if too long (for display purposes)
  const displayTitle = truncateToWidth(session.title, 50);

  // Map TaskStatus to display status (handle 'pending')
  const displayStatus = session.status === 'pending' ? 'starting' : session.status;
  return <Box flexDirection="column" tabIndex={0} autoFocus onKeyDown={handleKeyDown}>
      <Dialog title="Remote session details" onCancel={handleClose} color="background" inputGuide={exitState => exitState.pending ? <Text>Press {exitState.keyName} again to exit</Text> : <Byline>
              {onBack && <KeyboardShortcutHint shortcut="←" action="go back" />}
              <KeyboardShortcutHint shortcut="Esc/Enter/Space" action="close" />
              {!isTeleporting && <KeyboardShortcutHint shortcut="t" action="teleport" />}
            </Byline>}>
        <Box flexDirection="column">
          <Text>
            <Text bold>Status</Text>:{' '}
            {displayStatus === 'running' || displayStatus === 'starting' ? <Text color="background">{displayStatus}</Text> : displayStatus === 'completed' ? <Text color="success">{displayStatus}</Text> : <Text color="error">{displayStatus}</Text>}
          </Text>
          <Text>
            <Text bold>Runtime</Text>:{' '}
            {formatDuration((session.endTime ?? Date.now()) - session.startTime)}
          </Text>
          <Text wrap="truncate-end">
            <Text bold>Title</Text>: {displayTitle}
          </Text>
          <Text>
            <Text bold>Progress</Text>:{' '}
            <RemoteSessionProgress session={session} />
          </Text>
          <Text>
            <Text bold>Session URL</Text>:{' '}
            <Link url={getRemoteTaskSessionUrl(session.sessionId)}>
              <Text dimColor>{getRemoteTaskSessionUrl(session.sessionId)}</Text>
            </Link>
          </Text>
        </Box>

        {/* Remote session messages section */}
        {session.log.length > 0 && <Box flexDirection="column" marginTop={1}>
            <Text>
              <Text bold>Recent messages</Text>:
            </Text>
            <Box flexDirection="column" height={10} overflowY="hidden">
              {lastMessages.map((msg, i) => <Message key={i} message={msg} lookups={EMPTY_LOOKUPS} addMargin={i > 0} tools={toolUseContext.options.tools} commands={toolUseContext.options.commands} verbose={toolUseContext.options.verbose} inProgressToolUseIDs={new Set()} progressMessagesForMessage={[]} shouldAnimate={false} shouldShowDot={false} style="condensed" isTranscriptMode={false} isStatic={true} />)}
            </Box>
            <Box marginTop={1}>
              <Text dimColor italic>
                Showing last {lastMessages.length} of {session.log.length}{' '}
                messages
              </Text>
            </Box>
          </Box>}

        {/* Teleport error message */}
        {teleportError && <Box marginTop={1}>
            <Text color="error">Teleport failed: {teleportError}</Text>
          </Box>}

        {/* Teleporting status */}
        {isTeleporting && <Text color="background">Teleporting to session…</Text>}
      </Dialog>
    </Box>;
}
