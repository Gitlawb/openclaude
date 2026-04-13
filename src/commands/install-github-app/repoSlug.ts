export function extractGitHubRepoSlug(value: string): string | null {
  const trimmed = value.trim()

  const slugMatch = trimmed.match(
    /^(?<owner>[^/:\s]+)\/(?<repo>[^/\s]+?)(?:\.git)?\/?$/i,
  )
  if (slugMatch?.groups?.owner && slugMatch.groups.repo) {
    return `${slugMatch.groups.owner}/${slugMatch.groups.repo}`.replace(
      /\.git$/i,
      '',
    )
  }

  const shorthandUrlMatch = trimmed.match(
    /^(?:https?:\/\/)?(?:www\.)?github\.com\/(?<owner>[^/:\s]+)\/(?<repo>[^/\s]+?)(?:\.git)?\/?$/i,
  )
  if (shorthandUrlMatch?.groups?.owner && shorthandUrlMatch.groups.repo) {
    return `${shorthandUrlMatch.groups.owner}/${shorthandUrlMatch.groups.repo}`.replace(
      /\.git$/i,
      '',
    )
  }

  const sshMatch = trimmed.match(
    /^(?:git@|ssh:\/\/git@)(?:www\.)?github\.com[:/](?<owner>[^/:\s]+)\/(?<repo>[^/\s]+?)(?:\.git)?\/?$/i,
  )
  if (sshMatch?.groups?.owner && sshMatch.groups.repo) {
    return `${sshMatch.groups.owner}/${sshMatch.groups.repo}`
  }

  if (/^[a-z][a-z0-9+.-]*:\/\//i.test(trimmed)) {
    return null
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
