import type { Route } from "../http";
import type { SessionManager } from "../session";
import { ServerError, ErrorCode } from "../errors";

export function sessionsRoutes(sm: SessionManager): Route[] {
  return [
    { method: "GET", path: "/sessions", handler: async () => ({ status: 200, body: sm.list() }) },
    {
      method: "POST", path: "/sessions",
      handler: async () => {
        const s = sm.create();
        return { status: 201, body: { id: s.id, createdAt: s.createdAt } };
      },
    },
    {
      method: "GET", path: "/sessions/:id",
      handler: async ({ params }) => {
        const s = sm.get(params.id!);
        if (!s) throw new ServerError(ErrorCode.NOT_FOUND, "session not found");
        return { status: 200, body: s };
      },
    },
    {
      method: "DELETE", path: "/sessions/:id",
      handler: async ({ params }) => {
        const s = sm.get(params.id!);
        if (!s) throw new ServerError(ErrorCode.NOT_FOUND, "session not found");
        sm.delete(params.id!);
        return { status: 204 };
      },
    },
  ];
}
