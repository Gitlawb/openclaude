import type { LogOption } from '../types/logs.js'

export type ResumePrFilter = boolean | number | string | undefined

export function parsePrIdentifier(value: string): number | null {
  const directNumber = parseInt(value, 10)
  if (!isNaN(directNumber) && directNumber > 0) {
    return directNumber
  }
  const urlMatch = value.match(/github\.com\/[^/]+\/[^/]+\/pull\/(\d+)/)
  if (urlMatch?.[1]) {
    return parseInt(urlMatch[1], 10)
  }
  return null
}

export function filterResumeLogs(
  logs: LogOption[],
  filterByPr: ResumePrFilter,
): LogOption[] {
  let result = logs.filter(l => !l.isSidechain)
  if (filterByPr === undefined || filterByPr === false) {
    return result
  }
  if (filterByPr === true) {
    return result.filter(l => l.prNumber !== undefined)
  }
  if (typeof filterByPr === 'number') {
    return result.filter(l => l.prNumber === filterByPr)
  }
  const prNumber = parsePrIdentifier(filterByPr)
  if (prNumber !== null) {
    result = result.filter(l => l.prNumber === prNumber)
  }
  return result
}
