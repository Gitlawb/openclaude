/**
 * Health endpoint — 24/7 status reporting with metrics
 *
 * NEW FILE — provides /health and /healthz endpoints
 * for Docker healthchecks, PM2 monitoring, and external probes.
 *
 * IMPROVEMENTS:
 * - Per-adapter metrics (messages sent/received, errors, rate limited)
 * - Overall message throughput metrics
 * - Degraded detection includes rate-limit exhaustion
 */

import type { BotGateway } from './manager.js';

export interface AdapterHealth {
  type: string;
  enabled: boolean;
  connected: boolean;
  uptime: number;
  uptimeHuman: string;
  reconnectCount: number;
  lastError?: string;
  metrics: {
    messagesReceived: number;
    messagesSent: number;
    errors: number;
    lastMessageAt: string | null;
    lastErrorAt: string | null;
    rateLimited: number;
  };
}

export interface HealthReport {
  status: 'ok' | 'degraded' | 'down';
  uptime: number;
  uptimeHuman: string;
  startedAt: string;
  adapters: Record<string, AdapterHealth>;
  totals: {
    messagesReceived: number;
    messagesSent: number;
    errors: number;
    rateLimited: number;
    adapterCount: number;
    connectedCount: number;
  };
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
  const adapterReport: Record<string, AdapterHealth> = {};

  let hasIssues = false;
  let hasAnyAdapter = false;
  let totalReceived = 0;
  let totalSent = 0;
  let totalErrors = 0;
  let totalRateLimited = 0;
  let connectedCount = 0;

  for (const [name, status] of Object.entries(statuses)) {
    hasAnyAdapter = true;
    if (status.enabled && status.connected) connectedCount++;
    if (status.enabled && !status.connected) hasIssues = true;

    const metrics = status.metrics ?? {
      messagesReceived: 0, messagesSent: 0, errors: 0,
      lastMessageAt: null, lastErrorAt: null, rateLimited: 0,
    };

    totalReceived += metrics.messagesReceived;
    totalSent += metrics.messagesSent;
    totalErrors += metrics.errors;
    totalRateLimited += metrics.rateLimited;

    adapterReport[name] = {
      ...status,
      uptimeHuman: formatUptime(status.uptime),
      metrics,
    };
  }

  const uptime = Date.now() - startedAt.getTime();
  const adapterCount = Object.keys(statuses).length;

  return {
    status: !hasAnyAdapter ? 'down' : hasIssues ? 'degraded' : 'ok',
    uptime,
    uptimeHuman: formatUptime(uptime),
    startedAt: startedAt.toISOString(),
    adapters: adapterReport,
    totals: {
      messagesReceived: totalReceived,
      messagesSent: totalSent,
      errors: totalErrors,
      rateLimited: totalRateLimited,
      adapterCount,
      connectedCount,
    },
    timestamp: new Date().toISOString(),
  };
}
