
import type { SecurityFinding } from '../security/securityTypes.js';
import type { ProjectInspection } from '../../types/project.js';

export function explainScore(
  securityFindings: SecurityFinding[],
  project: ProjectInspection
): string[] {
  const explanation: string[] = [];

  const criticals = securityFindings.filter(f => f.severity === 'critical').length;
  const highs = securityFindings.filter(f => f.severity === 'high').length;
  const mediums = securityFindings.filter(f => f.severity === 'medium').length;

  if (criticals > 0) {
    explanation.push(`Critical vulnerabilities (${criticals}) significantly impact the score.`);
  }
  if (highs > 0) {
    explanation.push(`High severity issues (${highs}) contributed major penalties.`);
  }
  if (mediums > 0) {
    explanation.push(`Medium vulnerabilities (${mediums}) contributed moderate penalties.`);
  }

  if (!project.files.hasTests) {
    explanation.push('Missing test coverage reduces reliability and score (-10).');
  }
  if (!project.files.hasCI) {
    explanation.push('No CI pipeline detected, impacting continuous validation score (-8).');
  }
  if (!project.files.hasGitignore) {
    explanation.push('Missing .gitignore is a major security and structure risk (-10).');
  }
  if (!project.files.hasEnvExample) {
    explanation.push('Missing .env.example file, environment documentation recommended (-3).');
  }

  if (explanation.length === 0) {
    explanation.push('Project follows major best practices and has no significant security findings.');
  }

  return explanation;
}
