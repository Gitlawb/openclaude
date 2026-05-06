import { describe, it, expect } from "bun:test";
import { thoughtToolModules } from "./thoughtTools";
import type { ToolModule } from "./registry";

function findTool(modules: ToolModule[], name: string): ToolModule {
  const m = modules.find(m => m.definition.function.name === name);
  if (!m) throw new Error(`Tool "${name}" not found`);
  return m;
}

describe("thoughtToolModules", () => {
  it("exports structure_thought, refine_argument, counter_argument", () => {
    const modules = thoughtToolModules({});
    const names = modules.map(m => m.definition.function.name);
    expect(names).toContain("structure_thought");
    expect(names).toContain("refine_argument");
    expect(names).toContain("counter_argument");
  });
});

describe("structure_thought", () => {
  it("returns ok:false for invalid format", async () => {
    const tool = findTool(thoughtToolModules({}), "structure_thought");
    const result = await tool.run({ text: "teste", format: "invalid_format" }, {});
    expect(result.ok).toBe(false);
    expect(result.content).toContain("Formato inválido");
  });

  it("returns ok:false when LLM unreachable", async () => {
    const origUrl = process.env.OPENAI_BASE_URL;
    process.env.OPENAI_BASE_URL = "http://127.0.0.1:1";
    try {
      const tool = findTool(thoughtToolModules({}), "structure_thought");
      const result = await tool.run({ text: "teste", format: "scqa" }, {});
      expect(result.ok).toBe(false);
    } finally {
      if (origUrl !== undefined) process.env.OPENAI_BASE_URL = origUrl;
      else delete process.env.OPENAI_BASE_URL;
    }
  });

  it("returns ok:true with LLM mock", async () => {
    const server = Bun.serve({
      port: 0,
      fetch: () => Response.json({
        choices: [{ message: { content: "**Situação:** contexto\n**Complicação:** problema" } }],
      }),
    });
    const origUrl = process.env.OPENAI_BASE_URL;
    const origKey = process.env.OPENAI_API_KEY;
    const origModel = process.env.OPENCLAUDE_MODEL;
    process.env.OPENAI_BASE_URL = `http://127.0.0.1:${server.port}`;
    process.env.OPENAI_API_KEY = "test";
    process.env.OPENCLAUDE_MODEL = "test";
    try {
      const tool = findTool(thoughtToolModules({}), "structure_thought");
      const result = await tool.run({ text: "preciso organizar meus projetos", format: "scqa" }, {});
      expect(result.ok).toBe(true);
      expect(result.content).toContain("Situação");
    } finally {
      await server.stop(true);
      if (origUrl !== undefined) process.env.OPENAI_BASE_URL = origUrl; else delete process.env.OPENAI_BASE_URL;
      if (origKey !== undefined) process.env.OPENAI_API_KEY = origKey; else delete process.env.OPENAI_API_KEY;
      if (origModel !== undefined) process.env.OPENCLAUDE_MODEL = origModel; else delete process.env.OPENCLAUDE_MODEL;
    }
  });
});

describe("refine_argument", () => {
  it("returns ok:false when LLM unreachable", async () => {
    const origUrl = process.env.OPENAI_BASE_URL;
    process.env.OPENAI_BASE_URL = "http://127.0.0.1:1";
    try {
      const tool = findTool(thoughtToolModules({}), "refine_argument");
      const result = await tool.run({ argument: "arg", feedback: "mais preciso" }, {});
      expect(result.ok).toBe(false);
    } finally {
      if (origUrl !== undefined) process.env.OPENAI_BASE_URL = origUrl;
      else delete process.env.OPENAI_BASE_URL;
    }
  });

  it("calls LLM with argument and feedback in prompt", async () => {
    let capturedBody = "";
    const server = Bun.serve({
      port: 0,
      fetch: async (req) => {
        capturedBody = await req.text();
        return Response.json({ choices: [{ message: { content: "argumento refinado" } }] });
      },
    });
    const origUrl = process.env.OPENAI_BASE_URL;
    const origKey = process.env.OPENAI_API_KEY;
    const origModel = process.env.OPENCLAUDE_MODEL;
    process.env.OPENAI_BASE_URL = `http://127.0.0.1:${server.port}`;
    process.env.OPENAI_API_KEY = "test";
    process.env.OPENCLAUDE_MODEL = "test";
    try {
      const tool = findTool(thoughtToolModules({}), "refine_argument");
      const result = await tool.run(
        { argument: "energia solar é cara", feedback: "adicione dados recentes" }, {}
      );
      expect(result.ok).toBe(true);
      expect(capturedBody).toContain("energia solar é cara");
      expect(capturedBody).toContain("adicione dados recentes");
    } finally {
      await server.stop(true);
      if (origUrl !== undefined) process.env.OPENAI_BASE_URL = origUrl; else delete process.env.OPENAI_BASE_URL;
      if (origKey !== undefined) process.env.OPENAI_API_KEY = origKey; else delete process.env.OPENAI_API_KEY;
      if (origModel !== undefined) process.env.OPENCLAUDE_MODEL = origModel; else delete process.env.OPENCLAUDE_MODEL;
    }
  });
});

describe("counter_argument", () => {
  it("returns structured counter-argument from LLM", async () => {
    const server = Bun.serve({
      port: 0,
      fetch: () => Response.json({
        choices: [{ message: { content: "**Refutação principal:** argumento oposto\n**Ponto mais vulnerável:** premissa falsa" } }],
      }),
    });
    const origUrl = process.env.OPENAI_BASE_URL;
    const origKey = process.env.OPENAI_API_KEY;
    const origModel = process.env.OPENCLAUDE_MODEL;
    process.env.OPENAI_BASE_URL = `http://127.0.0.1:${server.port}`;
    process.env.OPENAI_API_KEY = "test";
    process.env.OPENCLAUDE_MODEL = "test";
    try {
      const tool = findTool(thoughtToolModules({}), "counter_argument");
      const result = await tool.run({ argument: "devemos adotar IA em tudo" }, {});
      expect(result.ok).toBe(true);
      expect(result.content).toContain("Refutação principal");
    } finally {
      await server.stop(true);
      if (origUrl !== undefined) process.env.OPENAI_BASE_URL = origUrl; else delete process.env.OPENAI_BASE_URL;
      if (origKey !== undefined) process.env.OPENAI_API_KEY = origKey; else delete process.env.OPENAI_API_KEY;
      if (origModel !== undefined) process.env.OPENCLAUDE_MODEL = origModel; else delete process.env.OPENCLAUDE_MODEL;
    }
  });
});
