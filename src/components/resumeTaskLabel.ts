import type { CodeSession } from 'src/utils/teleport/api.js'

export type ResumeTaskSessionMetadata = CodeSession & {
  timeString: string
}

export function buildResumeTaskOptionLabel(
  timeString: string,
  title: string,
  repo: CodeSession['repo'],
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

export function getResumeTaskOptionLabelColumns(
  terminalColumns: number,
  optionCount: number,
): number {
  const indexColumnWidth = String(optionCount).length + 2
  const rowChromeWidth = 2 + indexColumnWidth + 2

  return Math.max(0, terminalColumns - rowChromeWidth)
}

export function buildResumeTaskOptionsFromMetadata(
  sessionMetadata: ResumeTaskSessionMetadata[],
  terminalColumns: number,
): Array<{ label: string; value: string }> {
  const optionLabelColumns = getResumeTaskOptionLabelColumns(
    terminalColumns,
    sessionMetadata.length,
  )
  const maxTimeStringLength = Math.max(
    'Updated'.length,
    ...sessionMetadata.map(meta => meta.timeString.length),
  )

  return sessionMetadata.map(({ timeString, title, repo, id }) => ({
    label: buildResumeTaskOptionLabel(
      timeString,
      title,
      repo,
      maxTimeStringLength,
      optionLabelColumns,
    ),
    value: id,
  }))
}
