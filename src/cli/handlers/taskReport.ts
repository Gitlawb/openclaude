import { resolve } from 'node:path'

import {
  buildTaskReport,
  formatTaskReport,
  writeTaskReport,
  type TaskReportArgs,
} from '../../utils/taskReport.js'
import {
  getProjectDir,
  getSessionFilesWithMtime,
} from '../../utils/sessionStorage.js'

function formatError(error: unknown): string {
  return error instanceof Error ? error.message : String(error)
}

function writeLine(
  stream: NodeJS.WritableStream,
  message: string,
): Promise<void> {
  return new Promise((resolve, reject) => {
    stream.write(`${message}\n`, error => {
      if (error) {
        reject(error)
      } else {
        resolve()
      }
    })
  })
}

export async function taskReportHandler(
  options: TaskReportArgs,
): Promise<void> {
  const cwd = resolve(options.cwd ?? process.cwd())
  const transcriptPath = await resolveTranscriptPath({
    cwd,
    sessionId: options.sessionId ?? null,
    transcriptPath: options.transcriptPath ?? null,
  })
  const report = await buildTaskReport({
    transcriptPath,
    cwd,
  })
  const content = formatTaskReport(report, options.format)

  if (options.outFile) {
    const outputPath = await writeTaskReport(options.outFile, content)
    await writeLine(process.stderr, `Task report written to ${outputPath}`)
    return
  }

  await writeLine(process.stdout, content)
}

export async function printTaskReportError(error: unknown): Promise<void> {
  await writeLine(
    process.stderr,
    `Failed to generate task report: ${formatError(error)}`,
  )
}

async function resolveTranscriptPath({
  cwd,
  sessionId,
  transcriptPath,
}: {
  cwd: string
  sessionId: string | null
  transcriptPath: string | null
}): Promise<string> {
  if (transcriptPath) {
    return resolve(cwd, transcriptPath)
  }

  const sessionFiles = await getSessionFilesWithMtime(getProjectDir(cwd))
  if (sessionId) {
    const sessionFile = sessionFiles.get(sessionId)
    if (!sessionFile) {
      throw new Error(`Session transcript not found: ${sessionId}`)
    }
    return sessionFile.path
  }

  let latest: { path: string; mtime: number; ctime: number } | null = null
  for (const sessionFile of sessionFiles.values()) {
    if (
      !latest ||
      sessionFile.mtime > latest.mtime ||
      (sessionFile.mtime === latest.mtime &&
        (sessionFile.ctime > latest.ctime ||
          (sessionFile.ctime === latest.ctime &&
            sessionFile.path.localeCompare(latest.path) < 0)))
    ) {
      latest = sessionFile
    }
  }
  if (!latest) {
    throw new Error(
      'No session transcripts found for the current project. Pass --transcript <file> or --session <id>.',
    )
  }
  return latest.path
}
