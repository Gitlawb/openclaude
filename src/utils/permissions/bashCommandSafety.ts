/**
 * Pattern-based safety classifier for Bash commands.
 *
 * Complements the existing tool-level allowlist (classifierDecision.ts —
 * which bypasses permission checks for inherently-safe tools like Read,
 * Glob, Grep) by classifying actual `bash` command strings. Returns one
 * of three verdicts:
 *
 *   - 'safe'    — obviously read-only / idempotent / no external effect;
 *                 callers may auto-approve without prompting.
 *   - 'unsafe'  — matches a known-destructive or network-sensitive pattern;
 *                 callers should never auto-approve; always prompt or deny.
 *   - 'unknown' — neither list matched; defer to the existing allow/deny
 *                 rule system (no opinion).
 *
 * Design:
 *   - Pure pattern matching: no LLM call, no latency, no hallucination.
 *   - Bias toward false-negatives ('unknown') over false-positives ('safe').
 *     It's better to prompt once too often than to auto-approve `rm -rf`.
 *   - Compound commands (&&, ||, ;, |, subshells) are split and classified
 *     individually. The overall verdict is the *worst* case:
 *         any 'unsafe' → 'unsafe'
 *         any 'unknown' (with no 'unsafe') → 'unknown'
 *         all 'safe' → 'safe'
 *   - Any I/O redirection to a real file (>, >>, tee -a FILE) degrades to
 *     'unknown' since it mutates state outside the current process.
 *
 * This module intentionally does NOT read env, check cwd, or consult the
 * permission rules system — it returns a verdict that those systems can
 * consume. Keeping it pure makes it trivial to test and reason about.
 */

export type CommandSafety = 'safe' | 'unsafe' | 'unknown'

export type SafetyVerdict = {
  safety: CommandSafety
  /** One-line reason. Useful for logs and a future UI indicator. */
  reason: string
  /** When compound, the per-subcommand verdicts that produced this result. */
  parts?: SafetyVerdict[]
}

// ---------------------------------------------------------------------------
// Safe allowlist: command patterns that are read-only, version queries,
// metadata dumps, or harmless echo. Matched against the first token of each
// sub-command AND, for some commands, the full argument list.
// ---------------------------------------------------------------------------

// Tools whose every invocation is inherently read-only regardless of args.
// NOTE: env and printenv are intentionally NOT in this set — they dump all
// environment variables, which may contain API keys / tokens. They fall to
// 'unknown' so the existing permission rule system can decide.
const ALWAYS_SAFE_COMMANDS = new Set([
  'pwd',
  'whoami',
  'hostname',
  'uname',
  'date',
  'id',
  'groups',
  'tty',
  'uptime',
  'arch',
  'nproc',
  'which',
  'command',
  'type',
  'whereis',
  'true',
  'false',
])

// Sensitive file paths that must never be auto-approved even via read-only
// commands (cat, head, tail, less, more, file, stat, wc). Matched against
// each argument; a single match degrades the whole invocation to 'unknown'.
const SENSITIVE_PATH_PATTERNS: readonly RegExp[] = [
  /^\/etc\/(shadow|gshadow|master\.passwd|sudoers(\/|$))/,
  /(^|\/)\.ssh\/(?!.*\.pub$)/, // .ssh/ contents except .pub keys
  /(^|\/)\.aws\/credentials$/,
  /(^|\/)\.aws\/config$/,
  /(^|\/)\.config\/gcloud\//,
  /(^|\/)\.kube\/config$/,
  /(^|\/)\.netrc$/,
  /(^|\/)\.npmrc$/,
  /(^|\/)\.pypirc$/,
  /(^|\/)\.docker\/config\.json$/,
  /^\/proc\/[^/]+\/(environ|mem|maps|kcore)$/,
  /^\/proc\/kcore$/,
  /^\/dev\/(sd[a-z]|nvme\d|disk\d|mmcblk|mapper\/)/,
  /^\/dev\/(mem|kmem|port|tty\d+)$/,
  /(^|\/)\.git-credentials$/,
  // Generic private-key patterns anywhere on disk
  /(^|\/)id_(rsa|dsa|ecdsa|ed25519)$/,
  /\.pem$/,
  /\.key$/,
]

