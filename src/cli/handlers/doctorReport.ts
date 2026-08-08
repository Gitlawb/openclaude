import {
  formatIssueReport,
  buildIssueReport,
  writeIssueReport,
  type IssueReportArgs,
} from '../../utils/diagnostics/issueReport.js'

function formatError(error: unknown): string {
  return error instanceof Error ? error.message : String(error)
}

export async function doctorReportHandler(
  options: IssueReportArgs,
): Promise<void> {
  if (!options.redacted) {
    throw new Error('Unredacted diagnostic reports are not supported')
  }

  const report = await buildIssueReport({
    includeDebug: options.includeDebug,
  })
  const content = formatIssueReport(report, options.format)

  if (options.outFile) {
    const outputPath = writeIssueReport(options.outFile, content)
    console.log(`Diagnostic report written to ${outputPath}`)
    return
  }

  console.log(content)
}

export function printDoctorReportError(error: unknown): void {
  console.error(`Failed to generate diagnostic report: ${formatError(error)}`)
}
