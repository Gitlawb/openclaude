import * as React from 'react';
import { useEffect, useRef, useState } from 'react';
import { useSettings } from '../../hooks/useSettings.js';
import { Box, Text } from '../../ink.js';
import { formatDuration } from '../../utils/format.js';

const FLASH_DURATION_MS = 1500;
// Sub-second turns don't get a flash — it reads as flicker, not feedback.
const MIN_TURN_MS = 1000;

type Props = {
  /** True while a turn is in flight (isLoading). The flash fires on the
   *  true→false transition, NOT on spinner unmount — the spinner also hides
   *  mid-turn when streaming text takes over as the feedback. */
  turnActive: boolean;
  /** True when something else owns the spinner row or attention (brief idle
   *  status, permission prompts, dialogs, teammates still running). */
  suppressed: boolean;
  loadingStartTimeRef: React.RefObject<number>;
  totalPausedMsRef: React.RefObject<number>;
};

/**
 * Transient `✓ Done · 12s` row shown for ~1.5s after a response completes.
 * Static text (no animation); same row footprint as the spinner (marginTop 1,
 * single row) so the prompt below doesn't jump twice. Mount it permanently
 * next to the spinner slot — it must observe the turnActive transition.
 */
export function CompletionFlash({
  turnActive,
  suppressed,
  loadingStartTimeRef,
  totalPausedMsRef
}: Props): React.ReactNode {
  const settings = useSettings();
  const reducedMotion = settings?.prefersReducedMotion === true;
  const [flash, setFlash] = useState<{ durationMs: number } | null>(null);
  const prevActiveRef = useRef(turnActive);
  useEffect(() => {
    const wasActive = prevActiveRef.current;
    prevActiveRef.current = turnActive;
    if (turnActive) {
      // Next turn started — clear any lingering flash immediately.
      setFlash(null);
      return;
    }
    if (suppressed || reducedMotion) {
      // Suppression owns the row/attention now: also hide an already-active
      // flash rather than only preventing new ones.
      setFlash(null);
      return;
    }
    if (!wasActive) return;
    const elapsedMs = Date.now() - loadingStartTimeRef.current - totalPausedMsRef.current;
    if (elapsedMs < MIN_TURN_MS) return;
    setFlash({
      durationMs: elapsedMs
    });
    const timer = setTimeout(() => setFlash(null), FLASH_DURATION_MS);
    return () => clearTimeout(timer);
    // refs are stable; only the transition matters
    // eslint-disable-next-line react-hooks/exhaustive-deps
    // biome-ignore lint/correctness/useExhaustiveDependencies: intentional
  }, [turnActive, suppressed, reducedMotion]);
  // Belt-and-braces with the effect's clear: don't render the one frame
  // between suppression (or reduced motion) flipping on and the effect
  // committing setFlash(null).
  if (!flash || suppressed || reducedMotion) return null;
  return <Box flexDirection="row" flexWrap="nowrap" marginTop={1} width="100%">
      <Text color="success">✓ </Text>
      <Text dimColor>Done · {formatDuration(flash.durationMs)}</Text>
    </Box>;
}
