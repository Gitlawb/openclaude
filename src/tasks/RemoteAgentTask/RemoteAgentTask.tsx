import type { ToolUseBlock } from '@anthropic-ai/sdk/resources';
import { getRemoteSessionUrl } from '../../constants/product.js';
import { OUTPUT_FILE_TAG, REMOTE_REVIEW_PROGRESS_TAG, REMOTE_REVIEW_TAG, STATUS_TAG, SUMMARY_TAG, TASK_ID_TAG, TASK_NOTIFICATION_TAG, TASK_TYPE_TAG, TOOL_USE_ID_TAG, ULTRAPLAN_TAG } from '../../constants/xml.js';
import type { SDKAssistantMessage, SDKMessage } from '../../entrypoints/agentSdkTypes.js';
import type { SetAppState, Task, TaskContext, TaskStateBase } from '../../Task.js';
import { createTaskStateBase, generateTaskId } from '../../Task.js';
import { TodoWriteTool } from '../../tools/TodoWriteTool/TodoWriteTool.js';
import { type BackgroundRemoteSessionPrecondition, checkBackgroundRemoteSessionEligibility } from '../../utils/background/remote/remoteSession.js';
import { logForDebugging } from '../../utils/debug.js';
import { logError } from '../../utils/log.js';
import { enqueuePendingNotification } from '../../utils/messageQueueManager.js';
import { extractTag, extractTextContent } from '../../utils/messages.js';
import { emitTaskTerminatedSdk } from '../../utils/sdkEventQueue.js';
import { deleteRemoteAgentMetadata, listRemoteAgentMetadata, type RemoteAgentMetadata, writeRemoteAgentMetadata } from '../../utils/sessionStorage.js';
import { jsonStringify } from '../../utils/slowOperations.js';
import { appendTaskOutput, evictTaskOutput, getTaskOutputPath, initTaskOutput } from '../../utils/task/diskOutput.js';
import { registerTask, updateTaskState } from '../../utils/task/framework.js';
import { fetchSession } from '../../utils/teleport/api.js';
import { archiveRemoteSession, pollRemoteSessionEvents } from '../../utils/teleport.js';
import type { TodoList } from '../../utils/todo/types.js';
import type { UltraplanPhase } from '../../utils/ultraplan/ccrSession.js';
export type RemoteAgentTaskState = TaskStateBase & {
  type: 'remote_agent';
  remoteTaskType: RemoteTaskType;
  /** Task-specific metadata (PR number, repo, etc.). */
  remoteTaskMetadata?: RemoteTaskMetadata;
  sessionId: string; // Original session ID for API calls
  command: string;
  title: string;
  todoList: TodoList;
  log: SDKMessage[];
  /**
   * Long-running agent that will not be marked as complete after the first `result`.
   */
  isLongRunning?: boolean;
  /**
   * When the local poller started watching this task (at spawn or on restore).
   * Review timeout clocks from here so a restore doesn't immediately time out
   * a task spawned >30min ago.
   */
  pollStartedAt: number;
  /** True when this task was created by a teleported /ultrareview command. */
  isRemoteReview?: boolean;
  /** Parsed from the orchestrator's <remote-review-progress> heartbeat echoes. */
  reviewProgress?: {
    stage?: 'finding' | 'verifying' | 'synthesizing';
    bugsFound: number;
    bugsVerified: number;
    bugsRefuted: number;
  };
  isUltraplan?: boolean;
  /**
   * Scanner-derived pill state. Undefined = running. `needs_input` when the
   * remote asked a clarifying question and is idle; `plan_ready` when
   * ExitPlanMode is awaiting browser approval. Surfaced in the pill badge
   * and detail dialog status line.
   */
  ultraplanPhase?: Exclude<UltraplanPhase, 'running'>;
};
const REMOTE_TASK_TYPES = ['remote-agent', 'ultraplan', 'ultrareview', 'autofix-pr', 'background-pr'] as const;
export type RemoteTaskType = (typeof REMOTE_TASK_TYPES)[number];
function isRemoteTaskType(v: string | undefined): v is RemoteTaskType {
  return (REMOTE_TASK_TYPES as readonly string[]).includes(v ?? '');
}
export type AutofixPrRemoteTaskMetadata = {
  owner: string;
  repo: string;
  prNumber: number;
};
export type RemoteTaskMetadata = AutofixPrRemoteTaskMetadata;

/**
 * Called on every poll tick for tasks with a matching remoteTaskType. Return a
 * non-null string to complete the task (string becomes the notification text),
 * or null to keep polling. Checkers that hit external APIs should self-throttle.
 */
export type RemoteTaskCompletionChecker = (remoteTaskMetadata: RemoteTaskMetadata | undefined) => Promise<string | null>;
const completionCheckers = new Map<RemoteTaskType, RemoteTaskCompletionChecker>();

