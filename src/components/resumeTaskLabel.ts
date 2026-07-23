export type ResumeTaskRepo = {
  name: string
  owner: {
    login: string
  }
} | null

export function buildResumeTaskOptionLabel(
  timeString: string,
  title: string,
  repo: ResumeTaskRepo,
  maxTimeStringLength: number,
  terminalColumns?: number,
): string {
  const paddedTime = timeString.padEnd(maxTimeStringLength, ' ')
  const baseLabel = `${paddedTime}  ${title}`

  if (!repo) {
    return baseLabel
  }

  const repoLabel = `  ${repo.owner.login}/${repo.name}`
  if (terminalColumns === undefined) {
    return `${baseLabel}${repoLabel}`
  }

  const baseLabelWidth = Array.from(baseLabel).length
  const availableRepoLabelWidth = terminalColumns - baseLabelWidth
  if (availableRepoLabelWidth <= 0) {
    return baseLabel
  }

  const repoCharacters = Array.from(repoLabel)
  if (repoCharacters.length <= availableRepoLabelWidth) {
    return `${baseLabel}${repoLabel}`
  }

  if (availableRepoLabelWidth <= 1) {
    return baseLabel
  }

  return `${baseLabel}${repoCharacters.slice(0, availableRepoLabelWidth - 1).join('')}…`
}
