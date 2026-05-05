import type { ToolModule, ToolContext, VaultToolResult } from "./registry";

interface WebResult {
  title: string;
  url: string;
  snippet: string;
  date?: string;
}

interface BraveSearchResponse {
  web?: {
    results: Array<{
      title: string;
      url: string;
      description: string;
      page_age?: string;
    }>;
  };
}

/** Strip HTML tags and collapse whitespace for clean text extraction. */
function stripHtml(html: string): string {
  return html
    .replace(/<script[\s\S]*?<\/script>/gi, "")
    .replace(/<style[\s\S]*?<\/style>/gi, "")
    .replace(/<[^>]+>/g, " ")
    .replace(/&nbsp;/g, " ")
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/\s{2,}/g, " ")
    .trim();
}

export function webToolModules(_ctx: ToolContext): ToolModule[] {
  return [
    {
      definition: {
        type: "function",
        function: {
          name: "web_search",
          description: "Search the web using Brave Search. Use when the vault lacks current info or the user asks about external topics.",
          parameters: {
            type: "object",
            properties: {
              query: { type: "string", description: "Search query." },
              maxResults: { type: "number", description: "Max results to return (default 5, max 10)." },
            },
            required: ["query"],
          },
        },
      },
      run: async (args, ctx): Promise<VaultToolResult> => {
        const apiKey = ctx.braveApiKey!;
        const query = String(args.query ?? "");
        if (!query) return { ok: false, content: "query is required" };
        const count = Math.min(Number(args.maxResults ?? 5), 10);

        // Allow test override of the Brave base URL
        const baseUrl = process.env._BRAVE_TEST_URL ?? "https://api.search.brave.com/res/v1/web/search";
        const url = `${baseUrl}?q=${encodeURIComponent(query)}&count=${count}`;

        let res: Response;
        try {
          res = await fetch(url, {
            headers: {
              "Accept": "application/json",
              "Accept-Encoding": "gzip",
              "X-Subscription-Token": apiKey,
            },
            signal: AbortSignal.timeout(10_000),
          });
        } catch (err) {
          return { ok: false, content: `web_search fetch error: ${String(err)}` };
        }

        if (!res.ok) {
          return { ok: false, content: `Brave Search API error: ${res.status} ${res.statusText}` };
        }

        const data = await res.json() as BraveSearchResponse;
        const results: WebResult[] = (data.web?.results ?? []).map(r => ({
          title: r.title,
          url: r.url,
          snippet: r.description,
          date: r.page_age,
        }));

        return {
          ok: true,
          content: JSON.stringify(results),
          preview: `${results.length} results for "${query}"`,
        };
      },
    },
    {
      definition: {
        type: "function",
        function: {
          name: "fetch_page",
          description: "Fetch and extract clean text from a web page URL. Use after web_search to read a result's full content.",
          parameters: {
            type: "object",
            properties: {
              url: { type: "string", description: "Full URL to fetch (must start with https:// or http://)." },
            },
            required: ["url"],
          },
        },
      },
      run: async (args, _ctx): Promise<VaultToolResult> => {
        const url = String(args.url ?? "");
        if (!url.startsWith("http://") && !url.startsWith("https://")) {
          return { ok: false, content: "URL must start with http:// or https://" };
        }

        const timeoutMs = Number(process.env._FETCH_PAGE_TIMEOUT_MS ?? 10_000);

        let res: Response;
        try {
          res = await fetch(url, {
            headers: { "User-Agent": "Mozilla/5.0 (compatible; OpenClaude/1.0)" },
            signal: AbortSignal.timeout(timeoutMs),
          });
        } catch (err) {
          const msg = String(err);
          const isTimeout = msg.includes("timeout") || msg.includes("TimeoutError") || msg.includes("AbortError");
          return {
            ok: false,
            content: isTimeout
              ? `fetch_page timeout after ${timeoutMs}ms: ${url}`
              : `fetch_page error: ${msg}`,
          };
        }

        if (!res.ok) {
          return { ok: false, content: `fetch_page HTTP error: ${res.status} ${res.statusText}` };
        }

        const html = await res.text();
        const text = stripHtml(html).slice(0, 8_000);
        return { ok: true, content: text, preview: `${text.length} chars from ${url}` };
      },
    },
  ];
}