/**
 * Register a completion checker for a remote task type. Invoked on every poll
 * tick; survives --resume via the sidecar's remoteTaskType + remoteTaskMetadata.
 */
export function registerCompletionChecker(remoteTaskType: RemoteTaskType, checker: RemoteTaskCompletionChecker): void {
  completionCheckers.set(remoteTaskType, checker);
}

/**
 * Persist a remote-agent metadata entry to the session sidecar.
 * Fire-and-forget — persistence failures must not block task registration.
 */
async function persistRemoteAgentMetadata(meta: RemoteAgentMetadata): Promise<void> {
  try {
    await writeRemoteAgentMetadata(meta.taskId, meta);
  } catch (e) {
    logForDebugging(`persistRemoteAgentMetadata failed: ${String(e)}`);
  }
}

/**
 * Remove a remote-agent metadata entry from the session sidecar.
 * Called on task completion/kill so restored sessions don't resurrect
 * tasks that already finished.
 */
async function removeRemoteAgentMetadata(taskId: string): Promise<void> {
  try {
    await deleteRemoteAgentMetadata(taskId);
  } catch (e) {
    logForDebugging(`removeRemoteAgentMetadata failed: ${String(e)}`);
  }
}

// Precondition error result
export type RemoteAgentPreconditionResult = {
  eligible: true;
} | {
  eligible: false;
  errors: BackgroundRemoteSessionPrecondition[];
};

/**
 * Check eligibility for creating a remote agent session.
 */
export async function checkRemoteAgentEligibility({
  skipBundle = false
}: {
  skipBundle?: boolean;
} = {}): Promise<RemoteAgentPreconditionResult> {
  const errors = await checkBackgroundRemoteSessionEligibility({
    skipBundle
  });
  if (errors.length > 0) {
    return {
      eligible: false,
      errors
    };
  }
  return {
    eligible: true
  };
}

/**
 * Format precondition error for display.
 */
export function formatPreconditionError(error: BackgroundRemoteSessionPrecondition): string {
  switch (error.type) {
    case 'not_logged_in':
      return 'Please run /login and sign in with your Anthropic account.';
    case 'no_remote_environment':
      return 'No cloud environment available. Set one up at https://claude.ai/code/onboarding?magic=env-setup';
    case 'not_in_git_repo':
      return 'Background tasks require a git repository. Initialize git or run from a git repository.';
    case 'no_git_remote':
      return 'Background tasks require a GitHub remote. Add one with `git remote add origin REPO_URL`.';
    case 'github_app_not_installed':
      return 'The Neural Network GitHub app must be installed on this repository first.\nhttps://github.com/apps/claude/installations/new';
    case 'policy_blocked':
      return "Remote sessions are disabled by your organization's policy. Contact your organization admin to enable them.";
  }
}

/**
 * Enqueue a remote task notification to the message queue.
 */
function enqueueRemoteNotification(taskId: string, title: string, status: 'completed' | 'failed' | 'killed', setAppState: SetAppState, toolUseId?: string): void {
  // Atomically check and set notified flag to prevent duplicate notifications.
  if (!markTaskNotified(taskId, setAppState)) return;
  const statusText = status === 'completed' ? 'completed successfully' : status === 'failed' ? 'failed' : 'was stopped';
  const toolUseIdLine = toolUseId ? `\n<${TOOL_USE_ID_TAG}>${toolUseId}</${TOOL_USE_ID_TAG}>` : '';
  const outputPath = getTaskOutputPath(taskId);
  const message = `<${TASK_NOTIFICATION_TAG}>
<${TASK_ID_TAG}>${taskId}</${TASK_ID_TAG}>${toolUseIdLine}
<${TASK_TYPE_TAG}>remote_agent</${TASK_TYPE_TAG}>
<${OUTPUT_FILE_TAG}>${outputPath}</${OUTPUT_FILE_TAG}>
<${STATUS_TAG}>${status}</${STATUS_TAG}>
<${SUMMARY_TAG}>Remote task "${title}" ${statusText}</${SUMMARY_TAG}>
</${TASK_NOTIFICATION_TAG}>`;
  enqueuePendingNotification({
    value: message,
    mode: 'task-notification'
  });
}

/**
 * Atomically mark a task as notified. Returns true if this call flipped the
 * flag (caller should enqueue), false if already notified (caller should skip).
 */
function markTaskNotified(taskId: string, setAppState: SetAppState): boolean {
  let shouldEnqueue = false;
  updateTaskState(taskId, setAppState, task => {
    if (task.notified) {
      return task;
    }
    shouldEnqueue = true;
    return {
      ...task,
      notified: true
    };
  });
  return shouldEnqueue;
}

/**
 * Extract the plan content from the remote session log.
 * Searches all assistant messages for <ultraplan>...</ultraplan> tags.
 */
