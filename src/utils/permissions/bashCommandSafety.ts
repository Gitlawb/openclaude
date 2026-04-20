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
const ALWAYS_SAFE_COMMANDS = new Set([
  'pwd',
  'whoami',
  'hostname',
  'uname',
  'date',
  'id',
  'groups',
  'env',
  'printenv',
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

// Tools that are safe for specific argument shapes. Each predicate takes the
// argument list (tokens after the command name) and returns true when the
// invocation is safe.
const ARG_GATED_SAFE: Record<string, (args: string[]) => boolean> = {
  // Read-only file reads — but NOT tee (writes), NOT `cat > FILE` (redirect
  // is handled separately at the compound level).
  cat: args => args.length >= 1 && !args.some(isMutatingFlag),
  head: args => args.length >= 1 && !args.some(isMutatingFlag),
  tail: args => args.length >= 1 && !args.some(isMutatingFlag),
  less: args => args.length >= 1 && !args.some(isMutatingFlag),
  more: args => args.length >= 1 && !args.some(isMutatingFlag),
  file: args => args.length >= 1,
  wc: args => args.length >= 1,
  stat: args => args.length >= 1,
  basename: args => args.length >= 1,
  dirname: args => args.length >= 1,
  realpath: args => args.length >= 1,
  readlink: args => args.length >= 1,

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

  // Git — only read subcommands
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
      'config',
      'rev-parse',
      'rev-list',
      'ls-files',
      'ls-remote',
      'ls-tree',
      'blame',
      'shortlog',
      'describe',
      'reflog',
      'stash',
      'worktree',
      'fetch',
      'help',
      '--version',
      '--help',
      'whatchanged',
      'bisect',
      'cat-file',
      'show-ref',
      'symbolic-ref',
      'name-rev',
      'count-objects',
      'fsck',
      'gc',
      'grep',
    ])
    if (!READ_ONLY_SUBCOMMANDS.has(sub)) return false
    // `git branch -D`, `git branch --delete`, `git stash drop`, etc. mutate.
    // Keep the heuristic simple: if any token starts with -D or --delete etc, reject.
    return !args.some(
      a =>
        a === '-D' ||
        a === '--delete' ||
        a === '--force-delete' ||
        a === 'drop' ||
        a === 'clear' ||
        a === '-d' && sub === 'branch' ||
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
      if (rest.some(a => a === '--unset' || a === '--replace-all' || a === '--add')) {
        return true
      }
    }

    return false
  },
}

// ---------------------------------------------------------------------------
// Parser — best-effort tokenization + compound splitting
// ---------------------------------------------------------------------------

// Splits a command line into compound parts at &&, ||, ;, | (keeping the
// semantics: each part is a sub-command that will run). Respects basic
// quoting (single + double) to avoid splitting inside strings. Does NOT
// fully evaluate shell grammar — intentionally conservative; anything too
// complex falls back to 'unknown'.
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
        if (c === ';' || c === '|' || c === '&') {
          parts.push(current)
          current = ''
          i++
          continue
        }
      }
    } else {
      if (inDouble && c === '"' && input[i - 1] !== '\\') inDouble = false
      if (inSingle && c === "'") inSingle = false
    }
    current += c
    i++
  }
  if (current.trim()) parts.push(current)
  return parts.map(p => p.trim()).filter(Boolean)
}

// Shell-like tokenizer. Respects ' and " quoting. Does NOT expand variables
// or handle $(...) substitution — if those are present, return null to
// signal the caller to treat the command as 'unknown'.
function tokenize(input: string): string[] | null {
  const trimmed = input.trim()
  if (!trimmed) return []
  if (trimmed.includes('$(') || trimmed.includes('`')) return null // command substitution

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
      if (inDouble && c === '"') {
        inDouble = false
        i++
        continue
      }
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
