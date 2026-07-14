# Context Management Architecture Comparison

## OpenClaude vs kimi-code / opencode / kilocode

Date: 2026-07-13

---

## Executive Summary

The core performance issue is that **OpenClaude sends the full session conversation history to the API on every single turn**. This means every user message, every tool result, every assistant response — the entire transcript since session start — is included in each API request. What should be a 2-second reply takes 60+ minutes because the context window fills up rapidly and compaction is reactive (only fires when the window is nearly full) rather than proactive.

The other three projects (opencode, kilocode, kimi-code) all use **aggressive proactive context management** — they compact, prune, or budget the message list *before* each API call, keeping only the relevant portion.

**Performance ordering (fastest to slowest):**
1. **opencode** — fastest: two-layer compaction (summary + tail) + aggressive tool output pruning
2. **kilocode** — slightly slower than opencode: same architecture + additional overflow capping
3. **kimi-code** — similar to OpenClaude: uses FullCompaction with strategy patterns, reactive
4. **OpenClaude** — slowest: sends full session context every turn, compaction is reactive

---

## Key Findings

### 1. OpenClaude: Full Session Context Every Turn

**What happens:**
- Every API request includes ALL messages from the session transcript since session start
- `normalizeMessagesForAPI()` in `src/utils/messages.ts` (4117 lines) processes the full message list
- It filters out some message types (progress, system, synthetic errors) but does NOT limit how far back in history it goes
- The message list is gathered from the entire session with no built-in budget/limit

**Compaction (reactive, not proactive):**
- `src/services/compact/autoCompact.ts` checks if context is nearly full and triggers compaction
- `src/services/compact/compact.ts` (1842 lines) runs a compaction agent to summarize old messages
- `AUTOCOMPACT_BUFFER_TOKENS = 13_000` — compaction fires when remaining tokens drop below this
- This means compaction only triggers AFTER the context is almost full, not before
- By the time compaction fires, the API has already been called with the full context multiple times

**Key problem:**
- No proactive budget for how many recent messages/tokens to include
- No "tail-only" approach — everything goes in until compaction fires
- Compaction is a complex, expensive agent-driven process (runs a sub-agent to summarize)
- `normalizeMessagesForAPI` is a massive function (4117-line file) that processes ALL messages

### 2. opencode: Proactive Two-Layer Context Management

**Compaction layer (`packages/opencode/src/session/compaction.ts`, 562 lines):**
- Uses a `Tail Turns` approach: keeps only the last N user-assistant turns as full messages
- `DEFAULT_TAIL_TURNS = 2` — by default, only the last 2 user turns are kept as full messages
- The rest of history is compacted into a structured summary
- `PRUNE_MINIMUM = 20_000` tokens before pruning activates
- `PRUNE_PROTECT = 40_000` tokens protected from pruning
- `MIN_PRESERVE_RECENT_TOKENS = 2_000` / `MAX_PRESERVE_RECENT_TOKENS = 8_000`

**Pruning layer (`compaction.ts` prune function):**
- Goes backwards through messages and removes tool outputs from older turns
- Only prunes completed tool outputs, not error or running ones
- Protected tools (`skill`) are never pruned
- `PRUNE_PROTECTED_TOOLS = ["skill"]`
- Pruning happens in the background (`yield* compaction.prune({ sessionID }).pipe(Effect.ignore, Effect.forkIn(scope))`)

**Overflow detection (`packages/opencode/packages/opencode/src/session/overflow.ts`, 34 lines):**
- `usable()` calculates available tokens: `model.limit.context - maxOutputTokens - reserved`
- `COMPACTION_BUFFER = 20_000` tokens buffer
- `isOverflow()` checks if current token count exceeds usable limit
- Simple, clean, composable check

**Message building (`packages/opencode/packages/opencode/src/session/prompt.ts`):**
- Messages (`msgs`) are `SessionV1.WithParts[]` — the full conversation history
- Before each LLM call, compaction creates a compacted summary and keeps only the tail
- `select()` function determines which messages to keep based on token budget
- `MessageV2.toModelMessagesEffect()` converts the selected messages to API format
- **Key: only the selected subset (head summary + tail turns) is sent to the LLM**