export function extractPlanFromLog(log: SDKMessage[]): string | null {
  // Walk backwards through assistant messages to find <ultraplan> content
  for (let i = log.length - 1; i >= 0; i--) {
    const msg = log[i];
    if (msg?.type !== 'assistant') continue;
    const fullText = extractTextContent(msg.message.content, '\n');
    const plan = extractTag(fullText, ULTRAPLAN_TAG);
    if (plan?.trim()) return plan.trim();
  }
  return null;
}

/**
 * Enqueue an ultraplan-specific failure notification. Unlike enqueueRemoteNotification
 * this does NOT instruct the model to read the raw output file (a JSONL dump that is
 * useless for plan extraction).
 */
export function enqueueUltraplanFailureNotification(taskId: string, sessionId: string, reason: string, setAppState: SetAppState): void {
  if (!markTaskNotified(taskId, setAppState)) return;
  const sessionUrl = getRemoteTaskSessionUrl(sessionId);
  const message = `<${TASK_NOTIFICATION_TAG}>
<${TASK_ID_TAG}>${taskId}</${TASK_ID_TAG}>
<${TASK_TYPE_TAG}>remote_agent</${TASK_TYPE_TAG}>
<${STATUS_TAG}>failed</${STATUS_TAG}>
<${SUMMARY_TAG}>Ultraplan failed: ${reason}</${SUMMARY_TAG}>
</${TASK_NOTIFICATION_TAG}>
The remote Ultraplan session did not produce a plan (${reason}). Inspect the session at ${sessionUrl} and tell the user to retry locally with plan mode.`;
  enqueuePendingNotification({
    value: message,
    mode: 'task-notification'
  });
}

/**
 * Extract review content from the remote session log.
 *
 * Two producers, two event shapes:
 * - bughunter mode: run_hunt.sh is a SessionStart hook; its echo lands as
 *   {type:'system', subtype:'hook_progress', stdout:'...'}. Neural Network never
 *   takes a turn so there are zero assistant messages.
 * - prompt mode: a real assistant turn wraps the review in the tag.
 *
 * Scans hook_progress first since bughunter is the intended production path
 * and prompt mode is the dev/fallback. Newest-first in both cases — the tag
 * appears once at the end of the run so reverse iteration short-circuits.
 */
function extractReviewFromLog(log: SDKMessage[]): string | null {
  for (let i = log.length - 1; i >= 0; i--) {
    const msg = log[i];
    // The final echo before hook exit may land in either the last
    // hook_progress or the terminal hook_response depending on buffering;
    // both have flat stdout.
    if (msg?.type === 'system' && (msg.subtype === 'hook_progress' || msg.subtype === 'hook_response')) {
      const tagged = extractTag(msg.stdout, REMOTE_REVIEW_TAG);
      if (tagged?.trim()) return tagged.trim();
    }
  }
  for (let i = log.length - 1; i >= 0; i--) {
    const msg = log[i];
    if (msg?.type !== 'assistant') continue;
    const fullText = extractTextContent(msg.message.content, '\n');
    const tagged = extractTag(fullText, REMOTE_REVIEW_TAG);
    if (tagged?.trim()) return tagged.trim();
  }

  // Hook-stdout concat fallback: a single echo should land in one event, but
  // large JSON payloads can flush across two if the pipe buffer fills
  // mid-write. Per-message scan above misses a tag split across events.
  const hookStdout = log.filter(msg => msg.type === 'system' && (msg.subtype === 'hook_progress' || msg.subtype === 'hook_response')).map(msg => msg.stdout).join('');
  const hookTagged = extractTag(hookStdout, REMOTE_REVIEW_TAG);
  if (hookTagged?.trim()) return hookTagged.trim();

  // Fallback: concatenate all assistant text in chronological order.
  const allText = log.filter((msg): msg is SDKAssistantMessage => msg.type === 'assistant').map(msg => extractTextContent(msg.message.content, '\n')).join('\n').trim();
  return allText || null;
}

/**
 * Tag-only variant of extractReviewFromLog for delta scanning.
 *
 * Returns non-null ONLY when an explicit <remote-review> tag is found.
 * Unlike extractReviewFromLog, this does NOT fall back to concatenated
 * assistant text. This is critical for the delta scan: in prompt mode,
 * early untagged assistant messages (e.g. "I'm analyzing the diff...")
 * would trigger the fallback and prematurely set cachedReviewContent,
 * completing the review before the actual tagged output arrives.
 */
