import { describe, it, expect } from "bun:test";
import { ServerError, errorResponse, ErrorCode } from "./errors";

describe("ServerError", () => {
  it("carries code, message, httpStatus", () => {
    const e = new ServerError(ErrorCode.UNAUTHORIZED, "nope");
    expect(e.code).toBe("UNAUTHORIZED");
    expect(e.message).toBe("nope");
    expect(e.httpStatus).toBe(401);
  });

  it("maps codes to HTTP status", () => {
    expect(new ServerError(ErrorCode.NOT_FOUND, "").httpStatus).toBe(404);
    expect(new ServerError(ErrorCode.RATE_LIMIT, "").httpStatus).toBe(429);
    expect(new ServerError(ErrorCode.CONFLICT, "").httpStatus).toBe(409);
    expect(new ServerError(ErrorCode.VAULT_UNAVAILABLE, "").httpStatus).toBe(503);
    expect(new ServerError(ErrorCode.INTERNAL, "").httpStatus).toBe(500);
    expect(new ServerError(ErrorCode.TRIPWIRE_BLOCKED, "").httpStatus).toBe(403);
  });
});

describe("errorResponse", () => {
  it("formats JSON error shape", () => {
    const r = errorResponse(new ServerError(ErrorCode.UNAUTHORIZED, "nope"));
    expect(r.status).toBe(401);
    expect(r.body).toEqual({ error: { code: "UNAUTHORIZED", message: "nope" } });
  });

  it("includes extras", () => {
    const e = new ServerError(ErrorCode.RATE_LIMIT, "slow", { retryAfterMs: 5000 });
    const r = errorResponse(e);
    expect(r.body).toEqual({ error: { code: "RATE_LIMIT", message: "slow", retryAfterMs: 5000 } });
  });
});
