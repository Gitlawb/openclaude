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
): string {
  const paddedTime = timeString.padEnd(maxTimeStringLength, ' ')
  const repoLabel = repo ? `  ${repo.owner.login}/${repo.name}` : ''

  return `${paddedTime}  ${title}${repoLabel}`
}