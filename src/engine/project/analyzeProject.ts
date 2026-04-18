
import { detectProjectType } from './detectProjectType.js';
import { inspectProjectFiles } from './inspectProjectFiles.js';
import { validateStructure } from './structureValidator.js';
import type { ProjectInspection } from '../../types/project.js';

export async function analyzeProject(cwd: string): Promise<ProjectInspection> {
  const { type, packageManager } = detectProjectType(cwd);
  const fileInspection = inspectProjectFiles(cwd);
  
  const partialInspection: Omit<ProjectInspection, 'findings'> = {
    path: cwd,
    type,
    packageManager,
    files: {
      detected: fileInspection.detectedFiles,
      hasReadme: fileInspection.hasReadme,
      hasGitignore: fileInspection.hasGitignore,
      hasDockerfile: fileInspection.hasDockerfile,
      hasCI: fileInspection.hasCI,
      hasEnvExample: fileInspection.hasEnvExample,
      hasTests: fileInspection.hasTests,
      hasPackageJson: fileInspection.hasPackageJson,
      hasTsConfig: fileInspection.hasTsConfig,
      hasPyProject: fileInspection.hasPyProject,
      hasRequirements: fileInspection.hasRequirements,
      hasGoMod: fileInspection.hasGoMod,
      hasCargoToml: fileInspection.hasCargoToml,
    },
    directories: {
      detected: fileInspection.detectedDirectories,
    },
  };

  const findings = validateStructure(partialInspection);

  return {
    ...partialInspection,
    findings,
  };
}
