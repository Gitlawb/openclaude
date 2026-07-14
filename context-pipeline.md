## Full Context Pipeline: Message → API Call

Every turn runs through this pipeline in `query.ts` (the `while(true)` loop). Here's each step, in order:

### Step 1: Proactive Budget (line 682)
`applyProactiveBudget()` — strips old redundant Read/Write/Edit tool results, keeping only the latest per file. Content-aware pruning only — never removes messages. Feature-gated by `proactiveBudgetLimit` config (default: 100K, set 0 to disable). Runs BEFORE all other compaction so subsequent passes have less work.

### Step 2: Conversation Arc (line 690)
`updateArcPhase()` — if the `CONVERSATION_ARC` feature is on and knowledge graph is enabled, extracts facts from the latest message.

### Step 3: Tool Result Budget (line 717)
`applyToolResultBudget()` — enforces per-message caps on aggregate tool result size. If a tool result exceeds the budget, its content is replaced with a summary marker. Replaces content in-place for cache efficiency.

### Step 4: Snip (line 744)
`snipCompactIfNeeded()` — removes messages that were marked for deletion by the `SnipTool` (feature-gated by `HISTORY_SNIP`). Returns `tokensFreed` which flows into later threshold checks.

### Step 5: Microcompact (line 757)
`deps.microcompact(messagesForQuery)` — replaces individual tool_result content blocks with **stub markers** for cache efficiency. Doesn't remove messages, just edits content in-place.

### Step 6: Context Collapse (line 790)
`contextCollapse.applyCollapsesIfNeeded()` — projects a **collapsed view** of old messages. Archived messages are replaced with collapse summaries. Feature-gated by `CONTEXT_COLLAPSE`.

### Step 7: Conversation Arc Summary (line 801)
`getArcSummary()` — if `CONVERSATION_ARC` is on, injects a summary of the conversation's thematic arc into the **system prompt** (not messages).

### Step 8: Force Compaction Check (line 835)
Checks two conditions:
- **Message count limit** (`maxMessagesCompactionThreshold`): if message count exceeds threshold, sets `forceReason: 'message-count'`
- **Memory pressure** (`consumeCompactionRequest()`): if the system detected memory pressure, sets `forceReason: 'memory-pressure'`

Both bypass the normal token-threshold check in autocompact.

### Step 9: AutoCompact (line 855)
After force compaction check, if the estimated token count exceeds the autocompact threshold, `compactConversation()` runs. This is the heavy compaction — it asks the model to **summarize old turns** into compact boundary messages. The summary replaces the original messages. Key thresholds (`autoCompact.ts`):
- **Context window** = model's limit minus `MAX_OUTPUT_TOKENS_FOR_SUMMARY` (20K)
- **Auto-compact fires at** ~80% of effective context window
- **Blocking limit** = context window (hard stop)
- **Warning threshold** = ~75% (yellow in UI)
- **Error threshold** = ~85% (red in UI)

### Step 10: Blocking Limit Pre-check
Before sending, calculates token estimate via `tokenCountWithEstimation()`:
```
estimatedTokens = tokenCountWithEstimation(messagesForQuery) - snipTokensFreed
```
If `isAtBlockingLimit(estimatedTokens)` is true, the turn is **aborted immediately** with a "conversation is too long" error — never hits the API. This prevents wasting API calls on requests that will get 413'd.

### Step 11: The API Call
```
messages = prependUserContext(messagesForQuery, userContext)
systemPrompt = appendSystemContext(systemPrompt + arc, systemContext)
```
Then:
```
deps.callModel({
  messages,         // ← the compiled message list
  systemPrompt,     // ← system + user context + arc
  tools,            // ← available tools
  signal,           // ← abort controller
  options: {        // ← model, maxOutputTokens, taskBudget, etc.
    model: currentModel,
    ...
  }
})
```

### User Context Injection (`context.ts`)
`getUserContext()` gathers CLAUDE.md files, memory files, git instructions, and repo map; `getSystemContext()` adds git status. These are assembled into the system prompt before each query.

### Token accounting

`tokenCountWithEstimation()` at `src/utils/tokens.ts:572`:
1. Walks backwards from the last message
2. Finds the last assistant message with real API token usage data
3. Sums: last API response's cached tokens + incremental counter for everything newer

This is used for the blocking-limit check AND the autocompact threshold decision. The incremental counter (`getIncrementalTokenCounter()`) tracks tokens added since the last API call — tool results, user messages — so the estimate converges on real token counts without needing a full re-count.

### Summary diagram

```
messages[]
  ↓
[ProactiveBudget] → strip old redundant Read/Write/Edit tool results (never drops messages)
[Arc]             → extract facts from latest message  
[ToolBudget]      → cap per-tool-result size
[SnipCompact]     → remove marked messages
[Microcompact]    → stub markers for cache
[Collapse]        → replace archived turns with summaries
[ArcSummary]      → inject KG summary into system prompt
[ForceCompact]    → check message count / memory pressure
[AutoCompact]     → summarize old turns (if over threshold)
[BlockingCheck]   → pre-emptively abort if would 413
  ↓
normalizeMessagesForAPI()  → strip virtuals, reorder, handle errors
prependUserContext()       → inject user context
appendSystemContext()      → inject system context
  ↓
callModel({ messages, systemPrompt, tools, ... })
```
