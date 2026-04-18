
import { runSemgrep } from './semgrepRunner.js';
import { parseSemgrep } from './semgrepParser.js';
import { runTrivy } from './trivyRunner.js';
import { parseTrivy } from './trivyParser.js';
import type { SecurityFinding, SecurityScanResult } from './securityTypes.js';

export async function runSecurityScan(cwd: string): Promise<SecurityScanResult> {
  const findings: SecurityFinding[] = [];
  const warnings: string[] = [];

  const [semgrepResult, trivyResult] = await Promise.allSettled([
    runSemgrep(cwd),
    runTrivy(cwd)
  ]);

  // Handle Semgrep
  if (semgrepResult.status === 'fulfilled') {
    const res = semgrepResult.value;
    if (res.ok) {
      findings.push(...parseSemgrep(res.stdout));
    } else if (res.error === 'SEMGREP_NOT_FOUND') {
      warnings.push('Semgrep not found. Install it for SAST (code) scanning: https://semgrep.dev/');
    } else {
      warnings.push(`Semgrep execution failed: ${res.stderr}`);
    }
  } else {
    warnings.push(`Semgrep scan crashed: ${semgrepResult.reason}`);
  }

  // Handle Trivy
  if (trivyResult.status === 'fulfilled') {
    const res = trivyResult.value;
    if (res.ok) {
      findings.push(...parseTrivy(res.stdout));
    } else if (res.error === 'TRIVY_NOT_FOUND') {
      warnings.push('Trivy not found. Install it for SCA (dependency) scanning: https://aquasecurity.github.io/trivy/');
    } else {
      warnings.push(`Trivy execution failed: ${res.stderr}`);
    }
  } else {
    warnings.push(`Trivy scan crashed: ${trivyResult.reason}`);
  }

  const sortedFindings = findings.sort((a, b) => {
    const weights = { critical: 0, high: 1, medium: 2, low: 3, info: 4 };
    return weights[a.severity] - weights[b.severity];
  });

  return {
    findings: sortedFindings,
    warnings
  };
}
