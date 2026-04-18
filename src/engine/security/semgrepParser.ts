
import type { SecurityFinding, SecuritySeverity } from './securityTypes.js';

export function parseSemgrep(json: string): SecurityFinding[] {
  try {
    const data = JSON.parse(json);
    if (!data.results || !Array.isArray(data.results)) {
      return [];
    }

    return data.results.map((result: any): SecurityFinding => {
      const semgrepSeverity = result.extra?.severity || 'INFO';
      
      let severity: SecuritySeverity = 'low';
      if (semgrepSeverity === 'ERROR') {
        severity = 'high';
      } else if (semgrepSeverity === 'WARNING') {
        severity = 'medium';
      }

      return {
        source: 'semgrep',
        severity,
        title: result.check_id.split('.').pop() || result.check_id,
        description: result.extra?.message || 'No description provided.',
        file: result.path,
        line: result.start?.line,
        ruleId: result.check_id,
        category: result.extra?.metadata?.category,
        metadata: result.extra?.metadata,
      };
    });
  } catch (error) {
    console.error('Error parsing Semgrep JSON:', error);
    return [];
  }
}
