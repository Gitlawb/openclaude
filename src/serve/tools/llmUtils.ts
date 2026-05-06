import { createCombinedAbortSignal } from "../../utils/combinedAbortSignal";

/**
 * Make a non-streaming LLM sub-call and return the text response.
 * Throws on HTTP error or network failure. Callers wrap in try/catch.
 */
export async function callLLM(prompt: string): Promise<string> {
  const baseUrl = (process.env.OPENAI_BASE_URL ?? "https://api.openai.com/v1").replace(/\/$/, "");
  const apiKey  = process.env.OPENAI_API_KEY ?? "";
  const model   = process.env.OPENCLAUDE_MODEL ?? "gpt-4o-mini";

  const { signal, cleanup } = createCombinedAbortSignal(undefined, { timeoutMs: 60_000 });
  try {
    const res = await fetch(`${baseUrl}/chat/completions`, {
      method: "POST",
      headers: {
        "Content-Type":  "application/json",
        "Authorization": `Bearer ${apiKey}`,
      },
      body: JSON.stringify({
        model,
        stream: false,
        messages: [{ role: "user", content: prompt }],
      }),
      signal,
    });
    if (!res.ok) throw new Error(`LLM sub-call failed: ${res.status}`);
    const data = await res.json() as { choices?: Array<{ message?: { content?: string } }> };
    const content = data.choices?.[0]?.message?.content;
    if (!content) throw new Error("LLM returned empty content");
    return content;
  } finally {
    cleanup();
  }
}
