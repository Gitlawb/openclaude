import { describe, it, expect } from "bun:test";
import { webToolModules } from "./webTools";
import type { ToolModule } from "./registry";

function findTool(modules: ToolModule[], name: string): ToolModule {
  const m = modules.find(m => m.definition.function.name === name);
  if (!m) throw new Error(`Tool "${name}" not found`);
  return m;
}

describe("webToolModules", () => {
  it("exports web_search and fetch_page", () => {
    const modules = webToolModules({ braveApiKey: "key" });
    expect(modules.length).toBe(2);
    const names = modules.map(m => m.definition.function.name);
    expect(names).toContain("web_search");
    expect(names).toContain("fetch_page");
  });

  it("each module has definition and run function", () => {
    const modules = webToolModules({ braveApiKey: "BSA_TEST" });
    for (const mod of modules) {
      expect(mod).toHaveProperty("definition");
      expect(typeof mod.run).toBe("function");
    }
  });
});

describe("web_search", () => {
  it("returns ok:false when Brave API returns non-200", async () => {
    const server = Bun.serve({ port: 0, fetch: () => new Response("forbidden", { status: 403 }) });
    process.env._BRAVE_TEST_URL = `http://127.0.0.1:${server.port}`;
    try {
      const tool = findTool(webToolModules({ braveApiKey: "bad-key" }), "web_search");
      const result = await tool.run({ query: "test" }, { braveApiKey: "bad-key" });
      expect(result.ok).toBe(false);
      expect(result.content).toContain("403");
    } finally {
      delete process.env._BRAVE_TEST_URL;
      await server.stop();
    }
  });

  it("returns ok:false when query is empty", async () => {
    const tool = findTool(webToolModules({ braveApiKey: "key" }), "web_search");
    const result = await tool.run({ query: "" }, { braveApiKey: "key" });
    expect(result.ok).toBe(false);
    expect(result.content).toBe("query is required");
  });

  it("returns search results on success", async () => {
    const mockResponse = {
      web: {
        results: [
          { title: "Test Result", url: "https://example.com", description: "A test snippet", page_age: "2024-01-01" },
        ],
      },
    };
    const server = Bun.serve({ port: 0, fetch: () => Response.json(mockResponse) });
    process.env._BRAVE_TEST_URL = `http://127.0.0.1:${server.port}`;
    try {
      const tool = findTool(webToolModules({ braveApiKey: "valid-key" }), "web_search");
      const result = await tool.run({ query: "energia solar", maxResults: 3 }, { braveApiKey: "valid-key" });
      expect(result.ok).toBe(true);
      const hits = JSON.parse(result.content);
      expect(hits[0].title).toBe("Test Result");
      expect(hits[0].url).toBe("https://example.com");
      expect(hits[0].snippet).toBe("A test snippet");
    } finally {
      delete process.env._BRAVE_TEST_URL;
      await server.stop();
    }
  });
});

describe("fetch_page", () => {
  it("returns stripped text from HTML page", async () => {
    const html = "<html><body><h1>Title</h1><p>Some content here.</p></body></html>";
    const server = Bun.serve({
      port: 0,
      fetch: () => new Response(html, { headers: { "Content-Type": "text/html" } }),
    });
    try {
      const tool = findTool(webToolModules({ braveApiKey: "key" }), "fetch_page");
      const result = await tool.run({ url: `http://127.0.0.1:${server.port}` }, { braveApiKey: "key" });
      expect(result.ok).toBe(true);
      expect(result.content).toContain("Title");
      expect(result.content).toContain("Some content here");
      expect(result.content).not.toContain("<html>");
      expect(result.content).not.toContain("<p>");
    } finally {
      await server.stop();
    }
  });

  it("returns ok:false for invalid URL scheme", async () => {
    const tool = findTool(webToolModules({ braveApiKey: "key" }), "fetch_page");
    const result = await tool.run({ url: "ftp://example.com/file" }, { braveApiKey: "key" });
    expect(result.ok).toBe(false);
    expect(result.content).toContain("http");
  });

  it("returns ok:false on timeout", async () => {
    // Use a server that delays longer than our timeout so AbortSignal fires first.
    const server = Bun.serve({
      port: 0,
      fetch: async () => {
        await Bun.sleep(5_000); // 5s — well past our 150ms test timeout
        return new Response("late");
      },
    });
    process.env._FETCH_PAGE_TIMEOUT_MS = "150";
    try {
      const tool = findTool(webToolModules({ braveApiKey: "key" }), "fetch_page");
      const result = await tool.run({ url: `http://127.0.0.1:${server.port}` }, { braveApiKey: "key" });
      expect(result.ok).toBe(false);
      expect(result.content).toContain("timeout");
    } finally {
      delete process.env._FETCH_PAGE_TIMEOUT_MS;
      server.stop(true); // force-close without waiting for pending requests
    }
  });
});
