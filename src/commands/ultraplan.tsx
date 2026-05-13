import { readFileSync } from 'fs';
import { REMOTE_CONTROL_DISCONNECTED_MSG } from '../bridge/types.js';
import type { Command } from '../commands.js';
import { DIAMOND_OPEN } from '../constants/figures.js';
import { getRemoteSessionUrl } from '../constants/product.js';
import { getFeatureValue_CACHED_MAY_BE_STALE } from '../services/analytics/growthbook.js';
import { type AnalyticsMetadata_I_VERIFIED_THIS_IS_NOT_CODE_OR_FILEPATHS, logEvent } from '../services/analytics/index.js';
import type { AppState } from '../state/AppStateStore.js';
import { checkRemoteAgentEligibility, formatPreconditionError, RemoteAgentTask, type RemoteAgentTaskState, registerRemoteAgentTask } from '../tasks/RemoteAgentTask/RemoteAgentTask.js';
import type { LocalJSXCommandCall } from '../types/command.js';
import { logForDebugging } from '../utils/debug.js';
import { errorMessage } from '../utils/errors.js';
import { logError } from '../utils/log.js';
import { enqueuePendingNotification } from '../utils/messageQueueManager.js';
import { ALL_MODEL_CONFIGS } from '../utils/model/configs.js';
import { updateTaskState } from '../utils/task/framework.js';
import { archiveRemoteSession, teleportToRemote } from '../utils/teleport.js';
import { pollForApprovedExitPlanMode, UltraplanPollError } from '../utils/ultraplan/ccrSession.js';

// TODO(prod-hardening): OAuth token may go stale over the 30min poll;
// consider refresh.

// Multi-agent exploration is slow; 30min timeout.
const ULTRAPLAN_TIMEOUT_MS = 30 * 60 * 1000;
export const CCR_TERMS_URL = 'https://code.claude.com/docs/en/claude-code-on-the-web';

// CCR runs against the first-party API — use the canonical ID, not the
// provider-specific string getModelStrings() would return (which may be a
// Bedrock ARN or Vertex ID on the local CLI). Read at call time, not module
// load: the GrowthBook cache is empty at import and `/config` Gates can flip
// it between invocations.
function getUltraplanModel(): string {
  return getFeatureValue_CACHED_MAY_BE_STALE('tengu_ultraplan_model', ALL_MODEL_CONFIGS.opus46.firstParty);
}

// prompt.txt is wrapped in <system-reminder> so the CCR browser hides
// scaffolding (CLI_BLOCK_TAGS dropped by stripSystemNotifications)
// while the model still sees full text.
// Phrasing deliberately avoids the feature name because
// the remote CCR CLI runs keyword detection on raw input before
// any tag stripping, and a bare "ultraplan" in the prompt would self-trigger as
// /ultraplan, which is filtered out of headless mode as "Unknown skill"
//
// Bundler inlines .txt as a string; the test runner wraps it as {default}.
/* eslint-disable @typescript-eslint/no-require-imports */
const _rawPrompt = require('../utils/ultraplan/prompt.txt');
/* eslint-enable @typescript-eslint/no-require-imports */
const DEFAULT_INSTRUCTIONS: string = (typeof _rawPrompt === 'string' ? _rawPrompt : _rawPrompt.default).trimEnd();

// Dev-only prompt override resolved eagerly at module load.
// Gated to ant builds (USER_TYPE is a build-time define,
// so the override path is DCE'd from external builds).
// Shell-set env only, so top-level process.env read is fine
// — settings.env never injects this.
/* eslint-disable custom-rules/no-process-env-top-level, custom-rules/no-sync-fs -- internal-only dev override; eager top-level read is the point (crash at startup, not silently inside the slash-command try/catch) */
const ULTRAPLAN_INSTRUCTIONS: string = "external" === 'ant' && process.env.ULTRAPLAN_PROMPT_FILE ? readFileSync(process.env.ULTRAPLAN_PROMPT_FILE, 'utf8').trimEnd() : DEFAULT_INSTRUCTIONS;
/* eslint-enable custom-rules/no-process-env-top-level, custom-rules/no-sync-fs */

/**
 * Assemble the initial CCR user message. seedPlan and blurb stay outside the
 * system-reminder so the browser renders them; scaffolding is hidden.
 */
