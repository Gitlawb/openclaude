import { c as _c } from "react-compiler-runtime";
import figures from 'figures';
import * as React from 'react';
import { useState } from 'react';
import type { Root } from '../ink.js';
import { Box, Text, useAnimationFrame } from '../ink.js';
import { AppStateProvider } from '../state/AppState.js';
import { checkOutTeleportedSessionBranch, processMessagesForTeleportResume, type TeleportProgressStep, type TeleportResult, teleportResumeCodeSession } from '../utils/teleport.js';
type Props = {
  currentStep: TeleportProgressStep;
  sessionId?: string;
};
const SPINNER_FRAMES = ['◐', '◓', '◑', '◒'];
const STEPS: {
  key: TeleportProgressStep;
  label: string;
}[] = [{
  key: 'validating',
  label: 'Validating session'
}, {
  key: 'fetching_logs',
  label: 'Fetching session logs'
}, {
  key: 'fetching_branch',
  label: 'Getting branch info'
}, {
  key: 'checking_out',
  label: 'Checking out branch'
}];
export function TeleportProgress(t0) {
  const $ = _c(16);
  const {
    currentStep,
    sessionId
  } = t0;
  const [ref, time] = useAnimationFrame(100);
  const frame = Math.floor(time / 100) % SPINNER_FRAMES.length;
  let t1;
  if ($[0] !== currentStep) {
    t1 = s => s.key === currentStep;
    $[0] = currentStep;
    $[1] = t1;
  } else {
    t1 = $[1];
  }
  const currentStepIndex = STEPS.findIndex(t1);
  const t2 = SPINNER_FRAMES[frame];
  let t3;
  if ($[2] !== t2) {
    t3 = <Box marginBottom={1}><Text bold={true} color="claude">{t2} Teleporting session…</Text></Box>;
    $[2] = t2;
    $[3] = t3;
  } else {
    t3 = $[3];
  }
  let t4;
  if ($[4] !== sessionId) {
    t4 = sessionId && <Box marginBottom={1}><Text dimColor={true}>{sessionId}</Text></Box>;
    $[4] = sessionId;
    $[5] = t4;
  } else {
    t4 = $[5];
  }
  let t5;
  if ($[6] !== currentStepIndex || $[7] !== frame) {
    t5 = STEPS.map((step, index) => {
      const isComplete = index < currentStepIndex;
      const isCurrent = index === currentStepIndex;
      const isPending = index > currentStepIndex;
      let icon;
      let color;
      if (isComplete) {
        icon = figures.tick;
        color = "green";
      } else {
        if (isCurrent) {
          icon = SPINNER_FRAMES[frame];
          color = "claude";
        } else {
          icon = figures.circle;
          color = undefined;
        }
      }
      return <Box key={step.key} flexDirection="row"><Box width={2}><Text color={color as never} dimColor={isPending}>{icon}</Text></Box><Text dimColor={isPending} bold={isCurrent}>{step.label}</Text></Box>;
    });
    $[6] = currentStepIndex;
    $[7] = frame;
    $[8] = t5;
  } else {
    t5 = $[8];
  }
  let t6;
  if ($[9] !== t5) {
    t6 = <Box flexDirection="column" marginLeft={2}>{t5}</Box>;
    $[9] = t5;
    $[10] = t6;
  } else {
    t6 = $[10];
  }
  let t7;
  if ($[11] !== ref || $[12] !== t3 || $[13] !== t4 || $[14] !== t6) {
    t7 = <Box ref={ref} flexDirection="column" paddingX={1} paddingY={1}>{t3}{t4}{t6}</Box>;
    $[11] = ref;
    $[12] = t3;
    $[13] = t4;
    $[14] = t6;
    $[15] = t7;
  } else {
    t7 = $[15];
  }
  return t7;
}

/**
 * Teleports to a remote session with progress UI rendered into the existing root.
 * Fetches the session, checks out the branch, and returns the result.
 */
export async function teleportWithProgress(root: Root, sessionId: string): Promise<TeleportResult> {
  // Capture the setState function from the rendered component
  let setStep: (step: TeleportProgressStep) => void = () => {};
  function TeleportProgressWrapper(): React.ReactNode {
    const [step, _setStep] = useState<TeleportProgressStep>('validating');
    setStep = _setStep;
    return <TeleportProgress currentStep={step} sessionId={sessionId} />;
  }
  root.render(<AppStateProvider>
      <TeleportProgressWrapper />
    </AppStateProvider>);
  const result = await teleportResumeCodeSession(sessionId, setStep);
  setStep('checking_out');
  const {
    branchName,
    branchError
  } = await checkOutTeleportedSessionBranch(result.branch);
  return {
    messages: processMessagesForTeleportResume(result.log, branchError),
    branchName
  };
}
