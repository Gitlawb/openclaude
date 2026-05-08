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
  history?: Array<{ role: "user" | "assistant"; content: string }>;
  preset?: "conservative" | "balanced" | "aggressive";
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
      const VALID_PRESETS = new Set(["conservative", "balanced", "aggressive"]);
      const input = body as { sessionId?: string; message: string; context?: any; preset?: "conservative" | "balanced" | "aggressive" };
      if (!input || typeof input.message !== "string") {
        throw new ServerError(ErrorCode.VALIDATION, "body.message required");
      }
      if (input.preset !== undefined && !VALID_PRESETS.has(input.preset)) {
        throw new ServerError(ErrorCode.VALIDATION, `Invalid preset: "${input.preset}". Must be conservative, balanced, or aggressive.`);
      }
      const session = input.sessionId ? (sm.get(input.sessionId) ?? sm.create()) : sm.create();

      // Build history BEFORE appending the current user message (last 20 user+assistant messages)
      const history = session.messages
        .filter(m => m.role === "user" || m.role === "assistant")
        .slice(-20)
        .map(m => ({ role: m.role as "user" | "assistant", content: m.content }));

      sm.append(session.id, { role: "user", content: input.message, ts: Date.now() });

      const sse = new SseWriter(res);
      let assistantText = "";

      try {
        for await (const evt of activeAgent({
          message: input.message,
          sessionId: session.id,
          context: input.context,
          history,
          preset: input.preset,
        })) {
          if (evt.event === "token") assistantText += evt.data.text;
          if (evt.event === "done") {
            sse.send(evt.event, { ...(evt.data as object), sessionId: session.id });
          } else {
            sse.send(evt.event, evt.data);
          }
        }
      } catch (err) {
        sse.send("error", { code: "INTERNAL", message: String(err) });
      } finally {
        if (assistantText) {
          sm.append(session.id, { role: "assistant", content: assistantText, ts: Date.now() });
        }
        sse.end();
      }
    },
  };
}