export function buildUltraplanPrompt(blurb: string, seedPlan?: string): string {
  const parts: string[] = [];
  if (seedPlan) {
    parts.push('Here is a draft plan to refine:', '', seedPlan, '');
  }
  parts.push(ULTRAPLAN_INSTRUCTIONS);
  if (blurb) {
    parts.push('', blurb);
  }
  return parts.join('\n');
}
function startDetachedPoll(taskId: string, sessionId: string, url: string, getAppState: () => AppState, setAppState: (f: (prev: AppState) => AppState) => void): void {
  const started = Date.now();
  let failed = false;
  void (async () => {
    try {
      const {
        plan,
        rejectCount,
        executionTarget
      } = await pollForApprovedExitPlanMode(sessionId, ULTRAPLAN_TIMEOUT_MS, phase => {
        if (phase === 'needs_input') logEvent('tengu_ultraplan_awaiting_input', {});
        updateTaskState<RemoteAgentTaskState>(taskId, setAppState, t => {
          if (t.status !== 'running') return t;
          const next = phase === 'running' ? undefined : phase;
          return t.ultraplanPhase === next ? t : {
            ...t,
            ultraplanPhase: next
          };
        });
      }, () => getAppState().tasks?.[taskId]?.status !== 'running');
      logEvent('tengu_ultraplan_approved', {
        duration_ms: Date.now() - started,
        plan_length: plan.length,
        reject_count: rejectCount,
        execution_target: executionTarget as AnalyticsMetadata_I_VERIFIED_THIS_IS_NOT_CODE_OR_FILEPATHS
      });
      if (executionTarget === 'remote') {
        // User chose "execute in CCR" in the browser PlanModal — the remote
        // session is now coding. Skip archive (ARCHIVE has no running-check,
        // would kill mid-execution) and skip the choice dialog (already chose).
        // Guard on task status so a poll that resolves after stopUltraplan
        // doesn't notify for a killed session.
        const task = getAppState().tasks?.[taskId];
        if (task?.status !== 'running') return;
        updateTaskState<RemoteAgentTaskState>(taskId, setAppState, t => t.status !== 'running' ? t : {
          ...t,
          status: 'completed',
          endTime: Date.now()
        });
        setAppState(prev => prev.ultraplanSessionUrl === url ? {
          ...prev,
          ultraplanSessionUrl: undefined
        } : prev);
        enqueuePendingNotification({
          value: [`Ultraplan approved — executing in OpenClaude on the web. Follow along at: ${url}`, '', 'Results will land as a pull request when the remote session finishes. There is nothing to do here.'].join('\n'),
          mode: 'task-notification'
        });
      } else {
        // Teleport: set pendingChoice so REPL mounts UltraplanChoiceDialog.
        // The dialog owns archive + URL clear on choice. Guard on task status
        // so a poll that resolves after stopUltraplan doesn't resurrect the
        // dialog for a killed session.
        setAppState(prev => {
          const task = prev.tasks?.[taskId];
          if (!task || task.status !== 'running') return prev;
          return {
            ...prev,
            ultraplanPendingChoice: {
              plan,
              sessionId,
              taskId
            }
          };
        });
      }
    } catch (e) {
      // If the task was stopped (stopUltraplan sets status=killed), the poll
      // erroring is expected — skip the failure notification and cleanup
      // (kill() already archived; stopUltraplan cleared the URL).
      const task = getAppState().tasks?.[taskId];
      if (task?.status !== 'running') return;
      failed = true;
      logEvent('tengu_ultraplan_failed', {
        duration_ms: Date.now() - started,
        reason: (e instanceof UltraplanPollError ? e.reason : 'network_or_unknown') as AnalyticsMetadata_I_VERIFIED_THIS_IS_NOT_CODE_OR_FILEPATHS,
        reject_count: e instanceof UltraplanPollError ? e.rejectCount : undefined
      });
      enqueuePendingNotification({
        value: `Ultraplan failed: ${errorMessage(e)}\n\nSession: ${url}`,
        mode: 'task-notification'
      });
      // Error path owns cleanup; teleport path defers to the dialog; remote
      // path handled its own cleanup above.
      void archiveRemoteSession(sessionId).catch(e => logForDebugging(`ultraplan archive failed: ${String(e)}`));
      setAppState(prev =>
      // Compare against this poll's URL so a newer relaunched session's
      // URL isn't cleared by a stale poll erroring out.
      prev.ultraplanSessionUrl === url ? {
        ...prev,
        ultraplanSessionUrl: undefined
      } : prev);
    } finally {
      // Remote path already set status=completed above; teleport path
      // leaves status=running so the pill shows the ultraplanPhase state
      // until UltraplanChoiceDialog completes the task after the user's
      // choice. Setting completed here would filter the task out of
      // isBackgroundTask before the pill can render the phase state.
      // Failure path has no dialog, so it owns the status transition here.
      if (failed) {
        updateTaskState<RemoteAgentTaskState>(taskId, setAppState, t => t.status !== 'running' ? t : {
          ...t,
          status: 'failed',
          endTime: Date.now()
        });
      }
    }
  })();
}

