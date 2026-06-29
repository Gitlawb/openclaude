import { describe, expect, test } from 'bun:test'

import { redactUrlForDisplay, shouldRedactUrlQueryParam } from './redaction.js'

describe('redactUrlForDisplay', () => {
  test('redacts credentials and sensitive query params for valid URLs', () => {
    const redacted = redactUrlForDisplay(
      'http://user:pass@localhost:11434/v1?api_key=secret&foo=bar',
    )

    expect(redacted).toBe(
      'http://redacted:redacted@localhost:11434/v1?api_key=redacted&foo=bar',
    )
  })

  test('redacts token-like query parameter names', () => {
    const redacted = redactUrlForDisplay(
      'https://example.com/v1?x_access_token=abc123&model=qwen2.5-coder',
    )

    expect(redacted).toBe(
      'https://example.com/v1?x_access_token=redacted&model=qwen2.5-coder',
    )
  })

  test('drops fragments before displaying URLs', () => {
    const redacted = redactUrlForDisplay(
      'https://example.com/v1?api_key=secret#access_token=fragment-secret',
    )

    expect(redacted).toBe('https://example.com/v1?api_key=redacted')
  })

  // Regression: a query-looking `?token=SECRET` fragment must not leak
  // the credential. `parsed.hash = ""` drops the full fragment, so the
  // entire `#debug?token=SECRET` suffix is removed.
  test('drops fragment containing a query-like credential', () => {
    expect(
      redactUrlForDisplay('https://api.example.com/v1#debug?token=SECRET'),
    ).toBe('https://api.example.com/v1')
  })

  test('falls back to regex redaction for malformed URLs', () => {
    const redacted = redactUrlForDisplay(
      '//user:pass@localhost:11434?token=abc&mode=test',
    )

    expect(redacted).toBe('//redacted@localhost:11434?token=redacted&mode=test')
  })

  test('fallback redaction drops fragments for malformed URLs', () => {
    const redacted = redactUrlForDisplay(
      '//user:pass@localhost:11434?token=abc#access_token=fragment-secret',
    )

    expect(redacted).toBe('//redacted@localhost:11434?token=redacted')
  })

  test('keeps non-sensitive URLs unchanged', () => {
    const url = 'http://localhost:11434/v1?model=llama3.1:8b'
    expect(redactUrlForDisplay(url)).toBe(url)
  })

  // Regression: the openaiShim copy of this list dropped these four names,
  // so `?passwd=…`, `?pwd=…`, `?auth=…`, `?apikey=…` (the no-underscore
  // form) were leaking into self-heal/error diagnostic logs (#1069). Pin
  // them here so any future fork of the list trips the test instead of
  // silently regressing.
  test('redacts passwd / pwd / auth / apikey variants', () => {
    expect(
      redactUrlForDisplay('https://api.example.com/v1?passwd=hunter2'),
    ).toBe('https://api.example.com/v1?passwd=redacted')
    expect(
      redactUrlForDisplay('https://api.example.com/v1?pwd=hunter2'),
    ).toBe('https://api.example.com/v1?pwd=redacted')
    expect(
      redactUrlForDisplay('https://api.example.com/v1?auth=Bearer-XYZ'),
    ).toBe('https://api.example.com/v1?auth=redacted')
    expect(
      redactUrlForDisplay('https://api.example.com/v1?apikey=sk-abc'),
    ).toBe('https://api.example.com/v1?apikey=redacted')
  })

  // Regression: the malformed-URL fallback regex must cover the same
  // credential parameter set as the primary `URL` parser path. The two
  // paths were previously maintained as separate string lists — any
  // drift (e.g. forgetting `signature` / `sig` in the fallback) leaked
  // through the malformed path. Both lists are now derived from
  // `SENSITIVE_URL_QUERY_PARAM_TOKENS` so the set can never diverge.
  test('malformed URL fallback redacts the full credential parameter set', () => {
    // Trigger the catch branch with `//host` form (no scheme).
    const malformed = `//user:pass@localhost:11434?api_key=secret&access_token=abc&refresh_token=def&signature=sig1&sig=sig2&secret=s3&password=p4&apikey=k5&model=m6`
    const redacted = redactUrlForDisplay(malformed)
    expect(redacted).toBe(
      '//redacted@localhost:11434?api_key=redacted&access_token=redacted&refresh_token=redacted&signature=redacted&sig=redacted&secret=redacted&password=redacted&apikey=redacted&model=m6',
    )
    // Non-sensitive param survives.
    expect(redacted).toContain('model=m6')
  })

  test('malformed URL fallback redacts userinfo in the same pass', () => {
    // Bare relative URL — exercises the userinfo regex AND the
    // parameter regex in sequence against a single malformed input.
    const malformed = '//alice:hunter2@api.example.com/v1?token=abc'
    expect(redactUrlForDisplay(malformed)).toBe(
      '//redacted@api.example.com/v1?token=redacted',
    )
  })

  // Regression: the fallback path must use the same substring predicate
  // as `shouldRedactUrlQueryParam`. The previous hand-rolled regex only
  // matched exact parameter names (`api_key=`, `access_token=`), so
  // `my_api_key` and `x_access_token` slipped through unchanged even
  // though `shouldRedactUrlQueryParam` flags them as sensitive. The new
  // path iterates pairs and runs the same predicate on each key.
  test('malformed URL fallback redacts prefixed credential params', () => {
    const malformed = '//host/path?my_api_key=SECRET&x_access_token=TOKEN'
    const redacted = redactUrlForDisplay(malformed)
    expect(redacted).toContain('my_api_key=redacted')
    expect(redacted).toContain('x_access_token=redacted')
    expect(redacted).not.toContain('SECRET')
    expect(redacted).not.toContain('TOKEN')
  })

  test('malformed URL fallback leaves non-sensitive params unchanged', () => {
    const malformed = '//host/path?model=llama3.1&temperature=0.7'
    const redacted = redactUrlForDisplay(malformed)
    expect(redacted).toContain('model=llama3.1')
    expect(redacted).toContain('temperature=0.7')
  })

  test('malformed URL fallback drops fragment after redacted query', () => {
    const malformed = '//host/path?my_token=SECRET#section'
    const redacted = redactUrlForDisplay(malformed)
    expect(redacted).toBe('//host/path?my_token=redacted')
  })

  // Regression: the malformed-URL fallback must drop fragments even
  // when there is no query string, matching the valid-URL path.
  test('malformed URL fallback drops fragment-only credential', () => {
    const redacted = redactUrlForDisplay(
      '//host/path#access_token=SECRET',
    )
    expect(redacted).toBe('//host/path')
  })

  // Regression: the malformed-URL fallback must decode percent-encoded
  // param names before running the sensitive-name predicate, otherwise
  // encoded variants like %74oken (= 'token') slip through.
  test('malformed URL fallback redacts encoded sensitive query param names', () => {
    const malformed = '//host/path?%74oken=SECRET'
    const redacted = redactUrlForDisplay(malformed)
    expect(redacted).toContain('%74oken=redacted')
    expect(redacted).not.toContain('SECRET')
  })

  // Regression: the userinfo regex must stop at query (?) and fragment (#)
  // delimiters. Without this boundary, a malformed URL like
  // //host?email=user@example.com&token=SECRET would have the regex
  // greedily match //host?email=user@ (through the query) and replace it
  // with //redacted@, destroying query params.
  test('malformed URL fallback userinfo regex respects query delimiter', () => {
    const malformed =
      '//api.example.com?email=user@example.com&token=SECRET'
    const redacted = redactUrlForDisplay(malformed)
    // Userinfo regex must not eat the query string looking for an @ sign.
    expect(redacted).toBe(
      '//api.example.com?email=user@example.com&token=redacted',
    )
  })

  test('malformed URL fallback userinfo regex respects fragment delimiter', () => {
    const malformed =
      '//api.example.com#frag@illegal'
    const redacted = redactUrlForDisplay(malformed)
    // No userinfo before the fragment delimiter should be consumed.
    // Fragment is dropped to match the valid-URL path.
    expect(redacted).toBe('//api.example.com')
  })

  test('malformed URL fallback userinfo regex respects fragment delimiter with port', () => {
    // Same as above but with :port before # — the loose regex would
    // greedily consume :443#frag@ as password and @illegal as host.
    const malformed =
      '//api.example.com:443#frag@illegal'
    const redacted = redactUrlForDisplay(malformed)
    expect(redacted).toBe('//api.example.com:443')
  })

  // Regression: bare-host URL with # in password must not be misclassified
  // as fragment content.  hostEnd !== -1 (a / or ? follows @) is the signal.
  test('malformed URL fallback redacts #-in-password userinfo on bare host', () => {
    const malformed =
      '//alice:sec#ret@host/path?token=SECRET'
    const redacted = redactUrlForDisplay(malformed)
    expect(redacted).toBe('//redacted@host/path?token=redacted')
  })

  // Regression: username-only userinfo with # must still be redacted.
  // It lacks typical payload signals (like =) in the fragment side.
  test('malformed URL fallback redacts username-only userinfo with #', () => {
    const malformed = '//alice#part@example.com/path'
    const redacted = redactUrlForDisplay(malformed)
    expect(redacted).toBe('//redacted@example.com/path')
  })

  // Regression: bare hosts shouldn't be mistakenly matched as userinfo.
  // A fragment that happens to contain userinfo (e.g. an access token)
  // should be completely stripped rather than applied across fragments.
  test('malformed URL fallback redacts fragment completely when bare host is valid', () => {
    const malformed = '//host#access_token=SECRET@example.com/path'
    const redacted = redactUrlForDisplay(malformed)
    expect(redacted).toBe('//host')
  })

  // Regression: the valid-URL path must pre-redact semicolon-delimited
  // sensitive query params from the raw query before URLSearchParams
  // percent-encodes `;` as `%3B`, leaving them invisible to the
  // post-process pass.  Previously `model=ok;token=SECRET` leaked the
  // token value because parsed.toString() reserialized it as
  // `model=ok%3Btoken%3DSECRET` before redactSemicolonQueryParams ran.
  test('redacts semicolon-delimited token alongside &-delimited api_key', () => {
    expect(
      redactUrlForDisplay(
        'https://api.example.com/v1?model=ok;token=SECRET&api_key=KEY',
      ),
    ).toBe(
      'https://api.example.com/v1?model=ok;token=redacted&api_key=redacted',
    )
  })

  test('redacts semicolon-delimited token without &-delimited params', () => {
    expect(
      redactUrlForDisplay('https://api.example.com/v1?mode=ok;token=SECRET'),
    ).toBe('https://api.example.com/v1?mode=ok;token=redacted')
  })

  test('redacts semicolon-delimited api_key in mixed-separator query', () => {
    expect(
      redactUrlForDisplay(
        'https://api.example.com/v1?mode=ok;api_key=KEY&model=llama',
      ),
    ).toBe('https://api.example.com/v1?mode=ok;api_key=redacted&model=llama')
  })
})

describe('shouldRedactUrlQueryParam', () => {
  test('catches the canonical credential param names', () => {
    for (const name of [
      'api_key',
      'apikey',
      'api-key',
      'key',
      'token',
      'access_token',
      'access-token',
      'refresh_token',
      'signature',
      'sig',
      'secret',
      'password',
      'passwd',
      'pwd',
      'auth',
      'authorization',
    ]) {
      expect(shouldRedactUrlQueryParam(name)).toBe(true)
    }
  })

  test('does not flag unrelated param names', () => {
    for (const name of ['model', 'temperature', 'foo', 'session_id', 'user_id']) {
      expect(shouldRedactUrlQueryParam(name)).toBe(false)
    }
  })
})
