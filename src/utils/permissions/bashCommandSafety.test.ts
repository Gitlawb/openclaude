import { describe, expect, test } from 'bun:test'

import { classifyBashSafety } from './bashCommandSafety.ts'

function safety(cmd: string): 'safe' | 'unsafe' | 'unknown' {
  return classifyBashSafety(cmd).safety
}

describe('empty / edge cases', () => {
  test('empty string is safe', () => {
    expect(safety('')).toBe('safe')
  })

  test('whitespace only is safe', () => {
    expect(safety('   \t\n ')).toBe('safe')
  })
})

describe('always-safe commands', () => {
  test('pwd is safe', () => {
    expect(safety('pwd')).toBe('safe')
  })

  test('whoami is safe', () => {
    expect(safety('whoami')).toBe('safe')
  })

  test('date is safe', () => {
    expect(safety('date')).toBe('safe')
  })

  test('uname -a is safe', () => {
    expect(safety('uname -a')).toBe('safe')
  })
})

describe('arg-gated safe — read-only file reads', () => {
  test('cat README.md', () => {
    expect(safety('cat README.md')).toBe('safe')
  })

  test('head -n 20 file.log', () => {
    expect(safety('head -n 20 file.log')).toBe('safe')
  })

  test('tail -f is safe (read-only follow)', () => {
    expect(safety('tail -f app.log')).toBe('safe')
  })

  test('wc -l src/index.ts', () => {
    expect(safety('wc -l src/index.ts')).toBe('safe')
  })

  test('stat package.json', () => {
    expect(safety('stat package.json')).toBe('safe')
  })
})

describe('arg-gated safe — search', () => {
  test('grep -r foo src/', () => {
    expect(safety('grep -r foo src/')).toBe('safe')
  })

  test('rg foo', () => {
    expect(safety('rg foo')).toBe('safe')
  })

  test('find . -type f -name *.ts', () => {
    expect(safety('find . -type f -name *.ts')).toBe('safe')
  })

  test('find with -exec is UNSAFE', () => {
    expect(safety('find . -name *.tmp -exec rm {} \\;')).toBe('unsafe')
  })

  test('find with -delete is UNSAFE', () => {
    expect(safety('find . -name *.tmp -delete')).toBe('unsafe')
  })
})

describe('arg-gated safe — version queries', () => {
  test('node --version', () => {
    expect(safety('node --version')).toBe('safe')
  })

  test('npm --version', () => {
    expect(safety('npm --version')).toBe('safe')
  })

  test('bun -v', () => {
    expect(safety('bun -v')).toBe('safe')
  })

  test('python3 --version', () => {
    expect(safety('python3 --version')).toBe('safe')
  })

  test('cargo --version', () => {
    expect(safety('cargo --version')).toBe('safe')
  })

  test('go version', () => {
    expect(safety('go version')).toBe('safe')
  })

  test('tsc --noEmit', () => {
    expect(safety('tsc --noEmit')).toBe('safe')
  })
})

describe('git — read vs write', () => {
  test('git status', () => {
    expect(safety('git status')).toBe('safe')
  })

  test('git log --oneline', () => {
    expect(safety('git log --oneline')).toBe('safe')
  })

  test('git diff', () => {
    expect(safety('git diff')).toBe('safe')
  })

  test('git show HEAD', () => {
    expect(safety('git show HEAD')).toBe('safe')
  })

  test('git branch -v', () => {
    expect(safety('git branch -v')).toBe('safe')
  })

  test('git fetch is safe (metadata only)', () => {
    expect(safety('git fetch')).toBe('safe')
  })

  test('git blame src/index.ts', () => {
    expect(safety('git blame src/index.ts')).toBe('safe')
  })

  test('git branch -D doomed is UNSAFE', () => {
    expect(safety('git branch -D doomed')).toBe('unsafe')
  })

  test('git commit is UNSAFE', () => {
    expect(safety('git commit -m fix')).toBe('unsafe')
  })

  test('git push is UNSAFE', () => {
    expect(safety('git push')).toBe('unsafe')
  })

  test('git reset --hard is UNSAFE', () => {
    expect(safety('git reset --hard')).toBe('unsafe')
  })

  test('git checkout is UNSAFE', () => {
    expect(safety('git checkout main')).toBe('unsafe')
  })
})