function hasSensitivePath(args: readonly string[]): boolean {
  return args.some(arg => SENSITIVE_PATH_PATTERNS.some(re => re.test(arg)))
}

// Tools that are safe for specific argument shapes. Each predicate takes the
// argument list (tokens after the command name) and returns true when the
// invocation is safe.
const ARG_GATED_SAFE: Record<string, (args: string[]) => boolean> = {
  // Read-only file reads — but NOT tee (writes), NOT `cat > FILE` (redirect
  // is handled separately at the compound level), and NOT when any argument
  // points to a known-sensitive path (credentials, private keys, /dev, etc.).
  cat: args => args.length >= 1 && !args.some(isMutatingFlag) && !hasSensitivePath(args),
  head: args => args.length >= 1 && !args.some(isMutatingFlag) && !hasSensitivePath(args),
  tail: args => args.length >= 1 && !args.some(isMutatingFlag) && !hasSensitivePath(args),
  less: args => args.length >= 1 && !args.some(isMutatingFlag) && !hasSensitivePath(args),
  more: args => args.length >= 1 && !args.some(isMutatingFlag) && !hasSensitivePath(args),
  file: args => args.length >= 1 && !hasSensitivePath(args),
  wc: args => args.length >= 1 && !hasSensitivePath(args),
  stat: args => args.length >= 1 && !hasSensitivePath(args),
  basename: args => args.length >= 1,
  dirname: args => args.length >= 1,
  realpath: args => args.length >= 1 && !hasSensitivePath(args),
  readlink: args => args.length >= 1 && !hasSensitivePath(args),

  // Listing / inspection
  ls: args => !args.some(a => a === '-d' && args.includes('/')),
  tree: () => true,
  du: args => !args.some(a => a.startsWith('--delete')),
  df: () => true,

  // Search — disallow -exec (arbitrary command), -delete, -print0 + xargs
  find: args =>
    !args.some(a => a === '-exec' || a === '-execdir' || a === '-delete' || a === '-ok'),
  grep: args => !args.some(a => a.startsWith('--include=/dev')),
  rg: () => true,
  ag: () => true,
  fgrep: () => true,
  egrep: () => true,

  // Version / help queries are always safe; we only auto-approve simple form
  node: args => isSimpleQueryFlag(args),
  npm: args => args[0] === '--version' || args[0] === '-v' || args[0] === 'help' || args[0] === 'view' || args[0] === 'list' || args[0] === 'ls' || args[0] === 'root' || args[0] === 'config' && args[1] === 'get',
  bun: args => isSimpleQueryFlag(args) || args[0] === '--help',
  pnpm: args => isSimpleQueryFlag(args) || args[0] === 'list' || args[0] === 'ls',
  yarn: args => isSimpleQueryFlag(args) || args[0] === 'list',
  python: args => isSimpleQueryFlag(args),
  python3: args => isSimpleQueryFlag(args),
  ruby: args => isSimpleQueryFlag(args),
  go: args => isSimpleQueryFlag(args) || args[0] === 'version' || args[0] === 'env',
  cargo: args => isSimpleQueryFlag(args),
  rustc: args => isSimpleQueryFlag(args),
  deno: args => isSimpleQueryFlag(args),
  tsc: args => isSimpleQueryFlag(args) || args[0] === '--noEmit',
  java: args => isSimpleQueryFlag(args),
  javac: args => isSimpleQueryFlag(args),
  mvn: args => isSimpleQueryFlag(args),
  gradle: args => isSimpleQueryFlag(args),

  // Git — read-only subcommands with careful handling of known-mutating
  // variants. Removed from this list (defer to 'unknown'):
  //   - config  → plain `git config key value` is a set, writes .git/config
  //   - stash   → bare `git stash` = stash push, mutates worktree/index
  //   - gc      → repacks + deletes loose objects
  //   - bisect  → start/good/bad mutate HEAD
  git: args => {
    if (args.length === 0) return true // `git` alone shows usage
    const sub = args[0]
    const READ_ONLY_SUBCOMMANDS = new Set([
      'status',
      'log',
      'diff',
      'show',
      'branch',
      'tag',
      'remote',
      'rev-parse',
      'rev-list',
      'ls-files',
      'ls-remote',
      'ls-tree',
      'blame',
      'shortlog',
      'describe',
      'reflog',
      'worktree',
      'fetch',
      'help',
      '--version',
      '--help',
      'whatchanged',
      'cat-file',
      'show-ref',
      'symbolic-ref',
      'name-rev',
      'count-objects',
      'fsck',
      'grep',
    ])
    // stash is safe only for read subcommands (list, show). Bare `git stash`
    // is equivalent to `git stash push` — mutates the working tree.
    if (sub === 'stash') {
      const rest = args.slice(1)
      return rest[0] === 'list' || rest[0] === 'show'
    }
    if (!READ_ONLY_SUBCOMMANDS.has(sub)) return false
    // `git branch -D`, `git branch --delete`, `git tag -d`, etc. mutate.
    return !args.some(
      a =>
        a === '-D' ||
        a === '--delete' ||
        a === '--force-delete' ||
        a === 'drop' ||
        a === 'clear' ||
        a === '-d' && sub === 'branch' ||
        a === '-d' && sub === 'tag' ||
        a === '-m' && sub === 'stash',
    )
  },

  // Echo / print — safe because output-only (redirection is checked at the
  // compound level and promotes the verdict to 'unknown' or 'unsafe').
  echo: () => true,
  printf: () => true,
  yes: () => true,
  seq: () => true,
}

