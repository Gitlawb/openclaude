
import type { GeneratedReport } from './reportTypes.js';

export function renderJson(report: GeneratedReport): string {
  return JSON.stringify(report, null, 2);
}