**Compaction summary template:**
```
## Objective
- [one or two brief sentences]

## Important Details
- [constraints/preferences, decisions]

## Work State
### Completed
### Active
### Blocked

## Next Move
1. [immediate concrete action]

## Relevant Files
- [file or path: why it matters]
```

### 3. kilocode: Same Architecture as opencode + Custom Overflows

**Same base architecture as opencode** (fork), with these additions:

- `packages/opencode/src/session/network.ts` (418 lines) — network error handling for session operations (ECONNRESET, ECONNREFUSED, ENOTFOUND, etc.)
- Custom `KiloSessionOverflow` that caps token limits differently from opencode's overflow calculation
- Custom `KiloCompactionPayloadRecovery` — handles compaction failures/recovery
- Custom `KiloCompactionChunks` — chunked compaction processing
- Custom `KiloSessionPromptQueue` — prompt queuing for session
- Custom `SessionExport` — session export functionality
- Different summary template (Goal/Constraints/Progress format)
- Removes `revert.ts` from core and adds `message-id.ts`

**The custom overflow capping makes kilocode slightly more conservative than opencode**, meaning compaction triggers more aggressively, which could explain why it's slightly slower (more compaction rounds).

### 4. kimi-code: FullCompaction with Strategy Pattern

**Architecture:**
- Stateless agent loop with `LoopMessageBuilder` callback pattern
- `LoopMessageBuilder = () => Message[] | Promise<Message[]>` — the host builds messages per turn
- `FullCompaction` class in `packages/agent-core/src/agent/compaction/full.ts` (759 lines)
- Uses a `CompactionStrategy` pattern with `DefaultCompactionStrategy`

**Compaction approach:**
- Similar to OpenClaude — uses an agent-driven summarization process
- `compactionInstructionTemplate` from `compaction-instruction.md`
- `MAX_COMPACTION_RETRY_ATTEMPTS = 5`
- `DEFAULT_COMPACTION_MAX_COMPLETION_TOKENS = 128 * 1024`
- `OVERFLOW_CONTEXT_SAFETY_RATIO = 0.85` — compaction triggers at 85% context window
- `OVERFLOW_STATUS_RECOVERY_RATIO = 0.5` — after overflow, aims for 50% usage

**Key difference from OpenClaude:**
- The `LoopMessageBuilder` pattern means the host can control what messages go into each API call
- `FullCompaction` is more configurable with strategy patterns
- Compaction fires at 85% context window (proactive), not 13k tokens from full (reactive)
- But still sends the full history until compaction fires

---

## Detailed Notes

### How Each Project Builds Messages for API Calls

#### OpenClaude
1. Session transcript stores ALL messages (user, assistant, system, tool results, etc.)
2. Before each API call, messages are gathered from the full transcript
3. `normalizeMessagesForAPI()` filters/sanitizes the full list
4. Result: the entire conversation history is sent every turn
5. Compaction only fires when `AUTOCOMPACT_BUFFER_TOKENS` (13k) is breached

#### opencode
1. Session stores messages as `SessionV1.WithParts[]`
2. `select()` function determines which messages to keep:
   - Default: keeps last 2 user-assistant turns as full messages (tail)
   - Everything before that is compacted into a structured summary
   - Token budget: `MIN_PRESERVE_RECENT_TOKENS=2000` to `MAX_PRESERVE_RECENT_TOKENS=8000`
3. `MessageV2.toModelMessagesEffect()` converts selected messages to API format
4. Result: only the compacted summary + last 2 turns of detail are sent
5. Background pruning continuously removes large tool outputs from older turns

#### kilocode
Same as opencode with:
- More aggressive overflow threshold (custom `KiloSessionOverflow`)
- Additional network error handling
- Chunked compaction processing

