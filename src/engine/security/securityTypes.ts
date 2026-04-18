
export type SecuritySeverity = 
  | 'info' 
  | 'low' 
  | 'medium' 
  | 'high' 
  | 'critical';

export type SecurityFindingSource = 'semgrep' | 'trivy';

export type SecurityFinding = {
  source: SecurityFindingSource;
  severity: SecuritySeverity;
  title: string;
  description: string;

  // SAST specific (Semgrep)
  file?: string;
  line?: number;
  ruleId?: string;
  category?: string;

  // SCA specific (Trivy)
  packageName?: string;
  installedVersion?: string;
  fixedVersion?: string;
  vulnerabilityId?: string;
  target?: string;

  metadata?: Record<string, unknown>;
};

export type SecurityScanResult = {
  findings: SecurityFinding[];
  warnings: string[];
};
