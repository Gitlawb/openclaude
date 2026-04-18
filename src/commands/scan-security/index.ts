
import type { Command, LocalCommandCall } from '../../types/command.js';
import { runSecurityScan } from '../../engine/security/securityAggregator.js';

const call: LocalCommandCall = async () => {
  const cwd = process.cwd();
  
  try {
    const result = await runSecurityScan(cwd);
    const { findings, warnings } = result;

    if (findings.length === 0 && warnings.length === 0) {
      return {
        type: 'text',
        value: `
Security Scan Report
--------------------

No security issues found. ✅
`
      };
    }

    let output = `
Security Scan Report
--------------------

Findings: ${findings.length}
`;

    if (findings.length > 0) {
      output += '\n' + findings.map(f => {
        const source = `[${f.source}]`;
        const severity = `[${f.severity.toUpperCase()}]`;
        
        let details = '';
        if (f.source === 'semgrep') {
          const location = f.file ? `File: ${f.file}${f.line ? `:${f.line}` : ''}` : 'Location unknown';
          details = `${location}${f.ruleId ? `\nRule: ${f.ruleId}` : ''}`;
        } else if (f.source === 'trivy') {
          details = `Package: ${f.packageName || 'unknown'}\nInstalled: ${f.installedVersion || 'unknown'}${f.fixedVersion ? `\nFixed: ${f.fixedVersion}` : ''}\nVuln: ${f.vulnerabilityId || 'unknown'}\nTarget: ${f.target || 'unknown'}`;
        }

        return `${source}${severity} ${f.title}\n${details}\nDescription: ${f.description}`;
      }).join('\n\n');
    } else {
      output += '\nNo security issues found in active scanners. ✅';
    }

    if (warnings.length > 0) {
      output += `\n\nWarnings:\n${warnings.map(w => `- ${w}`).join('\n')}`;
    }

    return {
      type: 'text',
      value: output
    };
  } catch (error: any) {
    return {
      type: 'text',
      value: `
Security Scan Error
-------------------

${error.message}
`
    };
  }
}

const scanSecurityCmd = {
  type: 'local',
  name: 'scan-security',
  description: 'Run unified security scan (Semgrep + Trivy)',
  supportsNonInteractive: true,
  load: () => Promise.resolve({ call }),
} satisfies Command;

export default scanSecurityCmd;
