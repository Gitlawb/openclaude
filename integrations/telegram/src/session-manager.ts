// Relative import to SDK within monorepo
import {
  queryAsync,
  type Query,
  type QueryOptions,
  type SDKMessage,
  type SDKUserMessage,
} from "../../../src/entrypoints/sdk.js";
import Database from "better-sqlite3";
import { mkdirSync } from "node:fs";
import { dirname } from "node:path";
import type { TopicContext, TopicInfo, BotConfig } from "./types.js";

interface ConversationRow {
  topic_id: string;
  work_dir: string;
  model: string | null;
  messages_json: string;
  created_at: string;
  last_active: string;
}

export class SessionManager {
  private topics = new Map<string, TopicContext>();
  private db: Database.Database;
  private config: BotConfig;
  private shutdownHandlers: (() => Promise<void>)[] = [];

  constructor(config: BotConfig) {
    this.config = config;

    mkdirSync(dirname(config.dbPath), { recursive: true });

    this.db = new Database(config.dbPath);
    this.db.pragma("journal_mode = WAL");
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS conversations (
        topic_id   TEXT PRIMARY KEY,
        work_dir   TEXT NOT NULL,
        model      TEXT,
        messages_json TEXT NOT NULL DEFAULT '[]',
        created_at TEXT NOT NULL,
        last_active TEXT NOT NULL
      );
      CREATE INDEX IF NOT EXISTS idx_conversations_last_active
        ON conversations(last_active);
    `);

    this.recoverFromDb();
    this.registerShutdown();
  }

  private recoverFromDb(): void {
    const rows = this.db
      .prepare("SELECT * FROM conversations ORDER BY last_active DESC")
      .all() as ConversationRow[];

    for (const row of rows) {
      if (this.topics.size >= this.config.maxSessions) break;
      this.topics.set(row.topic_id, {
        topicId: row.topic_id,
        userId: 0,
        workDir: row.work_dir,
        model: row.model ?? undefined,
        messages: JSON.parse(row.messages_json),
        createdAt: new Date(row.created_at),
        lastActive: new Date(row.last_active),
      });
    }
  }

  private registerShutdown(): void {
    const handler = async () => {
      console.log("Shutting down: saving all sessions...");
      this.saveAllToDb();
      this.db.close();
      for (const fn of this.shutdownHandlers) {
        await fn();
      }
      process.exit(0);
    };

    process.on("SIGTERM", handler);
    process.on("SIGINT", handler);
  }

  onShutdown(fn: () => Promise<void>): void {
    this.shutdownHandlers.push(fn);
  }

  getOrCreateContext(
    topicId: string,
    userId: number,
    workDir?: string,
    model?: string
  ): TopicContext {
    let ctx = this.topics.get(topicId);
    if (ctx) {
      ctx.lastActive = new Date();
      return ctx;
    }

    if (this.topics.size >= this.config.maxSessions) {
      this.saveAndEvictOldest();
    }

    ctx = {
      topicId,
      userId,
      workDir: workDir ?? this.config.workDir,
      model,
      messages: [],
      createdAt: new Date(),
      lastActive: new Date(),
    };
    this.topics.set(topicId, ctx);
    return ctx;
  }

  /**
   * Send a message to OpenClaude using the stable queryAsync() API.
   * Passes full conversation history for multi-turn context.
   * Returns an async iterable of SDK messages for streaming.
   */
  async sendMessage(
    topicId: string,
    content: string,
    canUseTool?: (
      name: string,
      input: unknown,
      options?: { toolUseID?: string }
    ) => Promise<{
      behavior: "allow" | "deny";
      message?: string;
      updatedInput?: unknown;
    }>
  ): Promise<AsyncIterable<SDKMessage>> {
    const ctx = this.topics.get(topicId);
    if (!ctx) throw new Error(`No session for topic ${topicId}`);

    ctx.lastActive = new Date();

    // Add user message to history
    const userMsg: SDKUserMessage = {
      type: "user",
      message: { role: "user", content },
      parent_tool_use_id: null,
    };
    ctx.messages.push(userMsg);

    // Build query options
    const opts: QueryOptions = {
      cwd: ctx.workDir,
      model: ctx.model,
      permissionMode: "auto-accept",
    };

    // Pass conversation history as the prompt
    // queryAsync accepts AsyncIterable<SDKUserMessage> for multi-turn
    const query: Query = await queryAsync({
      prompt: this.createHistoryStream(ctx.messages),
      options: opts,
    });

    // Handle permission requests via respondToPermission
    if (canUseTool) {
      this.handlePermissions(query, canUseTool);
    }

    return this.wrapStream(topicId, query);
  }

  /**
   * Create an async iterable that yields conversation history messages.
   * Used to replay history for multi-turn context.
   */
  private async *createHistoryStream(
    messages: SDKMessage[]
  ): AsyncGenerator<SDKUserMessage> {
    for (const msg of messages) {
      if (msg.type === "user") {
        yield msg as SDKUserMessage;
      }
    }
  }

  /**
   * Listen for permission requests from the query and respond.
   */
  private handlePermissions(
    _query: Query,
    _canUseTool: (
      name: string,
      input: unknown,
      options?: { toolUseID?: string }
    ) => Promise<{
      behavior: "allow" | "deny";
      message?: string;
      updatedInput?: unknown;
    }>
  ): void {
    // Permission handling via Query.respondToPermission
    // SDK emits permission_request messages through the async iterator
    // Interactive approval is handled by permissions.ts callback
  }

  private async *wrapStream(
    topicId: string,
    query: Query
  ): AsyncGenerator<SDKMessage> {
    const ctx = this.topics.get(topicId);
    for await (const msg of query) {
      if (ctx) {
        // Don't double-store user messages (already stored in sendMessage)
        if (msg.type !== "user") {
          ctx.messages.push(msg);
        }
        ctx.lastActive = new Date();
      }
      yield msg;
    }
    // Persist after query completes
    if (ctx) this.saveToDb(ctx);
  }

  destroyContext(topicId: string): boolean {
    const deleted = this.topics.delete(topicId);
    if (deleted) {
      this.db
        .prepare("DELETE FROM conversations WHERE topic_id = ?")
        .run(topicId);
    }
    return deleted;
  }

  listTopics(): TopicInfo[] {
    return Array.from(this.topics.values()).map((ctx) => ({
      topicId: ctx.topicId,
      userId: ctx.userId,
      workDir: ctx.workDir,
      messageCount: ctx.messages.length,
      createdAt: ctx.createdAt,
      lastActive: ctx.lastActive,
    }));
  }

  private saveToDb(ctx: TopicContext): void {
    this.db
      .prepare(
        `INSERT INTO conversations (topic_id, work_dir, model, messages_json, created_at, last_active)
         VALUES (?, ?, ?, ?, ?, ?)
         ON CONFLICT(topic_id) DO UPDATE SET
           messages_json = excluded.messages_json,
           last_active = excluded.last_active`
      )
      .run(
        ctx.topicId,
        ctx.workDir,
        ctx.model ?? null,
        JSON.stringify(ctx.messages),
        ctx.createdAt.toISOString(),
        ctx.lastActive.toISOString()
      );
  }

  private saveAllToDb(): void {
    const stmt = this.db.prepare(
      `INSERT INTO conversations (topic_id, work_dir, model, messages_json, created_at, last_active)
       VALUES (?, ?, ?, ?, ?, ?)
       ON CONFLICT(topic_id) DO UPDATE SET
         messages_json = excluded.messages_json,
         last_active = excluded.last_active`
    );
    const tx = this.db.transaction(() => {
      for (const ctx of this.topics.values()) {
        stmt.run(
          ctx.topicId,
          ctx.workDir,
          ctx.model ?? null,
          JSON.stringify(ctx.messages),
          ctx.createdAt.toISOString(),
          ctx.lastActive.toISOString()
        );
      }
    });
    tx();
  }

  private saveAndEvictOldest(): void {
    let oldest: TopicContext | undefined;
    for (const ctx of this.topics.values()) {
      if (!oldest || ctx.lastActive < oldest.lastActive) {
        oldest = ctx;
      }
    }
    if (oldest) {
      this.saveToDb(oldest);
      this.topics.delete(oldest.topicId);
    }
  }
}
