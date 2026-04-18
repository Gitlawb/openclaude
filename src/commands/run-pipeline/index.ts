
import type { Command, LocalCommandCall } from '../../types/command.js';
import { executeStandardPipeline } from '../../engine/pipeline/builtInPipeline.js';

const call: LocalCommandCall = async () => {
  const cwd = process.cwd();
  
  try {
    const result = await executeStandardPipeline(cwd);
    const { score, grade, explanation, project, securityFindings, securityWarnings } = result;

    const severitySummary = {
      critical: securityFindings.filter(f => f.severity === 'critical').length,
      high: securityFindings.filter(f => f.severity === 'high').length,
      medium: securityFindings.filter(f => f.severity === 'medium').length,
      low: securityFindings.filter(f => f.severity === 'low').length,
      info: securityFindings.filter(f => f.severity === 'info').length,
    };

    const statusText = grade.toUpperCase();
    
    let output = `
Pipeline Execution Report
-------------------------

Score: ${score} / 100
Status: ${statusText}

Project:
- Type: ${project.type}
- Tests: ${project.files.hasTests ? '✅' : '❌'}
- CI: ${project.files.hasCI ? '✅' : '❌'}
- Docker: ${project.files.hasDockerfile ? '✅' : '❌'}

Security:
- Findings: ${securityFindings.length}
- Critical: ${severitySummary.critical}
- High: ${severitySummary.high}
- Medium: ${severitySummary.medium}
- Low: ${severitySummary.low}

Warnings:
${securityWarnings.length > 0 ? securityWarnings.map(w => `- ${w}`).join('\n') : '- None'}

Explanation:
${explanation.map(e => `- ${e}`).join('\n')}

Audit artifacts generated in: reports/
`;

    return {
      type: 'text',
      value: output
    };
  } catch (error: any) {
    return {
      type: 'text',
      value: `
Pipeline Execution Error
------------------------

${error.message}
`
    };
  }
}

const runPipelineCmd = {
  type: 'local',
  name: 'run-pipeline',
  description: 'Execute full audit pipeline with automated scoring',
  supportsNonInteractive: true,
  load: () => Promise.resolve({ call }),
} satisfies Command;

export default runPipelineCmd;