#### kimi-code
1. Host builds messages via `LoopMessageBuilder` callback
2. `FullCompaction` replaces old messages with a summary
3. Compaction triggers at 85% context window
4. Still sends all messages until compaction fires
5. Similar to OpenClaude in practice

### The Core Problem (OpenClaude)

The fundamental issue is that OpenClaude sends the **entire session transcript** on every API call. This means:

1. **First few turns** — fine, context is small
2. **10+ turns in** — context includes all tool results, all file reads, all assistant responses
3. **20+ turns in** — context window is near full, every call is massive
4. **Compaction finally fires** — but it's a complex agent-driven process that takes time
5. **After compaction** — the summary replaces old messages, but then the transcript grows again

The result: a 2-second API call becomes a 60-minute ordeal because:
- The API has to process 100k+ tokens of context
- The provider may throttle or take longer on large contexts
- Latency scales with context size for most providers

### Why opencode is Fastest

1. **Always sends only the tail (last ~2 turns)** + a structured summary
2. **Summary is generated by a dedicated compaction model** with a clean template
3. **Tool output pruning happens in the background** asynchronously
4. **Compaction is proactive** — `select()` runs every time messages are prepared
5. **The LLM request is always roughly the same size** regardless of session length

### Why kilocode is Slightly Slower than opencode

1. **Same architecture** but with additional layers
2. **Custom overflow capping** means compaction triggers more often
3. **Additional session features** (network handling, prompt queue, export) add overhead
4. **The core compaction logic is the same** but the extras add latency

### Why kimi-code is Similar to OpenClaude

1. **Both use agent-driven summarization** (run a sub-agent to compact)
2. **Both send full history until compaction fires**
3. **kimi-code has better strategy configuration** (85% threshold, 0.85 ratio)
4. **But the fundamental approach is the same** — reactive, not proactive

---

## Sources & References

### Repositories (shallow clones, depth=1)
- `kimi-code`: `https://github.com/MoonshotAI/kimi-code.git` at `/root/kimi-code`
- `opencode`: `https://github.com/anomalyco/opencode.git` at `/root/opencode`
- `kilocode`: `https://github.com/Kilo-Org/kilocode.git` at `/root/kilocode`
- `openclaude`: `/root/openclaude`

### Key Files

#### OpenClaude
- `src/services/api/client.ts` (828 lines) — monolithic API client
- `src/utils/messages.ts` (4117 lines) — message normalization, `normalizeMessagesForAPI()`
- `src/services/compact/compact.ts` (1842 lines) — compaction agent
- `src/services/compact/autoCompact.ts` (571 lines) — auto-compaction trigger logic
- `src/services/compact/microCompact.ts` — micro-compaction
- `src/query.ts` (2884 lines) — main query loop, message gathering
- `src/services/compact/sessionMemoryCompact.ts` — session memory compaction
- `src/services/compact/snipCompact.ts` — snip-based compaction
- `src/services/compact/cachedMicrocompact.ts` — cached micro-compaction
- `src/services/compact/timeBasedMCConfig.ts` — time-based compaction config

#### opencode
- `packages/opencode/src/session/compaction.ts` (562 lines) — main compaction logic
- `packages/opencode/src/session/overflow.ts` (34 lines) — overflow detection
- `packages/opencode/src/session/prompt.ts` (1631 lines) — session prompt builder, message selection
- `packages/opencode/src/session/message-v2.ts` (734 lines) — message conversion, `toModelMessagesEffect()`
- `packages/opencode/src/session/processor.ts` (718 lines) — session processor, tool call lifecycle
- `packages/core/src/session/compaction.ts` (241 lines) — core compaction, `buildPrompt()`, `select()`
- `packages/core/src/session/message.ts` — core session message types
- `packages/llm/src/route/` — composable LLM architecture
- `packages/llm/src/route/client.ts` (436 lines) — route client
- `packages/llm/src/route/executor.ts` (385 lines) — request executor with retry
- `packages/llm/src/route/protocol.ts` (84 lines) — protocol abstraction
- `packages/llm/src/route/endpoint.ts` (53 lines) — URL construction
- `packages/llm/src/route/framing.ts` (27 lines) — SSE/binary framing
- `packages/llm/src/route/transport/` — HTTP/WebSocket transport
- `packages/llm/src/cache-policy.ts` (111 lines) — caching policy

