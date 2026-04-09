/**
 * Hook Scripts Tests
 *
 * Tests shell script argument handling for pre-edit-check.sh and post-edit-log.sh.
 * Verifies that scripts accept $1 argument with TOOL_INPUT env var fallback.
 */


import { join, dirname } from 'path';
import { fileURLToPath } from 'url';
import { spawn } from 'child_process';
import { tmpdir } from 'os';
import fs from 'fs-extra';

// Get the directory of this test file
const __dirname = dirname(fileURLToPath(import.meta.url));
// Scripts live at repo-root/scripts/hawat/ after Phase 1D copy
const scriptsDir = join(__dirname, '..', '..', '..', 'scripts', 'hawat');

// Test directory setup
const TEST_BASE = join(tmpdir(), 'forge-hooks-test');
let testDir;

/**
 * Create a unique test directory for each test
 */
function createTestDir() {
  const uniqueId = `${Date.now()}-${Math.random().toString(36).substr(2, 9)}`;
  return join(TEST_BASE, uniqueId);
}

/**
 * Execute a shell script and capture output
 * @param {string} scriptPath - Path to the script
 * @param {string[]} args - Command line arguments
 * @param {object} env - Environment variables
 * @returns {Promise<{code: number, stdout: string, stderr: string}>}
 */
function runScript(scriptPath, args = [], env = {}) {
  return new Promise((resolve) => {
    const child = spawn(scriptPath, args, {
      env: { ...process.env, ...env },
      cwd: testDir
    });

    let stdout = '';
    let stderr = '';

    child.stdout.on('data', (data) => {
      stdout += data.toString();
    });

    child.stderr.on('data', (data) => {
      stderr += data.toString();
    });

    child.on('close', (code) => {
      resolve({ code: code || 0, stdout, stderr });
    });

    child.on('error', (err) => {
      resolve({ code: 1, stdout, stderr: err.message });
    });
  });
}

beforeAll(async () => {
  // Ensure base test directory exists
  await fs.ensureDir(TEST_BASE);
});

beforeEach(async () => {
  testDir = createTestDir();
  await fs.ensureDir(testDir);
});

afterEach(async () => {
  // Clean up test directory
  if (testDir && await fs.pathExists(testDir)) {
    await fs.remove(testDir);
  }
});

afterAll(async () => {
  // Clean up base test directory
  if (await fs.pathExists(TEST_BASE)) {
    await fs.remove(TEST_BASE);
  }
});

