import { describe, it, expect, beforeEach, afterEach } from "bun:test";
import { startServer, type ServerHandle } from "../index";
import { setMockAgent } from "./chat";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

let server: ServerHandle | undefined;
let home: string;
const auth = () => ({ authorization: `Bearer ${server!.token}` });

beforeEach(async () => {
  home = mkdtempSync(join(tmpdir(), "oc-dv-"));
  process.env.HOME = home;
  process.env.USERPROFILE = home;
  setMockAgent(async function* (input) {
    if (input.message.includes("Generate DQL")) {
      yield { event: "token", data: { text: 'TABLE status FROM "03-Projetos" WHERE status = "Ativo"' } };
      yield { event: "done", data: { finishReason: "stop" } };
    } else if (input.message.includes("Analyze")) {
      yield { event: "token", data: { text: "3 ativos. NeuroGrid parado 13 dias." } };
      yield { event: "done", data: { finishReason: "stop" } };
    }
  });
  server = await startServer({ port: 0 });
});
afterEach(async () => {
  if (server) await server.stop();
  rmSync(home, { recursive: true, force: true });
});

describe("POST /tools/dataview", () => {
  it("returns generated DQL for natural language", async () => {
    const r = await fetch(`${server!.url}/tools/dataview`, {
      method: "POST",
      headers: { ...auth(), "content-type": "application/json" },
      body: JSON.stringify({ naturalLanguage: "projetos ativos" }),
    });
    expect(r.status).toBe(200);
    const j = await r.json();
    expect(j.dql).toContain("TABLE");
    expect(j.dql).toContain("status");
  });
});

describe("POST /tools/analyze-results", () => {
  it("returns non-empty insight text", async () => {
    const r = await fetch(`${server!.url}/tools/analyze-results`, {
      method: "POST",
      headers: { ...auth(), "content-type": "application/json" },
      body: JSON.stringify({
        dql: "TABLE status FROM projetos",
        results: [{ file: "FinPower", status: "Ativo" }, { file: "NeuroGrid", status: "Ativo" }],
      }),
    });
    expect(r.status).toBe(200);
    const j = await r.json();
    expect(typeof j.insight).toBe("string");
    expect(j.insight.length).toBeGreaterThan(0);
  });
});
