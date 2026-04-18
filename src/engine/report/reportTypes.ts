
import type { ProjectInspection } from '../../types/project.js';
import type { SecurityFinding } from '../security/securityTypes.js';

export type SeveritySummary = {
  critical: number;
  high: number;
  medium: number;
  low: number;
  info: number;
};

export type SourceSummary = Record<string, number>;

export type GeneratedReport = {
  generatedAt: string;
  project: {
    cwd: string;
    type: string;
    packageManager: string;
    hasTests: boolean;
    hasCI: boolean;
    hasDockerfile: boolean;
    detectedFiles: string[];
    detectedDirectories: string[];
  };
  projectFindings: ProjectInspection['findings'];
  security: {
    findings: SecurityFinding[];
    warnings: string[];
    severitySummary: SeveritySummary;
    sourceSummary: SourceSummary;
  };
  recommendations: string[];
};
