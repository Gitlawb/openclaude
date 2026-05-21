import { Telegraf } from "telegraf";
import { message } from "telegraf/filters";
import { createWriteStream } from "node:fs";
import { pipeline } from "node:stream/promises";
import { resolve } from "node:path";
import { SessionManager } from "./session-manager.js";
import { loadConfig, validatePath } from "./config.js";
import type { BotConfig } from "./types.js";
import { buildInteractiveCallback } from "./permissions.js";
import { sendLongMessage, escapeMarkdownV2 } from "./message-handler.js";
import { mapSDKError } from "./errors.js";

export function createBot(config: BotConfig): Telegraf {
  const bot = new Telegraf(config.botToken);
  const sessionManager = new SessionManager(config);

  // Auth middleware: reject unauthorized users
  bot.use(async (ctx, next) => {
    const userId = ctx.from?.id;
    if (!userId || !config.allowedUsers.includes(userId)) {
      return; // silently ignore
    }
    return next();
  });

  // /start and /help
  bot.command(["start", "help"], async (ctx) => {
    const text = [
      "*OpenClaude Telegram Bot*",
      "",
      "/start \\- Show this help",
      "/help \\- Show this help",
      "/new \\- Start a new session",
      "/kill \\- Destroy current session",
      "/sessions \\- List active sessions",
      "/cd <path> \\- Change working directory",
      "/model <name> \\- Switch model",
      "",
      "Send a message to chat with Claude\\.",
    ].join("\n");

    await ctx.reply(text, { parse_mode: "MarkdownV2" });
  });

  // /new - start fresh session
  bot.command("new", async (ctx) => {
    const topicId = String(ctx.message.chat.id);
    const userId = ctx.from.id;
    sessionManager.destroyContext(topicId);
    sessionManager.getOrCreateContext(topicId, userId);
    await ctx.reply("New session started.");
  });

  // /kill - destroy session
  bot.command("kill", async (ctx) => {
    const topicId = String(ctx.message.chat.id);
    if (sessionManager.destroyContext(topicId)) {
      await ctx.reply("Session destroyed.");
    } else {
      await ctx.reply("No active session.");
    }
  });

  // /sessions - list active
  bot.command("sessions", async (ctx) => {
    const topics = sessionManager.listTopics();
    if (topics.length === 0) {
      await ctx.reply("No active sessions.");
      return;
    }

    const lines = topics.map((t) => {
      const age = Math.round((Date.now() - t.lastActive.getTime()) / 60_000);
      return `\`${t.topicId}\` | ${t.messageCount} msgs | ${age}m ago`;
    });

    await sendLongMessage(bot, String(ctx.message.chat.id), `*Active Sessions*\n\n${lines.join("\n")}`);
  });

  // /cd - change working directory
  bot.command("cd", async (ctx) => {
    const topicId = String(ctx.message.chat.id);
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
    const topicId = String(ctx.message.chat.id);
    const modelName = ctx.message.text.split(/\s+/).slice(1).join(" ").trim();
    if (!modelName) {
      await ctx.reply("Usage: /model <model-name>");
      return;
    }

    const topic = sessionManager.getOrCreateContext(topicId, ctx.from.id);
    topic.model = modelName || undefined;
    await ctx.reply(`Model set to: \`${escapeMarkdownV2(modelName)}\``, { parse_mode: "MarkdownV2" });
  });

  // Text message handler: route to session manager
  bot.on(message("text"), async (ctx) => {
    const topicId = String(ctx.message.chat.id);
    const userId = ctx.from.id;
    const text = ctx.message.text;

    // Skip commands
    if (text.startsWith("/")) return;

    sessionManager.getOrCreateContext(topicId, userId);

    try {
      const canUseTool = buildInteractiveCallback(bot, topicId);
      const stream = await sessionManager.sendMessage(topicId, text, canUseTool);

      let response = "";
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
      }

      if (response) {
        await sendLongMessage(bot, topicId, response);
      } else {
        await ctx.reply("No response received.");
      }
    } catch (err) {
      await ctx.reply(mapSDKError(err));
    }
  });

  // Document handler: download file to workDir
  bot.on(message("document"), async (ctx) => {
    const topicId = String(ctx.message.chat.id);
    const userId = ctx.from.id;
    const doc = ctx.message.document;
    const topic = sessionManager.getOrCreateContext(topicId, userId);

    try {
      const fileLink = await ctx.telegram.getFileLink(doc.file_id);
      const fileName = doc.file_name ?? "uploaded_file";
      const filePath = resolve(topic.workDir, fileName);

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
