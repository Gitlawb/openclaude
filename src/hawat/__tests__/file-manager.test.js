/**
 * File Manager Tests
 *
 * Tests for file-manager.js library functions including:
 * - MED-9: listFiles() with maxFiles limit
 * - MED-6: rotateBackups() and cleanupBackups()
 * - MED-11: syncPackageAssets() for asset synchronization
 */


import { join, dirname } from 'path';
import { fileURLToPath } from 'url';
import { tmpdir } from 'os';
import fs from 'fs-extra';

// Import functions under test
import {
  exists,
  readJson,
  validatePath,
  writeFile,
  writeJson,
  copyFile,
  copyDir,
  remove,
  isSymlink,
  readSymlink,
  makeExecutable,
  findBackups,
  listFiles,
  getDefaultMaxFiles,
  getDefaultMaxBackups,
  rotateBackups,
  cleanupBackups,
  syncPackageAssets
} from '../lib/file-manager.js';

// Get the directory of this test file
const __dirname = dirname(fileURLToPath(import.meta.url));

// Test directory setup
const TEST_BASE = join(tmpdir(), 'forge-file-manager-test');
let testDir;

/**
 * Create a unique test directory for each test
 */
function createTestDir() {
  const uniqueId = `${Date.now()}-${Math.random().toString(36).substr(2, 9)}`;
  return join(TEST_BASE, uniqueId);
}

/**
 * Create multiple test files in a directory
 * @param {string} dir - Directory to create files in
 * @param {number} count - Number of files to create
 * @param {string} ext - File extension (default: .txt)
 * @returns {Promise<string[]>} Array of created file paths
 */
async function createTestFiles(dir, count, ext = '.txt') {
  const files = [];
  await fs.ensureDir(dir);
  for (let i = 0; i < count; i++) {
    const filePath = join(dir, `file-${String(i).padStart(4, '0')}${ext}`);
    await fs.writeFile(filePath, `content-${i}`);
    files.push(filePath);
  }
  return files;
}

/**
 * Create backup files with specific modification times
 * @param {string} dir - Directory to create backups in
 * @param {string} baseName - Base filename
 * @param {number} count - Number of backups
 * @returns {Promise<string[]>} Array of created backup file paths
 */