// Renders immediately so the terminal doesn't appear hung during the
// multi-second teleportToRemote round-trip.
function buildLaunchMessage(disconnectedBridge?: boolean): string {
  const prefix = disconnectedBridge ? `${REMOTE_CONTROL_DISCONNECTED_MSG} ` : '';
  return `${DIAMOND_OPEN} ultraplan\n${prefix}Starting OpenClaude on the web…`;
}
function buildSessionReadyMessage(url: string): string {
  return `${DIAMOND_OPEN} ultraplan · Monitor progress in OpenClaude on the web ${url}\nYou can continue working — when the ${DIAMOND_OPEN} fills, press ↓ to view results`;
}
function buildAlreadyActiveMessage(url: string | undefined): string {
  return url ? `ultraplan: already polling. Open ${url} to check status, or wait for the plan to land here.` : 'ultraplan: already launching. Please wait for the session to start.';
}

/**
 * Stop a running ultraplan: archive the remote session (halts it but keeps the
 * URL viewable), kill the local task entry (clears the pill), and clear
 * ultraplanSessionUrl (re-arms the keyword trigger). startDetachedPoll's
 * shouldStop callback sees the killed status on its next tick and throws;
 * the catch block early-returns when status !== 'running'.
 */
export async function stopUltraplan(taskId: string, sessionId: string, setAppState: (f: (prev: AppState) => AppState) => void): Promise<void> {
  // RemoteAgentTask.kill archives the session (with .catch) — no separate
  // archive call needed here.
  await RemoteAgentTask.kill(taskId, setAppState);
  setAppState(prev => prev.ultraplanSessionUrl || prev.ultraplanPendingChoice || prev.ultraplanLaunching ? {
    ...prev,
    ultraplanSessionUrl: undefined,
    ultraplanPendingChoice: undefined,
    ultraplanLaunching: undefined
  } : prev);
  const url = getRemoteSessionUrl(sessionId, process.env.SESSION_INGRESS_URL);
  enqueuePendingNotification({
    value: `Ultraplan stopped.\n\nSession: ${url}`,
    mode: 'task-notification'
  });
  enqueuePendingNotification({
    value: 'The user stopped the ultraplan session above. Do not respond to the stop notification — wait for their next message.',
    mode: 'task-notification',
    isMeta: true
  });
}

/**
 * Shared entry for the slash command, keyword trigger, and the plan-approval
 * dialog's "Ultraplan" button. When seedPlan is present (dialog path), it is
 * prepended as a draft to refine; blurb may be empty in that case.
 *
 * Resolves immediately with the user-facing message. Eligibility check,
 * session creation, and task registration run detached and failures surface via
 * enqueuePendingNotification.
 */
