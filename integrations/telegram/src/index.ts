import { loadConfig } from "./config.js";
import { createBot } from "./bot.js";

const config = loadConfig();
const bot = createBot(config);

// Graceful shutdown
process.once("SIGINT", () => {
  console.log("SIGINT received, shutting down...");
  bot.stop("SIGINT");
  process.exit(0);
});

process.once("SIGTERM", () => {
  console.log("SIGTERM received, shutting down...");
  bot.stop("SIGTERM");
  process.exit(0);
});

bot.launch().then(() => {
  console.log("Bot started");
}).catch((err) => {
  console.error("Failed to start bot:", err);
  process.exit(1);
});
