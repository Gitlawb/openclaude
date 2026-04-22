// @ts-nocheck
/**
 * ACP Bridge — Agent Communication Protocol (kimi-cli style)
 * Enables inter-agent messaging, session handoffs, and collaborative task execution.
 * 
 * Protocol: JSON-RPC over WebSocket + HTTP fallback
 * Port: 18794 (OpenClaw ACP server)
 */

export interface ACPMessage {
  id: string
  type: 'request' | 'response' | 'notification' | 'handshake'
  action: string
  params: Record<string, unknown>
  from: string
  to: string
  timestamp: number
  sessionId?: string
}

export interface ACPSession {
  sessionId: string
  agentId: string
  mode: 'single' | 'handoff' | 'collaborative'
  context: Record<string, unknown>
  created: number
  lastActivity: number
}

export interface ACPBridgeConfig {
  host?: string
  port?: number
  agentId: string
  apiKey?: string
}

const DEFAULT_CONFIG = {
  host: 'localhost',
  port: 18794,
}

export class ACPBridge {
  private config: ACPBridgeConfig
  private sessions: Map<string, ACPSession> = new Map()
  private handlers: Map<string, (msg: ACPMessage) => Promise<void>> = new Map()
  private ws: WebSocket | null = null
  private httpBase: string

  constructor(config: Partial<ACPBridgeConfig> & { agentId: string }) {
    this.config = { ...DEFAULT_CONFIG, ...config } as ACPBridgeConfig
    this.httpBase = `http://${this.config.host}:${this.config.port}`
  }

  /** Connect to ACP server */
  async connect(): Promise<boolean> {
    try {
      const resp = await fetch(`${this.httpBase}/health`, { signal: AbortSignal.timeout(3000) })
      return resp.ok
    } catch {
      return false
    }
  }

  /** Send a message to another agent */
  async send(to: string, action: string, params: Record<string, unknown> = {}): Promise<ACPMessage | null> {
    const msg: ACPMessage = {
      id: `msg_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`,
      type: 'request',
      action,
      params,
      from: this.config.agentId,
      to,
      timestamp: Date.now(),
    }
    try {
      const resp = await fetch(`${this.httpBase}/message`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${this.config.apiKey ?? ''}` },
        body: JSON.stringify(msg),
      })
      return resp.ok ? msg : null
    } catch {
      return null
    }
  }

  /** Broadcast to all agents */
  async broadcast(action: string, params: Record<string, unknown> = {}): Promise<number> {
    try {
      const resp = await fetch(`${this.httpBase}/broadcast`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${this.config.apiKey ?? ''}` },
        body: JSON.stringify({ action, params, from: this.config.agentId }),
      })
      return resp.ok ? 1 : 0
    } catch {
      return 0
    }
  }

  /** Create a collaborative session */
  async createSession(mode: 'single' | 'handoff' | 'collaborative', context: Record<string, unknown> = {}): Promise<string> {
    const sessionId = `session_${Date.now()}`
    const session: ACPSession = {
      sessionId,
      agentId: this.config.agentId,
      mode,
      context,
      created: Date.now(),
      lastActivity: Date.now(),
    }
    this.sessions.set(sessionId, session)
    return sessionId
  }

  /** Hand off session to another agent */
  async handoff(sessionId: string, toAgent: string): Promise<boolean> {
    const session = this.sessions.get(sessionId)
    if (!session) return false
    session.lastActivity = Date.now()
    const msg = await this.send(toAgent, 'session_handoff', {
      sessionId,
      context: session.context,
      mode: session.mode,
    })
    return !!msg
  }

  /** Register a message handler */
  on(action: string, handler: (msg: ACPMessage) => Promise<void>) {
    this.handlers.set(action, handler)
  }

  /** List active sessions */
  getSessions(): ACPSession[] {
    return Array.from(this.sessions.values())
  }
}

export const createACPBridge = (config: Partial<ACPBridgeConfig> & { agentId: string }) => new ACPBridge(config)