export async function launchUltraplan(opts: {
  blurb: string;
  seedPlan?: string;
  getAppState: () => AppState;
  setAppState: (f: (prev: AppState) => AppState) => void;
  signal: AbortSignal;
  /** True if the caller disconnected Remote Control before launching. */
  disconnectedBridge?: boolean;
  /**
   * Called once teleportToRemote resolves with a session URL. Callers that
   * have setMessages (REPL) append this as a second transcript message so the
   * URL is visible without opening the ↓ detail view. Callers without
   * transcript access (ExitPlanModePermissionRequest) omit this — the pill
   * still shows live status.
   */
  onSessionReady?: (msg: string) => void;
}): Promise<string> {
  const {
    blurb,
    seedPlan,
    getAppState,
    setAppState,
    signal,
    disconnectedBridge,
    onSessionReady
  } = opts;
  const {
    ultraplanSessionUrl: active,
    ultraplanLaunching
  } = getAppState();
  if (active || ultraplanLaunching) {
    logEvent('tengu_ultraplan_create_failed', {
      reason: (active ? 'already_polling' : 'already_launching') as AnalyticsMetadata_I_VERIFIED_THIS_IS_NOT_CODE_OR_FILEPATHS
    });
    return buildAlreadyActiveMessage(active);
  }
  if (!blurb && !seedPlan) {
    // No event — bare /ultraplan is a usage query, not an attempt.
    return [
    // Rendered via <Markdown>; raw <message> is tokenized as HTML
    // and dropped. Backslash-escape the brackets.
    'Usage: /ultraplan \\<prompt\\>, or include "ultraplan" anywhere', 'in your prompt', '', 'Advanced multi-agent plan mode with our most powerful model', '(Opus). Runs in OpenClaude on the web. When the plan is ready,', 'you can execute it in the web session or send it back here.', 'Terminal stays free while the remote plans.', 'Requires /login.', '', `Terms: ${CCR_TERMS_URL}`].join('\n');
  }

  // Set synchronously before the detached flow to prevent duplicate launches
  // during the teleportToRemote window.
  setAppState(prev => prev.ultraplanLaunching ? prev : {
    ...prev,
    ultraplanLaunching: true
  });
  void launchDetached({
    blurb,
    seedPlan,
    getAppState,
    setAppState,
    signal,
    onSessionReady
  });
  return buildLaunchMessage(disconnectedBridge);
}
async function launchDetached(opts: {
  blurb: string;
  seedPlan?: string;
  getAppState: () => AppState;
  setAppState: (f: (prev: AppState) => AppState) => void;
  signal: AbortSignal;
  onSessionReady?: (msg: string) => void;
}): Promise<void> {
  const {
    blurb,
    seedPlan,
    getAppState,
    setAppState,
    signal,
    onSessionReady
  } = opts;
  // Hoisted so the catch block can archive the remote session if an error
  // occurs after teleportToRemote succeeds (avoids 30min orphan).
  let sessionId: string | undefined;
  try {
    const model = getUltraplanModel();
    const eligibility = await checkRemoteAgentEligibility();
    if (!eligibility.eligible) {
      logEvent('tengu_ultraplan_create_failed', {
        reason: 'precondition' as AnalyticsMetadata_I_VERIFIED_THIS_IS_NOT_CODE_OR_FILEPATHS,
        precondition_errors: eligibility.errors.map(e => e.type).join(',') as AnalyticsMetadata_I_VERIFIED_THIS_IS_NOT_CODE_OR_FILEPATHS
      });
      const reasons = eligibility.errors.map(formatPreconditionError).join('\n');
      enqueuePendingNotification({
        value: `ultraplan: cannot launch remote session —\n${reasons}`,
        mode: 'task-notification'
      });
      return;
    }
    const prompt = buildUltraplanPrompt(blurb, seedPlan);
    let bundleFailMsg: string | undefined;
    const session = await teleportToRemote({
      initialMessage: prompt,
      description: blurb || 'Refine local plan',
      model,
      permissionMode: 'plan',
      ultraplan: true,
      signal,
      useDefaultEnvironment: true,
      onBundleFail: msg => {
        bundleFailMsg = msg;
      }
    });
    if (!session) {
      logEvent('tengu_ultraplan_create_failed', {
        reason: (bundleFailMsg ? 'bundle_fail' : 'teleport_null') as AnalyticsMetadata_I_VERIFIED_THIS_IS_NOT_CODE_OR_FILEPATHS
      });
      enqueuePendingNotification({
        value: `ultraplan: session creation failed${bundleFailMsg ? ` — ${bundleFailMsg}` : ''}. See --debug for details.`,
        mode: 'task-notification'
      });
      return;
    }
    sessionId = session.id;
    const url = getRemoteSessionUrl(session.id, process.env.SESSION_INGRESS_URL);
    setAppState(prev => ({
      ...prev,
      ultraplanSessionUrl: url,
      ultraplanLaunching: undefined
    }));
    onSessionReady?.(buildSessionReadyMessage(url));
    logEvent('tengu_ultraplan_launched', {
      has_seed_plan: Boolean(seedPlan),
      model: model as AnalyticsMetadata_I_VERIFIED_THIS_IS_NOT_CODE_OR_FILEPATHS
    });
    // TODO(#23985): replace registerRemoteAgentTask + startDetachedPoll with
    // ExitPlanModeScanner inside startRemoteSessionPolling.
    const {
      taskId
    } = registerRemoteAgentTask({
      remoteTaskType: 'ultraplan',
      session: {
        id: session.id,
        title: blurb || 'Ultraplan'
      },
      command: blurb,
      context: {
        abortController: new AbortController(),
        getAppState,
        setAppState
      },
      isUltraplan: true
    });
    startDetachedPoll(taskId, session.id, url, getAppState, setAppState);
  } catch (e) {
    logError(e);
    logEvent('tengu_ultraplan_create_failed', {
      reason: 'unexpected_error' as AnalyticsMetadata_I_VERIFIED_THIS_IS_NOT_CODE_OR_FILEPATHS
    });
    enqueuePendingNotification({
      value: `ultraplan: unexpected error — ${errorMessage(e)}`,
      mode: 'task-notification'
    });
    if (sessionId) {
      // Error after teleport succeeded — archive so the remote doesn't sit
      // running for 30min with nobody polling it.
      void archiveRemoteSession(sessionId).catch(err => logForDebugging('ultraplan: failed to archive orphaned session', err));
      // ultraplanSessionUrl may have been set before the throw; clear it so
      // the "already polling" guard doesn't block future launches.
      setAppState(prev => prev.ultraplanSessionUrl ? {
        ...prev,
        ultraplanSessionUrl: undefined
      } : prev);
    }
  } finally {
    // No-op on success: the url-setting setAppState already cleared this.
    setAppState(prev => prev.ultraplanLaunching ? {
      ...prev,
      ultraplanLaunching: undefined
    } : prev);
  }
}
const call: LocalJSXCommandCall = async (onDone, context, args) => {
  const blurb = args.trim();

  // Bare /ultraplan (no args, no seed plan) just shows usage — no dialog.
  if (!blurb) {
    const msg = await launchUltraplan({
      blurb,
      getAppState: context.getAppState,
      setAppState: context.setAppState,
      signal: context.abortController.signal
    });
    onDone(msg, {
      display: 'system'
    });
    return null;
  }

  // Guard matches launchUltraplan's own check — showing the dialog when a
  // session is already active or launching would waste the user's click and set
  // hasSeenUltraplanTerms before the launch fails.
  const {
    ultraplanSessionUrl: active,
    ultraplanLaunching
  } = context.getAppState();
  if (active || ultraplanLaunching) {
    logEvent('tengu_ultraplan_create_failed', {
      reason: (active ? 'already_polling' : 'already_launching') as AnalyticsMetadata_I_VERIFIED_THIS_IS_NOT_CODE_OR_FILEPATHS
    });
    onDone(buildAlreadyActiveMessage(active), {
      display: 'system'
    });
    return null;
  }

  // Mount the pre-launch dialog via focusedInputDialog (bottom region, like
  // permission dialogs) rather than returning JSX (transcript area, anchors
  // at top of scrollback). REPL.tsx handles launch/clear/cancel on choice.
  context.setAppState(prev => ({
    ...prev,
    ultraplanLaunchPending: {
      blurb
    }
  }));
  // 'skip' suppresses the (no content) echo — the dialog's choice handler
  // adds the real /ultraplan echo + launch confirmation.
  onDone(undefined, {
    display: 'skip'
  });
  return null;
};
export default {
  type: 'local-jsx',
  name: 'ultraplan',
  description: `~10–30 min · OpenClaude on the web drafts an advanced plan you can edit and approve. See ${CCR_TERMS_URL}`,
  argumentHint: '<prompt>',
  isEnabled: () => "external" === 'ant',
  load: () => Promise.resolve({
    call
  })
} satisfies Command;
