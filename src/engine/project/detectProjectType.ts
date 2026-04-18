
import { existsSync } from 'node:fs';
import { join } from 'node:path';
import type { ProjectType, PackageManager } from '../../types/project.js';

export function detectProjectType(cwd: string): { type: ProjectType; packageManager: PackageManager } {
  const hasFile = (file: string) => existsSync(join(cwd, file));

  const checks = {
    node: hasFile('package.json') || hasFile('bun.lock') || hasFile('pnpm-lock.yaml') || hasFile('yarn.lock') || hasFile('package-lock.json'),
    python: hasFile('pyproject.toml') || hasFile('requirements.txt') || hasFile('setup.py'),
    go: hasFile('go.mod'),
    rust: hasFile('Cargo.toml'),
  };

  const detectedTypes = Object.entries(checks)
    .filter(([_, exists]) => exists)
    .map(([type]) => type as ProjectType);

  let type: ProjectType = 'unknown';
  if (detectedTypes.length > 1) {
    type = 'mixed';
  } else if (detectedTypes.length === 1) {
    type = detectedTypes[0];
  }

  // Detect Package Manager
  let packageManager: PackageManager = 'unknown';

  if (hasFile('bun.lock') || hasFile('bun.lockb')) {
    packageManager = 'bun';
  } else if (hasFile('pnpm-lock.yaml')) {
    packageManager = 'pnpm';
  } else if (hasFile('yarn.lock')) {
    packageManager = 'yarn';
  } else if (hasFile('package-lock.json')) {
    packageManager = 'npm';
  } else if (hasFile('uv.lock')) {
    packageManager = 'uv';
  } else if (hasFile('poetry.lock')) {
    packageManager = 'poetry';
  } else if (hasFile('requirements.txt')) {
    packageManager = 'pip';
  } else if (hasFile('go.mod')) {
    packageManager = 'go';
  } else if (hasFile('Cargo.toml')) {
    packageManager = 'cargo';
  }

  return { type, packageManager };
}
