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
  jsonRedactor,
  redactDiagnosticObject,
  redactDiagnosticUrl,
  redactHomePath,
  redactJsonLines,
  redactSensitiveInfo,
  summarizeSecretEnvPresence,
  _resetRedactionCacheForTesting,
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

  // Regression: false/absent env-presence values must be preserved as-is
  // rather than collapsed to "[set]" which would misrepresent the value.
  test("preserves absent and falsey env-presence values", () => {
    const redacted = redactDiagnosticObject({
      OPENAI_API_KEY: false,
      ANTHROPIC_API_KEY: "",
      GITHUB_TOKEN: 0,
      MISTRAL_API_KEY: null,
    });

    expect(redacted).toEqual({
      OPENAI_API_KEY: false,
      ANTHROPIC_API_KEY: "",
      GITHUB_TOKEN: 0,
      MISTRAL_API_KEY: null,
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
      "header was [REDACTED_TOKEN]",
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
      "https://example.com/v1?api_key=redacted&mode=test&token=redacted",
    );
  });

  test("redacts userinfo when password contains # (malformed URL)", () => {
    // The fragment char `#` inside userinfo breaks URL parsing, so the
    // fallback regex handles it. The `:redacted` is omitted because the
    // regex replaces the whole `//user:pass@` span at once.
    expect(
      redactDiagnosticUrl("https://alice:pa#ss@example.com/v1?token=abc"),
    ).toBe("https://example.com/v1?token=redacted");
  });

  test("redacts userinfo with # in password for bare host (no path)", () => {
    expect(redactDiagnosticUrl("//alice:sec#ret@host")).toBe("//host");
    expect(redactDiagnosticUrl("//alice:sec#ret@host:443")).toBe(
      "//host:443",
    );
  });

  test("redacts semicolon-delimited sensitive query params", () => {
    // The `;` separator is preserved while the sensitive value is redacted.
    expect(
      redactDiagnosticUrl("https://x.test/path?mode=ok;token=SECRET123&x=1"),
    ).toBe("https://x.test/path?mode=ok;token=redacted&x=1");
  });

  test("redacts semicolon-delimited api_key query params via fallback path", () => {
    expect(
      redactDiagnosticUrl("//x.test/path?mode=ok;api_key=SECRET123&x=1"),
    ).toBe("//x.test/path?mode=ok;api_key=redacted&x=1");
  });

  test("preserves harmless semicolons in query params", () => {
    // A semicolon that is not preceding a sensitive key=value segment must
    // not be altered. Previously the pre-pass normalized all `;` to `&`.
    expect(
      redactDiagnosticUrl("https://api.example.com/v1?redirect=https://a;b&mode=ok"),
    ).toBe("https://api.example.com/v1?redirect=https://a;b&mode=ok");
  });

  test("does not mangle //user@host inside a query-param value", () => {
    // The credential-strip pass must be scoped to the authority only.
    // A redirect_uri or callback value that itself contains //something@host
    // must survive intact (the mode=safe param value here is intentionally
    // non-sensitive so it is not redacted by the query-param redactor).
    expect(
      redactDiagnosticUrl(
        "https://proxy.example.com/v1?callback=https%3A%2F%2Fuser%40host&mode=safe",
      ),
    ).toBe(
      "https://proxy.example.com/v1?callback=https%3A%2F%2Fuser%40host&mode=safe",
    );
  });

  test("preserves trailing slash on path before query string", () => {
    // Trailing-slash trimming must only strip the bare root slash that the
    // URL serializer appends when there is no path (e.g. `https://host/`).
    // A meaningful path segment like `/v1/` must be left intact.
    expect(
      redactDiagnosticUrl("https://api.example.com/v1/?mode=safe&path=foo/"),
    ).toBe("https://api.example.com/v1/?mode=safe&path=foo/");
    // Bare root slash (no path) IS trimmed.
    expect(redactDiagnosticUrl("https://api.example.com/")).toBe(
      "https://api.example.com",
    );
  });

  test("does not mangle //redacted@ literal inside a path segment", () => {
    // A proxy route whose path contains the literal text `//redacted@other`
    // must survive the credential-strip pass unchanged. Previously the
    // full-string regex would corrupt this path content.
    expect(
      redactDiagnosticUrl("https://host/path//redacted@other?x=1"),
    ).toBe("https://host/path//redacted@other?x=1");
  });

  test("preserves double-slash path https://host//", () => {
    // A URL with `//` in the path must not be collapsed to `https://host` by
    // the trailing-slash trim, which is now scoped to bare-root only.
    expect(redactDiagnosticUrl("https://host//")).toBe("https://host//");
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
      "x-api-key: [REDACTED]",
    );
  });

  test("redacts authorization value with trailing paren", () => {
    expect(redactSensitiveInfo("Authorization: Bearer abc(def)ghi")).toBe(
      "Authorization: [REDACTED]",
    );
  });

  // P1: Bracketed credential values were not redacted because [ and ] were
  // excluded from value captures. Ensure they are fully consumed.
  test("redacts bracketed x-api-key value", () => {
    expect(redactSensitiveInfo("x-api-key: [secret]")).toBe(
      "x-api-key: [REDACTED]",
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
      "x-api-key: [REDACTED]",
    );
  });

  test("redacts multi-word Authorization Bearer value", () => {
    expect(redactSensitiveInfo("Authorization: Bearer abc def ghi")).toBe(
      "Authorization: [REDACTED]",
    );
  });

  test("redacts multi-word Authorization Basic value", () => {
    expect(redactSensitiveInfo("Authorization: Basic dXNlcjpwYXNz")).toBe(
      "Authorization: [REDACTED]",
    );
  });

  test("redacts multi-word password value", () => {
    expect(redactSensitiveInfo("password: foo bar")).toBe("password: [REDACTED]");
  });

  // P1: bare Bearer token without preceding key name must be caught
  test("redacts bare Bearer token in free-form text", () => {
    expect(redactSensitiveInfo('error: {"message":"Bearer abc123456789"}')).toBe(
      'error: {"message":"[REDACTED_TOKEN]"}',
    );
    expect(redactSensitiveInfo("Bearer abcdefgh.ijklmnop.qrstuvwx")).toBe(
      "[REDACTED_TOKEN]",
    );
  });

  // P1: bare JWT token (three base64url segments) without preceding key
  test("redacts bare JWT token in free-form text", () => {
    const jwt = "eyJhbGciOiJIUzI1NiJ9.eyJzdWIiOiIxMjM0NTY3ODkwIn0.dozjgNqPZNoVgM1jLkMTQw";
    expect(redactSensitiveInfo(`token was ${jwt}`)).toMatch(/\[REDACTED_TOKEN\]/);
    expect(redactSensitiveInfo(jwt)).toBe("[REDACTED_TOKEN]");
  });

  // P1: nested object values under non-credential keys must still redact
  // bare Bearer/JWT tokens via jsonRedactor
  test("redacts bare Bearer inside nested object under non-credential key", () => {
    const obj = { nested: { message: "Bearer abc123456789" } };
    const redacted = JSON.parse(JSON.stringify(obj, jsonRedactor)) as typeof obj;
    expect(redacted.nested.message).toMatch(/\[REDACTED_TOKEN\]/);
  });

  test("redacts bare JWT inside nested object under non-credential key", () => {
    const jwt = "eyJhbGciOiJIUzI1NiJ9.eyJzdWIiOiIxMjM0NTY3ODkwIn0.dozjgNqPZNoVgM1jLkMTQw";
    const obj = { nested: { message: jwt } };
    const redacted = JSON.parse(JSON.stringify(obj, jsonRedactor)) as typeof obj;
    expect(redacted.nested.message).toMatch(/\[REDACTED_TOKEN\]/);
  });

  // P2: jsonRedactor must not exempt non-numeric values under token keys.
  // A string or array under { tokens: [...] } could be a credential container.
  test("redacts non-numeric tokens array via jsonRedactor", () => {
    const redacted = JSON.parse(
      JSON.stringify({ tokens: ["opaque-secret-value"] }, jsonRedactor),
    ) as Record<string, unknown>;
    expect(redacted.tokens).toMatch(/\[REDACTED\]/);
  });

  test("redacts non-numeric tokens object via jsonRedactor", () => {
    const redacted = JSON.parse(
      JSON.stringify({ tokens: { secret: "opaque-value" } }, jsonRedactor),
    ) as Record<string, unknown>;
    expect(redacted.tokens).toMatch(/\[REDACTED\]/);
  });

  test("preserves numeric tokens count via jsonRedactor", () => {
    const redacted = JSON.parse(
      JSON.stringify({ tokens: 100 }, jsonRedactor),
    ) as Record<string, unknown>;
    expect(redacted.tokens).toBe(100);
  });

  test("preserves numeric input_tokens count via jsonRedactor", () => {
    const redacted = JSON.parse(
      JSON.stringify({ input_tokens: 50 }, jsonRedactor),
    ) as Record<string, unknown>;
    expect(redacted.input_tokens).toBe(50);
  });

  // P2: known provider env-var values must be redacted — the bare Bearer
  // pattern catches "Bearer secret-value" in the value portion, while the
  // env-var pattern (which stops at the first space) independently matches
  // the OPENAI_AUTH_HEADER_VALUE=Bearer prefix. Either pass fully redacts.
  test("redacts OPENAI_AUTH_HEADER_VALUE env-var assignment", () => {
    // Reset cached env-var pattern so the fix to buildKnownEnvVarPattern
    // (\\s escaping) is picked up by this test.
    _resetRedactionCacheForTesting();
    expect(
      redactSensitiveInfo("OPENAI_AUTH_HEADER_VALUE=Bearer secret-value"),
    ).toMatch(/\[REDACTED/);
    expect(
      redactSensitiveInfo("OPENAI_AUTH_HEADER_VALUE: Bearer secret-value"),
    ).toMatch(/\[REDACTED/);
    // Non-Bearer value (plain token) tests the env-var pattern directly
    expect(
      redactSensitiveInfo("OPENAI_AUTH_HEADER_VALUE=sk-plain-secret-999"),
    ).toMatch(/\[REDACTED/);
    expect(
      redactSensitiveInfo("OPENAI_AUTH_HEADER_VALUE=nobearer-secret-value"),
    ).toMatch(/\[REDACTED/);
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

  test("redactJsonLines fallback preserves non-whitespace prefix before JSON and redacts trailing secret", () => {
    // Non-whitespace prefix like a log level must be preserved while
    // sensitive content in the trailing text is redacted. Exact output
    // shape verifies ordering and no content loss.
    const line = 'WARN {"ok":true} api_key=sk-ant-trailing-key';
    const result = redactJsonLines(line);
    expect(result).toBe('WARN {"ok":true} api_key=[REDACTED]');
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

  // Regression: COOKIE_PATTERN must consume comma-joined multi-cookie values
  // (e.g. `Set-Cookie: sid=one, refresh=two`) rather than stopping at the
  // first comma like the generic header pattern does.
  test("redacts comma-joined Set-Cookie values fully", () => {
    const result = redactSensitiveInfo(
      'Set-Cookie: sid=abc123, refresh=def456',
    );
    expect(result).toBe('Set-Cookie: [REDACTED]');
  });

  test("redacts comma-joined Cookie values fully", () => {
    const result = redactSensitiveInfo(
      "cookie: sid=abc123, refresh=def456",
    );
    expect(result).toBe("cookie: [REDACTED]");
  });

  // Regression: URL query redaction must not skip URLs that already contain
  // [REDACTED] from a generic pattern match — remaining sensitive params
  // (e.g. signature=SIG) must still be caught by redactUrlForDisplay.
  test("redacts remaining URL query params after generic pattern redacted part of URL", () => {
    const result = redactSensitiveInfo(
      "https://api.example.com/v1?api_key=SECRET&signature=SIG&mode=test",
    );
    expect(result).toBe(
      "https://api.example.com/v1?api_key=redacted&signature=redacted&mode=test",
    );
  });

  // Regression: protocol-relative // URLs must be caught by the URL
  // extractor in redactSensitiveInfo, not just by redactUrlForDisplay.
  test("redacts protocol-relative URL query params via redactSensitiveInfo", () => {
    const result = redactSensitiveInfo(
      "//api.example.com/v1?signature=SECRET&mode=test",
    );
    expect(result).toBe(
      "//api.example.com/v1?signature=redacted&mode=test",
    );
  });

  // Regression: uppercase provider env-var names in URL query strings must not
  // consume safe trailing query params when matched by env-var redaction passes.
  test("preserves safe query params after provider env-var names in URLs", () => {
    const cases = [
      {
        input: "https://example.com/v1?OPENAI_API_KEY=secret&mode=test",
        expected: "https://example.com/v1?OPENAI_API_KEY=redacted&mode=test",
      },
      {
        input: "https://example.com/v1?AWS_SECRET_ACCESS_KEY=key123&debug=true",
        expected:
          "https://example.com/v1?AWS_SECRET_ACCESS_KEY=redacted&debug=true",
      },
      {
        input: "https://example.com/v1?GOOGLE_API_KEY=gkey456&trace=1",
        expected: "https://example.com/v1?GOOGLE_API_KEY=redacted&trace=1",
      },
      {
        input:
          "https://example.com/v1?ANTHROPIC_API_KEY=ant789&limit=10#section",
        expected:
          "https://example.com/v1?ANTHROPIC_API_KEY=redacted&limit=10",
      },
    ];

    for (const { input, expected } of cases) {
      expect(redactSensitiveInfo(input)).toBe(expected);
    }
  });

  // Regression: uppercase provider keys with semicolon-separated safe trailing
  // params must preserve the safe params even though URL redaction handles `;`.
  test("preserves semicolon-delimited safe params after uppercase provider env-var keys", () => {
    const cases = [
      {
        input: "https://example.com/v1?OPENAI_API_KEY=secret;mode=test",
        expected: "https://example.com/v1?OPENAI_API_KEY=redacted;mode=test",
      },
      {
        input: "https://example.com/v1?AWS_SECRET_ACCESS_KEY=key123;debug=true",
        expected: "https://example.com/v1?AWS_SECRET_ACCESS_KEY=redacted;debug=true",
      },
      {
        input: "https://example.com/v1?GOOGLE_API_KEY=gkey456;trace=1",
        expected: "https://example.com/v1?GOOGLE_API_KEY=redacted;trace=1",
      },
    ];

    for (const { input, expected } of cases) {
      expect(redactSensitiveInfo(input)).toBe(expected);
    }
  });

  // Regression: COOKIE_PATTERN should not consume URL query params.
  // Cookie in query strings should be handled by the URL redaction pass,
  // not the header-style cookie pattern that consumes full values.
  test("does not let cookie query param consume safe trailing params", () => {
    // Cookie in URL query should go through URL redaction (which preserves
    // safe trailing params) not the header-style cookie pattern.
    const result = redactSensitiveInfo(
      "https://example.com/v1?cookie=secret&mode=test",
    );
    expect(result).toBe("https://example.com/v1?cookie=redacted&mode=test");
  });

  test("does not let set-cookie query param consume safe trailing params", () => {
    const result = redactSensitiveInfo(
      "https://example.com/v1?set-cookie=secret&mode=test",
    );
    expect(result).toBe("https://example.com/v1?set-cookie=redacted&mode=test");
  });

  // P2: semicolon-delimited cookie in URL query must not be consumed by
  // the header-style COOKIE_PATTERN, dropping safe trailing params.
  test("preserves semicolon-delimited safe params after cookie in URL query", () => {
    const result = redactSensitiveInfo(
      "https://example.com/v1?foo=bar;cookie=secret;mode=test",
    );
    expect(result).toBe("https://example.com/v1?foo=bar;cookie=redacted;mode=test");
  });

  test("preserves semicolon-delimited safe params after set-cookie in URL query", () => {
    const result = redactSensitiveInfo(
      "https://example.com/v1?foo=bar;set-cookie=secret;mode=test",
    );
    expect(result).toBe("https://example.com/v1?foo=bar;set-cookie=redacted;mode=test");
  });

  // Regression: header-style cookie values should still be fully redacted.
  test("still redacts full Cookie header values with semicolon attributes", () => {
    const result = redactSensitiveInfo(
      "Cookie: sessionId=abc123; Path=/; Secure; HttpOnly",
    );
    expect(result).toBe("Cookie: [REDACTED]");
  });

  test("still redacts full Set-Cookie header values with semicolon attributes", () => {
    const result = redactSensitiveInfo(
      "Set-Cookie: sessionId=abc123; Path=/; Secure; HttpOnly",
    );
    expect(result).toBe("Set-Cookie: [REDACTED]");
  });

  // Regression: keep generic secret values whole outside URLs and preserve URL safe params inside URLs
  test("keeps generic env secret values whole in non-URL contexts", () => {
    expect(redactSensitiveInfo("DATABASE_PASSWORD=correct&horse=battery")).toBe("DATABASE_PASSWORD=[REDACTED]");
    expect(redactSensitiveInfo("x-api-key: abc&def=ghi")).toBe("x-api-key: [REDACTED]");
    expect(redactSensitiveInfo("token=abc;def=ghi")).toBe("token=[REDACTED]");
  });

  test("preserves safe URL parameters inside URL query strings for generic/provider keys", () => {
    expect(redactSensitiveInfo("https://example.com/v1?OPENAI_API_KEY=secret&mode=test")).toBe(
      "https://example.com/v1?OPENAI_API_KEY=redacted&mode=test"
    );
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