function extractReviewTagFromLog(log: SDKMessage[]): string | null {
  // hook_progress / hook_response per-message scan (bughunter path)
  for (let i = log.length - 1; i >= 0; i--) {
    const msg = log[i];
    if (msg?.type === 'system' && (msg.subtype === 'hook_progress' || msg.subtype === 'hook_response')) {
      const tagged = extractTag(msg.stdout, REMOTE_REVIEW_TAG);
      if (tagged?.trim()) return tagged.trim();
    }
  }

  // assistant text per-message scan (prompt mode)
  for (let i = log.length - 1; i >= 0; i--) {
    const msg = log[i];
    if (msg?.type !== 'assistant') continue;
    const fullText = extractTextContent(msg.message.content, '\n');
    const tagged = extractTag(fullText, REMOTE_REVIEW_TAG);
    if (tagged?.trim()) return tagged.trim();
  }

  // Hook-stdout concat fallback for split tags
  const hookStdout = log.filter(msg => msg.type === 'system' && (msg.subtype === 'hook_progress' || msg.subtype === 'hook_response')).map(msg => msg.stdout).join('');
  const hookTagged = extractTag(hookStdout, REMOTE_REVIEW_TAG);
  if (hookTagged?.trim()) return hookTagged.trim();
  return null;
}

/**
 * Enqueue a remote-review completion notification. Injects the review text
 * directly into the message queue so the local model receives it on the next
 * turn — no file indirection, no mode change. Session is kept alive so the
 * claude.ai URL stays a durable record the user can revisit; TTL handles cleanup.
 */
function enqueueRemoteReviewNotification(taskId: string, reviewContent: string, setAppState: SetAppState): void {
  if (!markTaskNotified(taskId, setAppState)) return;
  const message = `<${TASK_NOTIFICATION_TAG}>
<${TASK_ID_TAG}>${taskId}</${TASK_ID_TAG}>
<${TASK_TYPE_TAG}>remote_agent</${TASK_TYPE_TAG}>
<${STATUS_TAG}>completed</${STATUS_TAG}>
<${SUMMARY_TAG}>Remote review completed</${SUMMARY_TAG}>
</${TASK_NOTIFICATION_TAG}>
The remote review produced the following findings:

${reviewContent}`;
  enqueuePendingNotification({
    value: message,
    mode: 'task-notification'
  });
}

/**
 * Enqueue a remote-review failure notification.
 */
function enqueueRemoteReviewFailureNotification(taskId: string, reason: string, setAppState: SetAppState): void {
  if (!markTaskNotified(taskId, setAppState)) return;
  const message = `<${TASK_NOTIFICATION_TAG}>
<${TASK_ID_TAG}>${taskId}</${TASK_ID_TAG}>
<${TASK_TYPE_TAG}>remote_agent</${TASK_TYPE_TAG}>
<${STATUS_TAG}>failed</${STATUS_TAG}>
<${SUMMARY_TAG}>Remote review failed: ${reason}</${SUMMARY_TAG}>
</${TASK_NOTIFICATION_TAG}>
Remote review did not produce output (${reason}). Tell the user to retry /ultrareview, or use /review for a local review instead.`;
  enqueuePendingNotification({
    value: message,
    mode: 'task-notification'
  });
}

/**
 * Extract todo list from SDK messages (finds last TodoWrite tool use).
 */
function extractTodoListFromLog(log: SDKMessage[]): TodoList {
  const todoListMessage = log.findLast((msg): msg is SDKAssistantMessage => msg.type === 'assistant' && msg.message.content.some(block => block.type === 'tool_use' && block.name === TodoWriteTool.name));
  if (!todoListMessage) {
    return [];
  }
  const input = todoListMessage.message.content.find((block): block is ToolUseBlock => block.type === 'tool_use' && block.name === TodoWriteTool.name)?.input;
  if (!input) {
    return [];
  }
  const parsedInput = TodoWriteTool.inputSchema.safeParse(input);
  if (!parsedInput.success) {
    return [];
  }
  return parsedInput.data.todos;
}

/**
 * Register a remote agent task in the unified task framework.
 * Bundles task ID generation, output init, state creation, registration, and polling.
 * Callers remain responsible for custom pre-registration logic (git dialogs, transcript upload, teleport options).
 */
