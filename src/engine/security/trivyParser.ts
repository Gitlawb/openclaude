
import type { SecurityFinding, SecuritySeverity } from './securityTypes.js';

export function parseTrivy(json: string): SecurityFinding[] {
  try {
    const data = JSON.parse(json);
    if (!data.Results || !Array.isArray(data.Results)) {
      return [];
    }

    const findings: SecurityFinding[] = [];

    for (const result of data.Results) {
      if (!result.Vulnerabilities || !Array.isArray(result.Vulnerabilities)) {
        continue;
      }

      for (const vuln of result.Vulnerabilities) {
        const trivySeverity = vuln.Severity || 'UNKNOWN';
        
        let severity: SecuritySeverity = 'info';
        if (trivySeverity === 'CRITICAL') {
          severity = 'critical';
        } else if (trivySeverity === 'HIGH') {
          severity = 'high';
        } else if (trivySeverity === 'MEDIUM') {
          severity = 'medium';
        } else if (trivySeverity === 'LOW') {
          severity = 'low';
        }

        findings.push({
          source: 'trivy',
          severity,
          title: vuln.Title || vuln.VulnerabilityID || 'Vulnerable dependency detected',
          description: vuln.Description || 'No description provided.',
          packageName: vuln.PkgName,
          installedVersion: vuln.InstalledVersion,
          fixedVersion: vuln.FixedVersion,
          vulnerabilityId: vuln.VulnerabilityID,
          target: result.Target,
          metadata: {
            references: vuln.References,
            cvss: vuln.CVSS,
            datasource: vuln.DataSource,
          },
        });
      }
    }

    return findings;
  } catch (error) {
    console.error('Error parsing Trivy JSON:', error);
    return [];
  }
}
