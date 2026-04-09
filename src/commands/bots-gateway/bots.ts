/**
 * Bots gateway command implementation
 *
 * Usage:
 *   /bots start    — Start the bot gateway
 *   /bots stop     — Stop the bot gateway
 *   /bots status   — Show gateway + adapter status
 *   /bots restart  — Restart the gateway
 */

import type { LocalCommandCall, LocalCommandResult } from '../../types/command.js';
import { BotGateway } from '../../bots/manager.js';
import { buildHealthReport } from '../../bots/health.js';

let gateway: BotGateway | null = null;
let startedAt: Date | null = null;

export const call: LocalCommandCall = async (args, _context): Promise<LocalCommandResult> => {
  const action = args.trim().toLowerCase() || 'status';

  switch (action) {
    case 'start':
      return startGateway();
    case 'stop':
      return stopGateway();
    case 'status':
      return showStatus();
    case 'restart':
      return restartGateway();
    default:
      return {
        type: 'text',
        value: `Unknown action: ${action}\n\nUsage: /bots [start|stop|status|restart]`,
      } satisfies LocalCommandResult;
  }
};

async function startGateway(): Promise<LocalCommandResult> {
  if (gateway) {
    return { type: 'text', value: '⚠️  Bot gateway is already running. Use `/bots restart` to restart.' } satisfies LocalCommandResult;
  }

  try {
    const config = loadGatewayConfig();
    gateway = new BotGateway(config);
    startedAt = new Date();

    // Wire message handler — logs to console for now
    gateway.onMessage(async (msg) => {
      console.log(`[bots:${msg.platform}] ${msg.userId}: ${msg.content}`);
      // TODO: Route through OpenClaude coordinator agent loop
    });

    await gateway.start24_7();

    const statuses = gateway.getAllStatuses();
    const summary = Object.entries(statuses)
      .map(([name, s]) => `  ${s.connected ? '✅' : '❌'} ${name}: ${s.connected ? 'connected' : 'disconnected'}`)
      .join('\n');

    return {
      type: 'text',
      value: `🚀 Bot gateway started!\n\nAdapters:\n${summary || '  (none configured)'}\n\nHealth: http://localhost:${config.healthPort ?? 3000}/health`,
    } satisfies LocalCommandResult;
  } catch (err) {
    return {
      type: 'text',
      value: `❌ Failed to start gateway: ${err instanceof Error ? err.message : String(err)}`,
    } satisfies LocalCommandResult;
  }
}

async function stopGateway(): Promise<LocalCommandResult> {
  if (!gateway) {
    return { type: 'text', value: '⚠️  Bot gateway is not running.' } satisfies LocalCommandResult;
  }

  await gateway.shutdown('user requested');
  gateway = null;
  startedAt = null;

  return { type: 'text', value: '🛑 Bot gateway stopped.' } satisfies LocalCommandResult;
}

async function showStatus(): Promise<LocalCommandResult> {
  if (!gateway || !startedAt) {
    return { type: 'text', value: '💤 Bot gateway is not running. Use `/bots start` to start.' } satisfies LocalCommandResult;
  }

  const report = buildHealthReport(gateway, startedAt);
  const adapterLines = Object.entries(report.adapters)
    .map(([name, a]) => {
      const icon = a.connected ? '✅' : (a.enabled ? '⚠️' : '⏸️');
      const errs = a.lastError ? `\n     ⚠️  ${a.lastError}` : '';
      return `  ${icon} ${name}: ${a.connected ? 'connected' : 'disconnected'} (${a.uptimeHuman}, ${a.reconnectCount} reconnects)${errs}`;
    })
    .join('\n');

  return {
    type: 'text',
    value: [
      `📊 Bot Gateway Status`,
      ``,
      `  Status: ${report.status === 'ok' ? '🟢 OK' : report.status === 'degraded' ? '🟡 Degraded' : '🔴 Down'}`,
      `  Uptime: ${report.uptimeHuman}`,
      `  Started: ${report.startedAt}`,
      ``,
      `  Adapters:`,
      adapterLines || '    (none configured)',
    ].join('\n'),
  } satisfies LocalCommandResult;
}

async function restartGateway(): Promise<LocalCommandResult> {
  if (gateway) {
    await gateway.shutdown('restart');
    gateway = null;
    startedAt = null;
  }
  return startGateway();
}

function loadGatewayConfig() {
  return {
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
}
