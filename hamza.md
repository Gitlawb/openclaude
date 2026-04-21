

I'll analyze the MCP client code and look for improvement opportunities. Let me search for specific patterns like TODOs, FIXMEs, and examine the file structure more thoroughly.

Let me read more of the client.ts file to understand its full structure and provide a comprehensive analysis.

Based on my analysis of the MCP client code, here are the key findings and improvement opportunities:

## Analysis Summary

### Current Architecture

The [client.ts](cci:7://file:///f:/projects/_contribution-forks/openclaude/src/services/mcp/client.ts:0:0-0:0) file (3,364 lines) is a large monolithic module handling:
- **7 transport types**: SSE, SSE-IDE, WebSocket, WebSocket-IDE, HTTP, claude.ai-proxy, stdio, SDK
- **3 specialized in-process servers**: Chrome MCP, Computer Use MCP, SDK MCP
- **Connection lifecycle**: connection, caching, reconnection, cleanup
- **Tool/resource/command fetching** with memoization
- **Error handling**: auth failures, session expiry, network errors
- **Process management**: stdio server process termination with signal escalation

---

## Identified Improvements

### 1. **Modularize Transport Creation (High Priority)**

The transport setup (lines 633-975) is a large `if/else` chain with ~350 lines of repetitive code. Each transport type shares common patterns (headers, auth, logging) but duplicates them:

```typescript
// Current: ~350 lines of if/else
if (serverRef.type === 'sse') { ... }
else if (serverRef.type === 'sse-ide') { ... }
else if (serverRef.type === 'ws') { ... }
// etc
```

**Suggestion**: Create a `transports/` subdirectory with:
- `BaseTransportFactory.ts` - Common header/auth/logging logic
- `SSETransport.ts`, `WebSocketTransport.ts`, `HTTPTransport.ts`, etc.

### 2. **Address Memoization Complexity TODO (Line 605)**

```typescript
@f:\projects\_contribution-forks\openclaude\src\services\mcp\client.ts:604-606
/**
 * TODO (ollie): The memoization here increases complexity by a lot, and im not sure it really improves performance
 */
```

The `connectToServer` function is wrapped with `memoize`, but reconnection logic manually clears caches. This creates:
- Cache invalidation bugs (stale connections)
- Complex cleanup code (lines 1398-1417)
- Race conditions during reconnection

**Suggestion**: Evaluate if connection-level memoization is needed vs. simpler connection pooling.

### 3. **Split Tool/Resource/Command Fetching**

Lines 1758-2122 define 3 large memoized functions (`fetchToolsForClient`, `fetchResourcesForClient`, `fetchCommandsForClient`). Each:
- ~100+ lines
- Similar error handling patterns
- Duplicated capability checks

**Suggestion**: Create `f:\projects\_contribution-forks\openclaude\src\services\mcp\fetchers\` with:
- `ToolFetcher.ts`
- `ResourceFetcher.ts`
- `CommandFetcher.ts`
- Shared `BaseFetcher.ts` with common retry/error handling

### 4. **Process Cleanup Complexity (Lines 1419-1585)**

The stdio cleanup has a complex 500ms signal escalation (SIGINT → SIGTERM → SIGKILL) with nested intervals/timeouts. This is ~170 lines for process termination.

**Suggestion**: Extract to `ProcessTerminator.ts` with configurable escalation strategy.

### 5. **SSE-IDE Auth TODO (Line 695)**

```typescript
@f:\projects\_contribution-forks\openclaude\src\services\mcp\client.ts:694-696
// IDE servers don't need authentication
// TODO: Use the auth token provided in the lockfile
```

Outstanding TODO for IDE authentication.

### 6. **Error Handler Complexity (Lines 1280-1386)**

The [client.onerror](cci:1://file:///f:/projects/_contribution-forks/openclaude/src/services/mcp/client.ts:1279:6-1385:7) handler (100+ lines) handles:
- Terminal error detection
- Session expiry
- Reconnection logic
- Transport-specific error patterns

**Suggestion**: Create pluggable error handler strategy pattern.

---

## Recommended File Structure

```
src/services/mcp/
├── client.ts                    # Core connection orchestration (~1000 lines)
├── errors/
│   ├── McpAuthError.ts
│   ├── McpSessionExpiredError.ts
│   ├── McpToolCallError.ts
│   └── errorClassifiers.ts      # isMcpSessionExpiredError, etc.
├── transports/
│   ├── factories/
│   │   ├── SSETransportFactory.ts
│   │   ├── WebSocketTransportFactory.ts
│   │   ├── HTTPTransportFactory.ts
│   │   └── StdioTransportFactory.ts
│   └── InProcessTransport.ts    # (already exists)
├── fetchers/
│   ├── ToolFetcher.ts
│   ├── ResourceFetcher.ts
│   └── CommandFetcher.ts
├── cleanup/
│   └── ProcessTerminator.ts
└── auth/
    ├── authCache.ts             # McpAuthCache logic (lines 257-316)
    └── ClaudeAiProxyFetch.ts   # createClaudeAiProxyFetch
```

Would you like me to implement any of these improvements? I can start with:
1. **Extracting transport factories** - reduces [client.ts](cci:7://file:///f:/projects/_contribution-forks/openclaude/src/services/mcp/client.ts:0:0-0:0) by ~350 lines
2. **Creating fetcher modules** - reduces another ~300 lines
3. **Modularizing error classes** - cleaner separation of concerns