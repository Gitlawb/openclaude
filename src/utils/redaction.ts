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
const X_API_KEY_PATTERN = /(["']?x-api-key["']?\s*[:=]\s*["']?)[^"',\n&#;]+/gi;

// Authorization header / Bearer token redaction
const AUTHORIZATION_PATTERN =
  /(["']?authorization["']?\s*[:=]\s*["']?(?:bearer\s+)?)[^"',\n&#;]+/gi;

// Bare Bearer token (without preceding key name)
const BARE_BEARER_PATTERN =
  /(?<![A-Za-z0-9_-])Bearer\s+[A-Za-z0-9._~+/=-]{8,}(?![A-Za-z0-9_-])/gi;

// JWT tokens (three base64url segments, 8+ chars each)
const JWT_TOKEN_PATTERN =
  /(?<![A-Za-z0-9_-])[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}(?![A-Za-z0-9_-])/g;

// AWS_* / GOOGLE_* / provider-prefixed env var redaction
const PROVIDER_PREFIXED_ENV_PATTERN =
  /((?:AWS|GOOGLE)[_-][A-Za-z0-9_]+\s*[=:]\s*)["']?[^"',\s)}\]&#;]+["']?/gi;

// Generic credential env var names (*_API_KEY, *_SECRET, *_TOKEN, *_PASSWORD)
// with strict negative lookarounds so we don't redact normal text that
// happens to contain "API_KEY=" mid-sentence.
const GENERIC_CREDENTIAL_ENV_PATTERN =
  /(?<![A-Za-z0-9_-])((?:[A-Za-z0-9_]*_)?(?:API[_-]?KEY|SECRET|TOKEN|PASSWORD)\s*[=:]\s*)["']?[^"',\n&#;]+["']?/gi;

// Header-style key-value: x-api-key, authorization, bearer, api_key, token,
// access_token, refresh_token, secret, password, cookie, set-cookie, id_token,
// private_key. This is the catch-all for "the secret sits next to a known
// field name in arbitrary text" — header dumps, log lines, error payloads.
const GENERIC_HEADER_FIELD_PATTERN =
  /(["']?(?:x-api-key|x[-_]?auth|authorization|auth|bearer|api[-_]?key|token|access[-_]?token|refresh[-_]?token|secret|password|cookie|set[-_]?cookie|id[-_]?token|exchanged[-_]?api[-_]?key|trusted[-_]?device[-_]?token|private[-_]?key)["']?\s*[:=]\s*["']?)(?:bearer\s+)?([^"',\n&#;]+)/gi;

// Cookie/Set-Cookie header values — scoped to header-shaped text only (not URL
// query params) via negative lookbehind on ? or &. Uses a permissive value
// character class that allows `;` and `,` so semicolon-delimited attributes
// (e.g. `sessionKey=abc123; Path=/; Secure`) and comma-joined multi-cookie
// values (e.g. `sid=one, refresh=two`) are fully redacted. This runs first in
// redactSensitiveInfo so the generic pattern below (which stops at `;`) never
// sees partial cookie values.
const COOKIE_PATTERN =
  /(?<![?&;])(["']?(?:set[-_]?cookie|(?<!set[-_])cookie)["']?\s*[:=]\s*["']?)[^"'\n&]+/gi;

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
    `(?<![A-Za-z0-9_])(${escaped.join("|")})(\\s*[=:]\\s*)["']?[^"'\\s)\\}&#;\\]]+["']?`,
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

  // Bare Bearer token (no preceding key name) — runs before env-var patterns
  // so OPENAI_AUTH_HEADER_VALUE=Bearer secret-value is caught by the Bearer
  // pattern (the env-var regex stops at the first space in multi-word values).
  redacted = redacted.replace(BARE_BEARER_PATTERN, "[REDACTED_TOKEN]");

  // Bare JWT token (three base64url segments)
  redacted = redacted.replace(JWT_TOKEN_PATTERN, "[REDACTED_TOKEN]");

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

  // Cookie/Set-Cookie header values — permissive `;`-allowing pass runs
  // before GENERIC_HEADER_FIELD_PATTERN (which stops at `;`) so
  // semicolon-delimited cookie attributes are fully redacted.
  redacted = redacted.replace(COOKIE_PATTERN, "$1[REDACTED]");

  // Catch-all: any of the standard credential field names with a value
  redacted = redacted.replace(
    GENERIC_HEADER_FIELD_PATTERN,
    (match, prefix: string, value: string) => {
      // Only bypass if the value is EXACTLY the canonical placeholder
      // "[REDACTED]" produced by this generic pattern. Reject any other
      // variation like "[REDACTED_API_KEY]" or "[REDACTED_actual_secret]"
      // which may carry a real secret suffix.
      if (value === "[REDACTED]") return match;
      return `${prefix}[REDACTED]`;
    },
  );

  // URLs embedded in free-form text or serialized objects
  redacted = redacted.replace(
    /\/\/[^/@\s?#]+(?::[^/@\s?]*)?@/g,
    "//redacted@",
  );

  // Post-processing: absorb any trailing brackets, parens, or braces that may
  // remain after a value capture consumed part of a bracketed value. This is a
  // safety net for edge cases where a delimiter-based match ends before a
  // closing delimiter.
  redacted = redacted.replace(
    /\[REDACTED\](?:\[[^\]]*\]|[)\]}])+/g,
    "[REDACTED]",
  );

  // Redact sensitive query params in `https?://` and protocol-relative `//`
  // URLs embedded in free-form text, log lines, and error messages. This
  // catches query params like `signature=SECRET123` that the generic key-value
  // patterns don't cover, even when another param was already redacted by a
  // generic pattern (e.g. `api_key=XXX` matched by GENERIC_HEADER_FIELD_PATTERN).
  redacted = redacted.replace(
    /(?:https?:)?\/\/[^\s"',)}>]+/gi,
    (url) => redactUrlForDisplay(url),
  );

  // Post-processing: absorb any `&<text>` or `;<text>` segments that trail a
  // redacted placeholder. These appear only in non-URL contexts (URL redaction
  // above converts `[REDACTED]` → `redacted` before this pass runs), so safe
  // URL query params like `&mode=test` are preserved and non-URL value
  // continuations like `DATABASE_PASSWORD=correct&horse=battery` are collapsed.
  redacted = redacted.replace(
    /(\[REDACTED(?:_[A-Z_]+)?\])([&;][^\s"'&;]+)*/g,
    "$1",
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

  // Allow token usage fields through — they contain "token" but are not
  // secrets. Non-numeric values under these keys could be credential
  // containers (e.g. tokens: ["opaque-secret"]) so only numbers pass through;
  // string/array/object values are collapsed to "[REDACTED]".
  const EXCLUDED_KEYS = [
    "inputtokens",
    "outputtokens",
    "tokens",
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
    if (typeof value === "number") return value;
    return "[REDACTED]";
  }

  // Exact-match for auth-style keys to avoid false positives (e.g. "author").
  if (AUTH_WHOLE_WORDS.has(normalizedKey)) {
    return "[REDACTED]";
  }

  if (SENSITIVE_FIELD_SUBSTRINGS.some((s) => normalizedKey.includes(s))) {
    return "[REDACTED]";
  }

  if (typeof value === "string") {
    // Route URL-shaped strings through the URL redaction helper first so
    // signed-URL query params (signature, sig, etc.) that redactSensitiveInfo
    // doesn't cover are still masked. Covers both https:// and protocol-relative
    // //host URLs. Non-URL strings pass through unchanged to avoid the fallback
    // path in redactUrlForDisplay treating # as a fragment delimiter on ordinary
    // text.
    const urlRedacted = /^(?:https?:)?\/\//i.test(value)
      ? redactUrlForDisplay(value)
      : value;
    return redactSensitiveInfo(urlRedacted);
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
  "cookie",
  "set-cookie",
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
  const redacted = redactSensitiveQuerySegments(query);
  return prefix + redacted;
}

/**
 * Post-process a URL string to redact sensitive query parameters that
 * were delimited by `;` instead of `&`.  `URLSearchParams` doesn't split
 * on `;` (it treats the entire span between two `&` as one key-value
 * pair), so keys like `token` or `api_key` inside `;`-delimited segments
 * are invisible to the standard `parsed.searchParams` loop.
 *
 * This function is applied as a final pass on both the valid-URL and
 * fallback paths so that the behavior is consistent regardless of how
 * the URL was originally parsed.
 */
function redactSensitiveQuerySegments(query: string): string {
  return query.replace(
    /(^|[&;])([^&=;]+)(?:=([^&;]*))?/g,
    (match, delim, rawKey) => {
      let key: string;
      try {
        key = decodeURIComponent(rawKey);
      } catch {
        key = rawKey;
      }
      if (shouldRedactUrlQueryParam(key)) {
        return `${delim}${rawKey}=redacted`;
      }
      return match;
    },
  );
}

function redactSemicolonQueryParams(urlStr: string): string {
  if (!urlStr.includes(";")) return urlStr;
  const qs = urlStr.indexOf("?");
  if (qs === -1) return urlStr;
  const prefix = urlStr.slice(0, qs + 1);
  const hashIdx = urlStr.indexOf("#", qs);
  const queryEnd = hashIdx === -1 ? urlStr.length : hashIdx;
  const query = urlStr.slice(qs + 1, queryEnd);
  const suffix = hashIdx === -1 ? "" : urlStr.slice(hashIdx);

  const cleaned = redactSensitiveQuerySegments(query);
  if (cleaned === query) return urlStr;
  return prefix + cleaned + suffix;
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

    // Pre-redact semicolon-delimited sensitive query params from the raw
    // query string. URLSearchParams percent-encodes `;` as `%3B`, so the
    // post-process pass (redactSemicolonQueryParams) cannot find
    // `;token=SECRET` after parsed.toString() reserializes the URL.
    // Only consider `?` that appears before any `#` — a `?` inside a
    // fragment is not a query separator.
    const hashIdx = rawUrl.indexOf("#");
    const qsStart = rawUrl.indexOf("?");
    if (qsStart !== -1 && (hashIdx === -1 || qsStart < hashIdx)) {
      const rawQuery =
        hashIdx === -1
          ? rawUrl.slice(qsStart + 1)
          : rawUrl.slice(qsStart + 1, hashIdx);
      parsed.search = redactSensitiveQuerySegments(rawQuery);
    }

    parsed.hash = "";
    return parsed.toString();
  } catch {
    const hashIdx = rawUrl.indexOf("#");
    let userinfoRedacted: string;

    if (hashIdx !== -1) {
      const afterHash = rawUrl.slice(hashIdx + 1);
      const atInFragment = afterHash.indexOf("@");

      if (atInFragment !== -1) {
        const afterAt = afterHash.slice(atInFragment + 1);
        const hostEnd = afterAt.search(/[/?#]/);
        const hostCandidate = hostEnd === -1 ? afterAt : afterAt.slice(0, hostEnd);
        const hostname = hostCandidate.split(":")[0];

        // If the part before # already contains a valid host (with dot,
        // localhost, IPv6, or port), then # is a fragment delimiter and
        // any @ after it is fragment content, not userinfo.
        const beforeHash = rawUrl.slice(0, hashIdx);
        const hostPart = beforeHash.startsWith("//") ? beforeHash.slice(2) : beforeHash;
        const fragmentBeforeAt = afterHash.slice(0, atInFragment);
        const hasValidHostBeforeHash =
          hostPart.includes(".") ||
          hostPart === "localhost" ||
          /^\[/.test(hostPart) ||
          /:[0-9]+$/.test(hostPart) ||
          (!hostPart.includes(":") &&
            hostPart.length > 0 &&
            /[=/?&]/.test(fragmentBeforeAt));

        if (
          !hasValidHostBeforeHash &&
          (hostname.includes(".") ||
            hostname === "localhost" ||
            /^\[/.test(hostname) ||
            hostEnd !== -1 ||
            // Bare hostname (no dot, no path) — e.g. "host" or "host:443"
            // Only apply if there's no valid host before the #
            /^[a-zA-Z0-9.-]+(:[0-9]+)?$/.test(hostCandidate))
        ) {
          // @ after # followed by hostname-like → # is in password or username
          userinfoRedacted = rawUrl.replace(
            /\/\/[^/@\s?]+@/g,
            "//redacted@",
          );
        } else {
          // @ is fragment content → strip fragment first
          const noFragment = rawUrl.slice(0, hashIdx);
          userinfoRedacted = noFragment.replace(
            /\/\/[^/@\s?#]+(?::[^/@\s?#]*)?@/g,
            "//redacted@",
          );
        }
      } else {
        const noFragment = rawUrl.slice(0, hashIdx);
        userinfoRedacted = noFragment.replace(
          /\/\/[^/@\s?#]+(?::[^/@\s?#]*)?@/g,
          "//redacted@",
        );
      }
    } else {
      userinfoRedacted = rawUrl.replace(
        /\/\/[^/@\s?#]+(?::[^/@\s?#]*)?@/g,
        "//redacted@",
      );
    }

    return redactSemicolonQueryParams(redactMalformedQuery(userinfoRedacted));
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
  /(?:api[_-]?key|auth(?:orization)?|bearer|cookie|password|passwd|pwd|private[_-]?key|refresh[_-]?token|secret|token)/i;

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
  const rendered = redactUrlForDisplay(rawUrl);

  // Use the URL parser on the already-redacted output to locate the precise
  // authority boundary. Both mutations are scoped exactly:
  //
  //   1. Userinfo strip — only the `scheme://[userinfo@]host:port` prefix.
  //      Path content (including any literal `//redacted@` in a proxy route)
  //      is never touched.
  //
  //   2. Trailing-slash trim — only when pathname === "/" (the bare root
  //      slash URL serialization appends when there is no real path).
  //      Meaningful paths like `/v1/` or `//proxy` are preserved as-is.
  try {
    const parsed = new URL(rendered);
    let result = rendered;

    // 1. Strip userinfo: find the `@` that belongs to the authority by
    //    searching backwards from just before the pathname starts. This
    //    avoids matching `@` characters that appear in path segments.
    if (parsed.username || parsed.password) {
      const schemeLen = parsed.protocol.length + 2; // "https://".length
      const pathStart = result.indexOf(parsed.pathname, schemeLen);
      if (pathStart !== -1) {
        const atIdx = result.lastIndexOf("@", pathStart - 1);
        if (atIdx >= schemeLen) {
          result = result.slice(0, schemeLen) + result.slice(atIdx + 1);
        }
      }
    }

    // 2. Trim the bare root slash only when pathname is exactly "/".
    //    Re-parse after the userinfo strip to get an accurate pathStart.
    if (parsed.pathname === "/") {
      const schemeLen = parsed.protocol.length + 2;
      const reparsed = new URL(result);
      const pathIdx = result.indexOf(reparsed.pathname, schemeLen);
      if (pathIdx !== -1) {
        const nextChar = result[pathIdx + 1];
        if (nextChar === undefined || nextChar === "?" || nextChar === "#") {
          result = result.slice(0, pathIdx) + result.slice(pathIdx + 1);
        }
      }
    }

    return result;
  } catch {
    // Fallback for protocol-relative and other URLs the parser rejects.
    // Scope the userinfo strip to the first `//…@host` segment only.
    const schemeEnd = rendered.indexOf("//");
    if (schemeEnd === -1) return rendered;
    const afterSlashes = rendered.slice(schemeEnd + 2);
    const slashAfterHost = afterSlashes.search(/[/?#]/);
    const hostPart =
      slashAfterHost === -1 ? afterSlashes : afterSlashes.slice(0, slashAfterHost);
    const atInHost = hostPart.indexOf("@");
    let result =
      atInHost === -1
        ? rendered
        : rendered.slice(0, schemeEnd + 2) + afterSlashes.slice(atInHost + 1);
    // Trim bare root slash for `//host/` form (no real path).
    result = result.replace(/(\/\/[^/]+)\/+$/, "$1");
    return result;
  }
}

export function redactHomePath(value: string, homeDir = homedir()): string {
  if (!value || !homeDir) return value;
  const normalizedHome = homeDir.replace(/[/\\]+$/, "");
  if (!normalizedHome) return value;
  const isWindowsLike =
    /^[a-zA-Z]:[\\/]/.test(value) || value.includes("\\");
  const flags = isWindowsLike ? "gi" : "g";
  return value.replace(
    new RegExp(`${escapeRegExp(normalizedHome)}(?=$|[/\\\\])`, flags),
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

  // If the parent key is a credential-sensitive name, mask the entire value
  // regardless of its type — an object under { auth: { ... } } would
  // otherwise descend and leak the inner keys. Objects under non-sensitive
  // keys (e.g. "credential" metadata in issue reports) are recursed into.
  // Preserve absent/falsey values: null and undefined are already returned
  // above; false, 0, and "" indicate the value is unset and should not be
  // misrepresented as "[set]" or "[redacted]".
  if (key && isDiagnosticSecretKey(key)) {
    if (value === false || value === "" || value === 0) return value;
    return isEnvPresenceKey(key) ? "[set]" : "[redacted]";
  }

  if (typeof value === "string") {
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
 * Try to extract the first complete JSON object from a string that may
 * contain trailing garbage after a valid JSON value.  Returns the parsed
 * object and the remaining text on success, or null on failure.
 *
 * Handles nested braces, escaped quotes inside string values, and unicode
 * escapes in keys/values (which `JSON.parse` resolves natively).
 */
function tryParseFirstJsonObject(text: string): { before: string; parsed: unknown; rest: string } | null {
  const start = text.indexOf("{");
  if (start === -1) return null;

  let depth = 0;
  let inString = false;
  let escaped = false;

  for (let i = start; i < text.length; i++) {
    const ch = text[i];

    if (escaped) {
      escaped = false;
      continue;
    }

    if (ch === "\\" && inString) {
      escaped = true;
      continue;
    }

    if (ch === '"') {
      inString = !inString;
      continue;
    }

    if (!inString) {
      if (ch === "{") {
        depth++;
      } else if (ch === "}") {
        depth--;
        if (depth === 0) {
          const jsonStr = text.slice(start, i + 1);
          try {
            return { before: text.slice(0, start), parsed: JSON.parse(jsonStr), rest: text.slice(i + 1) };
          } catch {
            return null;
          }
        }
      }
    }
  }

  return null;
}

/**
 * Redact a raw JSONL transcript string by parsing each line as JSON,
 * applying {@link jsonRedactor} as the `JSON.stringify` replacer, and
 * reassembling.  Lines that fail to parse are handled by extracting the
 * first valid JSON object, redacting it key-awarably, and preserving any
 * trailing garbage so that key-based secrets in malformed lines (e.g.
 * `{"auth":"plain-secret"} broken`) are still caught.
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
        const extracted = tryParseFirstJsonObject(line);
        if (extracted) {
          const redacted = JSON.stringify(extracted.parsed, jsonRedactor);
          // Preserve any non-JSON prefix (e.g. log level labels) and
          // trailing garbage — both are redacted before concatenation.
          if (extracted.before || extracted.rest) {
            return (
              redactSensitiveInfo(extracted.before) +
              redacted +
              redactSensitiveInfo(extracted.rest)
            );
          }
          return redacted;
        }
        return redactSensitiveInfo(line);
      }
    })
    .join("\n");
}
