import {
  afterAll,
  afterEach,
  beforeAll,
  beforeEach,
  describe,
  expect,
  mock,
  test,
} from "bun:test";
import { homedir } from "node:os";
import { getKnownProviderSecretEnvKeys } from "../providerSecrets.js";
import {
  collectProviderSecretEnvVars,
  redactDiagnosticObject,
  redactDiagnosticUrl,
  redactHomePath,
  redactJsonLines,
  redactSensitiveInfo,
  summarizeSecretEnvPresence,
} from "../redaction.js";

const writeToStderrMock = mock((data: string) => {});
let capturedStderr = "";
beforeEach(() => {
  capturedStderr = "";
  writeToStderrMock.mockImplementation((data: string) => {
    capturedStderr += data;
  });
});

// Module-scope mock so it is registered before any test runs.  When another
// test file (e.g. sessionTitle.test.ts) imports debug.ts first, the cached
// module already resolved process.js without the mock.  We use a cache-busting
// query param for all debug.ts imports below so that a fresh module instance
// is created and picks up this mock.
mock.module("../process.js", () => ({
  writeToStderr: writeToStderrMock,
}));

const DEBUG_CACHE_KEY = "logForDebugging";

describe("diagnostic redaction", () => {
  test("collects every known provider secret env var from the centralized registry", () => {
    const expected = new Set(getKnownProviderSecretEnvKeys());

    expect(new Set(collectProviderSecretEnvVars())).toEqual(expected);
    expect(expected.has("GEMINI_ACCESS_TOKEN")).toBe(true);
    expect(expected.has("GITHUB_TOKEN")).toBe(true);
    expect(expected.has("OPENGATEWAY_API_KEY")).toBe(true);
    expect(expected.size).toBeGreaterThan(10);
  });

  test("represents provider secret env vars as presence booleans only", () => {
    const envVars = collectProviderSecretEnvVars();
    const env = Object.fromEntries(
      envVars.map((name, index) => [name, `sk-${name}-secret-${index}`]),
    );

    const summary = summarizeSecretEnvPresence(env, envVars);
    const serialized = JSON.stringify(summary);

    for (const name of envVars) {
      expect(summary).toContainEqual({ name, present: true });
      expect(serialized).not.toContain(env[name]!);
    }
  });

  test("redacts known and likely secret-looking values in nested objects", () => {
    const redacted = redactDiagnosticObject({
      OPENAI_API_KEY: "sk-openai-secret",
      headers: {
        Authorization: "Bearer abc123",
        "x-api-key": "plain-token",
      },
      nested: [{ password: "hunter2" }, { safe: "enabled" }],
    });

    expect(redacted).toEqual({
      OPENAI_API_KEY: "[set]",
      headers: {
        Authorization: "[redacted]",
        "x-api-key": "[redacted]",
      },
      nested: [{ password: "[redacted]" }, { safe: "enabled" }],
    });
  });

  test("redacts bare auth header keys in JSON/header objects", () => {
    const redacted = redactDiagnosticObject({
      auth: "plain-auth-secret",
      "x-auth": "plain-x-auth-secret",
      "Authorization": "Bearer token",
    });

    expect(redacted).toEqual({
      auth: "[redacted]",
      "x-auth": "[redacted]",
      Authorization: "[redacted]",
    });
  });

  test("redacts secret-looking values even under harmless field names", () => {
    const home = homedir();
    const redacted = redactDiagnosticObject({
      messages: [
        "request used sk-openai-secret-token",
        "google key AIzaSyDUMMY-secret-token",
        "header was Bearer abcdefghijklmnop",
        "token github_pat_abcdefghijklmnopqrstuvwxyz",
        "MISTRAL_API_KEY=mistralOpaqueToken123456789",
        "mistral api key abcdefghijklmnopqrstuvwxyz",
      ],
      path: `${home}/private/openclaude/src/file.ts`,
    }) as { messages: string[]; path: string };
    const serialized = JSON.stringify(redacted);

    expect(redacted.messages).toEqual([
      "request used [REDACTED_OPENAI_KEY]",
      "google key [REDACTED_GCP_KEY]",
      "header was [redacted]",
      "token [REDACTED_GITHUB_TOKEN]",
      "MISTRAL_API_KEY=[REDACTED]",
      "mistral api key [redacted]",
    ]);
    expect(redacted.path).toBe("~/private/openclaude/src/file.ts");
    expect(serialized).not.toContain("sk-openai-secret-token");
    expect(serialized).not.toContain("AIzaSyDUMMY-secret-token");
    expect(serialized).not.toContain("abcdefghijklmnop");
    expect(serialized).not.toContain("github_pat_abcdefghijklmnopqrstuvwxyz");
    expect(serialized).not.toContain("mistralOpaqueToken123456789");
    expect(serialized).not.toContain("abcdefghijklmnopqrstuvwxyz");
    expect(serialized).not.toContain(home);
  });

  test("does not redact arbitrary opaque ids without Mistral key context", () => {
    expect(
      redactDiagnosticObject({
        traceId: "abcdefghijklmnopqrstuvwxyz",
        message: "request id abcdefghijklmnopqrstuvwxyz failed",
      }),
    ).toEqual({
      traceId: "abcdefghijklmnopqrstuvwxyz",
      message: "request id abcdefghijklmnopqrstuvwxyz failed",
    });
  });

  test("redacts Windows-style home paths without matching sibling directories", () => {
    const home = "C:\\Users\\Alice";

    expect(
      redactHomePath(
        "debug path C:\\Users\\Alice\\AppData\\Roaming\\openclaude",
        home,
      ),
    ).toBe("debug path ~\\AppData\\Roaming\\openclaude");
    expect(redactHomePath("C:\\Users\\AliceOther\\openclaude", home)).toBe(
      "C:\\Users\\AliceOther\\openclaude",
    );
  });

  test("sanitizes credentials and sensitive query params in URLs", () => {
    expect(
      redactDiagnosticUrl(
        "https://user:pass@example.com/v1?api_key=secret&mode=test&token=abc",
      ),
    ).toBe(
      "https://redacted:redacted@example.com/v1?api_key=redacted&mode=test&token=redacted",
    );
  });
});

