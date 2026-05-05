import type { Route } from "../http";
import { SseWriter } from "../sse";
import type { SessionManager } from "../session";
import { ServerError, ErrorCode } from "../errors";

export type AgentEvent =
  | { event: "token"; data: { text: string } }
  | { event: "tool_call"; data: { id: string; name: string; args: unknown } }
  | { event: "tool_result"; data: { id: string; ok: boolean; preview?: string } }
  | { event: "pending_edit"; data: { id: string; file: string; reason: string } }
  | { event: "insight"; data: { text: string } }
  | { event: "suggestions"; data: { items: string[] } }
  | { event: "done"; data: { sessionId?: string; finishReason: string } }
  | { event: "error"; data: { code: string; message: string } };

export type AgentFn = (input: {
  message: string;
  sessionId: string;
  context?: { activeNote?: string; vault?: string; selection?: string; braveApiKey?: string };
}) => AsyncIterable<AgentEvent>;

let mockAgent: AgentFn | null = null;
let realAgent: AgentFn | null = null;
// mockAgent takes priority over realAgent — this lets setRealAgent be called
// inside startServer() without overwriting a test mock set in beforeEach.
export function setMockAgent(fn: AgentFn): void { mockAgent = fn; }
export function setRealAgent(fn: AgentFn): void { realAgent = fn; }
export function getActiveAgent(): AgentFn | null { return mockAgent ?? realAgent; }
const activeAgent: AgentFn = (input) => {
  const agent = mockAgent ?? realAgent;
  if (!agent) throw new Error("no agent configured");
  return agent(input);
};

export function chatRoute(sm: SessionManager): Route {
  return {
    method: "POST",
    path: "/chat",
    handler: async ({ body, res }) => {
      if (!mockAgent && !realAgent) throw new ServerError(ErrorCode.INTERNAL, "no agent configured");
      const input = body as { sessionId?: string; message: string; context?: any };
      if (!input || typeof input.message !== "string") {
        throw new ServerError(ErrorCode.VALIDATION, "body.message required");
      }
      const session = input.sessionId ? (sm.get(input.sessionId) ?? sm.create()) : sm.create();
      sm.append(session.id, { role: "user", content: input.message, ts: Date.now() });

      const sse = new SseWriter(res);
      try {
        for await (const evt of activeAgent({ message: input.message, sessionId: session.id, context: input.context })) {
          if (evt.event === "done") {
            sse.send(evt.event, { ...(evt.data as object), sessionId: session.id });
          } else {
            sse.send(evt.event, evt.data);
          }
        }
      } catch (err) {
        sse.send("error", { code: "INTERNAL", message: String(err) });
      } finally {
        sse.end();
      }
    },
  };
}
