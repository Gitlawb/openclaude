# Pull Request Proposal

## Title
`feat: add Telegram bot adapter for remote OpenClaude access`

## Body

### Summary

Adds a Telegram bot adapter that enables remote OpenClaude interaction through Telegram topics. Each topic maps to an independent query context with conversation history, file handling, and permission management.

### Changes

#### New files
- `packages/telegram-bot/src/index.ts` — Entry point, bot launch, graceful shutdown
- `packages/telegram-bot/src/bot.ts` — Telegraf setup, auth middleware, command handlers
- `packages/telegram-bot/src/session-manager.ts` — Topic-to-query context mapping, SQLite persistence
- `packages/telegram-bot/src/message-handler.ts` — Markdown-aware chunking, per-topic rate limiting
- `packages/telegram-bot/src/permissions.ts` — `canUseTool` callbacks (auto-approve + interactive)
- `packages/telegram-bot/src/errors.ts` — SDK error mapping to user-friendly messages
- `packages/telegram-bot/src/config.ts` — Environment config, path validation
- `packages/telegram-bot/src/types.ts` — TypeScript interfaces
- `packages/telegram-bot/src/__tests__/message-handler.test.ts` — Markdown splitter tests
- `packages/telegram-bot/src/__tests__/config.test.ts` — Path validation tests
- `packages/telegram-bot/src/__tests__/errors.test.ts` — Error mapping tests
- `packages/telegram-bot/package.json`
- `packages/telegram-bot/tsconfig.json`
- `packages/telegram-bot/.env.example`
- `packages/telegram-bot/README.md`

#### Modified files
- Root `package.json` — add `telegram-bot` to workspaces (if monorepo)
- Root `README.md` — add Telegram bot section to docs

### Test plan

- [ ] `npm run build` — zero TypeScript errors
- [ ] `npm test` — 15 unit tests pass (markdown splitting, path validation, error mapping)
- [ ] Manual: start bot, send message in topic, verify response
- [ ] Manual: send long code, verify chunking preserves code blocks
- [ ] Manual: restart bot, verify conversation history restored
- [ ] Manual: unauthorized user blocked
- [ ] Manual: `/cd ../etc` blocked (path traversal protection)

### Breaking changes

None — new standalone package, no changes to existing code.

### Closes

Closes #<issue-number>

---

## Commit Plan (10 atomic commits)

### Commit 1: `feat(telegram-bot): scaffold project structure`
Files: `package.json`, `tsconfig.json`, `.env.example`, `README.md`, empty src stubs
Message: `feat(telegram-bot): scaffold project structure`

### Commit 2: `feat(telegram-bot): add types and config`
Files: `src/types.ts`, `src/config.ts`
Message: `feat(telegram-bot): add types and config with path validation`

### Commit 3: `feat(telegram-bot): add session manager with SDK integration`
Files: `src/session-manager.ts`
Message: `feat(telegram-bot): add session manager using OpenClaude SDK v1 queryAsync() API`

### Commit 4: `feat(telegram-bot): add permission handling`
Files: `src/permissions.ts`
Message: `feat(telegram-bot): add canUseTool callbacks with auto-approve and interactive modes`

### Commit 5: `feat(telegram-bot): add bot core with commands`
Files: `src/bot.ts`, `src/index.ts`
Message: `feat(telegram-bot): add Telegraf bot with auth, commands, and message routing`

### Commit 6: `feat(telegram-bot): add message handler with markdown chunking`
Files: `src/message-handler.ts`, `src/errors.ts`
Message: `feat(telegram-bot): add MarkdownV2-aware chunking and per-topic rate limiting`

### Commit 7: `feat(telegram-bot): add file handling`
Files: update `src/bot.ts`
Message: `feat(telegram-bot): add file upload/download through Telegram`

### Commit 8: `feat(telegram-bot): add persistence and graceful shutdown`
Files: update `src/session-manager.ts`, `src/index.ts`
Message: `feat(telegram-bot): add SQLite persistence, SIGTERM handler, recovery on restart`

### Commit 9: `test(telegram-bot): add unit tests`
Files: `src/__tests__/*.test.ts`
Message: `test(telegram-bot): add unit tests for message handler, config, and errors`

### Commit 10: `docs(telegram-bot): add README with setup instructions`
Files: `README.md`
Message: `docs(telegram-bot): add setup guide, commands reference, troubleshooting`
