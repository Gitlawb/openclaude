import { Telegraf } from "telegraf";
import PQueue from "p-queue";

const TELEGRAM_MSG_LIMIT = 4096;
const TYPING_INTERVAL_MS = 4000;

// Per-topic rate limiters: 1 msg/sec each
const topicQueues = new Map<string, PQueue>();

function getTopicQueue(topicId: string): PQueue {
  let queue = topicQueues.get(topicId);
  if (!queue) {
    queue = new PQueue({ intervalCap: 1, interval: 1000 });
    topicQueues.set(topicId, queue);
  }
  return queue;
}

/**
 * MarkdownV2-aware text splitter.
 * Tracks open code fences and splits at safe boundaries
 * so each chunk is valid MarkdownV2.
 */
export function splitMarkdown(text: string, limit = TELEGRAM_MSG_LIMIT): string[] {
  if (text.length <= limit) return [text];

  const chunks: string[] = [];
  let remaining = text;
  let inCodeBlock = false;

  while (remaining.length > 0) {
    if (remaining.length <= limit) {
      chunks.push(remaining);
      break;
    }

    // Find a safe split point
    let splitAt = -1;

    // Try to split at a double newline (paragraph boundary)
    for (let i = limit - 1; i >= Math.floor(limit / 2); i--) {
      if (remaining[i] === "\n" && remaining[i - 1] === "\n") {
        splitAt = i + 1;
        break;
      }
    }

    // Fallback to single newline
    if (splitAt === -1) {
      for (let i = limit - 1; i >= Math.floor(limit / 2); i--) {
        if (remaining[i] === "\n") {
          // Don't split inside a code fence
          const fenceBefore = remaining.slice(0, i).match(/```/g);
          const fenceCount = fenceBefore ? fenceBefore.length : 0;
          if (fenceCount % 2 === 0 || !inCodeBlock) {
            splitAt = i + 1;
            break;
          }
        }
      }
    }

    // Hard split as last resort
    if (splitAt === -1) splitAt = limit;

    let chunk = remaining.slice(0, splitAt);

    // Track code fence state
    const fences = chunk.match(/```/g);
    if (fences) {
      inCodeBlock = fences.length % 2 !== 0 ? !inCodeBlock : inCodeBlock;
    }

    // If we're inside a code block, close it for this chunk and reopen in the next
    if (inCodeBlock) {
      chunk += "\n```";
      remaining = "```\n" + remaining.slice(splitAt);
    } else {
      remaining = remaining.slice(splitAt);
    }

    chunks.push(chunk);
  }

  return chunks;
}

/**
 * Escape text for Telegram MarkdownV2 parse mode.
 */
export function escapeMarkdownV2(text: string): string {
  return text.replace(/([_*\[\]()~`>#+\-=|{}.!\\])/g, "\\$1");
}

/**
 * Send a message to a Telegram chat with typing indicator and rate limiting.
 */
export async function sendMessage(
  bot: Telegraf,
  chatId: string,
  text: string,
  parseMode: "MarkdownV2" | "HTML" = "MarkdownV2"
): Promise<void> {
  const queue = getTopicQueue(chatId);

  await queue.add(async () => {
    // Start typing indicator
    const typingInterval = setInterval(() => {
      bot.telegram.sendChatAction(chatId, "typing").catch(() => {});
    }, TYPING_INTERVAL_MS);

    try {
      await bot.telegram.sendMessage(chatId, text, { parse_mode: parseMode });
    } finally {
      clearInterval(typingInterval);
    }
  });
}

/**
 * Send a potentially long message, splitting if necessary.
 */
export async function sendLongMessage(
  bot: Telegraf,
  chatId: string,
  text: string,
  parseMode: "MarkdownV2" | "HTML" = "MarkdownV2"
): Promise<void> {
  const chunks = splitMarkdown(text);
  for (const chunk of chunks) {
    await sendMessage(bot, chatId, chunk, parseMode);
  }
}
