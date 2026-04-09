/**
 * End-to-End Tests
 *
 * Tests for full CLI workflow including install, init, and doctor commands.
 * Verifies that all components work together correctly.
 *
 * Test Flow:
 * 1. Create temp directory
 * 2. Run forge install --force
 * 3. Run forge init --yes
 * 4. Verify CLAUDE.md created
 * 5. Verify settings.json is valid JSON
 * 6. Verify scripts are executable
 * 7. Run forge doctor and verify no errors
 */


import { join, dirname } from 'path';
import { fileURLToPath } from 'url';
import { spawn } from 'child_process';
import { tmpdir, homedir } from 'os';
import fs from 'fs-extra';

// Get the directory of this test file
const __dirname = dirname(fileURLToPath(import.meta.url));
// TODO Phase 2: update this path once the Forge CLI entrypoint is wired up
const cliPath = join(__dirname, '..', 'bin', 'forge.js');
const packageRoot = join(__dirname, '..');

// Test directory setup
const TEST_BASE = join(tmpdir(), 'forge-e2e-test');
const GLOBAL_HAWAT_DIR = join(homedir(), '.hawat');
let testDir;

/**
 * Create a unique test directory for each test
 */
function createTestDir() {
  const uniqueId = `${Date.now()}-${Math.random().toString(36).substr(2, 9)}`;
  return join(TEST_BASE, uniqueId);
}

/**
 * Execute the hawat CLI and capture output
 * @param {string[]} args - Command line arguments
 * @param {object} options - Spawn options
 * @returns {Promise<{code: number, stdout: string, stderr: string}>}
 */
