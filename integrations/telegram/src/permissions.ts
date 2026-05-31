import { Telegraf } from "telegraf";
import { InlineKeyboardButton } from "telegraf/types";

export type CanUseToolCallback = (
  name: string,
  input: unknown,
  options?: { toolUseID?: string }
) => Promise<{ behavior: "allow" | "deny"; message?: string; updatedInput?: unknown }>;

/**
 * Auto-approve callback for trusted sessions.
 * Returns { behavior: 'allow', updatedInput: input } for every tool call.
 */
export function buildAutoApproveCallback(): CanUseToolCallback {
  return async (_toolName, input) => ({
    behavior: "allow",
    updatedInput: input,
  });
}

/**
 * Interactive callback that sends an inline keyboard to the user via Telegram
 * and waits for Approve/Deny. Times out after 60s (denies by default).
 */
export function buildInteractiveCallback(
  bot: Telegraf,
  topicId: string
): CanUseToolCallback {
  return async (toolName, input) => {
    const buttons: InlineKeyboardButton[][] = [
      [
        { text: "Approve", callback_data: "perm:approve" },
        { text: "Deny", callback_data: "perm:deny" },
      ],
    ];

    const inputPreview = input
      ? `\n\`\`\`json\n${JSON.stringify(input, null, 2).slice(0, 500)}\n\`\`\``
      : "";

    // Parse composite topicId: forum topics encode as "<chatId>:<threadId>"
    const sep = topicId.lastIndexOf(":");
    let chatId = topicId;
    let threadId: number | undefined;
    if (sep > 0) {
      const parsed = Number(topicId.slice(sep + 1));
      if (Number.isFinite(parsed)) {
        chatId = topicId.slice(0, sep);
        threadId = parsed;
      }
    }

    const sendOpts: any = {
      parse_mode: "MarkdownV2",
      reply_markup: { inline_keyboard: buttons },
    };
    if (threadId) sendOpts.message_thread_id = threadId;

    await bot.telegram.sendMessage(
      chatId,
      `*Tool Request*\n\`${toolName}\`${inputPreview}`,
      sendOpts,
    );

    const result = await new Promise<string>((resolve) => {
      let settled = false;
      const timeout = setTimeout(() => {
        if (!settled) {
          settled = true;
          resolve("perm:deny");
        }
      }, 60_000);

      bot.on("callback_query", (ctx: any) => {
        if (settled) return;
        const data = ctx.callbackQuery?.data as string | undefined;
        if (data === "perm:approve" || data === "perm:deny") {
          settled = true;
          clearTimeout(timeout);
          resolve(data);
          ctx.answerCbQuery().catch(() => {});
        }
      });
    });

    if (result === "perm:approve") {
      return { behavior: "allow", updatedInput: input };
    }

    return { behavior: "deny" };
  };
}
