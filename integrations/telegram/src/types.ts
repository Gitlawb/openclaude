import type { SDKMessage } from "@gitlawb/openclaude/sdk";
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
  model?: string;
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


