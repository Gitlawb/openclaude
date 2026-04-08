import { existsSync, readFileSync } from 'fs'
import { homedir } from 'os'
import { dirname, join, resolve } from 'path'

function stripQuotes(value) {
  if (value.length < 2) {
    return value
  }

  const first = value[0]
  const last = value.at(-1)
  if ((first === '"' && last === '"') || (first === "'" && last === "'")) {
    const unquoted = value.slice(1, -1)
    return first === '"'
      ? unquoted
          .replace(/\\n/g, '\n')
          .replace(/\\r/g, '\r')
          .replace(/\\t/g, '\t')
          .replace(/\\"/g, '"')
          .replace(/\\\\/g, '\\')
      : unquoted
  }

  return value
}

export function parseDotEnv(contents) {
  const parsed = {}

  for (const rawLine of contents.split(/\r?\n/)) {
    const trimmed = rawLine.trim()
    if (!trimmed || trimmed.startsWith('#')) {
      continue
    }

    const normalized = trimmed.startsWith('export ')
      ? trimmed.slice('export '.length).trim()
      : trimmed

    const separatorIndex = normalized.indexOf('=')
    if (separatorIndex <= 0) {
      continue
    }

    const key = normalized.slice(0, separatorIndex).trim()
    if (!/^[A-Za-z_][A-Za-z0-9_]*$/.test(key)) {
      continue
    }

    let value = normalized.slice(separatorIndex + 1).trim()
    if (value && !value.startsWith('"') && !value.startsWith("'")) {
      const inlineCommentIndex = value.search(/\s#/)
      if (inlineCommentIndex !== -1) {
        value = value.slice(0, inlineCommentIndex).trim()
      }
    }

    parsed[key] = stripQuotes(value)
  }

  return parsed
}

export function getEnvFileCandidates({
  cwd,
  packageRoot,
  homeDir = homedir(),
}) {
  const candidates = []
  const stopDir = resolve(homeDir)
  let current = resolve(cwd)

  while (true) {
    candidates.push(join(current, '.env'))

    if (current === stopDir) {
      break
    }

    const parent = dirname(current)
    if (parent === current) {
      break
    }

    current = parent
  }

  if (packageRoot) {
    const packageDotEnv = join(resolve(packageRoot), '.env')
    if (!candidates.includes(packageDotEnv)) {
      candidates.push(packageDotEnv)
    }
  }

  return candidates
}

export function loadLauncherEnv({
  cwd = process.cwd(),
  env = process.env,
  packageRoot,
  homeDir,
} = {}) {
  const loadedFiles = []

  for (const filePath of getEnvFileCandidates({ cwd, packageRoot, homeDir })) {
    if (!existsSync(filePath)) {
      continue
    }

    const parsed = parseDotEnv(readFileSync(filePath, 'utf8'))
    for (const [key, value] of Object.entries(parsed)) {
      if (env[key] === undefined || env[key] === '') {
        env[key] = value
      }
    }

    loadedFiles.push(filePath)
  }

  return loadedFiles
}
