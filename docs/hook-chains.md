# Hook Chains (Self-Healing Agent Mesh MVP)

Hook Chains provide an event-driven recovery layer for important workflow failures.
When a matching hook event occurs, OpenClaude evaluates declarative rules and can dispatch remediation actions such as:

- `spawn_fallback_agent`
- `notify_team`
- `warm_remote_capacity`

## Disabled-By-Default Rollout

> **Rollout recommendation:** keep Hook Chains disabled until you validate rules in your environment.
>
> - Set top-level config to `"enabled": false` initially.
> - Enable per environment when ready.
> - You can hard-disable globally with `CLAUDE_CODE_ENABLE_HOOK_CHAINS=0`.

This keeps existing workflows unchanged while you tune guard windows and action behavior.

## Feature Overview

Hook Chains are loaded from a deterministic config file and evaluated on dispatched hook events.

MVP runtime trigger wiring:

- `PostToolUseFailure` hooks dispatch Hook Chains with outcome `failed`.
- `TaskCompleted` hooks dispatch Hook Chains with outcome:
  - `success` when completion hooks did not block.
  - `failed` when completion hooks returned blocking errors or prevented continuation.

Default config path:

- `.openclaude/hook-chains.json`

Override path:

- `CLAUDE_CODE_HOOK_CHAINS_CONFIG_PATH=/abs/or/relative/path/to/hook-chains.json`

Global gate:

- `CLAUDE_CODE_ENABLE_HOOK_CHAINS=0|1`

## Safety Guarantees

The runtime is intentionally conservative:

- **Depth guard:** chain dispatch is blocked when `chainDepth >= maxChainDepth`.
- **Rule cooldown:** each rule can only re-fire after cooldown expires.
- **Dedup window:** identical event/action combinations are suppressed for a window.
- **Abort-safe behavior:** if the current signal is aborted, actions skip safely.
- **Policy-aware remote warm:** `warm_remote_capacity` skips when remote sessions are policy denied.
- **Bridge inactive no-op:** `warm_remote_capacity` safely skips when no active bridge handle exists.
- **Missing team context safety:** `notify_team` skips with structured reason if no team context/team file is available.
- **Fallback launcher safety:** `spawn_fallback_agent` skips when no runtime launcher callback is wired.

## Configuration Schema Reference

Top-level object:

```json
{
  "version": 1,
  "enabled": true,
  "maxChainDepth": 2,
  "defaultCooldownMs": 30000,
  "defaultDedupWindowMs": 30000,
  "rules": []
}
```

### Top-Level Fields

| Field | Type | Required | Notes |
|---|---|---:|---|
| `version` | `1` | No | Defaults to `1`. |
| `enabled` | `boolean` | No | Global feature switch for this config file. |
| `maxChainDepth` | `integer` | No | Global depth guard (default `2`, max `10`). |
| `defaultCooldownMs` | `integer` | No | Default rule cooldown in ms (default `30000`). |
| `defaultDedupWindowMs` | `integer` | No | Default action dedup window in ms (default `30000`). |
| `rules` | `HookChainRule[]` | Yes | One or more matching rules. |

### Rule Object (`HookChainRule`)

```json
{
  "id": "task-failure-recovery",
  "enabled": true,
  "trigger": {
    "event": "TaskCompleted",
    "outcome": "failed"
  },
  "condition": {
    "toolNames": ["Edit"],
    "taskStatuses": ["failed"],
    "errorIncludes": ["timeout", "permission denied"],
    "eventFieldEquals": {
      "meta.source": "scheduler"
    }
  },
  "cooldownMs": 60000,
  "dedupWindowMs": 30000,
  "maxDepth": 2,
  "actions": []
}
```

| Field | Type | Required | Notes |
|---|---|---:|---|
| `id` | `string` | Yes | Stable identifier used in telemetry/guards. |
| `enabled` | `boolean` | No | Per-rule switch. |
| `trigger.event` | `HookEvent` | Yes | Event name to match. |
| `trigger.outcome` | `"success"|"failed"|"timeout"|"unknown"` | No | Single outcome matcher. |
| `trigger.outcomes` | `Outcome[]` | No | Multi-outcome matcher. Use either `outcome` or `outcomes`. |
| `condition` | `object` | No | Optional extra matching constraints. |
| `cooldownMs` | `integer` | No | Overrides global cooldown for this rule. |
| `dedupWindowMs` | `integer` | No | Overrides global dedup for this rule. |
| `maxDepth` | `integer` | No | Per-rule depth cap. |
| `actions` | `HookChainAction[]` | Yes | One or more actions to execute in order. |

### Condition Fields

| Field | Type | Notes |
|---|---|---|
| `toolNames` | `string[]` | Matches `tool_name` / `toolName` in event payload. |
| `taskStatuses` | `string[]` | Matches `task_status` / `taskStatus` / `status`. |
| `errorIncludes` | `string[]` | Case-insensitive substring match against `error` / `reason` / `message`. |
| `eventFieldEquals` | `Record<string, string\|number\|boolean>` | Dot-path equality against payload (example: `"meta.source": "scheduler"`). |

### Actions

#### `spawn_fallback_agent`

```json
{
  "type": "spawn_fallback_agent",
  "id": "fallback-1",
  "enabled": true,
  "dedupWindowMs": 30000,
  "description": "Fallback recovery for failed task",
  "promptTemplate": "Recover task ${TASK_SUBJECT}. Event=${EVENT_NAME}, outcome=${OUTCOME}, error=${ERROR}. Payload=${PAYLOAD_JSON}",
  "agentType": "general-purpose",
  "model": "sonnet"
}
```

