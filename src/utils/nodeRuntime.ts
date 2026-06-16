export const MIN_NODE_MAJOR = 22
export const MIN_NODE_VERSION = '22.0.0'
export const MIN_NODE_ENGINE_RANGE = `>=${MIN_NODE_VERSION}`

export type NodeVersionCheckResult =
  | {
    ok: true
    version: string
    major: number
  }
  | {
    ok: false
    version: string
    major: number | null
    message: string
  }

function normalizeNodeVersion(rawVersion: string): string {
  return rawVersion.trim().replace(/^v/, '')
}

function parseNodeMajor(version: string): number | null {
  const major = Number(version.split('.')[0] ?? '')
  return Number.isInteger(major) ? major : null
}

export function checkSupportedNodeVersion(
  rawVersion: string,
): NodeVersionCheckResult {
  const version = normalizeNodeVersion(rawVersion)
  const major = parseNodeMajor(version)

  if (major === null) {
    return {
      ok: false,
      version,
      major,
      message: `Could not parse Node.js version: ${version}. OpenClaude requires Node.js ${MIN_NODE_ENGINE_RANGE}.`,
    }
  }

  if (major < MIN_NODE_MAJOR) {
    return {
      ok: false,
      version,
      major,
      message: `Detected ${version}. OpenClaude requires Node.js ${MIN_NODE_ENGINE_RANGE}. Install Node ${MIN_NODE_MAJOR} LTS or newer, then reinstall/re-run OpenClaude.`,
    }
  }

  return {
    ok: true,
    version,
    major,
  }
}
