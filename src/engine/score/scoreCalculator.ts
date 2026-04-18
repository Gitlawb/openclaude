
import type { ScoreBreakdown } from './scoreTypes.js';
import type { SecurityFinding } from '../security/securityTypes.js';
import type { ProjectInspection } from '../../types/project.js';

export function calculateScore(
  securityFindings: SecurityFinding[],
  project: ProjectInspection
): ScoreBreakdown {
  const baseScore = 100;
  let penalties = 0;

  // Security Penalties
  for (const f of securityFindings) {
    switch (f.severity) {
      case 'critical': penalties += 40; break;
      case 'high': penalties += 20; break;
      case 'medium': penalties += 8; break;
      case 'low': penalties += 3; break;
    }
  }

  // Project Structure Penalties
  if (!project.files.hasTests) penalties += 10;
  if (!project.files.hasCI) penalties += 8;
  if (!project.files.hasEnvExample) penalties += 3;
  if (!project.files.hasGitignore) penalties += 10;

  const finalScore = Math.max(0, baseScore - penalties);

  return {
    baseScore,
    penalties,
    finalScore,
  };
}

export function getGrade(score: number): 'pass' | 'warn' | 'fail' {
  if (score >= 80) return 'pass';
  if (score >= 50) return 'warn';
  return 'fail';
}
