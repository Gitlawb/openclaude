
import { exec } from 'node:child_process';
import { promisify } from 'node:util';

const execPromise = promisify(exec);

export type SemgrepRawResult = {
  ok: boolean;
  stdout: string;
  stderr: string;
  error?: string;
};

export async function runSemgrep(cwd: string): Promise<SemgrepRawResult> {
  try {
    const { stdout, stderr } = await execPromise('semgrep scan --config auto --json', {
      cwd,
      timeout: 300000, // 5 minutes timeout
    });
    
    return {
      ok: true,
      stdout,
      stderr,
    };
  } catch (error: any) {
    // Semgrep returns exit code 1 if it finds issues, which is technically an "error" for exec
    if (error.stdout) {
      return {
        ok: true,
        stdout: error.stdout,
        stderr: error.stderr,
      };
    }

    return {
      ok: false,
      stdout: '',
      stderr: error.stderr || error.message,
      error: (error.code === 'ENOENT' || error.code === 127 || String(error.message).includes('not found') || String(error.message).includes('no encontrada')) ? 'SEMGREP_NOT_FOUND' : 'UNKNOWN_ERROR',
    };
  }
}
