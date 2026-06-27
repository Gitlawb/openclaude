/**
 * Centralized credential redaction utility.
 *
 * Primary source of truth for redacting secrets (API keys, tokens, passwords)
 * from strings, JSON values, URLs, filesystem paths, and structured
 * diagnostic objects that flow into logs, bug reports, transcript shares,
 * /status output, doctor reports, and other public-safe surfaces. The
 * regex sets and credential-name lists live here; call sites for diagnostic
 * and logging paths should prefer these over forking their own patterns.
 *
 * Specialized scanners (e.g. team-memory pre-upload scanning in
 * secretScanner.ts, OAuth token redaction in xaa.ts) maintain their own
 * rules for domain-specific needs and different threat models. Those are
 * intentional exceptions, not drift.
 *
 * Surface map:
 *
 *   Logs / bug reports / transcript shares
 *     redactSensitiveInfo(text)             free-form string scrub
 *     jsonRedactor(key, value)             JSON.stringify replacer
 *
 *   URL display
 *     redactUrlForDisplay(url)              masks userinfo + sensitive query params
 *     shouldRedactUrlQueryParam(name)       predicate for external callers
 *
 *   /status output
 *     redactUrlForStatus(url)               redactUrlForDisplay + drop fragment
 *     redactPathForStatus(path)             ~-redact $HOME prefix
 *
 *   Diagnostic reports (doctor / issue export)
 *     collectProviderSecretEnvVars()        list known env var names
 *     summarizeSecretEnvPresence(env)       [{name, present}] summary
 *     redactDiagnosticObject(value)         recursive walk; [set] / [redacted]
 *     redactDiagnosticUrl(url)              url redacted + trailing / stripped
 *     redactHomePath(value)                 $HOME → ~
 *     redactLikelySecrets(value)            free-form text scrub
 *
 * Provider coverage is generated from two sources:
 * - `getKnownProviderSecretEnvKeys()` for env-var name patterns, so a new
 *   provider added via the descriptor registry is covered automatically.
 * - Hard-coded prefix patterns for the well-known token formats (sk-ant-...,
 *   AIza..., ghp_..., etc.) which show up outside of env-var contexts.
 */

import { homedir } from "node:os";
import { getKnownProviderSecretEnvKeys } from "./providerSecrets.js";

// Anthropic API keys (sk-ant...)
// Boundary class is `[A-Za-z0-9_-]` (not `[A-Za-z0-9]`) so a raw key
// embedded in a JSON string value `"sk-ant-..."` is still caught — the
// leading `"` is the start of the string, not a key character.
const ANTHROPIC_KEY_PATTERN =
  /(?<![A-Za-z0-9_-])(sk-ant-?[A-Za-z0-9_-]{10,})(?![A-Za-z0-9_-])/g;

// OpenAI / Codex / OpenRouter API keys (sk-..., sk-proj-..., sk-or-v1-...)
const OPENAI_KEY_PATTERN =
  /(?<![A-Za-z0-9_-])(sk-(?:proj-|or-v1-)?[A-Za-z0-9_-]{5,})(?![A-Za-z0-9_-])/g;

// AWS access keys
const AWS_ACCESS_KEY_PATTERN = /(AKIA[A-Z0-9]{16})/g;

// Google Cloud / Gemini API keys (AIza...) — 35-char suffix matches real GCP
// keys which are typically 39 chars total. The diagnostics module uses {10,}
// because it sees values out of context; here we only flag clearly-shaped keys.
const GCP_KEY_PATTERN =
  /(?<![A-Za-z0-9_-])(AIza[A-Za-z0-9_-]{10,})(?![A-Za-z0-9_-])/g;

// Vertex AI service account emails
const GCP_SERVICE_ACCOUNT_PATTERN =
  /(?<![A-Za-z0-9])([a-z0-9-]+@[a-z0-9-]+\.iam\.gserviceaccount\.com)(?![A-Za-z0-9])/g;

