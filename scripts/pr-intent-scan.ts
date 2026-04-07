import { spawnSync } from 'node:child_process'
import { readFileSync } from 'node:fs'

export type FindingSeverity = 'high' | 'medium'

export type DiffLine = {
  file: string
  line: number
  content: string
}

export type Finding = {
  severity: FindingSeverity
  code: string
  file: string
  line: number
  detail: string
  excerpt: string
}

type CliOptions = {
  baseRef: string
  json: boolean
  failOn: FindingSeverity
}

const SELF_EXCLUDED_FILES = new Set([
  'scripts/pr-intent-scan.ts',
  'scripts/pr-intent-scan.test.ts',
])

const SHORTENER_DOMAINS = [
  'bit.ly',
  'tinyurl.com',
  'goo.gl',
  't.co',
  'is.gd',
  'rb.gy',
  'cutt.ly',
]

const SUSPICIOUS_DOWNLOAD_DOMAINS = [
  'dropbox.com',
  'dl.dropboxusercontent.com',
  'drive.google.com',
  'docs.google.com',
  'mega.nz',
  'mediafire.com',
  'transfer.sh',
  'anonfiles.com',
  'catbox.moe',
]

const URL_REGEX = /\bhttps?:\/\/[^\s)>"']+/gi
const LONG_BASE64_REGEX = /\b(?:[A-Za-z0-9+/]{80,}={0,2}|[A-Za-z0-9_-]{80,})\b/
const EXECUTABLE_PATH_REGEX =
  /\.(?:sh|bash|zsh|ps1|exe|msi|pkg|deb|rpm|zip|tar|tgz|gz|xz|dmg|appimage)(?:$|[?#])/i
const SENSITIVE_PATH_REGEX =
  /^(?:\.github\/workflows\/|scripts\/|bin\/|install(?:\/|\.|$)|.*(?:Dockerfile|docker-compose|compose\.ya?ml)$)/i

function parseOptions(argv: string[]): CliOptions {
  const options: CliOptions = {
    baseRef: 'origin/main',
    json: false,
    failOn: 'high',
  }

  for (let index = 0; index < argv.length; index++) {
    const arg = argv[index]
    if (arg === '--json') {
      options.json = true
      continue
    }
    if (arg === '--base') {
      const next = argv[index + 1]
      if (next && !next.startsWith('--')) {
        options.baseRef = next
        index++
      }
      continue
    }
    if (arg === '--fail-on') {
      const next = argv[index + 1]
      if (next === 'high' || next === 'medium') {
        options.failOn = next
        index++
      }
    }
  }

  return options
}

function trimExcerpt(content: string): string {
  const compact = content.trim().replace(/\s+/g, ' ')
  return compact.length > 140 ? `${compact.slice(0, 137)}...` : compact
}

function uniqueFindings(findings: Finding[]): Finding[] {
  const seen = new Set<string>()
  return findings.filter(finding => {
    const key = `${finding.code}:${finding.file}:${finding.line}:${finding.detail}`
    if (seen.has(key)) {
      return false
    }
    seen.add(key)
    return true
  })
}

function parseAddedLines(diffText: string): DiffLine[] {
  const lines = diffText.split('\n')
  const added: DiffLine[] = []
  let currentFile: string | null = null
  let currentLine = 0

  for (const rawLine of lines) {
    if (rawLine.startsWith('+++ b/')) {
      currentFile = rawLine.slice('+++ b/'.length)
      continue
    }

    if (rawLine.startsWith('@@')) {
      const match = /\+(\d+)(?:,(\d+))?/.exec(rawLine)
      if (match) {
        currentLine = Number(match[1])
      }
      continue
    }

    if (!currentFile) {
      continue
    }

    if (rawLine.startsWith('+') && !rawLine.startsWith('+++')) {
      added.push({
        file: currentFile,
        line: currentLine,
        content: rawLine.slice(1),
      })
      currentLine += 1
      continue
    }

    if (rawLine.startsWith('-') && !rawLine.startsWith('---')) {
      continue
    }

    if (!rawLine.startsWith('\\')) {
      currentLine += 1
    }
  }

  return added
}

function tryParseUrl(value: string): URL | null {
  try {
    return new URL(value)
  } catch {
    return null
  }
}

function hostMatches(hostname: string, domain: string): boolean {
  return hostname === domain || hostname.endsWith(`.${domain}`)
}

function hasSuspiciousDownloadIndicators(url: URL): boolean {
  const combined = `${url.pathname}${url.search}`.toLowerCase()
  return (
    combined.includes('dl=1') ||
    combined.includes('raw=1') ||
    combined.includes('export=download') ||
    combined.includes('/download') ||
    combined.includes('/uc?export=download')
  )
}

function findUrlFindings(line: DiffLine): Finding[] {
  const findings: Finding[] = []
  const matches = line.content.match(URL_REGEX) ?? []

  for (const match of matches) {
    const parsed = tryParseUrl(match)
    if (!parsed) continue

    const hostname = parsed.hostname.toLowerCase()

    for (const domain of SHORTENER_DOMAINS) {
      if (hostMatches(hostname, domain)) {
        findings.push({
          severity: 'medium',
          code: 'shortened-url',
          file: line.file,
          line: line.line,
          detail: `Added shortened URL: ${hostname}`,
          excerpt: trimExcerpt(line.content),
        })
      }
    }

    const isSuspiciousHost = SUSPICIOUS_DOWNLOAD_DOMAINS.some(domain =>
      hostMatches(hostname, domain),
    )
    const isExecutableDownload = EXECUTABLE_PATH_REGEX.test(
      `${parsed.pathname}${parsed.search}`,
    )

    if (isSuspiciousHost) {
      findings.push({
        severity:
          hasSuspiciousDownloadIndicators(parsed) || isExecutableDownload
            ? 'high'
            : 'medium',
        code: 'suspicious-download-link',
        file: line.file,
        line: line.line,
        detail: `Added external file-hosting link: ${hostname}`,
        excerpt: trimExcerpt(line.content),
      })
    } else if (isExecutableDownload) {
      findings.push({
        severity: 'high',
        code: 'executable-download-link',
        file: line.file,
        line: line.line,
        detail: `Added direct link to executable or archive payload: ${hostname}`,
        excerpt: trimExcerpt(line.content),
      })
    }
  }

  return findings
}

function findSensitivePathFindings(line: DiffLine): Finding[] {
  if (!SENSITIVE_PATH_REGEX.test(line.file)) {
    return []
  }

  const lower = line.content.toLowerCase()

  if (
    /\b(curl|wget|invoke-webrequest|iwr|powershell|bash|sh|chmod\s+\+x)\b/i.test(
      line.content,
    ) ||
    URL_REGEX.test(line.content) ||
    lower.includes('download')
  ) {
    return [
      {
        severity: 'medium',
        code: 'sensitive-automation-change',
        file: line.file,
        line: line.line,
        detail:
          'Added network, execution, or download-related content in a sensitive automation file',
        excerpt: trimExcerpt(line.content),
      },
    ]
  }

  return []
}

function findCommandFindings(line: DiffLine): Finding[] {
  const findings: Finding[] = []
  const lower = line.content.toLowerCase()

  const highPatterns: Array<[string, RegExp, string]> = [
    [
      'download-exec-chain',
      /\b(curl|wget|invoke-webrequest|iwr)\b.*(\|\s*(sh|bash|zsh)|;\s*chmod\s+\+x|&&\s*\.\.?\/|>\s*\/tmp\/)/i,
      'Added remote download followed by execution or staging',
    ],
    [
      'powershell-encoded',
      /\bpowershell(?:\.exe)?\b.*(?:-enc|-encodedcommand)\b/i,
      'Added encoded PowerShell invocation',
    ],
    [
      'shell-eval-remote',
      /\b(curl|wget)\b.*\|\s*(sh|bash|zsh)\b/i,
      'Added shell pipe from remote content into interpreter',
    ],
    [
      'binary-lolbin',
      /\b(mshta|rundll32|regsvr32|certutil)\b/i,
      'Added living-off-the-land binary often used for payload staging',
    ],
    [
      'invoke-expression',
      /\b(iex|invoke-expression)\b/i,
      'Added PowerShell expression execution',
    ],
  ]

  const mediumPatterns: Array<[string, RegExp, string]> = [
    [
      'download-command',
      /\b(curl|wget|invoke-webrequest|iwr)\b.*https?:\/\//i,
      'Added command that downloads remote content',
    ],
    [
      'archive-extract-exec',
      /\b(unzip|tar|7z)\b.*(&&|;).*\b(chmod|node|python|bash|sh)\b/i,
      'Added archive extraction followed by execution',
    ],
    [
      'base64-decode',
      /\b(base64\s+-d|openssl\s+base64\s+-d|python .*b64decode)\b/i,
      'Added explicit payload decode step',
    ],
  ]

  for (const [code, pattern, detail] of highPatterns) {
    if (pattern.test(line.content)) {
      findings.push({
        severity: 'high',
        code,
        file: line.file,
        line: line.line,
        detail,
        excerpt: trimExcerpt(line.content),
      })
    }
  }

  for (const [code, pattern, detail] of mediumPatterns) {
    if (code === 'download-command' && !SENSITIVE_PATH_REGEX.test(line.file)) {
      continue
    }
    if (pattern.test(line.content)) {
      findings.push({
        severity: 'medium',
        code,
        file: line.file,
        line: line.line,
        detail,
        excerpt: trimExcerpt(line.content),
      })
    }
  }

  if (LONG_BASE64_REGEX.test(line.content) && !lower.includes('sha256') && !lower.includes('sha512')) {
    findings.push({
      severity: 'medium',
      code: 'long-encoded-payload',
      file: line.file,
      line: line.line,
      detail: 'Added long encoded blob or token-like payload',
      excerpt: trimExcerpt(line.content),
    })
  }

  return findings
}

/**
 * Optional injectable file reader — lets tests supply fake file content
 * without touching the real filesystem.
 */
export type FileReader = (path: string) => string

/**
 * Detects the "write-before-fallible-spawn" anti-pattern in TypeScript/JavaScript
 * files touched by the PR.
 *
 * The bug: a persistent side-effect (file write) is committed before a fallible
 * async operation (spawn).  If the spawn throws, the write is already on disk and
 * leaves a ghost entry (e.g. a phantom team member in config.json).
 *
 * Detection: reads the current on-disk content of every modified .ts/.tsx file,
 * then looks for an `await write*FileAsync(` call that appears in the same function
 * scope as an `await spawn*Teammate(` call, where the write comes first.
 *
 * Scope is approximated by checking that no closing brace at the same or lower
 * indentation level appears between the two calls.
 */
export function findFileOrderingFindings(
  lines: DiffLine[],
  readFile: FileReader = (p) => readFileSync(p, 'utf-8'),
): Finding[] {
  const tsFiles = [
    ...new Set(
      lines
        .filter(
          l =>
            /\.[tj]sx?$/.test(l.file) && !SELF_EXCLUDED_FILES.has(l.file),
        )
        .map(l => l.file),
    ),
  ]

  const findings: Finding[] = []

  for (const file of tsFiles) {
    let content: string
    try {
      content = readFile(file)
    } catch {
      continue
    }

    const fileLines = content.split('\n')

    const writeLines = fileLines
      .map((text, i) => ({ text, lineNo: i + 1 }))
      .filter(({ text }) => /\bawait\s+write\w*FileAsync\s*\(/.test(text))

    const spawnLines = fileLines
      .map((text, i) => ({ text, lineNo: i + 1 }))
      .filter(({ text }) => /\bawait\s+spawn\w*Teammate\s*\(/.test(text))

    for (const write of writeLines) {
      for (const spawn of spawnLines) {
        const distance = spawn.lineNo - write.lineNo
        // Only flag if spawn comes after write and both are within 100 lines
        // (a rough proxy for the same function body).
        if (distance <= 0 || distance > 100) continue

        // Confirm they share the same function scope: no closing brace at the
        // write's indentation level (or less) should appear between them.
        const writeIndent = write.text.match(/^(\s*)/)?.[1].length ?? 0
        const between = fileLines.slice(write.lineNo, spawn.lineNo - 1)
        const scopeExit = between.some(l => {
          const indent = l.match(/^(\s*)/)?.[1].length ?? 0
          return /^\s*\}/.test(l) && indent <= writeIndent
        })

        if (!scopeExit) {
          findings.push({
            severity: 'medium',
            code: 'write-before-fallible-spawn',
            file,
            line: write.lineNo,
            detail: `File write at line ${write.lineNo} precedes fallible spawn at line ${spawn.lineNo} — a failed spawn leaves a ghost entry on disk`,
            excerpt: trimExcerpt(write.text),
          })
        }
      }
    }
  }

  return findings
}

export function scanAddedLines(
  lines: DiffLine[],
  options?: { readFile?: FileReader },
): Finding[] {
  const readFile = options?.readFile
  const findings = lines
    .filter(line => !SELF_EXCLUDED_FILES.has(line.file))
    .flatMap(line => [
      ...findUrlFindings(line),
      ...findCommandFindings(line),
      ...findSensitivePathFindings(line),
    ])
  return uniqueFindings([
    ...findings,
    ...findFileOrderingFindings(lines, readFile),
  ])
}

export function getGitDiff(baseRef: string): string {
  const mergeBase = spawnSync('git', ['merge-base', baseRef, 'HEAD'], {
    encoding: 'utf8',
  })

  if (mergeBase.status !== 0) {
    throw new Error(
      `Could not determine merge-base with ${baseRef}: ${mergeBase.stderr.trim() || mergeBase.stdout.trim()}`,
    )
  }

  const base = mergeBase.stdout.trim()
  const diff = spawnSync(
    'git',
    ['diff', '--unified=0', '--no-ext-diff', `${base}...HEAD`],
    { encoding: 'utf8' },
  )

  if (diff.status !== 0) {
    throw new Error(`git diff failed: ${diff.stderr.trim() || diff.stdout.trim()}`)
  }

  return diff.stdout
}

function shouldFail(findings: Finding[], failOn: FindingSeverity): boolean {
  if (failOn === 'medium') {
    return findings.length > 0
  }
  return findings.some(finding => finding.severity === 'high')
}

function renderText(findings: Finding[]): string {
  if (findings.length === 0) {
    return 'PR intent scan: no suspicious additions found.'
  }

  const high = findings.filter(f => f.severity === 'high')
  const medium = findings.filter(f => f.severity === 'medium')
  const lines = [
    `PR intent scan: ${findings.length} finding(s)`,
    `- high: ${high.length}`,
    `- medium: ${medium.length}`,
    '',
  ]

  for (const finding of findings) {
    lines.push(
      `[${finding.severity.toUpperCase()}] ${finding.file}:${finding.line} ${finding.detail}`,
    )
    lines.push(`  ${finding.excerpt}`)
  }

  return lines.join('\n')
}

export function run(options: CliOptions): number {
  const diff = getGitDiff(options.baseRef)
  const addedLines = parseAddedLines(diff)
  const findings = scanAddedLines(addedLines)

  if (options.json) {
    process.stdout.write(
      `${JSON.stringify(
        {
          baseRef: options.baseRef,
          addedLines: addedLines.length,
          findings,
        },
        null,
        2,
      )}\n`,
    )
  } else {
    process.stdout.write(`${renderText(findings)}\n`)
  }

  return shouldFail(findings, options.failOn) ? 1 : 0
}

if (import.meta.main) {
  const options = parseOptions(process.argv.slice(2))
  process.exitCode = run(options)
}
