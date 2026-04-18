
import { mkdir, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import type { GeneratedReport } from './reportTypes.js';
import { renderMarkdown } from './reportMarkdown.js';
import { renderJson } from './reportJson.js';

export async function writeReportFiles(report: GeneratedReport, cwd: string): Promise<{
  markdownPath: string;
  jsonPath: string;
}> {
  const reportsDir = join(cwd, 'reports');
  
  try {
    await mkdir(reportsDir, { recursive: true });
  } catch (err: any) {
    throw new Error(`Failed to create reports directory: ${err.message}`);
  }

  const timestamp = new Date().toISOString()
    .replace(/[:.]/g, '-')
    .replace('T', '_')
    .slice(0, 19);
  
  const baseName = `audit-report-${timestamp}`;
  const markdownPath = join(reportsDir, `${baseName}.md`);
  const jsonPath = join(reportsDir, `${baseName}.json`);

  try {
    await Promise.all([
      writeFile(markdownPath, renderMarkdown(report)),
      writeFile(jsonPath, renderJson(report)),
    ]);
  } catch (err: any) {
    throw new Error(`Failed to write report files: ${err.message}`);
  }

  return {
    markdownPath,
    jsonPath,
  };
}