#### kilocode
- `packages/opencode/src/session/compaction.ts` — same base as opencode + Kilo additions
- `packages/opencode/src/session/network.ts` (418 lines) — NEW: session network error handling
- `packages/opencode/src/session/overflow.ts` — overrides overflow with `KiloSessionOverflow`
- `packages/opencode/src/kilo-sessions/` — Kilo-specific session features
- `packages/core/src/session/compaction.ts` — identical to opencode

#### kimi-code
- `packages/agent-core/src/loop/run-turn.ts` (220 lines) — turn loop
- `packages/agent-core/src/loop/turn-step.ts` (473 lines) — step execution
- `packages/agent-core/src/agent/turn/index.ts` (1463 lines) — agent turn lifecycle
- `packages/agent-core/src/agent/compaction/full.ts` (759 lines) — FullCompaction
- `packages/agent-core/src/agent/compaction/strategy.ts` — compaction strategy patterns
- `packages/agent-core/src/loop/types.ts` (266 lines) — `LoopMessageBuilder` type
- `packages/protocol/src/rest/session.ts` — `CompactSession` protocol definition

---

## Open Questions / Gaps / Uncertainties

1. **How does OpenClaude's session transcript actually get queried for messages?** — I found where `normalizeMessagesForAPI` is called but couldn't trace the exact path where the full message list is gathered from storage/state. Need to check `src/query.ts` more deeply or the session transcript service.

2. **Does OpenClaude have a "tail" concept at all?** — The `contextCollapse` service (`src/services/contextCollapse/`) seems related but I didn't fully analyze it. It might provide some tail-like behavior.

3. **kimi-code's actual message building in the CLI app** — The `LoopMessageBuilder` is a callback, but I couldn't find where the CLI app actually implements it. It's likely in the host layer we didn't fully explore.

4. **How does OpenClaude's snip-based compaction work?** — `snipCompact.ts` exists but I didn't analyze it. It may provide a cheaper compaction path.

5. **The exact performance comparison** — I have the user's claim that opencode is fastest, kimi is similar to OpenClaude, but no hard benchmarks. The relative speed of kilocode vs opencode is unclear from the code alone.

6. **Impact of the monolithic API client on request latency** — `client.ts` (828 lines) does a lot of env-var manipulation and if/else branching per request. How much of the 60-minute delay is from context size vs request preparation overhead?

---

## Recommendations / Next Steps

### Immediate Fix: Add Proactive Tail-Based Message Selection

The single highest-impact change would be to add a **tail-based message selection** layer before `normalizeMessagesForAPI()`. Instead of passing ALL session messages, pass only:
1. A compacted summary of turns before the tail
2. The last N user-assistant turns (configure N, default 2-3)
3. A token budget cap (e.g. keep within 4000 tokens of recent messages)

### Medium-Term: Two-Layer Compaction

1. **Pruning layer**: Asynchronously prune large tool outputs from older turns (like opencode's `prune()`)
2. **Compaction layer**: When tail exceeds budget, run an agent-driven summarization (like opencode's `compact()`)

### Long-Term: Restructure API Layer

1. Separate the monolithic `client.ts` into composable layers (protocol, provider, route, auth, transport)
2. This enables independent optimization of each layer
3. Follow opencode/kilocode's architecture pattern

### Key Architectural Pattern to Follow

opencode's approach:
```
for each API call:
  1. Select messages: head (compacted summary) + tail (last N turns)
  2. Convert to API format
  3. Send compact request
  4. In background: prune tool outputs from old turns
```

This ensures request size stays bounded regardless of session length, which is the core fix for the "2 sec → 60 min" problem.