async function createBackupFiles(dir, baseName, count) {
  const backups = [];
  await fs.ensureDir(dir);
  const now = Date.now();

  for (let i = 0; i < count; i++) {
    // Create backup with timestamp extension
    const timestamp = new Date(now - (i * 60 * 60 * 1000)).toISOString()
      .replace(/:/g, '-').replace(/\.\d{3}Z$/, '');
    const backupPath = join(dir, `${baseName}.${timestamp}`);
    await fs.writeFile(backupPath, `backup-${i}`);

    // Set modification time so oldest backups are actually older
    const mtime = new Date(now - (i * 60 * 60 * 1000));
    await fs.utimes(backupPath, mtime, mtime);

    backups.push(backupPath);
  }

  return backups;
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

describe('File Manager', () => {
  describe('exists()', () => {
    it('should return true for existing file', async () => {
      const filePath = join(testDir, 'exists.txt');
      await fs.writeFile(filePath, 'content');

      const result = await exists(filePath);
      expect(result).toBe(true);
    });

    it('should return true for existing directory', async () => {
      const result = await exists(testDir);
      expect(result).toBe(true);
    });

    it('should return false for non-existent path', async () => {
      const result = await exists(join(testDir, 'nonexistent'));
      expect(result).toBe(false);
    });
  });

  describe('readJson()', () => {
    it('should read and parse valid JSON file', async () => {
      const filePath = join(testDir, 'config.json');
      await fs.writeFile(filePath, '{"key": "value", "number": 42}');

      const result = await readJson(filePath);
      expect(result).toEqual({ key: 'value', number: 42 });
    });

    it('should throw on invalid JSON', async () => {
      const filePath = join(testDir, 'invalid.json');
      await fs.writeFile(filePath, 'not valid json');

      await expect(readJson(filePath)).rejects.toThrow();
    });

    it('should throw on missing file', async () => {
      await expect(readJson(join(testDir, 'missing.json'))).rejects.toThrow();
    });
  });

  describe('path traversal protection', () => {
    it('validatePath should resolve safe relative paths within baseDir', () => {
      const safePath = validatePath('safe.txt', testDir);
      expect(safePath).toBe(join(testDir, 'safe.txt'));
    });

    it('validatePath should block traversal outside baseDir', () => {
      expect(() => validatePath('../outside.txt', testDir))
        .toThrow(/Path traversal attempt detected/);
    });

    it('writeFile should block traversal attempts', async () => {
      await expect(writeFile('../outside.txt', 'content', { baseDir: testDir }))
        .rejects
        .toThrow(/Path traversal attempt detected/);
    });

    it('writeJson should block traversal attempts', async () => {
      await expect(writeJson('../outside.json', { ok: true }, { baseDir: testDir }))
        .rejects
        .toThrow(/Path traversal attempt detected/);
    });

    it('copyFile should block traversal in source path', async () => {
      await expect(copyFile('../outside.txt', 'dest.txt', { baseDir: testDir }))
        .rejects
        .toThrow(/Path traversal attempt detected/);
    });

    it('copyFile should block traversal in destination path', async () => {
      const src = join(testDir, 'source.txt');
      await fs.writeFile(src, 'content');

      await expect(copyFile(src, '../outside.txt', { baseDir: testDir }))
        .rejects
        .toThrow(/Path traversal attempt detected/);
    });

    it('copyDir should block traversal in destination path', async () => {
      const srcDir = join(testDir, 'src');
      await fs.ensureDir(srcDir);
      await fs.writeFile(join(srcDir, 'file.txt'), 'content');

      await expect(copyDir(srcDir, '../outside-dir', { baseDir: testDir }))
        .rejects
        .toThrow(/Path traversal attempt detected/);
    });

    it('remove should block traversal attempts when baseDir is provided', async () => {
      const innerDir = join(testDir, 'inner');
      await fs.ensureDir(innerDir);
      await fs.writeFile(join(innerDir, 'safe.txt'), 'content');

      // Should work for paths within baseDir
      await remove('inner/safe.txt', { baseDir: testDir });
      await expect(exists(join(testDir, 'inner', 'safe.txt'))).resolves.toBe(false);

      // Should block traversal outside baseDir
      await expect(remove('../outside.txt', { baseDir: testDir }))
        .rejects
        .toThrow(/Path traversal attempt detected/);
    });

    it('remove should work without baseDir for backward compatibility', async () => {
      const tmpFile = join(testDir, 'no-validation.txt');
      await fs.writeFile(tmpFile, 'content');
      await remove(tmpFile);
      await expect(exists(tmpFile)).resolves.toBe(false);
    });
  });

  describe('isSymlink() and readSymlink()', () => {
    it('should identify symbolic links', async () => {
      const target = join(testDir, 'target.txt');
      const link = join(testDir, 'link.txt');
      await fs.writeFile(target, 'content');
      await fs.symlink(target, link);

      expect(await isSymlink(link)).toBe(true);
      expect(await isSymlink(target)).toBe(false);
    });

    it('should return false for non-existent path', async () => {
      expect(await isSymlink(join(testDir, 'nonexistent'))).toBe(false);
    });

    it('should read symlink target', async () => {
      const target = join(testDir, 'target.txt');
      const link = join(testDir, 'link.txt');
      await fs.writeFile(target, 'content');
      await fs.symlink(target, link);

      const result = await readSymlink(link);
      expect(result).toBe(target);
    });
  });

  describe('makeExecutable()', () => {
    it('should make file executable', async () => {
      const filePath = join(testDir, 'script.sh');
      await fs.writeFile(filePath, '#!/bin/bash\necho hello');

      await makeExecutable(filePath);

      const stats = await fs.stat(filePath);
      // Check execute bit is set for owner
      expect(stats.mode & 0o100).toBeTruthy();
    });
  });

  describe('findBackups()', () => {
    it('should find backup files with .bak extension', async () => {
      await fs.writeFile(join(testDir, 'file.txt.bak'), 'backup');
      await fs.writeFile(join(testDir, 'other.bak'), 'backup');
      await fs.writeFile(join(testDir, 'normal.txt'), 'normal');

      const backups = await findBackups(testDir);
      expect(backups).toHaveLength(2);
    });

    it('should find backup files with .backup extension', async () => {
      await fs.writeFile(join(testDir, 'config.json.backup'), 'backup');

      const backups = await findBackups(testDir);
      expect(backups).toHaveLength(1);
    });

    it('should find backup files with timestamp extension', async () => {
      await fs.writeFile(join(testDir, 'file.2024-01-15T10-30-00'), 'backup');

      const backups = await findBackups(testDir);
      expect(backups).toHaveLength(1);
    });

    it('should filter by pattern when provided', async () => {
      await fs.writeFile(join(testDir, 'settings.json.bak'), 'backup');
      await fs.writeFile(join(testDir, 'config.json.bak'), 'backup');

      const backups = await findBackups(testDir, 'settings');
      expect(backups).toHaveLength(1);
      expect(backups[0]).toContain('settings');
    });

    it('should return empty array for non-existent directory', async () => {
      const backups = await findBackups(join(testDir, 'nonexistent'));
      expect(backups).toEqual([]);
    });

    it('should return empty array for file instead of directory', async () => {
      const filePath = join(testDir, 'file.txt');
      await fs.writeFile(filePath, 'content');

      const backups = await findBackups(filePath);
      expect(backups).toEqual([]);
    });
  });

  describe('getDefaultMaxFiles()', () => {
    it('should return default max files limit', () => {
      expect(getDefaultMaxFiles()).toBe(10000);
    });
  });

  describe('getDefaultMaxBackups()', () => {
    it('should return default max backups limit', () => {
      expect(getDefaultMaxBackups()).toBe(5);
    });
  });

  describe('listFiles() - MED-9', () => {
    describe('basic functionality', () => {
      it('should list files in a directory', async () => {
        await createTestFiles(testDir, 5);

        const result = await listFiles(testDir);
        expect(result.files).toHaveLength(5);
        expect(result.limitReached).toBe(false);
      });

      it('should return empty array for empty directory', async () => {
        const emptyDir = join(testDir, 'empty');
        await fs.ensureDir(emptyDir);

        const result = await listFiles(emptyDir);
        expect(result.files).toHaveLength(0);
        expect(result.limitReached).toBe(false);
      });

      it('should throw error for non-existent directory', async () => {
        await expect(listFiles(join(testDir, 'nonexistent')))
          .rejects.toThrow('Directory does not exist');
      });

      it('should throw error for file instead of directory', async () => {
        const filePath = join(testDir, 'file.txt');
        await fs.writeFile(filePath, 'content');

        await expect(listFiles(filePath))
          .rejects.toThrow('Path is not a directory');
      });
    });

    describe('maxFiles limit (MED-9)', () => {
      it('should respect maxFiles limit', async () => {
        // Create 20 files
        await createTestFiles(testDir, 20);

        const result = await listFiles(testDir, { maxFiles: 10 });
        expect(result.files).toHaveLength(10);
        expect(result.limitReached).toBe(true);
      });

      it('should return all files when under limit', async () => {
        await createTestFiles(testDir, 5);

        const result = await listFiles(testDir, { maxFiles: 100 });
        expect(result.files).toHaveLength(5);
        expect(result.limitReached).toBe(false);
      });

      it('should use default maxFiles of 10000', async () => {
        await createTestFiles(testDir, 10);

        const result = await listFiles(testDir);
        expect(result.files).toHaveLength(10);
        expect(result.limitReached).toBe(false);
      });

      it('should log warning when limit is reached', async () => {
        // TODO Phase 2: use Bun's spyOn equivalent to verify console.warn
        const originalWarn = console.warn;
        let warnCalled = false;
        let warnMessage = '';
        console.warn = (msg) => { warnCalled = true; warnMessage = msg; };

        await createTestFiles(testDir, 20);
        await listFiles(testDir, { maxFiles: 10 });

        expect(warnCalled).toBe(true);
        expect(warnMessage).toContain('maxFiles limit');

        console.warn = originalWarn;
      });

      it('should handle maxFiles of 1', async () => {
        await createTestFiles(testDir, 10);

        const result = await listFiles(testDir, { maxFiles: 1 });
        expect(result.files).toHaveLength(1);
        expect(result.limitReached).toBe(true);
      });

      it('should throw error for invalid maxFiles (0)', async () => {
        await expect(listFiles(testDir, { maxFiles: 0 }))
          .rejects.toThrow('maxFiles must be a positive number');
      });

      it('should throw error for invalid maxFiles (negative)', async () => {
        await expect(listFiles(testDir, { maxFiles: -5 }))
          .rejects.toThrow('maxFiles must be a positive number');
      });

      it('should throw error for invalid maxFiles (string)', async () => {
        await expect(listFiles(testDir, { maxFiles: 'invalid' }))
          .rejects.toThrow('maxFiles must be a positive number');
      });
    });

    describe('recursive listing', () => {
      it('should list files recursively', async () => {
        await createTestFiles(testDir, 5);
        const subDir = join(testDir, 'subdir');
        await createTestFiles(subDir, 3);

        const result = await listFiles(testDir, { recursive: true });
        expect(result.files).toHaveLength(8);
      });

      it('should not recurse by default', async () => {
        await createTestFiles(testDir, 5);
        const subDir = join(testDir, 'subdir');
        await createTestFiles(subDir, 3);

        const result = await listFiles(testDir, { recursive: false });
        expect(result.files).toHaveLength(5);
      });

      it('should respect maxFiles during recursive listing', async () => {
        await createTestFiles(testDir, 10);
        const subDir1 = join(testDir, 'sub1');
        const subDir2 = join(testDir, 'sub2');
        await createTestFiles(subDir1, 10);
        await createTestFiles(subDir2, 10);

        const result = await listFiles(testDir, { recursive: true, maxFiles: 15 });
        expect(result.files).toHaveLength(15);
        expect(result.limitReached).toBe(true);
      });
    });

    describe('extension filtering', () => {
      it('should filter by single extension', async () => {
        await fs.writeFile(join(testDir, 'file1.js'), 'js');
        await fs.writeFile(join(testDir, 'file2.js'), 'js');
        await fs.writeFile(join(testDir, 'file3.ts'), 'ts');
        await fs.writeFile(join(testDir, 'file4.txt'), 'txt');

        const result = await listFiles(testDir, { extensions: ['.js'] });
        expect(result.files).toHaveLength(2);
        expect(result.files.every(f => f.endsWith('.js'))).toBe(true);
      });

      it('should filter by multiple extensions', async () => {
        await fs.writeFile(join(testDir, 'file1.js'), 'js');
        await fs.writeFile(join(testDir, 'file2.ts'), 'ts');
        await fs.writeFile(join(testDir, 'file3.txt'), 'txt');

        const result = await listFiles(testDir, { extensions: ['.js', '.ts'] });
        expect(result.files).toHaveLength(2);
      });

      it('should return all files when no extensions specified', async () => {
        await fs.writeFile(join(testDir, 'file1.js'), 'js');
        await fs.writeFile(join(testDir, 'file2.ts'), 'ts');

        const result = await listFiles(testDir, { extensions: [] });
        expect(result.files).toHaveLength(2);
      });

      it('should be case-insensitive for extensions', async () => {
        // Use different base names to avoid case-insensitive filesystem issues
        await fs.writeFile(join(testDir, 'upper.JS'), 'js');
        await fs.writeFile(join(testDir, 'mixed.Js'), 'js');
        await fs.writeFile(join(testDir, 'lower.js'), 'js');

        const result = await listFiles(testDir, { extensions: ['.js'] });
        expect(result.files).toHaveLength(3);
      });
    });
  });

  describe('rotateBackups() - MED-6', () => {
    describe('basic functionality', () => {
      it('should keep newest N backups and delete older ones', async () => {
        await createBackupFiles(testDir, 'config.json', 7);

        const result = await rotateBackups(testDir, { maxBackups: 3 });

        expect(result.kept).toHaveLength(3);
        expect(result.deleted).toHaveLength(4);
        expect(result.errors).toHaveLength(0);

        // Verify files on disk
        const remaining = await fs.readdir(testDir);
        expect(remaining).toHaveLength(3);
      });

      it('should keep all backups when count is under limit', async () => {
        await createBackupFiles(testDir, 'settings.json', 3);

        const result = await rotateBackups(testDir, { maxBackups: 5 });

        expect(result.kept).toHaveLength(3);
        expect(result.deleted).toHaveLength(0);
      });

      it('should use default maxBackups of 5', async () => {
        await createBackupFiles(testDir, 'config.json', 10);

        const result = await rotateBackups(testDir);

        expect(result.kept).toHaveLength(5);
        expect(result.deleted).toHaveLength(5);
      });
    });

    describe('edge cases', () => {
      it('should handle empty directory gracefully', async () => {
        const result = await rotateBackups(testDir);

        expect(result.kept).toHaveLength(0);
        expect(result.deleted).toHaveLength(0);
        expect(result.errors).toHaveLength(0);
      });

      it('should handle non-existent directory gracefully', async () => {
        const result = await rotateBackups(join(testDir, 'nonexistent'));

        expect(result.kept).toHaveLength(0);
        expect(result.deleted).toHaveLength(0);
        expect(result.errors).toHaveLength(0);
      });

      it('should handle maxBackups of 0 (delete all)', async () => {
        await createBackupFiles(testDir, 'config.json', 5);

        const result = await rotateBackups(testDir, { maxBackups: 0 });

        expect(result.kept).toHaveLength(0);
        expect(result.deleted).toHaveLength(5);
      });

      it('should ignore non-backup files', async () => {
        await fs.writeFile(join(testDir, 'config.json'), 'original');
        await fs.writeFile(join(testDir, 'README.md'), 'readme');
        await createBackupFiles(testDir, 'config.json', 3);

        const result = await rotateBackups(testDir, { maxBackups: 2 });

        expect(result.kept).toHaveLength(2);
        expect(result.deleted).toHaveLength(1);

        // Original files should still exist
        expect(await fs.pathExists(join(testDir, 'config.json'))).toBe(true);
        expect(await fs.pathExists(join(testDir, 'README.md'))).toBe(true);
      });

      it('should throw error for invalid maxBackups (negative)', async () => {
        await expect(rotateBackups(testDir, { maxBackups: -1 }))
          .rejects.toThrow('maxBackups must be a non-negative number');
      });
    });

    describe('pattern filtering', () => {
      it('should filter backups by pattern', async () => {
        await createBackupFiles(testDir, 'config.json', 5);
        await createBackupFiles(testDir, 'settings.json', 5);

        const result = await rotateBackups(testDir, {
          maxBackups: 2,
          pattern: 'config'
        });

        expect(result.kept).toHaveLength(2);
        expect(result.deleted).toHaveLength(3);
        expect(result.kept.every(p => p.includes('config'))).toBe(true);

        // Settings backups should be untouched
        const settingsBackups = (await fs.readdir(testDir))
          .filter(f => f.includes('settings'));
        expect(settingsBackups).toHaveLength(5);
      });
    });

    describe('dry run mode', () => {
      it('should not delete files in dry run mode', async () => {
        await createBackupFiles(testDir, 'config.json', 5);

        const result = await rotateBackups(testDir, {
          maxBackups: 2,
          dryRun: true
        });

        expect(result.kept).toHaveLength(2);
        expect(result.deleted).toHaveLength(3);

        // Files should still exist
        const remaining = await fs.readdir(testDir);
        expect(remaining).toHaveLength(5);
      });
    });
  });

  describe('cleanupBackups() - MED-6', () => {
    describe('basic functionality', () => {
      it('should delete backups older than maxAgeDays', async () => {
        const now = Date.now();

        // Create old backup (10 days ago)
        const oldBackup = join(testDir, 'old.bak');
        await fs.writeFile(oldBackup, 'old');
        const oldTime = new Date(now - (10 * 24 * 60 * 60 * 1000));
        await fs.utimes(oldBackup, oldTime, oldTime);

        // Create recent backup (1 day ago)
        const newBackup = join(testDir, 'new.bak');
        await fs.writeFile(newBackup, 'new');
        const newTime = new Date(now - (1 * 24 * 60 * 60 * 1000));
        await fs.utimes(newBackup, newTime, newTime);

        const result = await cleanupBackups(testDir, { maxAgeDays: 7 });

        expect(result.deleted).toHaveLength(1);
        expect(result.retained).toHaveLength(1);
        expect(result.deleted[0]).toContain('old.bak');
      });

      it('should use default maxAgeDays of 30', async () => {
        const now = Date.now();

        // Create backup 40 days old
        const oldBackup = join(testDir, 'very-old.bak');
        await fs.writeFile(oldBackup, 'old');
        const oldTime = new Date(now - (40 * 24 * 60 * 60 * 1000));
        await fs.utimes(oldBackup, oldTime, oldTime);

        // Create backup 10 days old
        const newBackup = join(testDir, 'recent.bak');
        await fs.writeFile(newBackup, 'recent');
        const recentTime = new Date(now - (10 * 24 * 60 * 60 * 1000));
        await fs.utimes(newBackup, recentTime, recentTime);

        const result = await cleanupBackups(testDir);

        expect(result.deleted).toHaveLength(1);
        expect(result.retained).toHaveLength(1);
      });
    });

    describe('edge cases', () => {
      it('should handle empty directory gracefully', async () => {
        const result = await cleanupBackups(testDir);

        expect(result.deleted).toHaveLength(0);
        expect(result.retained).toHaveLength(0);
        expect(result.errors).toHaveLength(0);
      });

      it('should handle non-existent directory gracefully', async () => {
        const result = await cleanupBackups(join(testDir, 'nonexistent'));

        expect(result.deleted).toHaveLength(0);
        expect(result.retained).toHaveLength(0);
        expect(result.errors).toHaveLength(0);
      });

      it('should delete all backups when maxAgeDays is 0', async () => {
        await fs.writeFile(join(testDir, 'file1.bak'), 'content');
        await fs.writeFile(join(testDir, 'file2.backup'), 'content');

        const result = await cleanupBackups(testDir, { maxAgeDays: 0 });

        expect(result.deleted).toHaveLength(2);
        expect(result.retained).toHaveLength(0);
      });

      it('should throw error for invalid maxAgeDays (negative)', async () => {
        await expect(cleanupBackups(testDir, { maxAgeDays: -1 }))
          .rejects.toThrow('maxAgeDays must be a non-negative number');
      });
    });

    describe('pattern filtering', () => {
      it('should filter backups by pattern', async () => {
        const now = Date.now();
        const oldTime = new Date(now - (40 * 24 * 60 * 60 * 1000));

        // Create old config backup
        const configBackup = join(testDir, 'config.json.bak');
        await fs.writeFile(configBackup, 'config');
        await fs.utimes(configBackup, oldTime, oldTime);

        // Create old settings backup
        const settingsBackup = join(testDir, 'settings.json.bak');
        await fs.writeFile(settingsBackup, 'settings');
        await fs.utimes(settingsBackup, oldTime, oldTime);

        const result = await cleanupBackups(testDir, {
          maxAgeDays: 30,
          pattern: 'config'
        });

        expect(result.deleted).toHaveLength(1);
        expect(result.deleted[0]).toContain('config');

        // Settings backup should still exist
        expect(await fs.pathExists(settingsBackup)).toBe(true);
      });
    });

    describe('dry run mode', () => {
      it('should not delete files in dry run mode', async () => {
        await fs.writeFile(join(testDir, 'file1.bak'), 'content');
        await fs.writeFile(join(testDir, 'file2.bak'), 'content');

        const result = await cleanupBackups(testDir, {
          maxAgeDays: 0,
          dryRun: true
        });

        expect(result.deleted).toHaveLength(2);

        // Files should still exist
        const remaining = await fs.readdir(testDir);
        expect(remaining).toHaveLength(2);
      });
    });
  });

  describe('syncPackageAssets() - MED-11', () => {
    let srcDir;
    let destDir;
    let mockPaths;

    /**
     * Create mock paths configuration for testing
     */
    function createMockPaths(src, dest) {
      return {
        PACKAGE_TEMPLATES_DIR: join(src, 'templates'),
        PACKAGE_SCRIPTS_DIR: join(src, 'scripts'),
        PACKAGE_LIB_CORE_DIR: join(src, 'lib', 'core'),
        PACKAGE_SKILLS_DIR: join(src, 'skills'),
        GLOBAL_TEMPLATES_DIR: join(dest, 'templates'),
        GLOBAL_SCRIPTS_DIR: join(dest, 'scripts'),
        GLOBAL_LIB_DIR: join(dest, 'lib'),
        GLOBAL_SKILLS_DIR: join(dest, 'skills')
      };
    }

    /**
     * Create source asset directories with sample files
     */
    async function createSourceAssets(src) {
      // Templates
      await fs.ensureDir(join(src, 'templates'));
      await fs.writeFile(join(src, 'templates', 'CLAUDE.md.hbs'), '# Template');
      await fs.writeFile(join(src, 'templates', 'settings.json.hbs'), '{}');

      // Scripts
      await fs.ensureDir(join(src, 'scripts'));
      await fs.writeFile(join(src, 'scripts', 'hook.sh'), '#!/bin/bash\necho "hook"');
      await fs.writeFile(join(src, 'scripts', 'setup.sh'), '#!/bin/bash\necho "setup"');

      // Lib/core
      await fs.ensureDir(join(src, 'lib', 'core'));
      await fs.writeFile(join(src, 'lib', 'core', 'README.md'), '# Core');

      // Skills
      await fs.ensureDir(join(src, 'skills'));
      await fs.writeFile(join(src, 'skills', 'orchestrate.md'), '# Skill');
    }

    beforeEach(async () => {
      srcDir = join(testDir, 'package');
      destDir = join(testDir, 'global');
      mockPaths = createMockPaths(srcDir, destDir);

      await fs.ensureDir(srcDir);
      await fs.ensureDir(destDir);
    });

    describe('basic functionality', () => {
      it('should sync all asset types by default', async () => {
        await createSourceAssets(srcDir);

        const result = await syncPackageAssets({}, mockPaths);

        expect(result.synced).toHaveLength(4);
        expect(result.errors).toHaveLength(0);

        // Verify files were copied
        expect(await exists(join(destDir, 'templates', 'CLAUDE.md.hbs'))).toBe(true);
        expect(await exists(join(destDir, 'scripts', 'hook.sh'))).toBe(true);
        expect(await exists(join(destDir, 'lib', 'README.md'))).toBe(true);
        expect(await exists(join(destDir, 'skills', 'orchestrate.md'))).toBe(true);
      });

      it('should throw error when paths configuration is missing', async () => {
        await expect(syncPackageAssets({})).rejects.toThrow(
          'paths configuration is required'
        );
      });

      it('should return synced paths in result', async () => {
        await createSourceAssets(srcDir);

        const result = await syncPackageAssets({}, mockPaths);

        // Check that synced entries contain expected info
        expect(result.synced.some(s => s.includes('templates'))).toBe(true);
        expect(result.synced.some(s => s.includes('scripts'))).toBe(true);
        expect(result.synced.some(s => s.includes('lib'))).toBe(true);
        expect(result.synced.some(s => s.includes('skills'))).toBe(true);
      });
    });

    describe('selective sync', () => {
      it('should sync only templates when specified', async () => {
        await createSourceAssets(srcDir);

        const result = await syncPackageAssets({
          templates: true,
          scripts: false,
          lib: false,
          skills: false
        }, mockPaths);

        expect(result.synced).toHaveLength(1);
        expect(result.synced[0]).toContain('templates');

        expect(await exists(join(destDir, 'templates'))).toBe(true);
        expect(await exists(join(destDir, 'scripts'))).toBe(false);
        expect(await exists(join(destDir, 'lib'))).toBe(false);
        expect(await exists(join(destDir, 'skills'))).toBe(false);
      });

      it('should sync only scripts when specified', async () => {
        await createSourceAssets(srcDir);

        const result = await syncPackageAssets({
          templates: false,
          scripts: true,
          lib: false,
          skills: false
        }, mockPaths);

        expect(result.synced).toHaveLength(1);
        expect(result.synced[0]).toContain('scripts');
      });

      it('should sync multiple selected asset types', async () => {
        await createSourceAssets(srcDir);

        const result = await syncPackageAssets({
          templates: true,
          scripts: false,
          lib: true,
          skills: false
        }, mockPaths);

        expect(result.synced).toHaveLength(2);
        expect(result.synced.some(s => s.includes('templates'))).toBe(true);
        expect(result.synced.some(s => s.includes('lib'))).toBe(true);
      });
    });

    describe('force overwrite', () => {
      it('should skip existing directories when force is false', async () => {
        await createSourceAssets(srcDir);

        // Pre-create destination directories
        await fs.ensureDir(join(destDir, 'templates'));
        await fs.writeFile(join(destDir, 'templates', 'existing.txt'), 'old content');

        const result = await syncPackageAssets({
          templates: true,
          scripts: false,
          lib: false,
          skills: false,
          force: false
        }, mockPaths);

        expect(result.synced).toHaveLength(0);
        expect(result.skipped).toHaveLength(1);
        expect(result.skipped[0]).toContain('already exists');

        // Original file should still exist
        expect(await exists(join(destDir, 'templates', 'existing.txt'))).toBe(true);
        // New file should NOT exist
        expect(await exists(join(destDir, 'templates', 'CLAUDE.md.hbs'))).toBe(false);
      });

      it('should overwrite existing directories when force is true', async () => {
        await createSourceAssets(srcDir);

        // Pre-create destination directories
        await fs.ensureDir(join(destDir, 'templates'));
        await fs.writeFile(join(destDir, 'templates', 'existing.txt'), 'old content');

        const result = await syncPackageAssets({
          templates: true,
          scripts: false,
          lib: false,
          skills: false,
          force: true
        }, mockPaths);

        expect(result.synced).toHaveLength(1);
        expect(result.skipped).toHaveLength(0);

        // New files should exist
        expect(await exists(join(destDir, 'templates', 'CLAUDE.md.hbs'))).toBe(true);
        expect(await exists(join(destDir, 'templates', 'settings.json.hbs'))).toBe(true);
      });
    });

    describe('source not found handling', () => {
      it('should skip and report when source directory does not exist', async () => {
        // Don't create source assets

        const result = await syncPackageAssets({
          templates: true,
          scripts: false,
          lib: false,
          skills: false
        }, mockPaths);

        expect(result.synced).toHaveLength(0);
        expect(result.skipped).toHaveLength(1);
        expect(result.skipped[0]).toContain('source not found');
      });

      it('should handle partial source availability', async () => {
        // Only create templates
        await fs.ensureDir(join(srcDir, 'templates'));
        await fs.writeFile(join(srcDir, 'templates', 'test.hbs'), 'content');

        const result = await syncPackageAssets({
          templates: true,
          scripts: true,
          lib: false,
          skills: false
        }, mockPaths);

        expect(result.synced).toHaveLength(1);
        expect(result.synced[0]).toContain('templates');
        expect(result.skipped).toHaveLength(1);
        expect(result.skipped[0]).toContain('scripts');
        expect(result.skipped[0]).toContain('source not found');
      });
    });

    describe('script executable permissions', () => {
      it('should make shell scripts executable after sync', async () => {
        await createSourceAssets(srcDir);

        await syncPackageAssets({
          templates: false,
          scripts: true,
          lib: false,
          skills: false
        }, mockPaths);

        // Check that scripts are executable
        const hookPath = join(destDir, 'scripts', 'hook.sh');
        const setupPath = join(destDir, 'scripts', 'setup.sh');

        const hookStats = await fs.stat(hookPath);
        const setupStats = await fs.stat(setupPath);

        // Check execute bit is set
        expect(hookStats.mode & 0o100).toBeTruthy();
        expect(setupStats.mode & 0o100).toBeTruthy();
      });

      it('should not make non-shell files executable', async () => {
        await fs.ensureDir(join(srcDir, 'scripts'));
        await fs.writeFile(join(srcDir, 'scripts', 'config.json'), '{}');

        await syncPackageAssets({
          templates: false,
          scripts: true,
          lib: false,
          skills: false
        }, mockPaths);

        const configPath = join(destDir, 'scripts', 'config.json');
        const stats = await fs.stat(configPath);

        // JSON files should not have execute bit
        expect(stats.mode & 0o100).toBeFalsy();
      });
    });

    describe('edge cases', () => {
      it('should handle empty source directories', async () => {
        // Create empty source directories
        await fs.ensureDir(join(srcDir, 'templates'));
        await fs.ensureDir(join(srcDir, 'scripts'));

        const result = await syncPackageAssets({
          templates: true,
          scripts: true,
          lib: false,
          skills: false
        }, mockPaths);

        expect(result.synced).toHaveLength(2);
        expect(result.errors).toHaveLength(0);
      });

      it('should handle nested directories in assets', async () => {
        // Create nested structure
        await fs.ensureDir(join(srcDir, 'templates', 'partials'));
        await fs.writeFile(join(srcDir, 'templates', 'partials', 'header.hbs'), 'header');
        await fs.writeFile(join(srcDir, 'templates', 'main.hbs'), 'main');

        await syncPackageAssets({
          templates: true,
          scripts: false,
          lib: false,
          skills: false
        }, mockPaths);

        // Check nested files were copied
        expect(await exists(join(destDir, 'templates', 'main.hbs'))).toBe(true);
        expect(await exists(join(destDir, 'templates', 'partials', 'header.hbs'))).toBe(true);
      });

      it('should return empty arrays when all options are false', async () => {
        await createSourceAssets(srcDir);

        const result = await syncPackageAssets({
          templates: false,
          scripts: false,
          lib: false,
          skills: false
        }, mockPaths);

        expect(result.synced).toHaveLength(0);
        expect(result.skipped).toHaveLength(0);
        expect(result.errors).toHaveLength(0);
      });
    });
  });
});