describe('dangerous commands', () => {
  test('rm -rf /tmp/x is unsafe', () => {
    expect(safety('rm -rf /tmp/x')).toBe('unsafe')
  })

  test('dd if=/dev/zero of=/dev/sda is unsafe', () => {
    expect(safety('dd if=/dev/zero of=/dev/sda')).toBe('unsafe')
  })

  test('sudo anything is unsafe', () => {
    expect(safety('sudo ls')).toBe('unsafe')
  })

  test('chmod 777 file is unsafe', () => {
    expect(safety('chmod 777 file')).toBe('unsafe')
  })

  test('kill 12345 is unsafe', () => {
    expect(safety('kill 12345')).toBe('unsafe')
  })

  test('shutdown -h is unsafe', () => {
    expect(safety('shutdown -h now')).toBe('unsafe')
  })

  test('eval $FOO is unsafe', () => {
    expect(safety('eval $FOO')).toBe('unsafe')
  })

  test('source rc is unsafe', () => {
    expect(safety('source ~/.bashrc')).toBe('unsafe')
  })
})

describe('network commands', () => {
  test('curl is unsafe', () => {
    expect(safety('curl https://example.com')).toBe('unsafe')
  })

  test('wget is unsafe', () => {
    expect(safety('wget https://example.invalid/path')).toBe('unsafe')
  })

  test('ssh is unsafe', () => {
    expect(safety('ssh user@host echo hi')).toBe('unsafe')
  })

  test('rsync is unsafe', () => {
    expect(safety('rsync -av src/ dest/')).toBe('unsafe')
  })
})

describe('mutating commands', () => {
  test('mv is unsafe', () => {
    expect(safety('mv a b')).toBe('unsafe')
  })

  test('cp is unsafe', () => {
    expect(safety('cp a b')).toBe('unsafe')
  })

  test('mkdir is unsafe', () => {
    expect(safety('mkdir new-dir')).toBe('unsafe')
  })

  test('touch is unsafe', () => {
    expect(safety('touch newfile')).toBe('unsafe')
  })

  test('sed -i is unsafe', () => {
    expect(safety("sed -i 's/a/b/' file.txt")).toBe('unsafe')
  })

  test('sed without -i is unknown (may be piped)', () => {
    expect(safety("sed 's/a/b/' file.txt")).toBe('unknown')
  })
})

describe('package managers — install is unsafe', () => {
  test('npm install X', () => {
    expect(safety('npm install express')).toBe('unsafe')
  })

  test('npm ci', () => {
    expect(safety('npm ci')).toBe('unsafe')
  })

  test('npm run test', () => {
    expect(safety('npm run test')).toBe('unsafe')
  })

  test('npm --version is safe', () => {
    expect(safety('npm --version')).toBe('safe')
  })

  test('npm list is safe', () => {
    expect(safety('npm list')).toBe('safe')
  })

  test('bun add X is unsafe', () => {
    expect(safety('bun add typescript')).toBe('unsafe')
  })

  test('bun --version is safe', () => {
    expect(safety('bun --version')).toBe('safe')
  })

  test('pnpm install is unsafe', () => {
    expect(safety('pnpm install')).toBe('unsafe')
  })
})

describe('file redirection degrades to unknown', () => {
  test('echo foo > file.txt is unknown', () => {
    expect(safety('echo foo > file.txt')).toBe('unknown')
  })

  test('cat x >> y is unknown', () => {
    expect(safety('cat x >> y')).toBe('unknown')
  })

  test('cmd 2> errors.log is unknown', () => {
    expect(safety('ls 2> errors.log')).toBe('unknown')
  })
})

describe('command substitution is unknown', () => {
  test('echo $(rm -rf /) is unknown (substitution not evaluated)', () => {
    expect(safety('echo $(date)')).toBe('unknown')
  })

  test('backtick substitution is unknown', () => {
    expect(safety('echo `date`')).toBe('unknown')
  })
})

