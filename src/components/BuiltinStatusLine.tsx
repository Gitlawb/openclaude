import { feature } from 'bun:bundle';
import * as React from 'react';
import { memo, useMemo } from 'react';
import { getKairosActive, getSdkBetas } from '../bootstrap/state.js';
import { getTotalCost } from '../cost-tracker.js';
import { useMainLoopModel } from '../hooks/useMainLoopModel.js';
import type { ReadonlySettings } from '../hooks/useSettings.js';
import { useTerminalSize } from '../hooks/useTerminalSize.js';
import { Box, Text } from '../ink.js';
import { getRawUtilization } from '../services/claudeAiLimits.js';
import { useClaudeAiLimits } from '../services/claudeAiLimitsHook.js';
import { useAppState } from '../state/AppState.js';
import type { Message } from '../types/message.js';
import { getGlobalConfig } from '../utils/config.js';
import { calculateContextPercentages, getContextWindowForModel } from '../utils/context.js';
import { isFullscreenEnvEnabled } from '../utils/fullscreen.js';
import { getRuntimeMainLoopModel, renderModelName } from '../utils/model/model.js';
import type { Theme } from '../utils/theme.js';
import { doesMostRecentAssistantMessageExceed200k, getCurrentUsage } from '../utils/tokens.js';

/**
 * Built-in status bar shown when the user has NOT configured a custom
 * /statusline command: `model · ctx % · session cost · rate limit`.
 * A configured custom statusline always takes precedence (see the ternary in
 * PromptInputFooter). Unlike the custom path this is pure in-process
 * computation — no subprocess, no debounce.
 */
export function builtinStatusLineShouldDisplay(settings: ReadonlySettings, config = getGlobalConfig()): boolean {
  // Assistant mode: fields reflect the REPL/daemon process, not the agent
  // child — hide, same as statusLineShouldDisplay.
  if (feature('KAIROS') && getKairosActive()) return false;
  // A configured custom statusline command always wins.
  if (settings?.statusLine !== undefined) return false;
  return config.defaultStatusLineEnabled ?? true;
}
export type StatusSegment = {
  key: string;
  /** Lower survives longer when the terminal narrows. */
  priority: number;
  text: string;
  color?: keyof Theme;
};
const SEPARATOR = ' · ';
export type BuiltinStatusData = {
  modelName: string;
  /** 0–100, or null before the first assistant turn. */
  contextUsedPercent: number | null;
  costUSD: number;
  /** Worst rate-limit window, or null when no utilization data (API-key users). */
  rateLimit: {
    label: string;
    usedPercent: number;
  } | null;
};
export function buildBuiltinStatusSegments(data: BuiltinStatusData): StatusSegment[] {
  const segments: StatusSegment[] = [{
    key: 'model',
    priority: 0,
    text: data.modelName
  }];
  if (data.contextUsedPercent !== null) {
    const pct = Math.round(data.contextUsedPercent);
    segments.push({
      key: 'context',
      priority: 1,
      text: `ctx ${pct}%`,
      // Thresholds align with the auto-compact warnings
      color: pct >= 90 ? 'error' : pct >= 70 ? 'warning' : undefined
    });
  }
  if (data.costUSD > 0) {
    const cost = data.costUSD;
    segments.push({
      key: 'cost',
      priority: 2,
      text: cost >= 100 ? `$${cost.toFixed(0)}` : `$${cost.toFixed(2)}`
    });
  }
  if (data.rateLimit) {
    const pct = Math.round(data.rateLimit.usedPercent);
    segments.push({
      key: 'rateLimit',
      priority: 3,
      text: `${data.rateLimit.label} ${pct}%`,
      color: pct >= 85 ? 'error' : pct >= 60 ? 'warning' : undefined
    });
  }
  return segments;
}

