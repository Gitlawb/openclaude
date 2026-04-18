
export type ProjectType = 'node' | 'python' | 'go' | 'rust' | 'mixed' | 'unknown';

export type PackageManager = 
  | 'bun' 
  | 'pnpm' 
  | 'yarn' 
  | 'npm' 
  | 'pip' 
  | 'poetry' 
  | 'uv' 
  | 'go' 
  | 'cargo' 
  | 'unknown';

export type Severity = 'info' | 'low' | 'medium';

export interface StructureFinding {
  severity: Severity;
  message: string;
}

export interface ProjectInspection {
  path: string;
  type: ProjectType;
  packageManager: PackageManager;
  files: {
    detected: string[];
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
  };
  directories: {
    detected: string[];
  };
  findings: StructureFinding[];
}