// Mutating flags that rule out the "read-only" classification for any cmd.
function isMutatingFlag(token: string): boolean {
  return (
    token === '-o' ||
    token === '--output' ||
    token === '-w' ||
    token === '--write' ||
    token === '--in-place' ||
    token === '-i' && /* sed -i */ false // keep simple; sed is handled elsewhere
  )
}

function isSimpleQueryFlag(args: string[]): boolean {
  if (args.length === 0) return true
  const first = args[0]
  return (
    first === '--version' ||
    first === '-v' ||
    first === '-V' ||
    first === 'version' ||
    first === '--help' ||
    first === '-h' ||
    first === 'help'
  )
}

// ---------------------------------------------------------------------------
// Unsafe denylist
// ---------------------------------------------------------------------------

const DANGEROUS_COMMANDS = new Set([
  'rm',
  'rmdir',
  'dd',
  'shred',
  'mkfs',
  'mkfs.ext4',
  'mkfs.btrfs',
  'fdisk',
  'parted',
  'mount',
  'umount',
  'chmod',
  'chown',
  'chgrp',
  'chattr',
  'setfacl',
  'passwd',
  'useradd',
  'userdel',
  'usermod',
  'sudo',
  'su',
  'doas',
  'kill',
  'killall',
  'pkill',
  'halt',
  'reboot',
  'shutdown',
  'poweroff',
  'systemctl',
  'service',
  'launchctl',
  'crontab',
  'at',
  'eval',
  'exec',
  'source',
  // Package managers that mutate system state
  'apt',
  'apt-get',
  'yum',
  'dnf',
  'pacman',
  'brew',
  'port',
  'snap',
])

// Network-effecting — not always destructive but exfiltration / side-effect
// risk high enough to require human approval.
const NETWORK_COMMANDS = new Set([
  'curl',
  'wget',
  'nc',
  'netcat',
  'ncat',
  'ssh',
  'scp',
  'sftp',
  'rsync',
  'telnet',
  'ftp',
])

