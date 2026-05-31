import { AGENT_TOOL_NAME } from '../AgentTool/constants.js'
import { BASH_TOOL_NAME } from '../BashTool/toolName.js'
import { TEST_RUNNER_TOOL_NAME } from './constants.js'

export function getDescription(): string {
  return `A structured test execution tool that runs tests and parses results.

  Usage:
  - Use ${TEST_RUNNER_TOOL_NAME} to run project tests with structured output parsing.
  - Auto-detects test framework (jest, vitest, pytest, go test, cargo test, etc.)
  - Parses test results into structured data: pass/fail counts, failure details, durations.
  - Tracks failure history across fix attempts to detect regressions.
  - Prefer this over running test commands via ${BASH_TOOL_NAME} — it provides structured results the agent can reason about.
  - For exploratory test runs or non-standard frameworks, use ${BASH_TOOL_NAME} directly.
  - Use ${AGENT_TOOL_NAME} for complex multi-step test workflows.
`
}
