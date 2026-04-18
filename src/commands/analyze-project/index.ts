
import type { Command, LocalCommandCall } from '../../types/command.js';
import { analyzeProject } from '../../engine/project/analyzeProject.js';

const call: LocalCommandCall = async () => {
  const cwd = process.cwd();
  const inspection = await analyzeProject(cwd);

  const findingsText = inspection.findings.length > 0
    ? inspection.findings.map(f => `[${f.severity.toUpperCase()}] ${f.message}`).join('\n')
    : 'No findings detected.';

  const output = `
Project Analysis Report
-----------------------
Path: ${inspection.path}
Type: ${inspection.type.toUpperCase()}
Package Manager: ${inspection.packageManager}

Structure Details:
- Tests: ${inspection.files.hasTests ? '✅ Detected' : '❌ Not found'}
- CI/CD: ${inspection.files.hasCI ? '✅ Detected' : '❌ Not found'}
- Docker: ${inspection.files.hasDockerfile ? '✅ Detected' : '❌ Not found'}

Detected Files:
${inspection.files.detected.map(f => `  - ${f}`).join('\n')}

Detected Directories:
${inspection.directories.detected.map(d => `  - ${d}`).join('\n')}

Findings & Recommendations:
${findingsText}

Next Steps:
- Detailed security scan coming in Phase 3.
`;

  return {
    type: 'text',
    value: output
  };
}

const analyzeProjectCmd = {
  type: 'local',
  name: 'analyze-project',
  description: 'Analyze current project structure and health',
  supportsNonInteractive: true,
  load: () => Promise.resolve({ call }),
} satisfies Command;

export default analyzeProjectCmd;