// Commands whose first arg determines mutation vs read. Map to a predicate
// that returns true when the invocation is UNSAFE.
const ARG_GATED_UNSAFE: Record<string, (args: string[]) => boolean> = {
  mv: () => true,
  cp: () => true,
  ln: () => true,
  touch: () => true,
  mkdir: () => true,
  tee: () => true, // always writes somewhere
  sed: args => args.some(a => a === '-i' || a === '--in-place' || a.startsWith('-i')),
  awk: args => args.some(a => a === '-i'),
  find: args =>
    args.some(
      a => a === '-exec' || a === '-execdir' || a === '-delete' || a === '-ok' || a === '-okdir',
    ),
  docker: args => {
    if (args.length === 0) return false
    const sub = args[0]
    return new Set([
      'rm',
      'rmi',
      'kill',
      'stop',
      'start',
      'run',
      'exec',
      'build',
      'push',
      'pull',
      'login',
      'logout',
      'system',
      'volume',
      'network',
    ]).has(sub)
  },
  npm: args => {
    if (args.length === 0) return false
    const sub = args[0]
    return new Set([
      'install',
      'i',
      'add',
      'uninstall',
      'remove',
      'rm',
      'un',
      'publish',
      'unpublish',
      'link',
      'unlink',
      'update',
      'upgrade',
      'audit',
      'ci',
      'exec',
      'run',
      'run-script',
      'start',
      'test',
      'dedupe',
      'prune',
    ]).has(sub)
  },
  yarn: args => {
    if (args.length === 0) return true // plain `yarn` = install
    const sub = args[0]
    return new Set([
      'add',
      'remove',
      'install',
      'publish',
      'unpublish',
      'link',
      'unlink',
      'upgrade',
      'run',
      'exec',
    ]).has(sub)
  },
  pnpm: args => {
    if (args.length === 0) return false
    const sub = args[0]
    return new Set([
      'install',
      'i',
      'add',
      'remove',
      'rm',
      'update',
      'up',
      'publish',
      'link',
      'unlink',
      'exec',
      'run',
      'start',
    ]).has(sub)
  },
  bun: args => {
    if (args.length === 0) return false
    const sub = args[0]
    return new Set([
      'install',
      'i',
      'add',
      'remove',
      'rm',
      'update',
      'publish',
      'link',
      'unlink',
      'run',
    ]).has(sub)
  },
  git: args => {
    if (args.length === 0) return false
    const sub = args[0]
    const MUTATING_SUBCOMMANDS = new Set([
      'push',
      'pull',
      'commit',
      'merge',
      'rebase',
      'reset',
      'revert',
      'checkout',
      'switch',
      'restore',
      'clean',
      'add',
      'rm',
      'mv',
      'init',
      'clone',
      'submodule',
      'cherry-pick',
      'apply',
      'am',
      'format-patch',
      'request-pull',
      'send-email',
      'filter-branch',
      'filter-repo',
    ])
    if (MUTATING_SUBCOMMANDS.has(sub)) return true

    // Destructive flags on otherwise-read-only subcommands.
    //   git branch -D / --delete / --force-delete  → mutates
    //   git stash drop / clear / pop                → mutates
    //   git tag -d / --delete                       → mutates
    //   git remote remove / rm / set-url            → mutates
    //   git config --unset / --replace-all          → mutates
    const rest = args.slice(1)
    if (sub === 'branch') {
      if (rest.some(a => a === '-D' || a === '--delete' || a === '--force-delete' || a === '-d')) {
        return true
      }
    }
    if (sub === 'stash') {
      if (rest.some(a => a === 'drop' || a === 'clear' || a === 'pop' || a === 'apply')) {
        return true
      }
    }
    if (sub === 'tag') {
      if (rest.some(a => a === '-d' || a === '--delete')) {
        return true
      }
    }
    if (sub === 'remote') {
      if (rest[0] === 'remove' || rest[0] === 'rm' || rest[0] === 'set-url' || rest[0] === 'add' || rest[0] === 'rename') {
        return true
      }
    }
    if (sub === 'config') {
      // Unsafe flags — explicit mutations.
      if (rest.some(a => a === '--unset' || a === '--replace-all' || a === '--add' || a === '--unset-all')) {
        return true
      }
      // `git config key value` (2+ positional args without a read flag)
      // writes to .git/config. Only the single-arg read form (`git config
      // user.email`) and explicit read flags (--get / --list / -l) are not
      // mutations — everything else is a set.
      const positional = rest.filter(a => !a.startsWith('-'))
      const isReadFlag = rest.some(a => a === '--get' || a === '--get-all' || a === '--list' || a === '-l')
      if (!isReadFlag && positional.length >= 2) {
        return true
      }
    }
    if (sub === 'stash') {
      // Bare `git stash` = `git stash push` → mutates.
      if (rest.length === 0) return true
      // Any push/save/create/store subcommand mutates.
      if (rest[0] === 'push' || rest[0] === 'save' || rest[0] === 'create' || rest[0] === 'store') {
        return true
      }
    }
    if (sub === 'gc' || sub === 'prune' || sub === 'repack') {
      return true
    }
    if (sub === 'bisect') {
      // start, good, bad, reset, run, skip all mutate bisect state / HEAD.
      // Allow only `git bisect log` and `git bisect visualize` through the
      // read-only path — but since bisect isn't in READ_ONLY_SUBCOMMANDS
      // anymore, everything falls to unknown by default; we mark the
      // common mutating subcommands unsafe for explicit-deny clarity.
      if (
        rest[0] === 'start' ||
        rest[0] === 'good' ||
        rest[0] === 'bad' ||
        rest[0] === 'reset' ||
        rest[0] === 'skip' ||
        rest[0] === 'run' ||
        rest[0] === 'terms' ||
        rest[0] === 'replay'
      ) {
        return true
      }
    }

    return false
  },
}

