import { Telegraf } from "telegraf";
import { message } from "telegraf/filters";
import { createWriteStream } from "node:fs";
import { pipeline } from "node:stream/promises";
import { resolve, basename } from "node:path";
import { SessionManager } from "./session-manager.js";
import { loadConfig, validatePath } from "./config.js";
import type { BotConfig } from "./types.js";
import { buildInteractiveCallback } from "./permissions.js";
import { sendLongMessage, escapeMarkdownV2, splitMarkdown } from "./message-handler.js";
import { mapSDKError } from "./errors.js";

/**
 * Build a session key that includes message_thread_id for forum topic
 * isolation. Without this, all topics in a supergroup share one session.
 */
function getTopicId(ctx: any): string {
  const threadId = ctx.message?.message_thread_id;
  return threadId
    ? `${ctx.message.chat.id}:${threadId}`
    : String(ctx.message.chat.id);
}

/**
 * Parse a composite topicId back into the real chat_id and optional
 * message_thread_id for Telegram API calls.  Forum topics encode as
 * "<chatId>:<threadId>" — the API still needs them as separate fields.
 */
export function parseTopicId(topicId: string): { chatId: string; threadId?: number } {
  const sep = topicId.lastIndexOf(":");
  if (sep > 0) {
    const threadId = Number(topicId.slice(sep + 1));
    if (Number.isFinite(threadId)) {
      return { chatId: topicId.slice(0, sep), threadId };
    }
  }
  return { chatId: topicId };
}

/**
 * Convenience wrapper: parses composite topicId and forwards to sendLongMessage
 * with the correct chat_id and message_thread_id for Telegram API calls.
 */
async function replyToTopic(bot: Telegraf, topicId: string, text: string, parseMode?: "MarkdownV2" | "HTML"): Promise<void> {
  const { chatId, threadId } = parseTopicId(topicId);
  await sendLongMessage(bot, chatId, text, parseMode, threadId);
}

