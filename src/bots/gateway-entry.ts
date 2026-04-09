#!/usr/bin/env bun
/**
 * Standalone Bot Gateway entrypoint
 *
 * For 24/7 deployment via Docker, PM2, or systemd.
 * Reads config from environment variables.
 *
 * Usage:
 *   TELEGRAM_BOT_TOKEN=xxx DISCORD_BOT_TOKEN=yyy bun run src/bots/gateway-entry.ts
 *   bun run src/commands/bots-gateway/bots.ts  # (via CLI)
 */

import { BotGateway } from './manager.js';
import { buildHealthReport } from './health.js';

async function main() {
  const config = {
    telegram: {
      enabled: !!process.env.TELEGRAM_BOT_TOKEN,
      token: process.env.TELEGRAM_BOT_TOKEN ?? '',
      parseMode: 'Markdown' as const,
    },
    discord: {
      enabled: !!process.env.DISCORD_BOT_TOKEN,
      token: process.env.DISCORD_BOT_TOKEN ?? '',
      mentionOnly: true,
    },
    healthPort: parseInt(process.env.HEALTH_PORT ?? '3000', 10),
    heartbeatMs: 30_000,
    autoRestart: true,
  };

  if (!config.telegram.enabled && !config.discord.enabled) {
    console.error('❌ No bot tokens configured. Set TELEGRAM_BOT_TOKEN and/or DISCORD_BOT_TOKEN.');
    process.exit(1);
  }

  const gateway = new BotGateway(config);
  const startedAt = new Date();

  gateway.onMessage(async (msg) => {
    console.log(`[${msg.platform}] ${msg.userId}: ${msg.content}`);
    // Route through OpenClaude coordinator here
    // const response = await runAgentLoop(msg.content, msg.sessionId);
    // await gateway.sendMessage(msg.platform, msg.userId, response, msg.metadata);
  });

  await gateway.start24_7();

  // Log status every 5 minutes
  setInterval(() => {
    const report = buildHealthReport(gateway, startedAt);
    console.log(`[gateway] Status: ${report.status}, Uptime: ${report.uptimeHuman}`);
  }, 5 * 60_000);

  console.log('🚀 Bot gateway running. Press Ctrl+C to stop.');
}

main().catch((err) => {
  console.error('Fatal:', err);
  process.exit(1);
});