export function registerRemoteAgentTask(options: {
  remoteTaskType: RemoteTaskType;
  session: {
    id: string;
    title: string;
  };
  command: string;
  context: TaskContext;
  toolUseId?: string;
  isRemoteReview?: boolean;
  isUltraplan?: boolean;
  isLongRunning?: boolean;
  remoteTaskMetadata?: RemoteTaskMetadata;
}): {
  taskId: string;
  sessionId: string;
  cleanup: () => void;
} {
  const {
    remoteTaskType,
    session,
    command,
    context,
    toolUseId,
    isRemoteReview,
    isUltraplan,
    isLongRunning,
    remoteTaskMetadata
  } = options;
  const taskId = generateTaskId('remote_agent');

  // Create the output file before registering the task.
  // RemoteAgentTask uses appendTaskOutput() (not TaskOutput), so
  // the file must exist for readers before any output arrives.
  void initTaskOutput(taskId);
  const taskState: RemoteAgentTaskState = {
    ...createTaskStateBase(taskId, 'remote_agent', session.title, toolUseId),
    type: 'remote_agent',
    remoteTaskType,
    status: 'running',
    sessionId: session.id,
    command,
    title: session.title,
    todoList: [],
    log: [],
    isRemoteReview,
    isUltraplan,
    isLongRunning,
    pollStartedAt: Date.now(),
    remoteTaskMetadata
  };
  registerTask(taskState, context.setAppState);

  // Persist identity to the session sidecar so --resume can reconnect to
  // still-running remote sessions. Status is not stored — it's fetched
  // fresh from CCR on restore.
  void persistRemoteAgentMetadata({
    taskId,
    remoteTaskType,
    sessionId: session.id,
    title: session.title,
    command,
    spawnedAt: Date.now(),
    toolUseId,
    isUltraplan,
    isRemoteReview,
    isLongRunning,
    remoteTaskMetadata
  });

  // Ultraplan lifecycle is owned by startDetachedPoll in ultraplan.tsx. Generic
  // polling still runs so session.log populates for the detail view's progress
  // counts; the result-lookup guard below prevents early completion.
  // TODO(#23985): fold ExitPlanModeScanner into this poller, drop startDetachedPoll.
  const stopPolling = startRemoteSessionPolling(taskId, context);
  return {
    taskId,
    sessionId: session.id,
    cleanup: stopPolling
  };
}

/**
 * Restore remote-agent tasks from the session sidecar on --resume.
 *
 * Scans remote-agents/, fetches live CCR status for each, reconstructs
 * RemoteAgentTaskState into AppState.tasks, and restarts polling for sessions
 * still running. Sessions that are archived or 404 have their sidecar file
 * removed. Must run after switchSession() so getSessionId() points at the
 * resumed session's sidecar directory.
 */
export async function restoreRemoteAgentTasks(context: TaskContext): Promise<void> {
  try {
    await restoreRemoteAgentTasksImpl(context);
  } catch (e) {
    logForDebugging(`restoreRemoteAgentTasks failed: ${String(e)}`);
  }
}
async function restoreRemoteAgentTasksImpl(context: TaskContext): Promise<void> {
  const persisted = await listRemoteAgentMetadata();
  if (persisted.length === 0) return;
  for (const meta of persisted) {
    let remoteStatus: string;
    try {
      const session = await fetchSession(meta.sessionId);
      remoteStatus = session.session_status;
    } catch (e) {
      // Only 404 means the CCR session is truly gone. Auth errors (401,
      // missing OAuth token) are recoverable via /login — the remote
      // session is still running. fetchSession throws plain Error for all
      // 4xx (validateStatus treats <500 as success), so isTransientNetworkError
      // can't distinguish them; match the 404 message instead.
      if (e instanceof Error && e.message.startsWith('Session not found:')) {
        logForDebugging(`restoreRemoteAgentTasks: dropping ${meta.taskId} (404: ${String(e)})`);
        void removeRemoteAgentMetadata(meta.taskId);
      } else {
        logForDebugging(`restoreRemoteAgentTasks: skipping ${meta.taskId} (recoverable: ${String(e)})`);
      }
      continue;
    }
    if (remoteStatus === 'archived') {
      // Session ended while the local client was offline. Don't resurrect.
      void removeRemoteAgentMetadata(meta.taskId);
      continue;
    }
    const taskState: RemoteAgentTaskState = {
      ...createTaskStateBase(meta.taskId, 'remote_agent', meta.title, meta.toolUseId),
      type: 'remote_agent',
      remoteTaskType: isRemoteTaskType(meta.remoteTaskType) ? meta.remoteTaskType : 'remote-agent',
      status: 'running',
      sessionId: meta.sessionId,
      command: meta.command,
      title: meta.title,
      todoList: [],
      log: [],
      isRemoteReview: meta.isRemoteReview,
      isUltraplan: meta.isUltraplan,
      isLongRunning: meta.isLongRunning,
      startTime: meta.spawnedAt,
      pollStartedAt: Date.now(),
      remoteTaskMetadata: meta.remoteTaskMetadata as RemoteTaskMetadata | undefined
    };
    registerTask(taskState, context.setAppState);
    void initTaskOutput(meta.taskId);
    startRemoteSessionPolling(meta.taskId, context);
  }
}

/**
 * Start polling for remote session updates.
 * Returns a cleanup function to stop polling.
 */
