
import type { ProjectInspection } from '../../types/project.js';
import type { SecurityFinding } from '../security/securityTypes.js';
import type { GeneratedReport } from '../report/reportTypes.js';

export type PipelineResult = {
  project: ProjectInspection;
  securityFindings: SecurityFinding[];
  securityWarnings: string[];
  report: GeneratedReport;
  score: number;
  grade: 'pass' | 'warn' | 'fail';
  explanation: string[];
};