export function createBot(config: BotConfig): Telegraf {
  const bot = new Telegraf(config.botToken);
  const sessionManager = new SessionManager(config);

  // Auth middleware: reject unauthorized users (empty list = deny all)
  bot.use(async (ctx, next) => {
    const userId = ctx.from?.id;
    if (!userId) return;
    if (!config.allowedUsers.includes(userId)) {
      return; // silently ignore unauthorized
    }
    return next();
  });

  bot.on("text", async (ctx, next) => {
    console.log(`[MSG] from=${ctx.from?.id} text="${ctx.message.text.slice(0, 50)}"`);
    return next();
  });

  // /start and /help
  bot.command(["start", "help"], async (ctx) => {
    const text = [
      "🤖 OpenClaude Telegram Bot",
      "━━━━━━━━━━━━━━━━━━━━━━━",
      "",
      "📋 SESSION",
      "  /new — New session",
      "  /kill — Destroy session",
      "  /sessions — List all sessions",
      "  /status — Current session info",
      "",
      "⚙️ SETTINGS",
      "  /cd <path> — Change directory",
      "  /model <name> — Switch model",
      "  /config — Show configuration",
      "",
      "📊 INFO",
      "  /context — Show conversation",
      "  /token — Token usage stats",
      "  /compact — Compact history",
      "  /undo — Remove last exchange",
      "",
      "🔌 ADVANCED",
      "  /mcp — MCP server management",
      "  /plugin — Plugin management",
      "  /provider — LLM provider switch",
      "  /skill — Skills list/run",
      "  /hook — Hooks management",
      "  /worktree — Git worktree ops",
      "  /exec <cmd> — Run shell command",
      "  /file — File read/write/list",
      "",
      "💬 Just type a message to chat!",
    ].join("\n");

    await ctx.reply(text);
  });

  // /new - start fresh session
  bot.command("new", async (ctx) => {
    const topicId = getTopicId(ctx);
    const userId = ctx.from.id;
    sessionManager.destroyContext(topicId);
    sessionManager.getOrCreateContext(topicId, userId);
    await ctx.reply("New session started.");
  });

  // /kill - destroy session
  bot.command("kill", async (ctx) => {
    const topicId = getTopicId(ctx);
    if (sessionManager.destroyContext(topicId)) {
      await ctx.reply("Session destroyed.");
    } else {
      await ctx.reply("No active session.");
    }
  });

  // /sessions - list active with clickable inline buttons
  bot.command("sessions", async (ctx) => {
    const lines: string[] = ["📋 Sessions", ""];

    // Bot-managed sessions
    const topics = sessionManager.listTopics();
    if (topics.length > 0) {
      lines.push("🤖 Bot:");
      for (const t of topics) {
        const age = Math.round((Date.now() - t.lastActive.getTime()) / 60_000);
        lines.push(`  ${t.topicId} | ${t.messageCount} msgs | ${age}m`);
      }
      lines.push("");
    }

    // OpenClude SDK sessions with inline buttons
    const buttons: Array<Array<{ text: string; callback_data: string }>> = [];
    try {
      const { listSessions } = await import("@gitlawb/openclaude/sdk");
      const sdkSessions = await listSessions({ limit: 8 });
      if (sdkSessions.length > 0) {
        lines.push("🔗 OpenClade (tap to enter):");
        for (const s of sdkSessions) {
          const age = s.lastModified ? Math.round((Date.now() - s.lastModified) / 60_000) : "?";
          const raw = s.customTitle || s.summary || s.firstPrompt?.slice(0, 30) || s.sessionId.slice(0, 8);
          const title = raw.length > 35 ? raw.slice(0, 35) + "…" : raw;
          lines.push(`  • ${title} (${age}m)`);
          buttons.push([{
            text: `▶ ${title.slice(0, 30)}`,
            callback_data: `enter:${s.sessionId.slice(0, 12)}:${s.cwd || ""}`,
          }]);
        }
      }
    } catch {
      // SDK session listing not available
    }

    if (lines.length <= 2) {
      await ctx.reply("No active sessions.");
      return;
    }

    await ctx.reply(lines.join("\n"), {
      reply_markup: { inline_keyboard: buttons.length > 0 ? buttons : [] },
    });
  });

  // Handle session button clicks
  bot.action(/^enter:(.+?):(.*)$/, async (ctx) => {
    const sessionId = ctx.match?.[1];
    const cwd = ctx.match?.[2];
    if (!sessionId) return;

    const topicId = String(ctx.from.id);
    const topic = sessionManager.getOrCreateContext(topicId, ctx.from.id);
    if (cwd) topic.workDir = cwd;

    await ctx.answerCbQuery(`Switched to session`);
    await ctx.reply(`✅ Entered session\n📂 WorkDir: ${cwd || "default"}`);
  });

  // /cd - change working directory
  bot.command("cd", async (ctx) => {
    const topicId = getTopicId(ctx);
    const args = ctx.message.text.split(/\s+/).slice(1).join(" ").trim();
    if (!args) {
      await ctx.reply("Usage: /cd <path>");
      return;
    }

    try {
      const resolved = validatePath(args, config.workDir);
      const topic = sessionManager.getOrCreateContext(topicId, ctx.from.id);
      topic.workDir = resolved;
      await ctx.reply(`Working directory set to: \`${escapeMarkdownV2(resolved)}\``, { parse_mode: "MarkdownV2" });
    } catch (err) {
      await ctx.reply(escapeMarkdownV2(err instanceof Error ? err.message : String(err)), { parse_mode: "MarkdownV2" });
    }
  });

  // /model - switch model
  bot.command("model", async (ctx) => {
    const topicId = getTopicId(ctx);
    const modelName = ctx.message.text.split(/\s+/).slice(1).join(" ").trim();
    if (!modelName) {
      await ctx.reply("Usage: /model <model-name>");
      return;
    }

    const topic = sessionManager.getOrCreateContext(topicId, ctx.from.id);
    topic.model = modelName || undefined;
    await ctx.reply(`Model set to: \`${escapeMarkdownV2(modelName)}\``, { parse_mode: "MarkdownV2" });
  });

  // /status - show current session info
  bot.command("status", async (ctx) => {
    const topicId = getTopicId(ctx);
    const topic = sessionManager.listTopics().find(t => t.topicId === topicId);
    if (!topic) {
      await ctx.reply("No active session. Send a message to start one.");
      return;
    }
    const age = Math.round((Date.now() - topic.lastActive.getTime()) / 60_000);
    await ctx.reply([
      "📊 Session Status",
      "━━━━━━━━━━━━━━━━",
      `📂 WorkDir: ${topic.workDir}`,
      `💬 Messages: ${topic.messageCount}`,
      `⏱ Last active: ${age}m ago`,
      `🤖 Model: ${topic.model || "default"}`,
    ].join("\n"));
  });

  // /context - show recent conversation
  bot.command("context", async (ctx) => {
    const topicId = getTopicId(ctx);
    const topic = sessionManager.listTopics().find(t => t.topicId === topicId);
    if (!topic) {
      await ctx.reply("No active session.");
      return;
    }
    await ctx.reply(`Context has ${topic.messageCount} messages. Use /compact to summarize.`);
  });

  // /compact - compact conversation history
  bot.command("compact", async (ctx) => {
    const topicId = getTopicId(ctx);
    await ctx.reply("🔄 Compacting conversation history...");
    // Send a special message that triggers summarization
    try {
      const stream = await sessionManager.sendMessage(topicId, "/compact");
      let response = "";
      for await (const msg of stream) {
        if (msg.type === "assistant") {
          const content = msg.message.content;
          if (Array.isArray(content)) {
            for (const block of content) {
              if (typeof block === "object" && block !== null && "type" in block && (block as any).type === "text") {
                response += (block as any).text ?? "";
              }
            }
          }
        }
        if (msg.type === "result") break;
      }
      await ctx.reply(response || "History compacted.");
    } catch (err) {
      await ctx.reply(mapSDKError(err));
    }
  });

  // /undo - remove last user+assistant exchange
  bot.command("undo", async (ctx) => {
    const topicId = getTopicId(ctx);
    const removed = sessionManager.undoLast(topicId);
    if (removed) {
      await ctx.reply("↩️ Last exchange removed.");
    } else {
      await ctx.reply("Nothing to undo.");
    }
  });

  // /config - show configuration
  bot.command("config", async (ctx) => {
    const topicId = getTopicId(ctx);
    const topic = sessionManager.listTopics().find(t => t.topicId === topicId);
    await ctx.reply([
      "⚙️ Configuration",
      "━━━━━━━━━━━━━━━",
      `📂 WorkDir: ${topic?.workDir || config.workDir}`,
      `🤖 Model: ${topic?.model || "default"}`,
      `🔒 Auth: ${config.allowedUsers.length > 0 ? "restricted" : "open"}`,
      `📊 Max sessions: ${config.maxSessions}`,
      `⏱ Timeout: ${config.sessionTimeout}s`,
    ].join("\n"));
  });

  // /token - show token usage
  bot.command("token", async (ctx) => {
    const topicId = getTopicId(ctx);
    const topic = sessionManager.listTopics().find(t => t.topicId === topicId);
    if (!topic) {
      await ctx.reply("No active session.");
      return;
    }
    await ctx.reply([
      "📊 Token Usage",
      "━━━━━━━━━━━━━",
      `💬 Messages: ${topic.messageCount}`,
      `⏱ Session age: ${Math.round((Date.now() - topic.lastActive.getTime()) / 60_000)}m`,
    ].join("\n"));
  });

  // /mcp - list/manage MCP servers
  bot.command("mcp", async (ctx) => {
    const args = ctx.message.text.split(/\s+/).slice(1);
    if (args.length === 0) {
      await ctx.reply([
        "🔌 MCP Servers",
        "━━━━━━━━━━━━━",
        "Usage: /mcp <action>",
        "",
        "  /mcp list — List all MCP servers",
        "  /mcp status — Show server status",
        "  /mcp restart <name> — Restart server",
      ].join("\n"));
      return;
    }
    // Route to OpenClade via message
    const topicId = getTopicId(ctx);
    sessionManager.getOrCreateContext(topicId, ctx.from.id);
    try {
      const stream = await sessionManager.sendMessage(topicId, `/mcp ${args.join(" ")}`);
      let response = "";
      for await (const msg of stream) {
        if (msg.type === "assistant") {
          const content = msg.message.content;
          if (Array.isArray(content)) {
            for (const block of content) {
              if (typeof block === "object" && block !== null && "type" in block && (block as any).type === "text") {
                response += (block as any).text ?? "";
              }
            }
          }
        }
        if (msg.type === "result") break;
      }
      await replyToTopic(bot, getTopicId(ctx), response || "No response.");
    } catch (err) {
      await ctx.reply(mapSDKError(err));
    }
  });

  // /plugin - list/manage plugins
  bot.command("plugin", async (ctx) => {
    const args = ctx.message.text.split(/\s+/).slice(1);
    if (args.length === 0) {
      await ctx.reply([
        "🧩 Plugins",
        "━━━━━━━━━",
        "Usage: /plugin <action>",
        "",
        "  /plugin list — List installed plugins",
        "  /plugin install <name> — Install plugin",
        "  /plugin remove <name> — Remove plugin",
      ].join("\n"));
      return;
    }
    const topicId = getTopicId(ctx);
    sessionManager.getOrCreateContext(topicId, ctx.from.id);
    try {
      const stream = await sessionManager.sendMessage(topicId, `/plugin ${args.join(" ")}`);
      let response = "";
      for await (const msg of stream) {
        if (msg.type === "assistant") {
          const content = msg.message.content;
          if (Array.isArray(content)) {
            for (const block of content) {
              if (typeof block === "object" && block !== null && "type" in block && (block as any).type === "text") {
                response += (block as any).text ?? "";
              }
            }
          }
        }
        if (msg.type === "result") break;
      }
      await replyToTopic(bot, getTopicId(ctx), response || "No response.");
    } catch (err) {
      await ctx.reply(mapSDKError(err));
    }
  });

  // /provider - switch LLM provider
  bot.command("provider", async (ctx) => {
    const args = ctx.message.text.split(/\s+/).slice(1);
    if (args.length === 0) {
      await ctx.reply([
        "🔄 LLM Provider",
        "━━━━━━━━━━━━━━",
        "Usage: /provider <action>",
        "",
        "  /provider list — List providers",
        "  /provider switch <name> — Switch provider",
        "  /provider status — Current provider",
      ].join("\n"));
      return;
    }
    const topicId = getTopicId(ctx);
    sessionManager.getOrCreateContext(topicId, ctx.from.id);
    try {
      const stream = await sessionManager.sendMessage(topicId, `/provider ${args.join(" ")}`);
      let response = "";
      for await (const msg of stream) {
        if (msg.type === "assistant") {
          const content = msg.message.content;
          if (Array.isArray(content)) {
            for (const block of content) {
              if (typeof block === "object" && block !== null && "type" in block && (block as any).type === "text") {
                response += (block as any).text ?? "";
              }
            }
          }
        }
        if (msg.type === "result") break;
      }
      await replyToTopic(bot, getTopicId(ctx), response || "No response.");
    } catch (err) {
      await ctx.reply(mapSDKError(err));
    }
  });

  // /skill - list/run skills
  bot.command("skill", async (ctx) => {
    const args = ctx.message.text.split(/\s+/).slice(1);
    if (args.length === 0) {
      await ctx.reply([
        "⚡ Skills",
        "━━━━━━━━",
        "Usage: /skill <action>",
        "",
        "  /skill list — List available skills",
        "  /skill run <name> — Run a skill",
        "  /skill info <name> — Skill details",
      ].join("\n"));
      return;
    }
    const topicId = getTopicId(ctx);
    sessionManager.getOrCreateContext(topicId, ctx.from.id);
    try {
      const stream = await sessionManager.sendMessage(topicId, `/skill ${args.join(" ")}`);
      let response = "";
      for await (const msg of stream) {
        if (msg.type === "assistant") {
          const content = msg.message.content;
          if (Array.isArray(content)) {
            for (const block of content) {
              if (typeof block === "object" && block !== null && "type" in block && (block as any).type === "text") {
                response += (block as any).text ?? "";
              }
            }
          }
        }
        if (msg.type === "result") break;
      }
      await replyToTopic(bot, getTopicId(ctx), response || "No response.");
    } catch (err) {
      await ctx.reply(mapSDKError(err));
    }
  });

  // /hook - list/manage hooks
  bot.command("hook", async (ctx) => {
    const args = ctx.message.text.split(/\s+/).slice(1);
    if (args.length === 0) {
      await ctx.reply([
        "🪝 Hooks",
        "━━━━━━━━",
        "Usage: /hook <action>",
        "",
        "  /hook list — List configured hooks",
        "  /hook status — Hook status",
      ].join("\n"));
      return;
    }
    const topicId = getTopicId(ctx);
    sessionManager.getOrCreateContext(topicId, ctx.from.id);
    try {
      const stream = await sessionManager.sendMessage(topicId, `/hook ${args.join(" ")}`);
      let response = "";
      for await (const msg of stream) {
        if (msg.type === "assistant") {
          const content = msg.message.content;
          if (Array.isArray(content)) {
            for (const block of content) {
              if (typeof block === "object" && block !== null && "type" in block && (block as any).type === "text") {
                response += (block as any).text ?? "";
              }
            }
          }
        }
        if (msg.type === "result") break;
      }
      await replyToTopic(bot, getTopicId(ctx), response || "No response.");
    } catch (err) {
      await ctx.reply(mapSDKError(err));
    }
  });

  // /worktree - git worktree operations
  bot.command("worktree", async (ctx) => {
    const args = ctx.message.text.split(/\s+/).slice(1);
    if (args.length === 0) {
      await ctx.reply([
        "🌳 Git Worktrees",
        "━━━━━━━━━━━━━━━",
        "Usage: /worktree <action>",
        "",
        "  /worktree list — List worktrees",
        "  /worktree create <name> — Create worktree",
        "  /worktree remove <name> — Remove worktree",
      ].join("\n"));
      return;
    }
    const topicId = getTopicId(ctx);
    sessionManager.getOrCreateContext(topicId, ctx.from.id);
    try {
      const stream = await sessionManager.sendMessage(topicId, `/worktree ${args.join(" ")}`);
      let response = "";
      for await (const msg of stream) {
        if (msg.type === "assistant") {
          const content = msg.message.content;
          if (Array.isArray(content)) {
            for (const block of content) {
              if (typeof block === "object" && block !== null && "type" in block && (block as any).type === "text") {
                response += (block as any).text ?? "";
              }
            }
          }
        }
        if (msg.type === "result") break;
      }
      await replyToTopic(bot, getTopicId(ctx), response || "No response.");
    } catch (err) {
      await ctx.reply(mapSDKError(err));
    }
  });

  // /exec - run shell command
  bot.command("exec", async (ctx) => {
    const cmd = ctx.message.text.split(/\s+/).slice(1).join(" ");
    if (!cmd) {
      await ctx.reply("Usage: /exec <command>\nExample: /exec ls -la");
      return;
    }
    const topicId = getTopicId(ctx);
    sessionManager.getOrCreateContext(topicId, ctx.from.id);
    try {
      const stream = await sessionManager.sendMessage(topicId, `Run this command: ${cmd}`);
      let response = "";
      for await (const msg of stream) {
        if (msg.type === "assistant") {
          const content = msg.message.content;
          if (Array.isArray(content)) {
            for (const block of content) {
              if (typeof block === "object" && block !== null && "type" in block && (block as any).type === "text") {
                response += (block as any).text ?? "";
              }
            }
          }
        }
        if (msg.type === "result") break;
      }
      await replyToTopic(bot, getTopicId(ctx), response || "No response.");
    } catch (err) {
      await ctx.reply(mapSDKError(err));
    }
  });

  // /file - read/write files
  bot.command("file", async (ctx) => {
    const args = ctx.message.text.split(/\s+/).slice(1);
    if (args.length === 0) {
      await ctx.reply([
        "📁 File Operations",
        "━━━━━━━━━━━━━━━━",
        "Usage: /file <action> [path]",
        "",
        "  /file read <path> — Read file",
        "  /file write <path> — Write file (send content next)",
        "  /file list [dir] — List directory",
      ].join("\n"));
      return;
    }
    const topicId = getTopicId(ctx);
    sessionManager.getOrCreateContext(topicId, ctx.from.id);
    try {
      const stream = await sessionManager.sendMessage(topicId, `/file ${args.join(" ")}`);
      let response = "";
      for await (const msg of stream) {
        if (msg.type === "assistant") {
          const content = msg.message.content;
          if (Array.isArray(content)) {
            for (const block of content) {
              if (typeof block === "object" && block !== null && "type" in block && (block as any).type === "text") {
                response += (block as any).text ?? "";
              }
            }
          }
        }
        if (msg.type === "result") break;
      }
      await replyToTopic(bot, getTopicId(ctx), response || "No response.");
    } catch (err) {
      await ctx.reply(mapSDKError(err));
    }
  });

  // Text message handler: route to session manager
  bot.on(message("text"), async (ctx) => {
    const topicId = getTopicId(ctx);
    const userId = ctx.from.id;
    const text = ctx.message.text;

    // Skip commands
    if (text.startsWith("/")) return;

    sessionManager.getOrCreateContext(topicId, userId);

    try {
      const canUseTool = buildInteractiveCallback(bot, topicId);
      const stream = await sessionManager.sendMessage(topicId, text, canUseTool);

      let response = "";
      let timeout: NodeJS.Timeout | undefined;
      const TIMEOUT_MS = 120_000; // 2 min max

      const timeoutPromise = new Promise<never>((_, reject) => {
        timeout = setTimeout(() => reject(new Error("Response timeout")), TIMEOUT_MS);
      });

      try {
        const iterPromise = (async () => {
          for await (const msg of stream) {
            if (msg.type === "assistant") {
              const content = msg.message.content;
              if (Array.isArray(content)) {
                for (const block of content) {
                  if (
                    typeof block === "object" &&
                    block !== null &&
                    "type" in block &&
                    (block as any).type === "text"
                  ) {
                    response += (block as any).text ?? "";
                  }
                }
              }
            }
            // Result message means query is done
            if (msg.type === "result") break;
          }
        })();

        await Promise.race([iterPromise, timeoutPromise]);
      } finally {
        if (timeout) clearTimeout(timeout);
      }

      if (response) {
        await replyToTopic(bot, topicId, response);
      } else {
        await ctx.reply("No response received.");
      }
    } catch (err) {
      await ctx.reply(mapSDKError(err));
    }
  });

  // Document handler: download file to workDir
  bot.on(message("document"), async (ctx) => {
    const topicId = getTopicId(ctx);
    const userId = ctx.from.id;
    const doc = ctx.message.document;
    const topic = sessionManager.getOrCreateContext(topicId, userId);

    try {
      const fileLink = await ctx.telegram.getFileLink(doc.file_id);
      // Sanitize: use basename to strip path separators/traversal,
      // reject absolute names, verify final path stays under workDir.
      const rawName = doc.file_name ?? "uploaded_file";
      const fileName = basename(rawName);
      if (!fileName || fileName === "." || fileName === "..") {
        await ctx.reply("Invalid file name.");
        return;
      }
      const filePath = resolve(topic.workDir, fileName);
      if (!filePath.startsWith(resolve(topic.workDir) + "/") && filePath !== resolve(topic.workDir, fileName)) {
        await ctx.reply("File path rejected: would escape work directory.");
        return;
      }

      const response = await fetch(fileLink.href);
      if (!response.body) throw new Error("Failed to download file");

      const fileStream = createWriteStream(filePath);
      await pipeline(response.body as any, fileStream);

      await ctx.reply(`File saved to: \`${escapeMarkdownV2(filePath)}\``, { parse_mode: "MarkdownV2" });
    } catch (err) {
      await ctx.reply(mapSDKError(err));
    }
  });

  return bot;
}
