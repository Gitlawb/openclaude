
import type { StructureFinding, ProjectInspection, ProjectType } from '../../types/project.js';

export function validateStructure(
  inspection: Omit<ProjectInspection, 'findings'>
): StructureFinding[] {
  const findings: StructureFinding[] = [];

  // Info checks
  if (inspection.directories.detected.includes('src')) {
    findings.push({ severity: 'info', message: 'Standard src/ directory detected.' });
  }
  if (inspection.directories.detected.includes('docs')) {
    findings.push({ severity: 'info', message: 'Documentation directory detected.' });
  }
  if (inspection.directories.detected.includes('scripts')) {
    findings.push({ severity: 'info', message: 'Scripts directory detected.' });
  }

  // Warning checks
  if (!inspection.files.hasReadme) {
    findings.push({ severity: 'low', message: 'README.md is missing. Consider adding project documentation.' });
  }
  if (!inspection.files.hasGitignore) {
    findings.push({ severity: 'medium', message: '.gitignore is missing. Risk of committing sensitive or temporary files.' });
  }
  if (!inspection.files.hasEnvExample) {
    findings.push({ severity: 'low', message: '.env.example is missing. Documentation of environment variables is recommended.' });
  }
  if (!inspection.files.hasTests) {
    findings.push({ severity: 'medium', message: 'No tests directory detected (test/ or tests/). Testing is highly recommended.' });
  }
  if (!inspection.files.hasCI) {
    findings.push({ severity: 'medium', message: 'CI configuration (.github/workflows) not found.' });
  }

  // Node specific
  if (inspection.type === 'node' && !inspection.files.hasTsConfig) {
    findings.push({ severity: 'low', message: 'Node.js project detected but tsconfig.json is missing.' });
  }

  return findings;
}