function startRemoteSessionPolling(taskId: string, context: TaskContext): () => void {
  let isRunning = true;
  const POLL_INTERVAL_MS = 1000;
  const REMOTE_REVIEW_TIMEOUT_MS = 30 * 60 * 1000;
  // Remote sessions flip to 'idle' between tool turns. With 100+ rapid
  // turns, a 1s poll WILL catch a transient idle mid-run. Require stable
  // idle (no log growth for N consecutive polls) before believing it.
  const STABLE_IDLE_POLLS = 5;
  let consecutiveIdlePolls = 0;
  let lastEventId: string | null = null;
  let accumulatedLog: SDKMessage[] = [];
  // Cached across ticks so we don't re-scan the full log. Tag appears once
  // at end of run; scanning only the delta (response.newEvents) is O(new).
  let cachedReviewContent: string | null = null;
  const poll = async (): Promise<void> => {
    if (!isRunning) return;
    try {
      const appState = context.getAppState();
      const task = appState.tasks?.[taskId] as RemoteAgentTaskState | undefined;
      if (!task || task.status !== 'running') {
        // Task was killed externally (TaskStopTool) or already terminal.
        // Session left alive so the claude.ai URL stays valid — the run_hunt.sh
        // post_stage() calls land as assistant events there, and the user may
        // want to revisit them after closing the terminal. TTL reaps it.
        return;
      }
      const response = await pollRemoteSessionEvents(task.sessionId, lastEventId);
      lastEventId = response.lastEventId;
      const logGrew = response.newEvents.length > 0;
      if (logGrew) {
        accumulatedLog = [...accumulatedLog, ...response.newEvents];
        const deltaText = response.newEvents.map(msg => {
          if (msg.type === 'assistant') {
            return msg.message.content.filter(block => block.type === 'text').map(block => 'text' in block ? block.text : '').join('\n');
          }
          return jsonStringify(msg);
        }).join('\n');
        if (deltaText) {
          appendTaskOutput(taskId, deltaText + '\n');
        }
      }
      if (response.sessionStatus === 'archived') {
        updateTaskState<RemoteAgentTaskState>(taskId, context.setAppState, t => t.status === 'running' ? {
          ...t,
          status: 'completed',
          endTime: Date.now()
        } : t);
        enqueueRemoteNotification(taskId, task.title, 'completed', context.setAppState, task.toolUseId);
        void evictTaskOutput(taskId);
        void removeRemoteAgentMetadata(taskId);
        return;
      }
      const checker = completionCheckers.get(task.remoteTaskType);
      if (checker) {
        const completionResult = await checker(task.remoteTaskMetadata);
        if (completionResult !== null) {
          updateTaskState<RemoteAgentTaskState>(taskId, context.setAppState, t => t.status === 'running' ? {
            ...t,
            status: 'completed',
            endTime: Date.now()
          } : t);
          enqueueRemoteNotification(taskId, completionResult, 'completed', context.setAppState, task.toolUseId);
          void evictTaskOutput(taskId);
          void removeRemoteAgentMetadata(taskId);
          return;
        }
      }

      // Ultraplan: result(success) fires after every CCR turn, so it must not
      // drive completion — startDetachedPoll owns that via ExitPlanMode scan.
      // Long-running monitors (autofix-pr) emit result per notification cycle,
      // so the same skip applies.
      const result = task.isUltraplan || task.isLongRunning ? undefined : accumulatedLog.findLast(msg => msg.type === 'result');

      // For remote-review: <remote-review> in hook_progress stdout is the
      // bughunter path's completion signal. Scan only the delta to stay O(new);
      // tag appears once at end of run so we won't miss it across ticks.
      // For the failure signal, debounce idle: remote sessions briefly flip
      // to 'idle' between every tool turn, so a single idle observation means
      // nothing. Require STABLE_IDLE_POLLS consecutive idle polls with no log
      // growth.
      if (task.isRemoteReview && logGrew && cachedReviewContent === null) {
        cachedReviewContent = extractReviewTagFromLog(response.newEvents);
      }
      // Parse live progress counts from the orchestrator's heartbeat echoes.
      // hook_progress stdout is cumulative (every echo since hook start), so
      // each event contains all progress tags. Grab the LAST occurrence —
      // extractTag returns the first match which would always be the earliest
      // value (0/0).
      let newProgress: RemoteAgentTaskState['reviewProgress'];
      if (task.isRemoteReview && logGrew) {
        const open = `<${REMOTE_REVIEW_PROGRESS_TAG}>`;
        const close = `</${REMOTE_REVIEW_PROGRESS_TAG}>`;
        for (const ev of response.newEvents) {
          if (ev.type === 'system' && (ev.subtype === 'hook_progress' || ev.subtype === 'hook_response')) {
            const s = ev.stdout;
            const closeAt = s.lastIndexOf(close);
            const openAt = closeAt === -1 ? -1 : s.lastIndexOf(open, closeAt);
            if (openAt !== -1 && closeAt > openAt) {
              try {
                const p = JSON.parse(s.slice(openAt + open.length, closeAt)) as {
                  stage?: 'finding' | 'verifying' | 'synthesizing';
                  bugs_found?: number;
                  bugs_verified?: number;
                  bugs_refuted?: number;
                };
                newProgress = {
                  stage: p.stage,
                  bugsFound: p.bugs_found ?? 0,
                  bugsVerified: p.bugs_verified ?? 0,
                  bugsRefuted: p.bugs_refuted ?? 0
                };
              } catch {
                // ignore malformed progress
              }
            }
          }
        }
      }
      // Hook events count as output only for remote-review — bughunter's
      // SessionStart hook produces zero assistant turns so stableIdle would
      // never arm without this.
      const hasAnyOutput = accumulatedLog.some(msg => msg.type === 'assistant' || task.isRemoteReview && msg.type === 'system' && (msg.subtype === 'hook_progress' || msg.subtype === 'hook_response'));
      if (response.sessionStatus === 'idle' && !logGrew && hasAnyOutput) {
        consecutiveIdlePolls++;
      } else {
        consecutiveIdlePolls = 0;
      }
      const stableIdle = consecutiveIdlePolls >= STABLE_IDLE_POLLS;
      // stableIdle is a prompt-mode completion signal (Neural Network stops writing
      // → session idles → done). In bughunter mode the session is "idle" the
      // entire time the SessionStart hook runs; the previous guard checked
      // hasAssistantEvents as a prompt-mode proxy, but post_stage() now
      // writes assistant events in bughunter mode too, so that check
      // misfires between heartbeats. Presence of a SessionStart hook event
      // is the discriminator — bughunter mode always has one (run_hunt.sh),
      // prompt mode never does — and it arrives before the kickoff
      // post_stage so there's no race. When the hook is running, only the
      // <remote-review> tag or the 30min timeout complete the task.
      // Filtering on hook_event avoids a (theoretical) non-SessionStart hook
      // in prompt mode from blocking stableIdle — the code_review container
      // only registers SessionStart, but the 30min-hang failure mode is
      // worth defending against.
      const hasSessionStartHook = accumulatedLog.some(m => m.type === 'system' && (m.subtype === 'hook_started' || m.subtype === 'hook_progress' || m.subtype === 'hook_response') && (m as {
        hook_event?: string;
      }).hook_event === 'SessionStart');
      const hasAssistantEvents = accumulatedLog.some(m => m.type === 'assistant');
      const sessionDone = task.isRemoteReview && (cachedReviewContent !== null || !hasSessionStartHook && stableIdle && hasAssistantEvents);
      const reviewTimedOut = task.isRemoteReview && Date.now() - task.pollStartedAt > REMOTE_REVIEW_TIMEOUT_MS;
      const newStatus = result ? result.subtype === 'success' ? 'completed' as const : 'failed' as const : sessionDone || reviewTimedOut ? 'completed' as const : accumulatedLog.length > 0 ? 'running' as const : 'starting' as const;

      // Update task state. Guard against terminal states — if stopTask raced
      // while pollRemoteSessionEvents was in-flight (status set to 'killed',
      // notified set to true), bail without overwriting status or proceeding to
      // side effects (notification, permission-mode flip).
      let raceTerminated = false;
      updateTaskState<RemoteAgentTaskState>(taskId, context.setAppState, prevTask => {
        if (prevTask.status !== 'running') {
          raceTerminated = true;
          return prevTask;
        }
        // No log growth and status unchanged → nothing to report. Return
        // same ref so updateTaskState skips the spread and 18 s.tasks
        // subscribers (REPL, Spinner, PromptInput, ...) don't re-render.
        // newProgress only arrives via log growth (heartbeat echo is a
        // hook_progress event), so !logGrew already covers no-update.
        const statusUnchanged = newStatus === 'running' || newStatus === 'starting';
        if (!logGrew && statusUnchanged) {
          return prevTask;
        }
        return {
          ...prevTask,
          status: newStatus === 'starting' ? 'running' : newStatus,
          log: accumulatedLog,
          // Only re-scan for TodoWrite when log grew — log is append-only,
          // so no growth means no new tool_use blocks. Avoids findLast +
          // some + find + safeParse every second when idle.
          todoList: logGrew ? extractTodoListFromLog(accumulatedLog) : prevTask.todoList,
          reviewProgress: newProgress ?? prevTask.reviewProgress,
          endTime: result || sessionDone || reviewTimedOut ? Date.now() : undefined
        };
      });
      if (raceTerminated) return;

      // Send notification if task completed or timed out
      if (result || sessionDone || reviewTimedOut) {
        const finalStatus = result && result.subtype !== 'success' ? 'failed' : 'completed';

        // For remote-review tasks: inject the review text directly into the
        // message queue. No mode change, no file indirection — the local model
        // just sees the review appear as a task-notification on its next turn.
        // Session kept alive — run_hunt.sh's post_stage() has already written
        // the formatted findings as an assistant event, so the claude.ai URL
        // stays a durable record the user can revisit. TTL handles cleanup.
        if (task.isRemoteReview) {
          // cachedReviewContent hit the tag in the delta scan. Full-log scan
          // catches the stableIdle path where the tag arrived in an earlier
          // tick but the delta scan wasn't wired yet (first poll after resume).
          const reviewContent = cachedReviewContent ?? extractReviewFromLog(accumulatedLog);
          if (reviewContent && finalStatus === 'completed') {
            enqueueRemoteReviewNotification(taskId, reviewContent, context.setAppState);
            void evictTaskOutput(taskId);
            void removeRemoteAgentMetadata(taskId);
            return; // Stop polling
          }

          // No output or remote error — mark failed with a review-specific message.
          updateTaskState(taskId, context.setAppState, t => ({
            ...t,
            status: 'failed'
          }));
          const reason = result && result.subtype !== 'success' ? 'remote session returned an error' : reviewTimedOut && !sessionDone ? 'remote session exceeded 30 minutes' : 'no review output — orchestrator may have exited early';
          enqueueRemoteReviewFailureNotification(taskId, reason, context.setAppState);
          void evictTaskOutput(taskId);
          void removeRemoteAgentMetadata(taskId);
          return; // Stop polling
        }
        enqueueRemoteNotification(taskId, task.title, finalStatus, context.setAppState, task.toolUseId);
        void evictTaskOutput(taskId);
        void removeRemoteAgentMetadata(taskId);
        return; // Stop polling
      }
    } catch (error) {
      logError(error);
      // Reset so an API error doesn't let non-consecutive idle polls accumulate.
      consecutiveIdlePolls = 0;

      // Check review timeout even when the API call fails — without this,
      // persistent API errors skip the timeout check and poll forever.
      try {
        const appState = context.getAppState();
        const task = appState.tasks?.[taskId] as RemoteAgentTaskState | undefined;
        if (task?.isRemoteReview && task.status === 'running' && Date.now() - task.pollStartedAt > REMOTE_REVIEW_TIMEOUT_MS) {
          updateTaskState(taskId, context.setAppState, t => ({
            ...t,
            status: 'failed',
            endTime: Date.now()
          }));
          enqueueRemoteReviewFailureNotification(taskId, 'remote session exceeded 30 minutes', context.setAppState);
          void evictTaskOutput(taskId);
          void removeRemoteAgentMetadata(taskId);
          return; // Stop polling
        }
      } catch {
        // Best effort — if getAppState fails, continue polling
      }
    }

    // Continue polling
    if (isRunning) {
      setTimeout(poll, POLL_INTERVAL_MS);
    }
  };

  // Start polling
  void poll();

  // Return cleanup function
  return () => {
    isRunning = false;
  };
}

