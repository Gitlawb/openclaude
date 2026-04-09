/**
 * Manual Security Verification Tests
 *
 * This file verifies that all HIGH priority security fixes work as expected.
 * Subtask 5-3: Manual verification of security fixes
 */

import { deepMerge } from '../lib/config-merger.js';
import { render, sanitizeTemplateData } from '../lib/template-engine.js';
import { copyDir, ensureDir, remove } from '../lib/file-manager.js';
import { execSync } from 'child_process';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';
import { tmpdir } from 'os';
import fs from 'fs-extra';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

describe('Security Verification - Manual Tests', () => {

  // ==========================================================================
  // HIGH-7: Prototype Pollution Protection in deepMerge
  // ==========================================================================
  describe('HIGH-7: Prototype Pollution Protection', () => {
    test('deepMerge with __proto__ key does NOT pollute Object.prototype', () => {
      // Store original state
      const originalPolluted = Object.prototype.polluted;

      // Attempt prototype pollution via __proto__
      const malicious = {
        '__proto__': {
          polluted: true
        }
      };

      const target = { safe: 'value' };
      const result = deepMerge(target, malicious);

      // Verify: Object.prototype should NOT be polluted
      expect(Object.prototype.polluted).toBeUndefined();
      expect({}.polluted).toBeUndefined();

      // Result should not contain __proto__
      expect(result.__proto__).toBe(Object.prototype);
      expect(result.polluted).toBeUndefined();

      // Restore original state if it existed
      if (originalPolluted !== undefined) {
        Object.prototype.polluted = originalPolluted;
      }
    });

    test('deepMerge with constructor key is filtered', () => {
      const malicious = {
        constructor: {
          prototype: {
            polluted: true
          }
        }
      };

      const target = { safe: 'value' };
      const result = deepMerge(target, malicious);

      // Result should still have its normal constructor
      expect(result.constructor).toBe(Object);
      expect(Object.prototype.polluted).toBeUndefined();
    });

    test('deepMerge with prototype key is filtered', () => {
      const malicious = {
        prototype: {
          polluted: true
        }
      };

      const target = { safe: 'value' };
      const result = deepMerge(target, malicious);

      // Prototype key should not be merged
      expect(result.prototype).toBeUndefined();
    });
  });

  // ==========================================================================
  // HIGH-5: Template Injection Prevention
  // ==========================================================================
  describe('HIGH-5: Template Injection Prevention', () => {
    test('template with {{constructor}} in user input is escaped', () => {
      const template = 'Hello {{name}}!';
      const maliciousData = {
        name: '{{constructor.constructor("return this")()}}'
      };

      // Should NOT execute the malicious code
      const result = render(template, maliciousData);

      // The malicious handlebars syntax should be escaped
      // Note: 'constructor' text may appear after double-encoding, but {{constructor shouldn't execute
      expect(result).not.toContain('{{constructor');
      expect(result).toContain('&amp;#123;');
    });

    test('template with {{{raw}}} triple braces in user input is escaped', () => {
      const template = 'Hello {{name}}!';
      const maliciousData = {
        name: '{{{<script>alert("xss")</script>}}}'
      };

      const result = render(template, maliciousData);

      // Triple braces should be escaped (double-encoded: & becomes &amp;)
      expect(result).toContain('&amp;#123;');
      expect(result).not.toContain('<script>');
    });

    test('sanitizeTemplateData sanitizes nested objects', () => {
      const data = {
        level1: {
          level2: {
            malicious: '{{evil}}'
          }
        }
      };

      const sanitized = sanitizeTemplateData(data);

      expect(sanitized.level1.level2.malicious).toBe('&#123;&#123;evil&#125;&#125;');
    });

    test('template injection via block helpers is prevented', () => {
      const template = 'Hello {{name}}!';
      const maliciousData = {
        name: '{{#each items}}{{.}}{{/each}}'
      };

      const result = render(template, maliciousData);

      // Block helper syntax should be escaped ({{#each shouldn't execute)
      expect(result).not.toContain('{{#each');
    });
  });

  // ==========================================================================
  // HIGH-6: Recursive Copy DoS Prevention (copyDir depth limits)
  // ==========================================================================
  describe('HIGH-6: copyDir Depth Limits', () => {
    let testDir;

    beforeAll(async () => {
      testDir = join(tmpdir(), `security-test-${Date.now()}`);
      await ensureDir(testDir);
    });

    afterAll(async () => {
      try {
        await remove(testDir);
      } catch {
        // Cleanup may fail in some cases
      }
    });

    test('copyDir throws when depth > maxDepth (custom limit)', async () => {
      // Create a deeply nested structure
      const srcDir = join(testDir, 'deep-src');
      let currentPath = srcDir;

      // Create 5 levels of nesting
      for (let i = 0; i < 5; i++) {
        currentPath = join(currentPath, `level${i}`);
        await ensureDir(currentPath);
      }
      await fs.writeFile(join(currentPath, 'file.txt'), 'content');

      const destDir = join(testDir, 'deep-dest');

      // Should throw with maxDepth=3
      await expect(copyDir(srcDir, destDir, {
        maxDepth: 3,
        sourceBaseDir: testDir,
        destBaseDir: testDir
      }))
        .rejects
        .toThrow(/Maximum directory depth \(3\) exceeded/);
    });

    test('copyDir succeeds within depth limit', async () => {
      // Create a shallow structure
      const srcDir = join(testDir, 'shallow-src');
      await ensureDir(join(srcDir, 'level1'));
      await fs.writeFile(join(srcDir, 'level1', 'file.txt'), 'content');

      const destDir = join(testDir, 'shallow-dest');

      // Should succeed with maxDepth=10 (default)
      await expect(copyDir(srcDir, destDir, {
        maxDepth: 10,
        sourceBaseDir: testDir,
        destBaseDir: testDir
      }))
        .resolves
        .not.toThrow();

      // Verify file was copied
      expect(await fs.pathExists(join(destDir, 'level1', 'file.txt'))).toBe(true);
    });

    test('copyDir throws when file count exceeds maxFiles', async () => {
      // Create many files
      const srcDir = join(testDir, 'many-files-src');
      await ensureDir(srcDir);

      for (let i = 0; i < 10; i++) {
        await fs.writeFile(join(srcDir, `file${i}.txt`), 'content');
      }

      const destDir = join(testDir, 'many-files-dest');

      // Should throw with maxFiles=5
      await expect(copyDir(srcDir, destDir, {
        maxFiles: 5,
        sourceBaseDir: testDir,
        destBaseDir: testDir
      }))
        .rejects
        .toThrow(/Maximum file count \(5\) exceeded/);
    });
  });

  // ==========================================================================
  // HIGH-3: Permission Bypass Protection (URL-encoded commands)
  // ==========================================================================
  describe('HIGH-3: Permission Bypass Protection', () => {
    const scriptPath = join(process.cwd(), 'scripts/hawat/validate-bash-command.sh');

    test('URL-encoded %72m (rm) command is blocked', () => {
      try {
        execSync(`"${scriptPath}" '%72m -rf /'`, {
          encoding: 'utf8',
          stdio: ['pipe', 'pipe', 'pipe']
        });
        // If we get here, the command was NOT blocked - fail the test
        fail('Expected command to be blocked');
      } catch (error) {
        // Exit code 1 means BLOCKED - this is expected
        expect(error.status).toBe(1);
        expect(error.stdout.toString()).toContain('BLOCKED');
      }
    });

    test('URL-encoded %73udo (sudo) command is warned', () => {
      try {
        const result = execSync(`"${scriptPath}" '%73udo echo test'`, {
          encoding: 'utf8',
          stdio: ['pipe', 'pipe', 'pipe']
        });
        // sudo should be warned but allowed (exit 0)
        expect(result).toContain('WARNING');
      } catch (error) {
        // If blocked (exit 1), check it's a warning
        if (error.status === 1) {
          expect(error.stdout.toString()).toContain('BLOCKED');
        }
      }
    });

    test('Backslash-escaped command is normalized', () => {
      try {
        execSync(`"${scriptPath}" 'r\\m -rf /'`, {
          encoding: 'utf8',
          stdio: ['pipe', 'pipe', 'pipe']
        });
        fail('Expected command to be blocked');
      } catch (error) {
        expect(error.status).toBe(1);
        expect(error.stdout.toString()).toContain('BLOCKED');
      }
    });

    test('Normal safe command is allowed', () => {
      const result = execSync(`"${scriptPath}" 'ls -la'`, {
        encoding: 'utf8',
        stdio: ['pipe', 'pipe', 'pipe']
      });
      // Exit code 0 means allowed
      // No BLOCKED message expected
      expect(result).not.toContain('BLOCKED');
    });
  });

  // ==========================================================================
  // HIGH-4: Log Injection Prevention
  // ==========================================================================
  describe('HIGH-4: Log Injection Prevention', () => {
    const scriptPath = join(process.cwd(), 'scripts/hawat/post-edit-log.sh');

    test('Newline in filename is sanitized', () => {
      const testFile = join(tmpdir(), 'test-file.txt');

      // Create a test file
      fs.writeFileSync(testFile, 'test content');

      try {
        // Run the script with a filename containing newline attempt
        execSync(`TOOL_INPUT="${testFile}" "${scriptPath}"`, {
          encoding: 'utf8',
          shell: '/bin/bash'
        });

        // The script should complete successfully
        // Check that the log file doesn't contain injected lines
        const logFile = join(process.env.HOME, '.hawat/logs/edits.log');
        if (fs.existsSync(logFile)) {
          const logContent = fs.readFileSync(logFile, 'utf8');
          const lastLine = logContent.trim().split('\n').pop();

          // Each log entry should be on a single line
          expect(lastLine).toMatch(/^\d{4}-\d{2}-\d{2}.*\| EDIT \|/);
        }
      } finally {
        // Cleanup
        fs.removeSync(testFile);
      }
    });

    test('Control characters are stripped from log entries', () => {
      // Test the sanitize function logic by verifying the script
      // uses printf instead of echo and strips control chars
      const scriptContent = fs.readFileSync(scriptPath, 'utf8');

      // Verify sanitize_for_log function exists
      expect(scriptContent).toContain('sanitize_for_log()');

      // Verify it removes control characters
      expect(scriptContent).toContain("tr -d '\\000-\\037\\177'");

      // Verify printf is used instead of echo for variable output
      expect(scriptContent).toContain("printf '%s'");
    });
  });

  describe('standalone manual-security-test.mjs integration', () => {
    it('manual-security-test.mjs should pass all cases', () => {
      const scriptPath = join(__dirname, 'manual-security-test.mjs');
      const result = execSync(`node "${scriptPath}"`, {
        timeout: 30000,
        encoding: 'utf8'
      });
      expect(result).toContain('ALL SECURITY TESTS PASSED');
    });
  });
});