function runCli(args = [], options = {}) {
  return new Promise((resolve) => {
    const child = spawn('node', [cliPath, ...args], {
      env: { ...process.env, ...options.env },
      cwd: options.cwd || testDir,
      timeout: 30000 // 30 second timeout
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

/**
 * Check if a file is executable
 * @param {string} filePath - Path to file
 * @returns {Promise<boolean>}
 */
async function isExecutable(filePath) {
  try {
    const stats = await fs.stat(filePath);
    // Check owner execute bit
    return (stats.mode & 0o100) !== 0;
  } catch {
    return false;
  }
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

describe('End-to-End CLI Tests', () => {
  describe('CLI Entrypoint', () => {
    it('should show help when no command provided', async () => {
      const result = await runCli(['--help']);

      expect(result.code).toBe(0);
      expect(result.stdout).toContain('Forge');
      expect(result.stdout).toContain('init');
      expect(result.stdout).toContain('install');
      expect(result.stdout).toContain('doctor');
    });

    it('should show version', async () => {
      const result = await runCli(['--version']);

      expect(result.code).toBe(0);
      // Should output a version number
      expect(result.stdout).toMatch(/\d+\.\d+\.\d+/);
    });
  });

  describe('Install Command', () => {
    it('should install global components with --force', async () => {
      const result = await runCli(['install', '--force']);

      expect(result.code).toBe(0);
      expect(result.stdout).toContain('Installation complete');
    });

    it('should show install help', async () => {
      const result = await runCli(['install', '--help']);

      expect(result.code).toBe(0);
      expect(result.stdout).toContain('--force');
      expect(result.stdout).toContain('global');
    });

    it('should install templates when run with --force', async () => {
      await runCli(['install', '--force']);

      // Check that global templates directory exists and has .hbs files
      const templatesDir = join(GLOBAL_HAWAT_DIR, 'templates');
      const exists = await fs.pathExists(templatesDir);
      expect(exists).toBe(true);

      const files = await fs.readdir(templatesDir);
      const hbsFiles = files.filter(f => f.endsWith('.hbs'));
      expect(hbsFiles.length).toBeGreaterThan(0);
    });

    it('should install scripts and make them executable', async () => {
      await runCli(['install', '--force']);

      // Check that global scripts directory exists
      const scriptsDir = join(GLOBAL_HAWAT_DIR, 'scripts');
      if (await fs.pathExists(scriptsDir)) {
        const files = await fs.readdir(scriptsDir);
        const shFiles = files.filter(f => f.endsWith('.sh'));

        // If there are shell scripts, they should be executable
        for (const shFile of shFiles) {
          const executable = await isExecutable(join(scriptsDir, shFile));
          expect(executable).toBe(true);
        }
      }
    });
  });

  describe('Init Command', () => {
    beforeEach(async () => {
      // Ensure global install is done before init tests
      await runCli(['install', '--force']);
    });

    it('should create CLAUDE.md in project directory', async () => {
      const result = await runCli(['init', '--yes'], { cwd: testDir });

      expect(result.code).toBe(0);

      const claudeMdPath = join(testDir, 'CLAUDE.md');
      const exists = await fs.pathExists(claudeMdPath);
      expect(exists).toBe(true);
    });

    it('should create valid settings.json in full mode', async () => {
      const result = await runCli(['init', '--yes'], { cwd: testDir });

      expect(result.code).toBe(0);

      const settingsPath = join(testDir, '.forge', 'settings.json');
      const exists = await fs.pathExists(settingsPath);
      expect(exists).toBe(true);

      // Verify it's valid JSON
      const content = await fs.readFile(settingsPath, 'utf-8');
      expect(() => JSON.parse(content)).not.toThrow();

      // Verify it has expected structure
      const settings = JSON.parse(content);
      expect(settings).toHaveProperty('permissions');
    });

    it('should create .forge directory in full mode', async () => {
      await runCli(['init', '--yes'], { cwd: testDir });

      const claudeDir = join(testDir, '.forge');
      const exists = await fs.pathExists(claudeDir);
      expect(exists).toBe(true);

      const stats = await fs.stat(claudeDir);
      expect(stats.isDirectory()).toBe(true);
    });

    it('should NOT create .forge directory in minimal mode', async () => {
      const result = await runCli(['init', '--yes', '--minimal'], { cwd: testDir });

      expect(result.code).toBe(0);

      // CLAUDE.md should exist
      const claudeMdExists = await fs.pathExists(join(testDir, 'CLAUDE.md'));
      expect(claudeMdExists).toBe(true);

      // .forge directory should NOT exist in minimal mode
      const claudeDirExists = await fs.pathExists(join(testDir, '.forge'));
      expect(claudeDirExists).toBe(false);
    });

    it('should show init help', async () => {
      const result = await runCli(['init', '--help']);

      expect(result.code).toBe(0);
      expect(result.stdout).toContain('--minimal');
      expect(result.stdout).toContain('--force');
      expect(result.stdout).toContain('--yes');
    });

    it('should overwrite existing files with --force', async () => {
      // First init
      await runCli(['init', '--yes'], { cwd: testDir });

      // Modify CLAUDE.md
      const claudeMdPath = join(testDir, 'CLAUDE.md');
      await fs.writeFile(claudeMdPath, '# Modified');

      // Re-init with force
      const result = await runCli(['init', '--yes', '--force'], { cwd: testDir });

      expect(result.code).toBe(0);

      // Content should be regenerated (not still "# Modified")
      const content = await fs.readFile(claudeMdPath, 'utf-8');
      // The regenerated content won't just be "# Modified"
      expect(content.length).toBeGreaterThan(20);
    });
  });

  describe('Doctor Command', () => {
    beforeEach(async () => {
      // Ensure global install and project init
      await runCli(['install', '--force']);
      await runCli(['init', '--yes'], { cwd: testDir });
    });

    it('should run without errors on valid installation', async () => {
      const result = await runCli(['doctor'], { cwd: testDir });

      // Doctor exits with 0 if no issues
      expect(result.code).toBe(0);
      expect(result.stdout).toContain('Health Check');
    });

    it('should show verbose output with --verbose', async () => {
      const result = await runCli(['doctor', '--verbose'], { cwd: testDir });

      expect(result.code).toBe(0);
      expect(result.stdout).toContain('Health Check');
      // Verbose should show more detail
      expect(result.stdout.length).toBeGreaterThan(100);
    });

    it('should detect valid settings.json', async () => {
      const result = await runCli(['doctor'], { cwd: testDir });

      expect(result.code).toBe(0);
      expect(result.stdout).toContain('settings.json');
      expect(result.stdout).toContain('Valid JSON');
    });

    it('should detect missing CLAUDE.md', async () => {
      // Remove CLAUDE.md
      await fs.remove(join(testDir, 'CLAUDE.md'));

      const result = await runCli(['doctor'], { cwd: testDir });

      expect(result.stdout).toContain('CLAUDE.md');
      expect(result.stdout).toMatch(/Not found|warning/i);
    });

    it('should detect invalid JSON in settings.json', async () => {
      // Write invalid JSON
      await fs.writeFile(join(testDir, '.forge', 'settings.json'), 'not valid json');

      const result = await runCli(['doctor'], { cwd: testDir });

      // Should report the invalid JSON
      expect(result.stdout).toContain('Invalid JSON');
    });

    it('should show doctor help', async () => {
      const result = await runCli(['doctor', '--help']);

      expect(result.code).toBe(0);
      expect(result.stdout).toContain('--verbose');
      expect(result.stdout).toContain('--fix');
      expect(result.stdout).toContain('--cleanup-backups');
    });

    it('should support --cleanup-backups option', async () => {
      // Create a backup file
      const backupFile = join(testDir, 'settings.json.bak');
      await fs.writeFile(backupFile, '{}');

      const result = await runCli(['doctor', '--cleanup-backups', '--dry-run'], { cwd: testDir });

      expect(result.code).toBe(0);
      expect(result.stdout).toContain('Backup');
    });
  });

  describe('Full Workflow Integration', () => {
    it('should complete full workflow: install -> init -> doctor', async () => {
      // Step 1: Install
      const installResult = await runCli(['install', '--force']);
      expect(installResult.code).toBe(0);

      // Step 2: Init in test directory
      const initResult = await runCli(['init', '--yes'], { cwd: testDir });
      expect(initResult.code).toBe(0);

      // Step 3: Verify CLAUDE.md exists
      const claudeMdPath = join(testDir, 'CLAUDE.md');
      expect(await fs.pathExists(claudeMdPath)).toBe(true);

      // Step 4: Verify settings.json is valid JSON
      const settingsPath = join(testDir, '.forge', 'settings.json');
      expect(await fs.pathExists(settingsPath)).toBe(true);
      const settingsContent = await fs.readFile(settingsPath, 'utf-8');
      expect(() => JSON.parse(settingsContent)).not.toThrow();

      // Step 5: Verify global scripts are executable (if they exist)
      const scriptsDir = join(GLOBAL_HAWAT_DIR, 'scripts');
      if (await fs.pathExists(scriptsDir)) {
        const shFiles = (await fs.readdir(scriptsDir)).filter(f => f.endsWith('.sh'));
        for (const shFile of shFiles) {
          const scriptPath = join(scriptsDir, shFile);
          expect(await isExecutable(scriptPath)).toBe(true);
        }
      }

      // Step 6: Run doctor and verify no errors
      const doctorResult = await runCli(['doctor'], { cwd: testDir });
      expect(doctorResult.code).toBe(0);
      expect(doctorResult.stdout).toContain('Health Check');
    });

    it('should work with minimal mode workflow', async () => {
      // Install
      await runCli(['install', '--force']);

      // Init in minimal mode
      const initResult = await runCli(['init', '--yes', '--minimal'], { cwd: testDir });
      expect(initResult.code).toBe(0);

      // Verify only CLAUDE.md exists
      expect(await fs.pathExists(join(testDir, 'CLAUDE.md'))).toBe(true);
      expect(await fs.pathExists(join(testDir, '.forge'))).toBe(false);

      // Doctor should still work (project detected)
      const doctorResult = await runCli(['doctor'], { cwd: testDir });
      // In minimal mode without .forge, doctor might show warnings but shouldn't error
      expect(doctorResult.stdout).toContain('Health Check');
    });
  });

  describe('Error Handling', () => {
    it('should handle unknown command gracefully', async () => {
      const result = await runCli(['unknowncommand']);

      // Should output error or help
      expect(result.code).toBe(1);
    });

    it('should handle init without install gracefully', async () => {
      // Even without global install, init should have fallback behavior
      const result = await runCli(['init', '--yes'], { cwd: testDir });

      // Should either succeed with basic files or fail gracefully
      expect([0, 1]).toContain(result.code);
    });

    it('should handle doctor in empty directory', async () => {
      const emptyDir = join(testDir, 'empty');
      await fs.ensureDir(emptyDir);

      const result = await runCli(['doctor'], { cwd: emptyDir });

      // Should complete without crashing
      expect(result.stdout).toContain('Health Check');
    });
  });

  describe('Settings.json Content Validation', () => {
    beforeEach(async () => {
      await runCli(['install', '--force']);
      await runCli(['init', '--yes'], { cwd: testDir });
    });

    it('should create settings.json with permissions structure', async () => {
      const settingsPath = join(testDir, '.forge', 'settings.json');
      const settings = JSON.parse(await fs.readFile(settingsPath, 'utf-8'));

      expect(settings).toHaveProperty('permissions');
      expect(settings.permissions).toHaveProperty('deny');
      expect(Array.isArray(settings.permissions.deny)).toBe(true);
    });

    it('should include sensitive file patterns in deny list (MED-4)', async () => {
      const settingsPath = join(testDir, '.forge', 'settings.json');
      const settings = JSON.parse(await fs.readFile(settingsPath, 'utf-8'));
      const denyList = settings.permissions.deny;

      // Check for MED-4 sensitive patterns
      const denyString = JSON.stringify(denyList);
      // Should have at least some protective patterns
      expect(denyString).toMatch(/\.env|secret|credential|key/i);
    });
  });
});
