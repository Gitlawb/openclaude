/**
 * Health endpoint — 24/7 status reporting
 *
 * NEW FILE — provides /health and /healthz endpoints
 * for Docker healthchecks, PM2 monitoring, and external probes.
 */

import type { BotGateway } from './manager.js';

export interface HealthReport {
  status: 'ok' | 'degraded' | 'down';
  uptime: number;
  uptimeHuman: string;
  startedAt: string;
  adapters: Record<string, {
    type: string;
    enabled: boolean;
    connected: boolean;
    uptime: number;
    uptimeHuman: string;
    reconnectCount: number;
    lastError?: string;
  }>;
  timestamp: string;
}

function formatUptime(ms: number): string {
  const s = Math.floor(ms / 1000);
  const m = Math.floor(s / 60);
  const h = Math.floor(m / 60);
  const d = Math.floor(h / 24);
  if (d > 0) return `${d}d ${h % 24}h ${m % 60}m`;
  if (h > 0) return `${h}h ${m % 60}m`;
  if (m > 0) return `${m}m ${s % 60}s`;
  return `${s}s`;
}

export function buildHealthReport(gateway: BotGateway, startedAt: Date): HealthReport {
  const statuses = gateway.getAllStatuses();
  const adapterReport: HealthReport['adapters'] = {};

  let hasIssues = false;
  let hasAnyAdapter = false;

  for (const [name, status] of Object.entries(statuses)) {
    hasAnyAdapter = true;
    if (status.enabled && !status.connected) hasIssues = true;

    adapterReport[name] = {
      ...status,
      uptimeHuman: formatUptime(status.uptime),
    };
  }

  const uptime = Date.now() - startedAt.getTime();

  return {
    status: !hasAnyAdapter ? 'down' : hasIssues ? 'degraded' : 'ok',
    uptime,
    uptimeHuman: formatUptime(uptime),
    startedAt: startedAt.toISOString(),
    adapters: adapterReport,
    timestamp: new Date().toISOString(),
  };
}
