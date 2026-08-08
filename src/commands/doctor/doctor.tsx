import React from 'react';
import { Doctor } from '../../screens/Doctor.js';
import type {
  LocalJSXCommandCall,
  LocalJSXCommandOnDone,
} from '../../types/command.js';
import {
  parseIssueReportArgs,
  renderIssueReport,
  writeIssueReport,
} from '../../utils/diagnostics/issueReport.js'

export function splitDoctorArgs(args: string): string[] {
  const parts: string[] = []
  let current = ''
  let quote: '"' | "'" | null = null
  let escaping = false

  for (let index = 0; index < args.length; index++) {
    const char = args[index]!
    const next = args[index + 1]
    if (escaping) {
      current += char
      escaping = false
      continue
    }

    if (
      char === '\\' &&
      (quote || next === '\\' || next === '"' || next === "'" || /\s/.test(next ?? ''))
    ) {
      escaping = true
      continue
    }

    if (quote) {
      if (char === quote) {
        quote = null
      } else {
        current += char
      }
      continue
    }

    if (char === '"' || char === "'") {
      quote = char
      continue
    }

    if (/\s/.test(char)) {
      if (current) {
        parts.push(current)
        current = ''
      }
      continue
    }

    current += char
  }

  if (escaping) current += '\\'
  if (current) parts.push(current)

  return parts
}

type DoctorReportDependencies = {
  parseIssueReportArgs: typeof parseIssueReportArgs
  renderIssueReport: typeof renderIssueReport
  writeIssueReport: typeof writeIssueReport
}

const defaultDoctorReportDependencies: DoctorReportDependencies = {
  parseIssueReportArgs,
  renderIssueReport,
  writeIssueReport,
}

export async function runDoctorReportCommand(
  args: string[],
  onDone: LocalJSXCommandOnDone,
  dependencies: DoctorReportDependencies = defaultDoctorReportDependencies,
): Promise<null> {
  const options = dependencies.parseIssueReportArgs(args)
  if (!options.redacted) {
    throw new Error('Unredacted diagnostic reports are not supported')
  }

  const content = await dependencies.renderIssueReport(options)
  if (options.outFile) {
    const outputPath = dependencies.writeIssueReport(options.outFile, content)
    onDone(`Diagnostic report written to ${outputPath}`, { display: 'system' })
    return null
  }

  onDone(content, { display: 'system' })
  return null
}

export function createDoctorCommandCall(
  dependencies: DoctorReportDependencies = defaultDoctorReportDependencies,
): LocalJSXCommandCall {
  return async (onDone, _context, args) => {
    const parts = splitDoctorArgs(args)
    if (parts[0]?.toLowerCase() === 'report') {
      return runDoctorReportCommand(parts.slice(1), onDone, dependencies)
    }

    return Promise.resolve(<Doctor onDone={onDone} />);
  }
}

export const call: LocalJSXCommandCall = createDoctorCommandCall()