/** Drops the highest-priority-number segments until the joined line fits. */
export function fitSegments(segments: StatusSegment[], maxWidth: number): StatusSegment[] {
  const fits = (segs: StatusSegment[]): boolean => {
    if (segs.length === 0) return true;
    const width = segs.reduce((sum, s) => sum + s.text.length, 0) + (segs.length - 1) * SEPARATOR.length;
    return width <= maxWidth;
  };
  const result = [...segments];
  while (result.length > 1 && !fits(result)) {
    let dropIndex = 0;
    for (let i = 1; i < result.length; i++) {
      if (result[i]!.priority > result[dropIndex]!.priority) dropIndex = i;
    }
    result.splice(dropIndex, 1);
  }
  return fits(result) ? result : [];
}

/** Worst (most-used) of the 5h/7d rate-limit windows, or null without data. */
export function getWorstRateLimit(): BuiltinStatusData['rateLimit'] {
  const raw = getRawUtilization();
  const candidates: { label: string; usedPercent: number }[] = [];
  if (raw.five_hour) candidates.push({ label: '5h', usedPercent: raw.five_hour.utilization * 100 });
  if (raw.seven_day) candidates.push({ label: '7d', usedPercent: raw.seven_day.utilization * 100 });
  if (candidates.length === 0) return null;
  return candidates.reduce((worst, c) => c.usedPercent > worst.usedPercent ? c : worst);
}
type Props = {
  // Same contract as StatusLine: messages stay behind a ref;
  // lastAssistantMessageId is the re-render/recompute trigger.
  messagesRef: React.RefObject<Message[]>;
  lastAssistantMessageId: string | null;
};
function BuiltinStatusLineInner({
  messagesRef,
  lastAssistantMessageId
}: Props): React.ReactNode {
  const permissionMode = useAppState(s => s.toolPermissionContext.mode);
  // AppState-sourced model — same source as API requests (see StatusLine).
  const mainLoopModel = useMainLoopModel();
  // Subscribe to rate-limit header updates so the segment stays fresh.
  useClaudeAiLimits();
  const {
    columns
  } = useTerminalSize();
  const computed = useMemo(() => {
    const msgs = messagesRef.current;
    const exceeds200kTokens = doesMostRecentAssistantMessageExceed200k(msgs);
    const runtimeModel = getRuntimeMainLoopModel({
      permissionMode,
      mainLoopModel,
      exceeds200kTokens
    });
    const contextWindowSize = getContextWindowForModel(runtimeModel, getSdkBetas());
    const contextPercentages = calculateContextPercentages(getCurrentUsage(msgs), contextWindowSize);
    return {
      modelName: renderModelName(runtimeModel),
      contextUsedPercent: contextPercentages.used,
      costUSD: getTotalCost()
    };
    // messagesRef is stable; lastAssistantMessageId is the messages-changed signal
    // eslint-disable-next-line react-hooks/exhaustive-deps
    // biome-ignore lint/correctness/useExhaustiveDependencies: intentional
  }, [lastAssistantMessageId, permissionMode, mainLoopModel, messagesRef]);
  const segments = fitSegments(buildBuiltinStatusSegments({
    ...computed,
    rateLimit: getWorstRateLimit()
  }),
  // paddingX from the footer (2 each side) is already outside this Box;
  // keep a 1-col safety margin against the truncate ellipsis. No artificial
  // floor: fitSegments returning [] is the signal that nothing fits, and the
  // empty branch below already handles it (row-reserve in fullscreen, null
  // otherwise).
  Math.max(columns - 5, 0));

  // Reserve the row in fullscreen — the footer is flexShrink:0, so a 0→1 row
  // change steals a row from ScrollBox (same trick as StatusLine).
  if (segments.length === 0) {
    return isFullscreenEnvEnabled() ? <Text> </Text> : null;
  }
  return <Box>
      <Text wrap="truncate">
        {segments.map((segment, index) => <Text key={segment.key}>
            {index > 0 ? <Text dimColor>{SEPARATOR}</Text> : null}
            <Text color={segment.color} dimColor={segment.color === undefined}>{segment.text}</Text>
          </Text>)}
      </Text>
    </Box>;
}

// Parent (PromptInputFooter) re-renders on every setMessages; memo keeps this
// to lastAssistantMessageId flips (same rationale as StatusLine).
export const BuiltinStatusLine = memo(BuiltinStatusLineInner);