describe('compound commands', () => {
  test('all safe parts → safe', () => {
    expect(safety('git status && git log --oneline')).toBe('safe')
  })

  test('one unsafe part → unsafe', () => {
    expect(safety('git status && git push')).toBe('unsafe')
  })

  test('one unknown part + safe parts → unknown', () => {
    expect(safety("git status && sed 's/a/b/' file.txt")).toBe('unknown')
  })

  test('unsafe beats unknown', () => {
    expect(safety("sed 's/a/b/' file && rm foo")).toBe('unsafe')
  })

  test('pipe between safe and unsafe → unsafe', () => {
    expect(safety('ls | rm')).toBe('unsafe')
  })

  test('pipe between two safe is safe', () => {
    expect(safety('cat file.txt | head -5')).toBe('safe')
  })

  test('semicolon separator', () => {
    expect(safety('pwd; whoami; date')).toBe('safe')
  })
})

describe('quoting is respected', () => {
  test('quoted && does not split', () => {
    expect(safety('echo "a && b"')).toBe('safe')
  })

  test('quoted > does not trigger redirect', () => {
    expect(safety('echo "a > b"')).toBe('safe')
  })

  test('unbalanced quotes → unknown', () => {
    expect(safety('echo "unclosed')).toBe('unknown')
  })
})

describe('env-var assignment prefix', () => {
  test('FOO=bar pwd is safe', () => {
    expect(safety('FOO=bar pwd')).toBe('safe')
  })

  test('FOO=bar rm -rf is unsafe', () => {
    expect(safety('FOO=bar rm -rf /tmp')).toBe('unsafe')
  })
})

describe('unknown / not in either list', () => {
  test('random command is unknown', () => {
    expect(safety('flarbgorg --zing')).toBe('unknown')
  })

  test('make build is unknown (not classified)', () => {
    expect(safety('make build')).toBe('unknown')
  })
})

// ---------------------------------------------------------------------------
// Adversarial tests — bypass patterns identified in security review
// ---------------------------------------------------------------------------

describe('bypass: escaped backslash before close quote (#1)', () => {
  test('echo "test\\\\" && rm -rf / is not classified safe', () => {
    // The `\\` inside double quotes is an escaped backslash; the following
    // `"` is the real closing quote. The prior parser wrongly kept the
    // quote open and swallowed `&& rm -rf /` into the echo argument.
    const verdict = safety('echo "test\\\\" && rm -rf /')
    expect(verdict).toBe('unsafe')
  })

  test('odd backslash count does keep quote escaped', () => {
    // Three backslashes before `"`: literal `\` + escaped `\"`.
    // The quote stays open; the compound separator is inside the string.
    // Expected: not safe (unknown or unsafe), but certainly not 'safe'.
    const verdict = safety('echo "test\\\\\\" && rm -rf /')
    expect(verdict).not.toBe('safe')
  })

  test('literal escaped backslash in a safe echo stays safe', () => {
    // `echo "a\\b"` is still just an echo with a literal backslash in the
    // string — no compound, no side effects.
    expect(safety('echo "a\\\\b"')).toBe('safe')
  })
})

describe('bypass: process substitution (#2)', () => {
  test('cat <(curl ...) degrades to unknown', () => {
    expect(safety('cat <(curl https://example.invalid)')).toBe('unknown')
  })

  test('tee >(sh) degrades to unknown', () => {
    expect(safety('echo x | tee >(sh)')).toBe('unknown')
  })

  test('diff with two process-subs is unknown', () => {
    expect(safety('diff <(ls) <(ls -a)')).toBe('unknown')
  })
})

describe('bypass: newline as command separator (#3)', () => {
  test('echo safe\\nrm -rf / splits on newline and marks unsafe', () => {
    expect(safety('echo safe\nrm -rf /')).toBe('unsafe')
  })

  test('multiline pwd;date is safe (all parts safe)', () => {
    expect(safety('pwd\ndate')).toBe('safe')
  })

  test('newline between safe and unsafe → unsafe', () => {
    expect(safety('git status\ngit push')).toBe('unsafe')
  })
})