/**
 * RemoteAgentTask - Handles remote Neural Network.ai session execution.
 *
 * Replaces the BackgroundRemoteSession implementation from:
 * - src/utils/background/remote/remoteSession.ts
 * - src/components/tasks/BackgroundTaskStatus.tsx (polling logic)
 */
export const RemoteAgentTask: Task = {
  name: 'RemoteAgentTask',
  type: 'remote_agent',
  async kill(taskId, setAppState) {
    let toolUseId: string | undefined;
    let description: string | undefined;
    let sessionId: string | undefined;
    let killed = false;
    updateTaskState<RemoteAgentTaskState>(taskId, setAppState, task => {
      if (task.status !== 'running') {
        return task;
      }
      toolUseId = task.toolUseId;
      description = task.description;
      sessionId = task.sessionId;
      killed = true;
      return {
        ...task,
        status: 'killed',
        notified: true,
        endTime: Date.now()
      };
    });

    // Close the task_started bookend for SDK consumers. The poll loop's
    // early-return when status!=='running' won't emit a notification.
    if (killed) {
      emitTaskTerminatedSdk(taskId, 'stopped', {
        toolUseId,
        summary: description
      });
      // Archive the remote session so it stops consuming cloud resources.
      if (sessionId) {
        void archiveRemoteSession(sessionId).catch(e => logForDebugging(`RemoteAgentTask archive failed: ${String(e)}`));
      }
    }
    void evictTaskOutput(taskId);
    void removeRemoteAgentMetadata(taskId);
    logForDebugging(`RemoteAgentTask ${taskId} killed, archiving session ${sessionId ?? 'unknown'}`);
  }
};

/**
 * Get the session URL for a remote task.
 */
export function getRemoteTaskSessionUrl(sessionId: string): string {
  return getRemoteSessionUrl(sessionId, process.env.SESSION_INGRESS_URL);
}