#### `notify_team`

```json
{
  "type": "notify_team",
  "id": "notify-ops",
  "enabled": true,
  "dedupWindowMs": 30000,
  "teamName": "mesh-team",
  "recipients": ["*"],
  "summary": "Hook chain ${RULE_ID} fired",
  "messageTemplate": "Event=${EVENT_NAME} outcome=${OUTCOME}\nTask=${TASK_ID}\nError=${ERROR}\nPayload=${PAYLOAD_JSON}"
}
```

#### `warm_remote_capacity`

```json
{
  "type": "warm_remote_capacity",
  "id": "warm-bridge",
  "enabled": true,
  "dedupWindowMs": 60000,
  "createDefaultEnvironmentIfMissing": false
}
```

## Complete Example Configs

### 1) Retry via Fallback Agent

```json
{
  "version": 1,
  "enabled": true,
  "maxChainDepth": 2,
  "defaultCooldownMs": 30000,
  "defaultDedupWindowMs": 30000,
  "rules": [
    {
      "id": "retry-task-via-fallback",
      "trigger": {
        "event": "TaskCompleted",
        "outcome": "failed"
      },
      "cooldownMs": 60000,
      "actions": [
        {
          "type": "spawn_fallback_agent",
          "id": "spawn-retry-agent",
          "description": "Retry failed task with fallback agent",
          "promptTemplate": "A task failed. Recover it safely.\nTask=${TASK_SUBJECT}\nDescription=${TASK_DESCRIPTION}\nError=${ERROR}\nPayload=${PAYLOAD_JSON}",
          "agentType": "general-purpose",
          "model": "sonnet"
        }
      ]
    }
  ]
}
```

### 2) Notify Only

```json
{
  "version": 1,
  "enabled": true,
  "maxChainDepth": 2,
  "defaultCooldownMs": 30000,
  "defaultDedupWindowMs": 30000,
  "rules": [
    {
      "id": "notify-on-tool-failure",
      "trigger": {
        "event": "PostToolUseFailure",
        "outcome": "failed"
      },
      "condition": {
        "toolNames": ["Edit", "Write", "Bash"]
      },
      "actions": [
        {
          "type": "notify_team",
          "id": "notify-team-failure",
          "recipients": ["*"],
          "summary": "Tool failure detected",
          "messageTemplate": "Tool failure detected.\nEvent=${EVENT_NAME} outcome=${OUTCOME}\nError=${ERROR}\nPayload=${PAYLOAD_JSON}"
        }
      ]
    }
  ]
}
```

### 3) Combined Fallback + Notify + Bridge Warm

```json
{
  "version": 1,
  "enabled": true,
  "maxChainDepth": 2,
  "defaultCooldownMs": 45000,
  "defaultDedupWindowMs": 30000,
  "rules": [
    {
      "id": "full-recovery-chain",
      "trigger": {
        "event": "TaskCompleted",
        "outcomes": ["failed", "timeout"]
      },
      "condition": {
        "errorIncludes": ["timeout", "capacity", "connection"]
      },
      "cooldownMs": 90000,
      "actions": [
        {
          "type": "spawn_fallback_agent",
          "id": "fallback-agent",
          "description": "Recover failed task execution",
          "promptTemplate": "Recover failed task and produce a concise fix summary.\nTask=${TASK_SUBJECT}\nError=${ERROR}\nPayload=${PAYLOAD_JSON}"
        },
        {
          "type": "notify_team",
          "id": "notify-team",
          "recipients": ["*"],
          "summary": "Recovery chain triggered",
          "messageTemplate": "Recovery chain ${RULE_ID} fired.\nOutcome=${OUTCOME}\nTask=${TASK_SUBJECT}\nError=${ERROR}"
        },
        {
          "type": "warm_remote_capacity",
          "id": "warm-capacity",
          "createDefaultEnvironmentIfMissing": false
        }
      ]
    }
  ]
}
```

## Template Variables

The following placeholders are supported by `promptTemplate`, `summary`, and `messageTemplate`:

- `${EVENT_NAME}`
- `${OUTCOME}`
- `${RULE_ID}`
- `${TASK_SUBJECT}`
- `${TASK_DESCRIPTION}`
- `${TASK_ID}`
- `${ERROR}`
- `${PAYLOAD_JSON}`

## Troubleshooting

### Rule never triggers

- Verify `trigger.event` and `trigger.outcome`/`trigger.outcomes` exactly match dispatched event data.
- Check `condition` filters (especially `toolNames` and `eventFieldEquals` dot-path keys).
- Confirm the config file is valid JSON and schema-valid.

### Actions show as skipped

Common skip reasons:

- `action disabled`
- `rule cooldown active ...`
- `dedup window active ...`
- `max chain depth reached ...`
- `No team context is available ...`
- `Team file not found ...`
- `Remote sessions are blocked by policy`
- `Bridge is not active; warm_remote_capacity is a safe no-op`
- `No fallback agent launcher is registered in runtime context`

### Config changes not reflected

- Loader uses memoization by file mtime/size.
- Ensure your editor writes the file fully and updates mtime.
- If needed, force reload from the caller side with `forceReloadConfig: true`.

### Existing workflows changed unexpectedly

- Set `"enabled": false` at top-level.
- Or globally disable with `CLAUDE_CODE_ENABLE_HOOK_CHAINS=0`.
- Re-enable gradually after validating one rule at a time.
