import type { Command, LocalCommandCall } from '../../types/command.js'

const call: LocalCommandCall = async () => {
  const cwd = process.cwd()

  return {
    type: 'text',
    value: `
Analyze Project (bootstrap)

Path: ${cwd}

Status: ready
Next: project analyzer coming in Phase 2
`
  }
}

const analyzeProject = {
  type: 'local',
  name: 'analyze-project',
  description: 'Analyze current project structure (Phase 1 bootstrap)',
  supportsNonInteractive: true,
  load: () => Promise.resolve({ call }),
} satisfies Command

export default analyzeProject