// GitHub personal access tokens (ghp_, gho_, ghs_, ghu_, ghr_, github_pat_)
const GITHUB_TOKEN_PATTERN =
  /(?<![A-Za-z0-9_-])(?:gh[pousr]_|github_pat_)[A-Za-z0-9_]{10,}(?![A-Za-z0-9_-])/g;

// "AWS key: \"AKIA...\"" — provider-specific debug-message wrapping
const AWS_KEY_LABELED_PATTERN = /AWS key:\s*"(AWS[A-Z0-9]{20,})"/g;

// Generic x-api-key header redaction
const X_API_KEY_PATTERN = /(["']?x-api-key["']?\s*[:=]\s*["']?)[^"',\n&]+/gi;

// Authorization header / Bearer token redaction
const AUTHORIZATION_PATTERN =
  /(["']?authorization["']?\s*[:=]\s*["']?(?:bearer\s+)?)[^"',\n&]+/gi;

// AWS_* / GOOGLE_* / provider-prefixed env var redaction
const PROVIDER_PREFIXED_ENV_PATTERN =
  /((?:AWS|GOOGLE)[_-][A-Za-z0-9_]+\s*[=:]\s*)["']?[^"',\s)}\]]+["']?/gi;

// Generic credential env var names (*_API_KEY, *_SECRET, *_TOKEN, *_PASSWORD)
// with strict negative lookarounds so we don't redact normal text that
// happens to contain "API_KEY=" mid-sentence.
const GENERIC_CREDENTIAL_ENV_PATTERN =
  /(?<![A-Za-z0-9_-])((?:[A-Za-z0-9_]*_)?(?:API[_-]?KEY|SECRET|TOKEN|PASSWORD)\s*[=:]\s*)["']?[^"',\n&]+["']?/gi;

// Header-style key-value: x-api-key, authorization, bearer, api_key, token,
// access_token, refresh_token, secret, password, cookie, set-cookie, id_token,
// private_key. This is the catch-all for "the secret sits next to a known
// field name in arbitrary text" — header dumps, log lines, error payloads.
const GENERIC_HEADER_FIELD_PATTERN =
  /(["']?(?:x-api-key|authorization|bearer|api[-_]?key|token|access[-_]?token|refresh[-_]?token|secret|password|cookie|set[-_]?cookie|id[-_]?token|exchanged[-_]?api[-_]?key|trusted[-_]?device[-_]?token|private[-_]?key)["']?\s*[:=]\s*["']?)(?:bearer\s+)?([^"',\n&]+)/gi;

// Substrings that flag a JSON field name as a credential container, used by
// `jsonRedactor`. Normalized keys (lowercased, dashes/underscores stripped)
// are checked against this list. `privatekey` is here so a JSON object
// like `{ "private_key": "..." }` (or `{ "privateKey": "..." }`) gets its
// value collapsed to `'[REDACTED]'` regardless of value shape — the
// header-field regex below handles the same key in inline key=value text.
const SENSITIVE_FIELD_SUBSTRINGS = [
  "token",
  "apikey",
  "secret",
  "password",
  "authorization",
  "cookie",
  "credential",
  "bearer",
  "privatekey",
] as const;

// Bare auth-style header keys that should be matched exactly (not as a
// substring) to avoid false positives like "author", "oauthProvider",
// "authenticationMode".
const AUTH_WHOLE_WORDS = new Set(["auth", "xauth"]);

/**
 * Build a regex matching a known credential env-var name on the left side of
 * an `=` or `:` assignment, e.g. `OPENAI_API_KEY=...` or `GITHUB_TOKEN: ...`.
 * Generated from `getKnownProviderSecretEnvKeys()` so a new provider added
 * to the descriptor registry is automatically covered.
 */
function buildKnownEnvVarPattern(): RegExp {
  const keys = getKnownProviderSecretEnvKeys();
  if (keys.length === 0) {
    // Should never happen in practice (FALLBACK_SECRET_ENV_KEYS is non-empty),
    // but returning a non-matching pattern keeps the call site branchless.
    return /(?!)/;
  }
  // Sort longest-first so OPENAI_API_KEY is tried before API_KEY would be.
  const sorted = [...keys].sort((a, b) => b.length - a.length);
  const escaped = sorted.map((k) => k.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"));
  return new RegExp(
    `(?<![A-Za-z0-9_])(${escaped.join("|")})(\\s*[=:]\\s*)["']?[^"'\\s)}\\]]+["']?`,
    "gi",
  );
}

let cachedEnvVarPattern: RegExp | null = null;
function getKnownEnvVarPattern(): RegExp {
  if (cachedEnvVarPattern === null) {
    cachedEnvVarPattern = buildKnownEnvVarPattern();
  }
  return cachedEnvVarPattern;
}

/**
 * Reset the cached env-var pattern. Test-only escape hatch; production code
 * should not need this.
 * @internal
 */
export function _resetRedactionCacheForTesting(): void {
  cachedEnvVarPattern = null;
}

/**
 * Redact known secret values from a free-form string.
 *
 * Applies a fixed sequence of regexes covering well-known credential
 * formats (Anthropic, OpenAI, AWS, GCP, GitHub) plus generic env-var and
 * header-field patterns. Safe to call inline on log lines or error
 * messages; cost is one pass per pattern.
 */
export function redactSensitiveInfo(text: string): string {
  let redacted = text;

  // Anthropic API keys (sk-ant...)
  redacted = redacted.replace(ANTHROPIC_KEY_PATTERN, "[REDACTED_API_KEY]");

  // OpenAI / Codex / OpenRouter API keys
  redacted = redacted.replace(OPENAI_KEY_PATTERN, "[REDACTED_OPENAI_KEY]");

  // AWS access keys (AKIA...) and labeled debug output ("AWS key: \"...\"")
  redacted = redacted.replace(AWS_ACCESS_KEY_PATTERN, "[REDACTED_AWS_KEY]");
  redacted = redacted.replace(
    AWS_KEY_LABELED_PATTERN,
    'AWS key: "[REDACTED_AWS_KEY]"',
  );

  // Google Cloud / Gemini API keys
  redacted = redacted.replace(GCP_KEY_PATTERN, "[REDACTED_GCP_KEY]");

  // Vertex AI service account emails
  redacted = redacted.replace(
    GCP_SERVICE_ACCOUNT_PATTERN,
    "[REDACTED_GCP_SERVICE_ACCOUNT]",
  );

  // GitHub tokens
  redacted = redacted.replace(GITHUB_TOKEN_PATTERN, "[REDACTED_GITHUB_TOKEN]");

  // x-api-key header values
  redacted = redacted.replace(X_API_KEY_PATTERN, "$1[REDACTED_API_KEY]");

  // Authorization: Bearer ... headers
  redacted = redacted.replace(AUTHORIZATION_PATTERN, "$1[REDACTED_TOKEN]");

  // AWS_*/GOOGLE_* env vars
  redacted = redacted.replace(PROVIDER_PREFIXED_ENV_PATTERN, "$1[REDACTED]");

  // Known provider env vars (from descriptor registry)
  redacted = redacted.replace(getKnownEnvVarPattern(), "$1$2[REDACTED]");

  // Generic *_API_KEY / *_SECRET / *_TOKEN / *_PASSWORD env vars
  redacted = redacted.replace(GENERIC_CREDENTIAL_ENV_PATTERN, "$1[REDACTED]");

  // PEM private keys — the generic header-field pattern below only captures
  // up to the first whitespace, so a value like
  // `private_key: -----BEGIN RSA PRIVATE KEY-----\n...` would redact only
  // the `-----BEGIN` prefix and leak the rest. This pass consumes the full
  // multi-line PEM block before the generic regex touches it.
  redacted = redacted.replace(
    /(["']?private[-_]?key["']?\s*[:=]\s*["']?)-{3,}BEGIN[\s\S]*?-{3,}END\s+(?:\w+\s+)?PRIVATE\s+KEY-{3,}/gi,
    "$1[REDACTED]",
  );

  // Catch-all: any of the standard credential field names with a value
  redacted = redacted.replace(
    GENERIC_HEADER_FIELD_PATTERN,
    (match, prefix: string, value: string) => {
      // If the value starts with `[REDACTED`, an earlier pass already handled
      // this field. Skip to preserve the specific label (e.g. `[REDACTED_TOKEN]`).
      if (/^\[REDACTED/.test(value)) return match;
      return `${prefix}[REDACTED]`;
    },
  );

  // Post-processing: absorb any trailing brackets, parens, or braces that may
  // remain after a value capture consumed part of a bracketed value. This is a
  // safety net for edge cases where a delimiter-based match ends before a
  // closing delimiter.
  redacted = redacted.replace(
    /\[REDACTED\](?:\[[^\]]*\]|[)\]}])+/g,
    "[REDACTED]",
  );

  return redacted;
}

/**
 * `JSON.stringify` replacer that redacts credential-shaped values.
 *
 * - If the key looks like a credential field (token, api_key, password,
 *   etc.), the value is replaced with `'[REDACTED]'` regardless of its
 *   type — preventing accidentally-unredacted objects from slipping
 *   through.
 * - Otherwise, string values are passed through `redactSensitiveInfo`
 *   so secrets embedded in free-form text are still caught.
 */
export function jsonRedactor(key: string, value: unknown): unknown {
  const normalizedKey = key.toLowerCase().replace(/[-_]/g, "");

  // Allow token usage fields through — they contain "token" but are not secrets
  const EXCLUDED_KEYS = [
    "inputtokens",
    "outputtokens",
    "cachereadinputtokens",
    "cachecreationinputtokens",
    "maxtokens",
    "tokensremaining",
    "tokencount",
    "totaltokens",
    "prompttokens",
    "completiontokens",
  ];
  if (EXCLUDED_KEYS.includes(normalizedKey)) {
    return value;
  }

  // Exact-match for auth-style keys to avoid false positives (e.g. "author").
  if (AUTH_WHOLE_WORDS.has(normalizedKey)) {
    return "[REDACTED]";
  }

  if (SENSITIVE_FIELD_SUBSTRINGS.some((s) => normalizedKey.includes(s))) {
    return "[REDACTED]";
  }

  if (typeof value === "string") {
    return redactSensitiveInfo(value);
  }

  return value;
}

// ---------------------------------------------------------------------------
//                             URL redaction
// ---------------------------------------------------------------------------

const SENSITIVE_URL_QUERY_PARAM_TOKENS = [
  "api_key",
  "apikey",
  "key",
  "token",
  "access_token",
  "refresh_token",
  "signature",
  "sig",
  "secret",
  "password",
  "passwd",
  "pwd",
  "auth",
  "authorization",
] as const;

/**
 * Single source of truth for "which query-param names look like
 * credentials". Used by `redactUrlForDisplay` and by external callers
 * (notably `openaiShim.redactUrlForDiagnostics`) that need the same
 * coverage as `redactUrlForDisplay` instead of forking a copy that
 * drifts.
 *
 * The same list also drives the malformed-URL fallback regex
 * `MALFORMED_URL_PARAM_PATTERN` below — both paths must agree on
 * which parameter names are sensitive. Any addition to this list
 * automatically extends the fallback coverage.
 */
export function shouldRedactUrlQueryParam(name: string): boolean {
  const lower = name.toLowerCase();
  return SENSITIVE_URL_QUERY_PARAM_TOKENS.some((token) =>
    lower.includes(token),
  );
}

/**
 * Per-query-param redaction for the malformed-URL fallback path.
 *
 * `shouldRedactUrlQueryParam` uses substring semantics: any param
 * whose name contains a sensitive token (e.g. `my_api_key`,
 * `x_access_token`) is matched. The function below iterates over the
 * URL's `?…&…` segment and substitutes each value, mirroring the
 * primary path's `parsed.searchParams.keys()` loop.
 *
 * Fragments are always dropped to prevent credential leaks, matching
 * the valid-URL path which sets `parsed.hash = ''`.
 */
function redactMalformedQuery(rawUrl: string): string {
  const hashIndex = rawUrl.indexOf("#");
  const noFragment = hashIndex === -1 ? rawUrl : rawUrl.slice(0, hashIndex);
  const queryStart = noFragment.indexOf("?");
  if (queryStart === -1) return noFragment;
  const prefix = noFragment.slice(0, queryStart + 1);
  const query = noFragment.slice(queryStart + 1);
  const redacted = query
    .split("&")
    .map((pair) => {
      const eqIndex = pair.indexOf("=");
      if (eqIndex === -1) return pair;
      const rawKey = pair.slice(0, eqIndex);
      let key: string;
      try {
        key = decodeURIComponent(rawKey);
      } catch {
        key = rawKey;
      }
      if (shouldRedactUrlQueryParam(key)) {
        return `${rawKey}=redacted`;
      }
      return pair;
    })
    .join("&");
  return `${prefix}${redacted}`;
}
export function redactUrlForDisplay(rawUrl: string): string {
  try {
    const parsed = new URL(rawUrl);
    if (parsed.username) {
      parsed.username = "redacted";
    }
    if (parsed.password) {
      parsed.password = "redacted";
    }

    for (const key of parsed.searchParams.keys()) {
      if (shouldRedactUrlQueryParam(key)) {
        parsed.searchParams.set(key, "redacted");
      }
    }

    parsed.hash = "";
    return parsed.toString();
  } catch {
    const userinfoRedacted = rawUrl.replace(
      /\/\/[^/@\s?#]+(?::[^/@\s?#]*)?@/g,
      "//redacted@",
    );
    return redactMalformedQuery(userinfoRedacted);
  }
}

// ---------------------------------------------------------------------------
//                             Status redaction
// ---------------------------------------------------------------------------

/**
 * Redact a URL for /status and other public-safe diagnostic surfaces.
 *
 * Wraps `redactUrlForDisplay` (which masks user/password and sensitive
 * query params) and additionally drops the fragment, which can carry tokens
 * or session IDs and is not useful when debugging proxy/TLS issues.
 *
 * Returned URLs are safe to paste in public issues or screenshots.
 */
export function redactUrlForStatus(rawUrl: string): string {
  if (!rawUrl) return rawUrl;

  const redacted = redactUrlForDisplay(rawUrl);

  // Drop the fragment. On the well-formed path (new URL succeeded) the
  // produced string contains at most one '#', which is the fragment
  // delimiter. On the malformed/regex-fallback path there is normally no
  // '#' (userinfo containing '#' broke URL parsing and the regex consumed
  // it); slicing at a stray '#' there would only shorten already-safe
  // output, never expose a secret.
  const hashIndex = redacted.indexOf("#");
  return hashIndex === -1 ? redacted : redacted.slice(0, hashIndex);
}

/**
 * Redact a filesystem path for /status and other public-safe diagnostic
 * surfaces. Replaces a leading $HOME segment with `~` so absolute paths
 * (e.g. mTLS cert/key, CA bundle) stay useful without leaking usernames
 * or home directory layout.
 */
export function redactPathForStatus(rawPath: string): string {
  if (!rawPath) return rawPath;

  const stripTrailingSep = (path: string) => path.replace(/[\\/]+$/, "");
  const isWindowsLike = (path: string) =>
    /^[a-zA-Z]:[\\/]/.test(path) || path.includes("\\");
  const normalizeForCompare = (path: string) =>
    isWindowsLike(path) ? path.toLowerCase() : path;
  const normalizedRawPath = stripTrailingSep(rawPath);
  const rawPathForCompare = normalizeForCompare(normalizedRawPath);

  // Cover POSIX (`HOME`), Windows (`USERPROFILE`), and containers where
  // neither is set (`os.homedir()` reads the OS passwd db). Check each
  // candidate; redact on the first prefix match. Filter out root-like
  // candidates so a misconfigured homedir never causes mass over-redaction.
  const candidates = [
    process.env.HOME,
    process.env.USERPROFILE,
    homedir(),
  ].filter((value): value is string =>
    Boolean(
      value && stripTrailingSep(value) && stripTrailingSep(value) !== "/",
    ),
  );

  for (const candidate of candidates) {
    const normalizedCandidate = stripTrailingSep(candidate);
    if (normalizeForCompare(normalizedCandidate) === rawPathForCompare) {
      return "~";
    }
    // Boundary check: the candidate must be followed by a path
    // separator (`/` or `\`) so `/home/alice` doesn't match
    // `/home/alice2/project`. The exact-length comparison above
    // already handles the equality case; this branch handles the
    // prefix case.
    const normalizedCandidateForCompare =
      normalizeForCompare(normalizedCandidate);
    if (
      rawPathForCompare.length > normalizedCandidateForCompare.length &&
      rawPathForCompare.startsWith(normalizedCandidateForCompare) &&
      (rawPathForCompare[normalizedCandidateForCompare.length] === "/" ||
        rawPathForCompare[normalizedCandidateForCompare.length] === "\\")
    ) {
      const suffix = normalizedRawPath.slice(normalizedCandidate.length);
      return `~${suffix}`;
    }
  }

  return rawPath;
}

// ---------------------------------------------------------------------------
//                          Diagnostic redaction
// ---------------------------------------------------------------------------

// Substrings that flag a JSON field name as a credential container, used by
// `redactDiagnosticObject`. Matches the union already defined above as
// `SENSITIVE_FIELD_SUBSTRINGS` — re-exported under the diagnostics alias
// for the existing test surface.
const DIAGNOSTIC_SECRET_KEY_PATTERN =
  /(?:api[_-]?key|auth(?:orization)?|bearer|cookie|credential|password|passwd|pwd|private[_-]?key|refresh[_-]?token|secret|token)/i;

type SecretValuePattern = {
  pattern: RegExp;
  replacement: string;
};

const LIKELY_SECRET_VALUE_PATTERNS = [
  { pattern: /\bsk-[A-Za-z0-9_-]{8,}\b/g, replacement: "[redacted]" },
  { pattern: /\bsk-ant-[A-Za-z0-9_-]{8,}\b/g, replacement: "[redacted]" },
  { pattern: /\bAIza[0-9A-Za-z_-]{10,}\b/g, replacement: "[redacted]" },
  {
    pattern: /\bBearer\s+[A-Za-z0-9._~+/=-]{8,}\b/gi,
    replacement: "[redacted]",
  },
  { pattern: /\bgithub_pat_[A-Za-z0-9_]{10,}\b/g, replacement: "[redacted]" },
  { pattern: /\bgh[pousr]_[A-Za-z0-9_]{10,}\b/g, replacement: "[redacted]" },
  {
    pattern:
      /\b((?:MISTRAL_API_KEY|mistral(?:\s+api)?\s+key)(?:\s*[:=]\s*|\s+)["']?)[A-Za-z0-9._~+/=-]{12,}(?=$|[\s"',;)\]}])/gi,
    replacement: "$1[redacted]",
  },
] satisfies SecretValuePattern[];

export type SecretEnvPresence = {
  name: string;
  present: boolean;
};

function unique<T extends string>(values: Iterable<T>): T[] {
  return [...new Set([...values].filter(Boolean))].sort((a, b) =>
    a.localeCompare(b),
  );
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

export function collectProviderSecretEnvVars(): string[] {
  return unique(getKnownProviderSecretEnvKeys());
}

export function summarizeSecretEnvPresence(
  env: NodeJS.ProcessEnv,
  envVars: readonly string[] = collectProviderSecretEnvVars(),
): SecretEnvPresence[] {
  return unique(envVars).map((name) => ({
    name,
    present: Boolean(env[name]?.trim()),
  }));
}

export function redactDiagnosticUrl(
  rawUrl: string | undefined,
): string | undefined {
  if (!rawUrl) return undefined;
  return redactUrlForDisplay(rawUrl).replace(/\/+$/, "");
}

export function redactHomePath(value: string, homeDir = homedir()): string {
  if (!value || !homeDir) return value;
  const normalizedHome = homeDir.replace(/[/\\]+$/, "");
  if (!normalizedHome) return value;
  return value.replace(
    new RegExp(`${escapeRegExp(normalizedHome)}(?=$|[/\\\\])`, "gi"),
    "~",
  );
}

export function redactLikelySecrets(value: string): string {
  // Run redactSensitiveInfo first for comprehensive coverage of all
  // well-known credential patterns (AKIA keys, x-api-key, Authorization,
  // PEM private keys, generic *_API_KEY env vars, etc.), then apply
  // LIKELY_SECRET_VALUE_PATTERNS as a catch-all for patterns that
  // redactSensitiveInfo doesn't cover (e.g. bare Bearer tokens in
  // free-form text, Mistral-specific key patterns).
  const firstPass = redactSensitiveInfo(value);
  return LIKELY_SECRET_VALUE_PATTERNS.reduce(
    (current, { pattern, replacement }) =>
      current.replace(pattern, replacement),
    firstPass,
  );
}

function isDiagnosticSecretKey(key: string): boolean {
  return DIAGNOSTIC_SECRET_KEY_PATTERN.test(key);
}

function isEnvPresenceKey(key: string): boolean {
  return (
    /^[A-Z0-9_]+$/.test(key) &&
    /(?:API_KEY|TOKEN|SECRET|PASSWORD|AUTH)/.test(key)
  );
}

export function redactDiagnosticObject(value: unknown): unknown {
  return redactDiagnosticObjectInternal(value);
}

function redactDiagnosticObjectInternal(value: unknown, key?: string): unknown {
  if (value === null || value === undefined) return value;

  if (typeof value === "string") {
    if (key && isDiagnosticSecretKey(key)) {
      return isEnvPresenceKey(key) ? "[set]" : "[redacted]";
    }
    return redactLikelySecrets(redactHomePath(value));
  }

  if (
    typeof value === "number" ||
    typeof value === "boolean" ||
    typeof value === "bigint"
  ) {
    return value;
  }

  if (Array.isArray(value)) {
    return value.map((item) => redactDiagnosticObjectInternal(item));
  }

  if (typeof value === "object") {
    const output: Record<string, unknown> = {};
    for (const [entryKey, entryValue] of Object.entries(value)) {
      output[entryKey] = redactDiagnosticObjectInternal(entryValue, entryKey);
    }
    return output;
  }

  return String(value);
}

/**
 * Redact a raw JSONL transcript string by parsing each line as JSON,
 * applying {@link jsonRedactor} as the `JSON.stringify` replacer, and
 * reassembling.  Lines that fail to parse are returned as-is so that
 * malformed entries are not lost entirely.
 */
export function redactJsonLines(raw: string): string {
  return raw
    .split("\n")
    .map((line) => {
      const trimmed = line.trim();
      if (!trimmed) return line;
      try {
        return JSON.stringify(JSON.parse(trimmed), jsonRedactor);
      } catch {
        return redactSensitiveInfo(line);
      }
    })
    .join("\n");
}
