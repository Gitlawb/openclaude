export function extractGitHubRepoSlug(value: string): string | null {
  const trimmed = value.trim()

  if (/^[a-z][a-z0-9+.-]*:\/\//i.test(trimmed) && !trimmed.includes('github.com')) {
    return null
  }

  if (!trimmed.includes('github.com')) {
    return trimmed
  }

  const sshMatch = trimmed.match(
    /^(?:git@|ssh:\/\/git@)(?:www\.)?github\.com[:/](?<owner>[^/:\s]+)\/(?<repo>[^/\s]+?)(?:\.git)?\/?$/i,
  )
  if (sshMatch?.groups?.owner && sshMatch.groups.repo) {
    return `${sshMatch.groups.owner}/${sshMatch.groups.repo}`
  }

  try {
    const parsed = new URL(trimmed)
    const hostname = parsed.hostname.toLowerCase()
    if (hostname !== 'github.com' && hostname !== 'www.github.com') {
      return null
    }

    const segments = parsed.pathname
      .replace(/^\/+|\/+$/g, '')
      .split('/')
      .filter(Boolean)
    if (segments.length < 2) {
      return null
    }

    return `${segments[0]}/${segments[1]}`.replace(/\.git$/i, '')
  } catch {
    return null
  }
}
