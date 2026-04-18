
import { analyzeProject } from '../project/analyzeProject.js';
import { runSecurityScan } from '../security/securityAggregator.js';
import type { GeneratedReport, SeveritySummary, SourceSummary } from './reportTypes.js';

export async function buildReport(cwd: string): Promise<GeneratedReport> {
  const projectInspection = await analyzeProject(cwd);
  const securityResult = await runSecurityScan(cwd);

  const severitySummary: SeveritySummary = {
    critical: 0,
    high: 0,
    medium: 0,
    low: 0,
    info: 0,
  };

  const sourceSummary: SourceSummary = {};

  for (const finding of securityResult.findings) {
    severitySummary[finding.severity]++;
    sourceSummary[finding.source] = (sourceSummary[finding.source] || 0) + 1;
  }

  const recommendations: string[] = [];

  if (severitySummary.critical > 0) {
    recommendations.push('Address critical security findings before deployment.');
  }
  if (severitySummary.high > 0) {
    recommendations.push('Review and remediate high-severity findings as a priority.');
  }
  if (!projectInspection.files.hasTests) {
    recommendations.push('Add automated tests to improve confidence in future scans.');
  }
  if (!projectInspection.files.hasCI) {
    recommendations.push('Consider adding CI workflows for continuous validation.');
  }
  if (!projectInspection.files.hasEnvExample) {
    recommendations.push('Provide a .env.example file to document expected environment variables.');
  }

  return {
    generatedAt: new Date().toISOString(),
    project: {
      cwd,
      type: projectInspection.type,
      packageManager: projectInspection.packageManager,
      hasTests: projectInspection.files.hasTests,
      hasCI: projectInspection.files.hasCI,
      hasDockerfile: projectInspection.files.hasDockerfile,
      detectedFiles: projectInspection.files.detected,
      detectedDirectories: projectInspection.directories.detected,
    },
    projectFindings: projectInspection.findings,
    security: {
      findings: securityResult.findings,
      warnings: securityResult.warnings,
      severitySummary,
      sourceSummary,
    },
    recommendations,
  };
}
