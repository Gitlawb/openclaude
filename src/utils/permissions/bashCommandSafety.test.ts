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