// ---------------------------------------------------------------------------
// Parser — best-effort tokenization + compound splitting
// ---------------------------------------------------------------------------

// Returns true when the character at position `i` is preceded by an odd
// number of backslashes — i.e., it is bash-escaped. `\"` has one backslash
// (odd → escaped), `\\"` has two (even → backslash escapes backslash, the
// quote stands). The prior `input[i-1] !== '\\'` check got this wrong and
// let `echo "test\\" && rm -rf /` slip through as one quoted token.
function isCharEscaped(input: string, i: number): boolean {
  let count = 0
  let j = i - 1
  while (j >= 0 && input[j] === '\\') {
    count++
    j--
  }
  return count % 2 === 1
}

// Splits a command line into compound parts at &&, ||, ;, |, and newlines
// (newline is equivalent to ; in bash). Respects basic single/double quoting
// to avoid splitting inside strings, with correct escape-counting for close
// quotes. Does NOT fully evaluate shell grammar — intentionally conservative;
// anything too complex falls back to 'unknown'.
function splitCompound(input: string): string[] {
  const parts: string[] = []
  let current = ''
  let i = 0
  let inSingle = false
  let inDouble = false
  let parenDepth = 0
  while (i < input.length) {
    const c = input[i]
    const next = input[i + 1]
    if (!inSingle && !inDouble) {
      if (c === '"') {
        inDouble = true
        current += c
        i++
        continue
      }
      if (c === "'") {
        inSingle = true
        current += c
        i++
        continue
      }
      if (c === '(' || c === '{') {
        parenDepth++
        current += c
        i++
        continue
      }
      if (c === ')' || c === '}') {
        parenDepth--
        current += c
        i++
        continue
      }
      if (parenDepth === 0) {
        if ((c === '&' && next === '&') || (c === '|' && next === '|')) {
          parts.push(current)
          current = ''
          i += 2
          continue
        }
        // Newline is a statement separator in bash, equivalent to ';'.
        if (c === ';' || c === '|' || c === '&' || c === '\n') {
          parts.push(current)
          current = ''
          i++
          continue
        }
      }
    } else {
      // Single quotes in bash do not respect any escape sequence — a single
      // quote always closes. Double quotes honor backslash escapes; we
      // detect a true (unescaped) close quote with isCharEscaped().
      if (inDouble && c === '"' && !isCharEscaped(input, i)) inDouble = false
      else if (inSingle && c === "'") inSingle = false
    }
    current += c
    i++
  }
  if (current.trim()) parts.push(current)
  return parts.map(p => p.trim()).filter(Boolean)
}

// Shell-like tokenizer. Respects ' and " quoting. Does NOT expand variables
// or handle $(...) / `...` / <(...) / >(...) substitution — if any of those
// are present, return null so the caller treats the command as 'unknown'.
// Process substitution (<( >() spawns a subprocess whose command we can't
// classify from this layer, so auto-approving is unsafe.
function tokenize(input: string): string[] | null {
  const trimmed = input.trim()
  if (!trimmed) return []
  if (
    trimmed.includes('$(') ||
    trimmed.includes('`') ||
    trimmed.includes('<(') ||
    trimmed.includes('>(')
  ) {
    return null // command / process substitution
  }

  const tokens: string[] = []
  let current = ''
  let i = 0
  let inSingle = false
  let inDouble = false
  while (i < trimmed.length) {
    const c = trimmed[i]
    if (!inSingle && !inDouble) {
      if (c === '"') {
        inDouble = true
        i++
        continue
      }
      if (c === "'") {
        inSingle = true
        i++
        continue
      }
      if (/\s/.test(c)) {
        if (current) {
          tokens.push(current)
          current = ''
        }
        i++
        continue
      }
    } else {
      // Double quotes honor backslash escapes in bash — a `\"` is a literal
      // quote, and the string keeps going. Use isCharEscaped() to count
      // consecutive backslashes so `\\"` (even) correctly closes the quote.
      if (inDouble && c === '"' && !isCharEscaped(trimmed, i)) {
        inDouble = false
        i++
        continue
      }
      // Single quotes are literal — no escape handling in bash.
      if (inSingle && c === "'") {
        inSingle = false
        i++
        continue
      }
    }
    current += c
    i++
  }
  if (inSingle || inDouble) return null // unbalanced quotes
  if (current) tokens.push(current)
  return tokens
}

