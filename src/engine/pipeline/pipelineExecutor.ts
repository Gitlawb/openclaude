
import { analyzeProject } from '../project/analyzeProject.js';
import { runSecurityScan } from '../security/securityAggregator.js';
import { buildReport } from '../report/reportBuilder.js';
import { calculateScore, getGrade } from '../score/scoreCalculator.js';
import { explainScore } from '../score/scoreExplainer.js';
import type { PipelineResult } from './pipelineTypes.js';

export async function runPipeline(cwd: string): Promise<PipelineResult> {
  // 1. Analyze Project
  const project = await analyzeProject(cwd);

  // 2. Security Scan
  const security = await runSecurityScan(cwd);

  // 3. Build Report
  const report = await buildReport(cwd);

  // 4. Calculate Score
  const scoreBreakdown = calculateScore(security.findings, project);
  const score = scoreBreakdown.finalScore;
  const grade = getGrade(score);

  // 5. Explain Score
  const explanation = explainScore(security.findings, project);

  return {
    project,
    securityFindings: security.findings,
    securityWarnings: security.warnings,
    report,
    score,
    grade,
    explanation,
  };
}
