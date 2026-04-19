# OpenClaude SDK Implementation Spec

## Goal
Implement a working SDK export in the OpenClaude project (`@gitlawb/openclaude`) that mirrors the `@anthropic-ai/claude-agent-sdk` interface, enabling programmatic usage from VS Code extensions.

## Source Project
- **OpenClaude:** `C:\Users\test\Documents\Projects\oclaude`
- **Consumer:** `C:\Users\test\Documents\claudesource\vscode-copilot-chat`

## Current State
- `src/entrypoints/agentSdkTypes.ts` has SDK function stubs that ALL throw `"not implemented"`
- `src/query.ts` has the real `query()` AsyncGenerator that works internally
- `src/QueryEngine.ts` wraps query with session management
- Build system: Bun bundler → single `dist/cli.mjs`
- Package publishes only CLI binary, no SDK exports

## Target Interface (match claude-agent-sdk)

The SDK must export these functions and types:

### Functions
```typescript
// Core query - returns an AsyncGenerator of typed messages
export function query(params: {
  prompt: AsyncIterable<SDKUserMessage>;
  options: Options;
}): Promise<Query>;

// Session management
export function listSessions(params: { dir: string }): Promise<SDKSessionInfo[]>;
export function getSessionInfo(sessionId: string, params: { dir: string }): Promise<SDKSessionInfo | undefined>;
export function getSessionMessages(sessionId: string, params: { dir: string }): Promise<SessionMessage[]>;
export function renameSession(sessionId: string, title: string): Promise<void>;
export function forkSession(sessionId: string, options?: ForkSessionOptions): Promise<ForkSessionResult>;
```

### Key Types
```typescript
interface Options {
  cwd: string;
  additionalDirectories?: string[];
  model?: string;
  sessionId?: string;
  resume?: string;
  permissionMode?: 'default' | 'plan' | 'auto-accept' | 'bypass-permissions';
  abortController?: AbortController;
  executable?: string;
  allowDangerouslySkipPermissions?: boolean;
  disallowedTools?: string[];
  hooks?: Partial<Record<HookEvent, HookCallbackMatcher[]>>;
  mcpServers?: Record<string, McpServerConfig>;
  settings?: {
    env?: Record<string, string>;
    attribution?: { commit: string; pr: string };
  };
  canUseTool?: (name: string, input: any) => Promise<{ behavior: 'allow' | 'deny'; message?: string }>;
  systemPrompt?: { type: 'preset'; preset: string } | { type: 'custom'; content: string };
  settingSources?: string[];
  stderr?: (data: string) => void;
}

interface Query {
  [Symbol.asyncIterator](): AsyncIterator<SDKMessage>;
  setModel(model: string): Promise<void>;
  setPermissionMode(mode: PermissionMode): Promise<void>;
}

type SDKMessage = SDKSystemMessage | SDKAssistantMessage | SDKUserMessage | SDKResultMessage;

interface SDKAssistantMessage {
  type: 'assistant';
  session_id: string;
  parent_tool_use_id: string | null;
  message: {
    role: 'assistant';
    model: string;
    content: Array<TextBlock | ThinkingBlock | ToolUseBlock>;
  };
}

interface SDKResultMessage {
  type: 'result';
  session_id: string;
  subtype?: string;
  result?: string;
  num_turns?: number;
  usage?: { input_tokens: number; output_tokens: number; cache_read_tokens?: number; cache_creation_tokens?: number };
}

interface SDKSystemMessage {
  type: 'system';
  session_id: string;
  subtype?: string;
  [key: string]: unknown;
}

interface SDKUserMessage {
  type: 'user';
  message: { role: 'user'; content: any };
  session_id: string;
  parent_tool_use_id: string | null;
  uuid: string;
}

interface SDKUserMessageReplay {
  type: 'user';
  // replay variant
}

interface TextBlock { type: 'text'; text: string; }
interface ThinkingBlock { type: 'thinking'; thinking: string; }
interface ToolUseBlock { type: 'tool_use'; id: string; name: string; input: any; }

interface SDKSessionInfo {
  session_id: string;
  title?: string;
  created_at?: string;
  updated_at?: string;
  [key: string]: unknown;
}

interface SessionMessage {
  role: 'user' | 'assistant';
  content: any;
  timestamp?: string;
  [key: string]: unknown;
}
```

## Implementation Plan

### Step 1: Create SDK Entry Point
**File:** `src/entrypoints/sdk.ts`

Create a real SDK entry point that:
- Imports `QueryEngine` from `src/QueryEngine.ts`
- Imports `query` from `src/query.ts`
- Implements `query()` function that:
  1. Creates a `QueryEngine` with the provided options
  2. Returns a `Query` object wrapping the engine
  3. The `Query` object implements `AsyncIterable<SDKMessage>`
  4. Supports `setModel()` and `setPermissionMode()`