describe('Hook Scripts', () => {
  describe('pre-edit-check.sh', () => {
    const scriptPath = join(scriptsDir, 'pre-edit-check.sh');

    describe('argument handling', () => {
      it('should accept $1 argument for file path', async () => {
        const testFile = join(testDir, 'test-file.js');
        await fs.writeFile(testFile, 'content');

        const result = await runScript(scriptPath, [testFile]);

        expect(result.code).toBe(0);
      });

      it('should fall back to TOOL_INPUT env var when $1 is not provided', async () => {
        const testFile = join(testDir, 'test-file.js');
        await fs.writeFile(testFile, 'content');

        const result = await runScript(scriptPath, [], { TOOL_INPUT: testFile });

        expect(result.code).toBe(0);
      });

      it('should prefer $1 argument over TOOL_INPUT env var', async () => {
        const argFile = join(testDir, 'arg-file.js');
        const envFile = join(testDir, 'env-file.js');
        await fs.writeFile(argFile, 'content');
        await fs.writeFile(envFile, 'content');

        // Pass allowed file via $1, blocked file via TOOL_INPUT
        const result = await runScript(scriptPath, [argFile], { TOOL_INPUT: envFile });

        // Should succeed because it uses the $1 arg (allowed file)
        expect(result.code).toBe(0);
      });

      it('should handle empty input gracefully (exit 0)', async () => {
        // No $1 arg, no TOOL_INPUT env var
        const result = await runScript(scriptPath, []);

        expect(result.code).toBe(0);
      });

      it('should handle empty string $1 argument gracefully', async () => {
        const result = await runScript(scriptPath, ['']);

        expect(result.code).toBe(0);
      });
    });

    describe('file blocking', () => {
      it('should block .env files', async () => {
        const envFile = join(testDir, '.env');
        await fs.writeFile(envFile, 'SECRET=value');

        const result = await runScript(scriptPath, [envFile]);

        expect(result.code).toBe(1);
        expect(result.stdout).toContain('BLOCKED');
      });

      it('should block .envrc files', async () => {
        const envrcFile = join(testDir, '.envrc');
        await fs.writeFile(envrcFile, 'export SECRET=value');

        const result = await runScript(scriptPath, [envrcFile]);

        expect(result.code).toBe(1);
        expect(result.stdout).toContain('BLOCKED');
      });

      it('should block files in secrets directory', async () => {
        const secretsDir = join(testDir, 'secrets');
        await fs.ensureDir(secretsDir);
        const secretFile = join(secretsDir, 'api-key.txt');
        await fs.writeFile(secretFile, 'secret');

        const result = await runScript(scriptPath, [secretFile]);

        expect(result.code).toBe(1);
        expect(result.stdout).toContain('BLOCKED');
      });

      it('should block .pem files', async () => {
        const pemFile = join(testDir, 'private.pem');
        await fs.writeFile(pemFile, '-----BEGIN PRIVATE KEY-----');

        const result = await runScript(scriptPath, [pemFile]);

        expect(result.code).toBe(1);
        expect(result.stdout).toContain('BLOCKED');
      });

      it('should block .key files', async () => {
        const keyFile = join(testDir, 'server.key');
        await fs.writeFile(keyFile, 'key content');

        const result = await runScript(scriptPath, [keyFile]);

        expect(result.code).toBe(1);
        expect(result.stdout).toContain('BLOCKED');
      });

      it('should block credentials.json files', async () => {
        const credsFile = join(testDir, 'credentials.json');
        await fs.writeFile(credsFile, '{}');

        const result = await runScript(scriptPath, [credsFile]);

        expect(result.code).toBe(1);
        expect(result.stdout).toContain('BLOCKED');
      });

      it('should block kubeconfig files', async () => {
        const kubeFile = join(testDir, '.kubeconfig');
        await fs.writeFile(kubeFile, 'clusters: []');

        const result = await runScript(scriptPath, [kubeFile]);

        expect(result.code).toBe(1);
        expect(result.stdout).toContain('BLOCKED');
      });

      it('should block .tfvars files', async () => {
        const tfvarsFile = join(testDir, 'prod.tfvars');
        await fs.writeFile(tfvarsFile, 'api_key = "secret"');

        const result = await runScript(scriptPath, [tfvarsFile]);

        expect(result.code).toBe(1);
        expect(result.stdout).toContain('BLOCKED');
      });

      it('should block .tfstate files', async () => {
        const tfstateFile = join(testDir, 'terraform.tfstate');
        await fs.writeFile(tfstateFile, '{}');

        const result = await runScript(scriptPath, [tfstateFile]);

        expect(result.code).toBe(1);
        expect(result.stdout).toContain('BLOCKED');
      });
    });

    describe('file allowing', () => {
      it('should allow regular JavaScript files', async () => {
        const jsFile = join(testDir, 'app.js');
        await fs.writeFile(jsFile, 'console.log("hello")');

        const result = await runScript(scriptPath, [jsFile]);

        expect(result.code).toBe(0);
      });

      it('should allow regular TypeScript files', async () => {
        const tsFile = join(testDir, 'app.ts');
        await fs.writeFile(tsFile, 'const x: number = 1');

        const result = await runScript(scriptPath, [tsFile]);

        expect(result.code).toBe(0);
      });

      it('should allow JSON config files', async () => {
        const jsonFile = join(testDir, 'config.json');
        await fs.writeFile(jsonFile, '{}');

        const result = await runScript(scriptPath, [jsonFile]);

        expect(result.code).toBe(0);
      });

      it('should allow markdown files', async () => {
        const mdFile = join(testDir, 'README.md');
        await fs.writeFile(mdFile, '# README');

        const result = await runScript(scriptPath, [mdFile]);

        expect(result.code).toBe(0);
      });
    });

    describe('warnings', () => {
      it('should warn about new file creation', async () => {
        const newFile = join(testDir, 'new-file.js');
        // Don't create the file - it doesn't exist

        const result = await runScript(scriptPath, [newFile]);

        expect(result.code).toBe(0);
        expect(result.stdout).toContain('Creating new file');
      });

      it('should warn about lock file editing', async () => {
        const lockFile = join(testDir, 'package-lock.json');
        await fs.writeFile(lockFile, '{}');

        const result = await runScript(scriptPath, [lockFile]);

        expect(result.code).toBe(0);
        expect(result.stdout).toContain('WARNING');
      });
    });
  });

  describe('post-edit-log.sh', () => {
    const scriptPath = join(scriptsDir, 'post-edit-log.sh');

    describe('argument handling', () => {
      it('should accept $1 argument for file path', async () => {
        const testFile = join(testDir, 'test-file.js');
        await fs.writeFile(testFile, 'content');

        const result = await runScript(scriptPath, [testFile]);

        expect(result.code).toBe(0);
        expect(result.stderr).toContain('EDIT:');
        expect(result.stderr).toContain(testFile);
      });

      it('should fall back to TOOL_INPUT env var when $1 is not provided', async () => {
        const testFile = join(testDir, 'test-file.js');
        await fs.writeFile(testFile, 'content');

        const result = await runScript(scriptPath, [], { TOOL_INPUT: testFile });

        expect(result.code).toBe(0);
        expect(result.stderr).toContain('EDIT:');
        expect(result.stderr).toContain(testFile);
      });

      it('should prefer $1 argument over TOOL_INPUT env var', async () => {
        const argFile = join(testDir, 'arg-file.js');
        const envFile = join(testDir, 'env-file.js');
        await fs.writeFile(argFile, 'content');
        await fs.writeFile(envFile, 'content');

        const result = await runScript(scriptPath, [argFile], { TOOL_INPUT: envFile });

        expect(result.code).toBe(0);
        // Should log the $1 arg, not the TOOL_INPUT
        expect(result.stderr).toContain(argFile);
        expect(result.stderr).not.toContain(envFile);
      });

      it('should handle empty input gracefully (exit 0)', async () => {
        // No $1 arg, no TOOL_INPUT env var
        const result = await runScript(scriptPath, []);

        expect(result.code).toBe(0);
      });

      it('should handle empty string $1 argument gracefully', async () => {
        const result = await runScript(scriptPath, ['']);

        expect(result.code).toBe(0);
      });
    });

    describe('session logging', () => {
      it('should log to HAWAT_SESSION_LOG when available', async () => {
        const testFile = join(testDir, 'edited-file.js');
        const sessionLog = join(testDir, 'session.log');
        await fs.writeFile(testFile, 'content');

        const result = await runScript(scriptPath, [testFile], {
          HAWAT_SESSION_LOG: sessionLog
        });

        expect(result.code).toBe(0);

        // Check that session log was created and contains the file path
        const logExists = await fs.pathExists(sessionLog);
        expect(logExists).toBe(true);

        const logContent = await fs.readFile(sessionLog, 'utf-8');
        expect(logContent).toContain(testFile);
      });

      it('should work without HAWAT_SESSION_LOG', async () => {
        const testFile = join(testDir, 'edited-file.js');
        await fs.writeFile(testFile, 'content');

        // Don't set HAWAT_SESSION_LOG
        const result = await runScript(scriptPath, [testFile]);

        expect(result.code).toBe(0);
        expect(result.stderr).toContain('EDIT:');
      });
    });

    describe('never blocks edits', () => {
      it('should always exit 0 even for sensitive files', async () => {
        // post-edit-log should never block - it's just for logging
        const envFile = join(testDir, '.env');
        await fs.writeFile(envFile, 'SECRET=value');

        const result = await runScript(scriptPath, [envFile]);

        // Should still exit 0 - logging should never block
        expect(result.code).toBe(0);
      });
    });
  });

  describe('Integration: both scripts with same input patterns', () => {
    const preEditPath = join(scriptsDir, 'pre-edit-check.sh');
    const postEditPath = join(scriptsDir, 'post-edit-log.sh');

    it('should handle $1 argument consistently across scripts', async () => {
      const testFile = join(testDir, 'consistent-test.js');
      await fs.writeFile(testFile, 'content');

      const preResult = await runScript(preEditPath, [testFile]);
      const postResult = await runScript(postEditPath, [testFile]);

      expect(preResult.code).toBe(0);
      expect(postResult.code).toBe(0);
    });

    it('should handle TOOL_INPUT consistently across scripts', async () => {
      const testFile = join(testDir, 'tool-input-test.js');
      await fs.writeFile(testFile, 'content');

      const preResult = await runScript(preEditPath, [], { TOOL_INPUT: testFile });
      const postResult = await runScript(postEditPath, [], { TOOL_INPUT: testFile });

      expect(preResult.code).toBe(0);
      expect(postResult.code).toBe(0);
    });

    it('should handle empty input consistently across scripts', async () => {
      const preResult = await runScript(preEditPath, []);
      const postResult = await runScript(postEditPath, []);

      expect(preResult.code).toBe(0);
      expect(postResult.code).toBe(0);
    });
  });
});
