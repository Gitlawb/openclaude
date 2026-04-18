
import { existsSync, readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';

export interface FileInspection {
  detectedFiles: string[];
  detectedDirectories: string[];
  hasReadme: boolean;
  hasGitignore: boolean;
  hasDockerfile: boolean;
  hasCI: boolean;
  hasEnvExample: boolean;
  hasTests: boolean;
  hasPackageJson: boolean;
  hasTsConfig: boolean;
  hasPyProject: boolean;
  hasRequirements: boolean;
  hasGoMod: boolean;
  hasCargoToml: boolean;
}

export function inspectProjectFiles(cwd: string): FileInspection {
  const filesToCheck = [
    'README.md',
    '.gitignore',
    'Dockerfile',
    '.env.example',
    'package.json',
    'tsconfig.json',
    'pyproject.toml',
    'requirements.txt',
    'go.mod',
    'Cargo.toml'
  ];

  const dirsToCheck = [
    'src',
    'app',
    'tests',
    'test',
    'docs',
    'scripts',
    '.github'
  ];

  const detectedFiles: string[] = [];
  const detectedDirectories: string[] = [];

  for (const file of filesToCheck) {
    if (existsSync(join(cwd, file)) && statSync(join(cwd, file)).isFile()) {
      detectedFiles.push(file);
    }
  }

  for (const dir of dirsToCheck) {
    if (existsSync(join(cwd, dir)) && statSync(join(cwd, dir)).isDirectory()) {
      detectedDirectories.push(dir);
    }
  }

  return {
    detectedFiles,
    detectedDirectories,
    hasReadme: detectedFiles.includes('README.md'),
    hasGitignore: detectedFiles.includes('.gitignore'),
    hasDockerfile: detectedFiles.includes('Dockerfile'),
    hasCI: existsSync(join(cwd, '.github/workflows')),
    hasEnvExample: detectedFiles.includes('.env.example'),
    hasTests: 
      detectedDirectories.includes('tests') || 
      detectedDirectories.includes('test') ||
      existsSync(join(cwd, 'src/__tests__')) ||
      existsSync(join(cwd, 'jest.config.ts')) ||
      existsSync(join(cwd, 'jest.config.js')) ||
      existsSync(join(cwd, 'vitest.config.ts')) ||
      existsSync(join(cwd, 'vitest.config.js')) ||
      existsSync(join(cwd, 'pytest.ini')),
    hasPackageJson: detectedFiles.includes('package.json'),
    hasTsConfig: detectedFiles.includes('tsconfig.json'),
    hasPyProject: detectedFiles.includes('pyproject.toml'),
    hasRequirements: detectedFiles.includes('requirements.txt'),
    hasGoMod: detectedFiles.includes('go.mod'),
    hasCargoToml: detectedFiles.includes('Cargo.toml'),
  };
}