### Step 2: Implement query()
The `query()` function must:
1. Accept `{ prompt: AsyncIterable<SDKUserMessage>, options: Options }`
2. Initialize app state, tool permissions, file state cache
3. Create a QueryEngine with:
   - `cwd` from options
   - `model` from options
   - `canUseTool` callback from options (for permission handling)
   - `sessionId` for new sessions, `resume` for existing ones
   - Environment variables from `options.settings.env`
   - MCP servers from options
   - Hooks from options
4. Return a `Query` object that:
   - Iterates the prompt async iterable, feeding messages to the engine
   - Yields `SDKMessage` objects from the engine
   - Maps internal message types to SDK message types
   - Supports abort via `abortController`

### Step 3: Implement Session Management
Implement `listSessions`, `getSessionInfo`, `getSessionMessages`, `renameSession` by:
- Reading session JSONL files from `~/.openclaude/projects/<sanitized-cwd>/`
- Parsing session metadata
- Returning typed results

### Step 4: Update Build System
**File:** `scripts/build.ts`

Add a second build target:
```javascript
// Existing CLI build
{ entrypoint: './src/entrypoints/cli.tsx', output: './dist/cli.mjs' }
// New SDK build
{ entrypoint: './src/entrypoints/sdk.ts', output: './dist/sdk.mjs' }
```

The SDK build should:
- Target `node` environment
- Bundle as ESM
- Keep external: `@anthropic-ai/*`, `@grpc/*`, openai, etc.
- NOT include: React, Ink, TUI components, CLI-only code
- Generate `dist/sdk.mjs` and `dist/sdk.d.ts`

### Step 5: Update package.json
```json
{
  "exports": {
    ".": {
      "types": "./dist/sdk.d.ts",
      "import": "./dist/sdk.mjs"
    }
  },
  "files": [
    "bin/",
    "dist/cli.mjs",
    "dist/cli.mjs.map",
    "dist/sdk.mjs",
    "dist/sdk.d.ts",
    "README.md"
  ]
}
```

### Step 6: Type Generation
Generate `dist/sdk.d.ts` that exports all SDK types. Can be done by:
- Writing a manual type file, or
- Using `tsc --emitDeclarationOnly` on the SDK entry point

### Step 7: Integration Test
Create a test script that:
```typescript
import { query } from '@gitlawb/openclaude';

const q = await query({
  prompt: (async function*() {
    yield { type: 'user', message: { role: 'user', content: 'Hello' }, session_id: 'test', parent_tool_use_id: null, uuid: crypto.randomUUID() };
  })(),
  options: { cwd: process.cwd(), model: 'claude-sonnet-4-20250514' }
});

for await (const msg of q) {
  console.log(msg.type, msg);
}
```

## Key Files to Modify/Create

| File | Action | Description |
|---|---|---|
| `src/entrypoints/sdk.ts` | CREATE | Main SDK entry point |
| `src/entrypoints/agentSdkTypes.ts` | MODIFY | Replace stubs with real implementations |
| `scripts/build.ts` | MODIFY | Add SDK build target |
| `package.json` | MODIFY | Add exports, files, types |
| `dist/sdk.mjs` | BUILD OUTPUT | Bundled SDK |
| `dist/sdk.d.ts` | BUILD OUTPUT | Type declarations |

## Key Files to Reference

| File | Purpose |
|---|---|
| `src/QueryEngine.ts` | Core engine to wrap |
| `src/query.ts` | Internal query AsyncGenerator |
| `src/entrypoints/cli.tsx` | How CLI initializes (replicate init flow) |
| `src/entrypoints/init.ts` | Bootstrap/initialization sequence |
| `src/services/api/client.ts` | API client creation |
| `src/services/api/providerConfig.ts` | Provider configuration |
| `src/tools/index.ts` | Tool registration |
| `src/bridge/sessionRunner.ts` | Example of child process spawning pattern |

## Critical Considerations

1. **Initialization sequence:** The CLI does `init()` → provider bootstrap → config loading before any query. SDK must do the same.
2. **Process model:** The SDK should work in-process (no child process spawn). The `QueryEngine` already supports this.
3. **Environment variables:** Provider credentials come from env vars. SDK must support `options.settings.env` override.
4. **Abort handling:** Must respect `options.abortController` and propagate to `QueryEngine.interrupt()`.
5. **Streaming:** SDK must yield partial messages (`stream_event` / `content_block_delta`) for real-time streaming.
6. **Tool permissions:** The `canUseTool` callback must be wired through to the tool permission system.

## Success Criteria
- `import { query } from '@gitlawb/openclaude'` works
- `query()` returns messages via AsyncIterable
- Tool use, permissions, streaming all work
- `listSessions()` returns session list from disk
- Build produces `dist/sdk.mjs` alongside existing `dist/cli.mjs`
- Can be used from vscode-copilot-chat's DI system as `IOpenClaudeSdkService`
