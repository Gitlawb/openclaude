// Relative import to SDK types within monorepo
import type { SDKMessage } from "../../../src/entrypoints/sdk.js";
export type { SDKMessage };

export interface TopicContext {
  topicId: string;
  userId: number;
  workDir: string;
  model?: string;
  messages: SDKMessage[];
  createdAt: Date;
  lastActive: Date;
}

export interface TopicInfo {
  topicId: string;
  userId: number;
  workDir: string;
  messageCount: number;
  createdAt: Date;
  lastActive: Date;
}

export interface SessionMeta {
  userId: number;
  topicId: string;
  startedAt: Date;
}

export interface BotConfig {
  botToken: string;
  allowedUsers: number[];
  maxSessions: number;
  sessionTimeout: number;
  workDir: string;
  dbPath: string;
}


