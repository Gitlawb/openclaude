import { describe, it, expect } from "vitest";
import {
  mapSDKError,
  SDKRateLimitError,
  SDKAuthenticationError,
  SDKServerError,
} from "../errors.js";

describe("mapSDKError", () => {
  it("maps SDKRateLimitError", () => {
    expect(mapSDKError(new SDKRateLimitError())).toContain("rate limited");
  });

  it("maps SDKAuthenticationError", () => {
    expect(mapSDKError(new SDKAuthenticationError())).toContain("Authentication");
  });

  it("maps SDKServerError", () => {
    expect(mapSDKError(new SDKServerError())).toContain("server error");
  });

  it("maps generic Error", () => {
    expect(mapSDKError(new Error("boom"))).toContain("boom");
  });

  it("maps unknown error", () => {
    expect(mapSDKError("weird")).toContain("unknown");
  });
});