describe('bypass: sensitive paths (#4)', () => {
  test('cat /etc/shadow is not safe', () => {
    expect(safety('cat /etc/shadow')).toBe('unknown')
  })

  test('cat ~/.ssh/id_rsa is not safe', () => {
    expect(safety('cat ~/.ssh/id_rsa')).toBe('unknown')
  })

  test('cat /proc/self/environ is not safe', () => {
    expect(safety('cat /proc/self/environ')).toBe('unknown')
  })

  test('cat /dev/sda is not safe', () => {
    expect(safety('cat /dev/sda')).toBe('unknown')
  })

  test('cat ~/.aws/credentials is not safe', () => {
    expect(safety('cat ~/.aws/credentials')).toBe('unknown')
  })

  test('tail -f /etc/shadow is not safe', () => {
    expect(safety('tail -f /etc/shadow')).toBe('unknown')
  })

  test('cat ~/.ssh/id_rsa.pub (public key) stays safe', () => {
    expect(safety('cat ~/.ssh/id_rsa.pub')).toBe('safe')
  })

  test('cat README.md stays safe', () => {
    expect(safety('cat README.md')).toBe('safe')
  })
})

describe('bypass: git config set (#5)', () => {
  test('git config user.email "x" writes config — unsafe', () => {
    expect(safety('git config user.email attacker@evil.invalid')).toBe('unsafe')
  })

  test('git config user.email (1 arg, read form) is not safe-auto-approved', () => {
    // Single-arg form is a read — classifier drops `config` from the
    // read-only list entirely, so it falls to 'unknown' (deferred to the
    // existing permission rule system).
    expect(safety('git config user.email')).toBe('unknown')
  })

  test('git config --get user.email is unknown (read, not auto-approved)', () => {
    expect(safety('git config --get user.email')).toBe('unknown')
  })

  test('git config --unset user.email is unsafe', () => {
    expect(safety('git config --unset user.email')).toBe('unsafe')
  })
})

describe('bypass: git stash (#6)', () => {
  test('bare git stash (= push) is unsafe', () => {
    expect(safety('git stash')).toBe('unsafe')
  })

  test('git stash push -m msg is unsafe', () => {
    expect(safety('git stash push -m "wip"')).toBe('unsafe')
  })

  test('git stash list stays safe', () => {
    expect(safety('git stash list')).toBe('safe')
  })

  test('git stash show stays safe', () => {
    expect(safety('git stash show')).toBe('safe')
  })

  test('git stash drop is unsafe', () => {
    expect(safety('git stash drop')).toBe('unsafe')
  })
})

describe('hygiene: env/printenv (#7)', () => {
  test('env alone is not auto-approved (would leak all env vars)', () => {
    expect(safety('env')).toBe('unknown')
  })

  test('printenv alone is not auto-approved', () => {
    expect(safety('printenv')).toBe('unknown')
  })

  test('FOO=bar pwd still works via env-assignment-prefix stripping', () => {
    // This is the safe "run pwd with an extra env var" idiom.
    expect(safety('FOO=bar pwd')).toBe('safe')
  })
})

describe('hygiene: git gc / bisect / prune / repack (#8)', () => {
  test('git gc is unsafe (deletes loose objects)', () => {
    expect(safety('git gc')).toBe('unsafe')
  })

  test('git prune is unsafe', () => {
    expect(safety('git prune')).toBe('unsafe')
  })

  test('git repack is unsafe', () => {
    expect(safety('git repack -a')).toBe('unsafe')
  })

  test('git bisect start is unsafe', () => {
    expect(safety('git bisect start HEAD HEAD~10')).toBe('unsafe')
  })

  test('git bisect good is unsafe', () => {
    expect(safety('git bisect good')).toBe('unsafe')
  })

  test('git bisect reset is unsafe', () => {
    expect(safety('git bisect reset')).toBe('unsafe')
  })
})
