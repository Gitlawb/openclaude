#!/usr/bin/env bun

import {
  analyzeUnusedCode,
  formatUnusedAnalysisReport,
  parseUnusedAnalysisArgs,
} from '../src/utils/unusedAnalysis.js'

const options = parseUnusedAnalysisArgs(process.argv.slice(2))
const report = analyzeUnusedCode(options)

if (options.json) {
  console.log(JSON.stringify(report, null, 2))
} else {
  console.log(formatUnusedAnalysisReport(report))
}

if (
  options.failOnFindings &&
  (report.summary.unusedImports > 0 || report.summary.unusedDeclarations > 0)
) {
  process.exitCode = 1
}