describe("redactSensitiveInfo", () => {
  // Regression: the generic header-field regex stops at the first whitespace,
  // so a PEM private key value would only redact the `-----BEGIN` prefix and
  // leak the rest. The dedicated PEM pattern must consume the full block.
  test("redacts PEM private key values as a whole", () => {
    const input = [
      "private_key: -----BEGIN RSA PRIVATE KEY-----",
      "FAKE_SECRET_BODY",
      "-----END RSA PRIVATE KEY-----",
    ].join("\n");
    expect(redactSensitiveInfo(input)).toBe("private_key: [REDACTED]");
  });

  test("redacts inline PEM private key with escaped newlines", () => {
    const input =
      "privateKey: -----BEGIN PRIVATE KEY-----\\nFAKE_SECRET_BODY\\n-----END PRIVATE KEY-----";
    expect(redactSensitiveInfo(input)).toBe("privateKey: [REDACTED]");
  });

  test("redacts private_key label with non-PEM value after space", () => {
    // The generic header regex still handles single-word values after space,
    // but the PEM pattern runs first and is more aggressive.
    const input = "private_key: my-secret-token";
    expect(redactSensitiveInfo(input)).toBe("private_key: [REDACTED]");
  });

  // Regression: logForDebugging redacts BEFORE JSON-stringifying multiline
  // messages, so the PEM pattern sees the raw (unescaped) key label.
  // If the order were reversed, `private_key` would be JSON-escaped
  // first and the PEM pattern would miss it.
  test("redacts PEM private key when redacted before JSON stringify", () => {
    const multiline = [
      "private_key: -----BEGIN RSA PRIVATE KEY-----",
      "FAKE_SECRET_BODY",
      "-----END RSA PRIVATE KEY-----",
    ].join("\n");

    // Simulate the logForDebugging ordering: redact first, then stringify.
    const redacted = redactSensitiveInfo(multiline);
    const jsonFormatted = JSON.stringify(redacted);

    expect(jsonFormatted).toBe('"private_key: [REDACTED]"');
  });

  // Regression: GENERIC_HEADER_FIELD_PATTERN excludes `)`, `}`, `]` from
  // its value capture group so a value like `abc(def)` would match only
  // `abc(def` and leave `)` exposed without the post-processing pass.
  test("redacts values with trailing parens", () => {
    expect(redactSensitiveInfo("token=abc(def)")).toBe("token=[REDACTED]");
  });

  test("redacts values with trailing braces", () => {
    expect(redactSensitiveInfo("token=abc{def}")).toBe("token=[REDACTED]");
  });

  test("redacts values with trailing brackets", () => {
    // Regression: GENERIC_HEADER_FIELD_PATTERN excludes `[` from the value
    // capture group, so `foo[bar]` would match only `foo` and leak `[bar]`.
    expect(redactSensitiveInfo("password: foo[bar]")).toBe(
      "password: [REDACTED]",
    );
  });

  test("redacts values with nested trailing parens", () => {
    expect(redactSensitiveInfo("token=abc(def(ghi))")).toBe("token=[REDACTED]");
  });

  // Regression: X_API_KEY_PATTERN and AUTHORIZATION_PATTERN used to exclude
  // `)` and `}` from their value capture, leaking content after embedded
  // closing delimiters. Same fix as GENERIC_HEADER_FIELD_PATTERN.
  test("redacts x-api-key value with trailing paren", () => {
    expect(redactSensitiveInfo("x-api-key: abc)def")).toBe(
      "x-api-key: [REDACTED_API_KEY]",
    );
  });

  test("redacts authorization value with trailing paren", () => {
    expect(redactSensitiveInfo("Authorization: Bearer abc(def)ghi")).toBe(
      "Authorization: Bearer [REDACTED_TOKEN]",
    );
  });

  // P1: Bracketed credential values were not redacted because [ and ] were
  // excluded from value captures. Ensure they are fully consumed.
  test("redacts bracketed x-api-key value", () => {
    expect(redactSensitiveInfo("x-api-key: [secret]")).toBe(
      "x-api-key: [REDACTED_API_KEY]",
    );
  });

  test("redacts bracketed token value", () => {
    expect(redactSensitiveInfo("token=[secret]")).toBe("token=[REDACTED]");
  });

  test("redacts bracketed env var value", () => {
    expect(redactSensitiveInfo("MY_API_KEY=[secret]")).toBe("MY_API_KEY=[REDACTED]");
  });

  // P2: Multi-word header values leaked after the first whitespace because
  // value captures excluded \s. Ensure spaces inside values are consumed.
  test("redacts multi-word x-api-key value", () => {
    expect(redactSensitiveInfo("x-api-key: a b c")).toBe(
      "x-api-key: [REDACTED_API_KEY]",
    );
  });

  test("redacts multi-word Authorization Bearer value", () => {
    expect(redactSensitiveInfo("Authorization: Bearer abc def ghi")).toBe(
      "Authorization: Bearer [REDACTED_TOKEN]",
    );
  });

  test("redacts multi-word Authorization Basic value", () => {
    expect(redactSensitiveInfo("Authorization: Basic dXNlcjpwYXNz")).toBe(
      "Authorization: [REDACTED_TOKEN]",
    );
  });

  test("redacts multi-word password value", () => {
    expect(redactSensitiveInfo("password: foo bar")).toBe("password: [REDACTED]");
  });

  test("redacts secrets in malformed JSONL lines via redactJsonLines fallback", () => {
    const malformedLine = '{"auth": "sk-ant-secret-key"} broken json';
    // Single malformed line — parsing fails, catch branch must still redact.
    const result = redactJsonLines(malformedLine);
    expect(result).not.toContain("sk-ant-secret-key");
    expect(result).toMatch(/\[REDACTED/);
  });

  test("redactJsonLines redacts valid JSONL lines with auth keys", () => {
    const input = JSON.stringify({ auth: "plain-secret" });
    const result = redactJsonLines(input);
    const parsed = JSON.parse(result) as Record<string, unknown>;
    expect(parsed.auth).toBe("[REDACTED]");
  });

  // P1: malformed JSONL lines — jsonRedactor key-awareness must apply via
  // the tryParseFirstJsonObject fallback, not just redactSensitiveInfo.
  test("redactJsonLines fallback redacts non-pattern auth value with trailing garbage", () => {
    const line = '{"auth":"plain-secret-value"} trailing';
    const result = redactJsonLines(line);
    expect(result).toContain("[REDACTED]");
    expect(result).not.toContain("plain-secret-value");
  });

  test("redactJsonLines fallback redacts unicode-escaped api_key with trailing garbage", () => {
    // \u005f is underscore, so the key becomes "api_key" after unescaping.
    const line = '{"api\\u005fkey":"plain-secret-value"} trailing';
    const result = redactJsonLines(line);
    expect(result).toContain("[REDACTED]");
    expect(result).not.toContain("plain-secret-value");
  });

  test("redactJsonLines fallback redacts auth value with escaped quote with trailing garbage", () => {
    const line = '{"auth":"plain\\"secret"} trailing';
    const result = redactJsonLines(line);
    expect(result).toContain("[REDACTED]");
    expect(result).not.toContain('plain\\"secret');
  });

  test("redactJsonLines fallback redacts secret in trailing garbage after parsed JSON", () => {
    // The JSON object parses fine; the trailing text contains a credential
    // that must be caught by redactSensitiveInfo on the rest.
    const line = '{"ok": true} api_key=sk-ant-supersecret-trailing';
    const result = redactJsonLines(line);
    expect(result).not.toContain("sk-ant-supersecret-trailing");
    expect(result).toMatch(/\[REDACTED/);
  });

  // P2: free-form text auth/x-auth coverage
  test("redactSensitiveInfo redacts auth= in free-form text", () => {
    const result = redactSensitiveInfo("auth=plain-secret-value");
    expect(result).toMatch(/\[REDACTED/);
    expect(result).not.toContain("plain-secret-value");
  });

  test("redactSensitiveInfo redacts x-auth= in free-form text", () => {
    const result = redactSensitiveInfo("x-auth=plain-secret-value");
    expect(result).toMatch(/\[REDACTED/);
    expect(result).not.toContain("plain-secret-value");
  });

  test("redactSensitiveInfo redacts auth: in free-form text", () => {
    const result = redactSensitiveInfo('"auth": "plain-secret-value"');
    expect(result).toMatch(/\[REDACTED/);
    expect(result).not.toContain("plain-secret-value");
  });
});

describe("logForDebugging", () => {
  afterAll(() => {
    // mock.module is process-global in Bun and mock.restore() does not undo
    // it.  Restore writeToStderr to its real behavior so downstream test
    // files don't inherit a mock or no-op.
    mock.module("../process.js", () => ({
      writeToStderr: (data: string) => {
        if (!process.stderr.destroyed) process.stderr.write(data);
      },
    }));
  });

  beforeAll(async () => {
    // Cache-busting query param ensures a fresh module instance even when
    // another test file already loaded debug.ts before mock.module was
    // registered (e.g. sessionTitle.test.ts).
    const debug = await import(`../debug.js?cache=${DEBUG_CACHE_KEY}`);
    debug.setHasFormattedOutput(true);
  });

  let originalDebug: string | undefined;
  let originalArgv: string[];

  beforeEach(async () => {
    originalDebug = process.env.DEBUG;
    originalArgv = [...process.argv];
    process.env.DEBUG = "1";
    // Route output through writeToStderr so the mock captures it.
    if (!process.argv.includes("--debug-to-stderr")) {
      process.argv.push("--debug-to-stderr");
    }

    // isDebugMode and isDebugToStdErr are lodash memoize wrappers. If a
    // previous test file imported debug.ts and called either (e.g. through
    // shouldLogDebugMessage), the cache already holds `false` for the
    // earlier env/argv values.  We use the cache-busting key so this import
    // returns the same fresh instance as beforeAll.
    const debug = await import(`../debug.js?cache=${DEBUG_CACHE_KEY}`);
    debug.isDebugMode.cache.clear?.();
    debug.isDebugToStdErr.cache.clear?.();
  });

  afterEach(() => {
    if (originalDebug === undefined) {
      delete process.env.DEBUG;
    } else {
      process.env.DEBUG = originalDebug;
    }
    process.argv = originalArgv;
  });

  test("redacts multiline PEM private key from debug output", async () => {
    const debug = await import(`../debug.js?cache=${DEBUG_CACHE_KEY}`);

    const multiline = [
      "private_key: -----BEGIN RSA PRIVATE KEY-----",
      "FAKE_SECRET_BODY",
      "-----END RSA PRIVATE KEY-----",
    ].join("\n");

    debug.logForDebugging(multiline);

    expect(capturedStderr).toContain("private_key: [REDACTED]");
    expect(capturedStderr).not.toContain("FAKE_SECRET_BODY");
    expect(capturedStderr).not.toContain("BEGIN RSA PRIVATE KEY");
    expect(capturedStderr).not.toContain("END RSA PRIVATE KEY");
  });
});
