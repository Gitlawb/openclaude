
import { exec } from 'node:child_process';
import { promisify } from 'node:util';

const execPromise = promisify(exec);

export type TrivyRawResult = {
  ok: boolean;
  stdout: string;
  stderr: string;
  error?: 'TRIVY_NOT_FOUND' | 'TIMEOUT' | 'EXEC_ERROR';
};

export async function runTrivy(cwd: string): Promise<TrivyRawResult> {
  try {
    const { stdout, stderr } = await execPromise('trivy fs --format json --scanners vuln .', {
      cwd,
      timeout: 300000, // 5 minutes
    });

    return {
      ok: true,
      stdout,
      stderr,
    };
  } catch (error: any) {
    if (error.stdout) {
      return {
        ok: true,
        stdout: error.stdout,
        stderr: error.stderr,
      };
    }

    const isNotFound = 
      error.code === 'ENOENT' || 
      error.code === 127 || 
      String(error.message).includes('not found') || 
      String(error.message).includes('no encontrada');

    return {
      ok: false,
      stdout: '',
      stderr: error.stderr || error.message,
      error: isNotFound ? 'TRIVY_NOT_FOUND' : 'EXEC_ERROR',
    };
  }
}