function hasFileRedirect(tokens: string[]): boolean {
  // >, >>, &>, 2>, 2>>, < (< is input redirect, safe-ish but we conservatively
  // treat it as unknown if piping into a mutating context)
  return tokens.some(t =>
    /^(&?>|>>|2>|2>>|&>>)$/.test(t) || /(?<!\\)>\S/.test(t),
  )
}

function classifyLeaf(command: string): SafetyVerdict {
  const trimmed = command.trim()
  if (!trimmed) {
    return { safety: 'safe', reason: 'empty' }
  }

  const tokens = tokenize(trimmed)
  if (tokens === null) {
    return {
      safety: 'unknown',
      reason: 'contains command substitution or unbalanced quotes',
    }
  }
  if (tokens.length === 0) {
    return { safety: 'safe', reason: 'empty' }
  }

  if (hasFileRedirect(tokens)) {
    return { safety: 'unknown', reason: 'file redirection (> / >>)' }
  }

  const [cmd, ...args] = tokens

  // Strip leading env-var assignments like FOO=bar cmd...
  let actualCmd = cmd
  let actualArgs = args
  if (/^[A-Z_][A-Z0-9_]*=/.test(cmd)) {
    // skip env-assignment prefix tokens
    let idx = 0
    while (idx < tokens.length && /^[A-Z_][A-Z0-9_]*=/.test(tokens[idx])) idx++
    if (idx >= tokens.length) {
      return { safety: 'safe', reason: 'env assignment only' }
    }
    actualCmd = tokens[idx]
    actualArgs = tokens.slice(idx + 1)
  }

  if (DANGEROUS_COMMANDS.has(actualCmd)) {
    return { safety: 'unsafe', reason: `${actualCmd} is on the dangerous list` }
  }
  if (NETWORK_COMMANDS.has(actualCmd)) {
    return {
      safety: 'unsafe',
      reason: `${actualCmd} performs network I/O — requires explicit approval`,
    }
  }

  const unsafeGate = ARG_GATED_UNSAFE[actualCmd]
  if (unsafeGate && unsafeGate(actualArgs)) {
    return { safety: 'unsafe', reason: `${actualCmd} invocation mutates state` }
  }

  if (ALWAYS_SAFE_COMMANDS.has(actualCmd)) {
    return { safety: 'safe', reason: `${actualCmd} is always safe` }
  }

  const safeGate = ARG_GATED_SAFE[actualCmd]
  if (safeGate && safeGate(actualArgs)) {
    return { safety: 'safe', reason: `${actualCmd} read-only invocation` }
  }

  return { safety: 'unknown', reason: `${actualCmd} not in allow/deny list` }
}

/**
 * Classify a (possibly compound) Bash command as safe / unsafe / unknown.
 */
export function classifyBashSafety(command: string): SafetyVerdict {
  const trimmed = (command ?? '').trim()
  if (!trimmed) {
    return { safety: 'safe', reason: 'empty command' }
  }

  const parts = splitCompound(trimmed)
  if (parts.length <= 1) {
    return classifyLeaf(trimmed)
  }

  const verdicts = parts.map(classifyLeaf)
  const hasUnsafe = verdicts.some(v => v.safety === 'unsafe')
  const hasUnknown = verdicts.some(v => v.safety === 'unknown')

  if (hasUnsafe) {
    return {
      safety: 'unsafe',
      reason: 'compound command contains an unsafe part',
      parts: verdicts,
    }
  }
  if (hasUnknown) {
    return {
      safety: 'unknown',
      reason: 'compound command contains an unknown part',
      parts: verdicts,
    }
  }
  return {
    safety: 'safe',
    reason: 'all parts safe',
    parts: verdicts,
  }
}
