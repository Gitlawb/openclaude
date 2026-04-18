
import type { Command, LocalCommandCall } from '../../types/command.js';
import { buildReport } from '../../engine/report/reportBuilder.js';
import { writeReportFiles } from '../../engine/report/reportWriter.js';

const call: LocalCommandCall = async () => {
  const cwd = process.cwd();
  
  try {
    const report = await buildReport(cwd);
    const { markdownPath, jsonPath } = await writeReportFiles(report, cwd);

    const { severitySummary, warnings } = report.security;

    const output = `
Technical Report Generated
--------------------------

Path: ${cwd}
Markdown: ${markdownPath}
JSON: ${jsonPath}

Security Findings: ${report.security.findings.length}
- Critical: ${severitySummary.critical}
- High: ${severitySummary.high}
- Medium: ${severitySummary.medium}
- Low: ${severitySummary.low}
- Info: ${severitySummary.info}

Project Findings: ${report.projectFindings.length}
Recommendations: ${report.recommendations.length}

${warnings.length > 0 ? `\nWarnings:\n${warnings.map(w => `- ${w}`).join('\n')}` : ''}
`;

    return {
      type: 'text',
      value: output
    };
  } catch (error: any) {
    return {
      type: 'text',
      value: `
Report Generation Error
-----------------------

${error.message}
`
    };
  }
}

const generateReportCmd = {
  type: 'local',
  name: 'generate-report',
  description: 'Consolidate all analysis results into professional reports (MD/JSON)',
  supportsNonInteractive: true,
  load: () => Promise.resolve({ call }),
} satisfies Command;

export default generateReportCmd;
