/**
 * File Manager for Hawat CLI
 *
 * Provides safe file operations with backup capability.
 */

import fs from 'fs-extra';
import { dirname, join, basename, resolve, sep, isAbsolute } from 'path';
import { debug } from '../utils/logger.js';

/**
 * Default maximum number of files to return from listFiles
 * @type {number}
 */
const DEFAULT_MAX_FILES = 10000;

/**
 * Default maximum number of backups to retain
 * @type {number}
 */
const DEFAULT_MAX_BACKUPS = 5;

/**
 * Backup file extension patterns to recognize
 * @type {RegExp}
 */
const BACKUP_PATTERN = /\.(bak|backup|orig|\d{4}-\d{2}-\d{2}T\d{2}-\d{2}-\d{2})$/i;

/**
 * Normalize and validate base directory
 * @param {string} baseDir - Base directory for safe path checks
 * @returns {string} Resolved base directory
 */
function normalizeBaseDir(baseDir) {
  if (!baseDir || typeof baseDir !== 'string') {
    throw new Error('baseDir is required for safe file operations');
  }
  return resolve(baseDir);
}

/**
 * Validate a path against a base directory to prevent traversal.
 * Relative paths are resolved against the base directory.
 * @param {string} filePath - Path to validate
 * @param {string} baseDir - Allowed base directory
 * @returns {string} Resolved safe path
 */
export function validatePath(filePath, baseDir) {
  if (!filePath || typeof filePath !== 'string') {
    throw new Error('filePath must be a non-empty string');
  }

  const resolvedBase = normalizeBaseDir(baseDir);
  const candidate = isAbsolute(filePath) ? filePath : join(resolvedBase, filePath);
  const resolvedPath = resolve(candidate);

  const baseWithSep = resolvedBase.endsWith(sep) ? resolvedBase : resolvedBase + sep;

  if (resolvedPath === resolvedBase || resolvedPath.startsWith(baseWithSep)) {
    return resolvedPath;
  }

  throw new Error(`Path traversal attempt detected: ${filePath}`);
}

/**
 * Ensure a directory exists, creating it if necessary
 * @param {string} dirPath - Path to the directory
 * @returns {Promise<void>}
 */
export async function ensureDir(dirPath) {
  await fs.ensureDir(dirPath);
  debug(`Ensured directory: ${dirPath}`);
}

/**
 * Check if a file exists
 * @param {string} filePath - Path to the file
 * @returns {Promise<boolean>}
 */
export async function exists(filePath) {
  return fs.pathExists(filePath);
}

/**
 * Read a file as text
 * @param {string} filePath - Path to the file
 * @returns {Promise<string>}
 */
export async function readFile(filePath) {
  return fs.readFile(filePath, 'utf-8');
}

/**
 * Read a JSON file
 * @param {string} filePath - Path to the JSON file
 * @returns {Promise<object>}
 */
export async function readJson(filePath) {
  return fs.readJson(filePath);
}

/**
 * Write content to a file, creating directories as needed
 * @param {string} filePath - Path to the file
 * @param {string} content - Content to write
 * @param {object} [options] - Options
 * @param {boolean} [options.backup=false] - Create backup before overwriting
 * @param {string} options.baseDir - Allowed base directory for write operations
 * @returns {Promise<void>}
 */
export async function writeFile(filePath, content, options = {}) {
  const { backup = false, baseDir } = options;
  const safePath = validatePath(filePath, baseDir);

  // Ensure parent directory exists
  await ensureDir(dirname(safePath));

  // Create backup if requested and file exists
  if (backup && await exists(safePath)) {
    const backupPath = validatePath(`${safePath}.backup.${Date.now()}`, baseDir);
    await fs.copy(safePath, backupPath);
    debug(`Created backup: ${backupPath}`);
  }

  await fs.writeFile(safePath, content, 'utf-8');
  debug(`Wrote file: ${safePath}`);
}

/**
 * Write a JSON file, creating directories as needed
 * @param {string} filePath - Path to the JSON file
 * @param {object} data - Data to write
 * @param {object} [options] - Options
 * @param {boolean} [options.backup=false] - Create backup before overwriting
 * @param {string} options.baseDir - Allowed base directory for write operations
 * @returns {Promise<void>}
 */
export async function writeJson(filePath, data, options = {}) {
  const { backup = false, baseDir } = options;
  const safePath = validatePath(filePath, baseDir);

  await ensureDir(dirname(safePath));

  if (backup && await exists(safePath)) {
    const backupPath = validatePath(`${safePath}.backup.${Date.now()}`, baseDir);
    await fs.copy(safePath, backupPath);
    debug(`Created backup: ${backupPath}`);
  }

  await fs.writeJson(safePath, data, { spaces: 2 });
  debug(`Wrote JSON: ${safePath}`);
}

/**
 * Copy a file with backup support
 * @param {string} src - Source path
 * @param {string} dest - Destination path
 * @param {object} [options] - Options
 * @param {boolean} [options.backup=false] - Create backup before overwriting
 * @param {boolean} [options.overwrite=true] - Overwrite existing files
 * @param {string} [options.baseDir] - Base directory applied to source and destination
 * @param {string} [options.sourceBaseDir] - Allowed base directory for source path
 * @param {string} [options.destBaseDir] - Allowed base directory for destination path
 * @returns {Promise<void>}
 */
export async function copyFile(src, dest, options = {}) {
  const {
    backup = false,
    overwrite = true,
    baseDir,
    sourceBaseDir,
    destBaseDir
  } = options;
  const resolvedSourceBase = sourceBaseDir || baseDir;
  const resolvedDestBase = destBaseDir || baseDir;
  const safeSrc = validatePath(src, resolvedSourceBase);
  const safeDest = validatePath(dest, resolvedDestBase);

  await ensureDir(dirname(safeDest));

  if (backup && await exists(safeDest)) {
    const backupPath = validatePath(`${safeDest}.backup.${Date.now()}`, resolvedDestBase);
    await fs.copy(safeDest, backupPath);
    debug(`Created backup: ${backupPath}`);
  }

  await fs.copy(safeSrc, safeDest, { overwrite });
  debug(`Copied: ${safeSrc} -> ${safeDest}`);
}

/**
 * Copy a directory recursively with depth and file count limits
 * @param {string} src - Source directory
 * @param {string} dest - Destination directory
 * @param {object} [options] - Options
 * @param {boolean} [options.overwrite=true] - Overwrite existing files
 * @param {number} [options.maxDepth=10] - Maximum directory depth to prevent DoS
 * @param {number} [options.maxFiles=10000] - Maximum file count to prevent DoS
 * @param {number} [options.currentDepth=0] - Current recursion depth (internal)
 * @param {string} [options.baseDir] - Base directory applied to source and destination
 * @param {string} [options.sourceBaseDir] - Allowed base directory for source path
 * @param {string} [options.destBaseDir] - Allowed base directory for destination path
 * @returns {Promise<void>}
 */
export async function copyDir(src, dest, options = {}) {
  const {
    overwrite = true,
    maxDepth = 10,
    maxFiles = 10000,
    currentDepth = 0,
    baseDir,
    sourceBaseDir,
    destBaseDir
  } = options;

  const resolvedSourceBase = sourceBaseDir || baseDir;
  const resolvedDestBase = destBaseDir || baseDir;
  const safeSrc = validatePath(src, resolvedSourceBase);
  const safeDest = validatePath(dest, resolvedDestBase);

  // Track file count via shared counter (initialized on first call)
  if (!options._fileCount) {
    options._fileCount = { count: 0 };
  }

  // Check depth limit
  if (currentDepth > maxDepth) {
    throw new Error(`Maximum directory depth (${maxDepth}) exceeded`);
  }

  const entries = await fs.readdir(safeSrc, { withFileTypes: true });
  await ensureDir(safeDest);

  for (const entry of entries) {
    // Increment and check file count
    options._fileCount.count++;
    if (options._fileCount.count > maxFiles) {
      throw new Error(`Maximum file count (${maxFiles}) exceeded`);
    }

    const srcPath = join(safeSrc, entry.name);
    const destPath = join(safeDest, entry.name);

    if (entry.isDirectory()) {
      await copyDir(srcPath, destPath, {
        ...options,
        currentDepth: currentDepth + 1,
        sourceBaseDir: resolvedSourceBase,
        destBaseDir: resolvedDestBase
      });
    } else {
      await fs.copy(srcPath, destPath, { overwrite });
    }
  }

  debug(`Copied directory: ${safeSrc} -> ${safeDest}`);
}

/**
 * Remove a file or directory
 * @param {string} targetPath - Path to remove
 * @param {object} [options] - Options
 * @param {string} [options.baseDir] - Allowed base directory for path validation
 * @returns {Promise<void>}
 */
export async function remove(targetPath, options = {}) {
  const { baseDir } = options;
  const safePath = baseDir ? validatePath(targetPath, baseDir) : targetPath;
  await fs.remove(safePath);
  debug(`Removed: ${safePath}`);
}

/**
 * Create a symlink
 * @param {string} target - Target path (what the link points to)
 * @param {string} linkPath - Path where the symlink will be created
 * @param {object} [options] - Options
 * @param {boolean} [options.force=false] - Remove existing link/file first
 * @returns {Promise<void>}
 */
export async function symlink(target, linkPath, options = {}) {
  const { force = false } = options;

  await ensureDir(dirname(linkPath));

  // Atomic approach: try to create, handle EEXIST error
  // This eliminates the TOCTOU race condition between check and remove
  try {
    await fs.symlink(target, linkPath);
  } catch (error) {
    if (error.code === 'EEXIST' && force) {
      await remove(linkPath);
      await fs.symlink(target, linkPath);
    } else {
      throw error;
    }
  }
  debug(`Created symlink: ${linkPath} -> ${target}`);
}

/**
 * Check if a path is a symlink
 * @param {string} path - Path to check
 * @returns {Promise<boolean>}
 */
export async function isSymlink(path) {
  try {
    const stats = await fs.lstat(path);
    return stats.isSymbolicLink();
  } catch {
    return false;
  }
}

/**
 * Get the target of a symlink
 * @param {string} linkPath - Path to the symlink
 * @returns {Promise<string|null>}
 */
export async function readSymlink(linkPath) {
  try {
    return await fs.readlink(linkPath);
  } catch {
    return null;
  }
}

/**
 * List files in a directory with optional filtering and limits.
 *
 * **IMPORTANT:** This function returns an OBJECT `{ files, limitReached }`, NOT an array.
 * Always destructure the result or access the `.files` property.
 *
 * @param {string} dirPath - Directory path to list files from
 * @param {Object} options - Listing options
 * @param {boolean} [options.recursive=false] - Whether to list files recursively
 * @param {string[]} [options.extensions=[]] - File extensions to filter by (e.g., ['.js', '.ts'])
 * @param {number} [options.maxFiles=10000] - Maximum number of files to return (DoS protection)
 * @returns {Promise<{files: string[], limitReached: boolean}>} Object containing file paths and limit status
 */
export async function listFiles(dirPath, options = {}) {
  const {
    recursive = false,
    extensions = [],
    maxFiles = DEFAULT_MAX_FILES
  } = options;

  // Validate maxFiles parameter
  if (typeof maxFiles !== 'number' || maxFiles < 1) {
    throw new Error(`maxFiles must be a positive number, got: ${maxFiles}`);
  }

  const files = [];
  let limitReached = false;

  async function collectFiles(currentPath) {
    if (files.length >= maxFiles) {
      limitReached = true;
      return;
    }

    let entries;
    try {
      entries = await fs.readdir(currentPath, { withFileTypes: true });
    } catch (err) {
      if (err.code === 'EACCES' || err.code === 'EPERM') {
        return;
      }
      throw err;
    }

    for (const entry of entries) {
      if (files.length >= maxFiles) {
        limitReached = true;
        return;
      }

      const fullPath = join(currentPath, entry.name);

      if (entry.isDirectory()) {
        if (recursive) {
          await collectFiles(fullPath);
        }
      } else if (entry.isFile()) {
        if (extensions.length > 0) {
          const ext = fullPath.substring(fullPath.lastIndexOf('.')).toLowerCase();
          if (!extensions.includes(ext)) {
            continue;
          }
        }

        files.push(fullPath);

        if (files.length >= maxFiles) {
          limitReached = true;
          return;
        }
      }
    }
  }

  // Verify directory exists
  try {
    const stat = await fs.stat(dirPath);
    if (!stat.isDirectory()) {
      throw new Error(`Path is not a directory: ${dirPath}`);
    }
  } catch (err) {
    if (err.code === 'ENOENT') {
      throw new Error(`Directory does not exist: ${dirPath}`);
    }
    throw err;
  }

  await collectFiles(dirPath);

  if (limitReached) {
    console.warn(
      `[file-manager] Warning: maxFiles limit (${maxFiles}) reached while listing ${dirPath}. ` +
      `Results may be incomplete. Consider increasing maxFiles or filtering by extension.`
    );
  }

  return { files, limitReached };
}

/**
 * Get file stats
 * @param {string} filePath - Path to the file
 * @returns {Promise<fs.Stats|null>}
 */
export async function getStats(filePath) {
  try {
    return await fs.stat(filePath);
  } catch {
    return null;
  }
}

/**
 * Make a file executable
 * @param {string} filePath - Path to the file
 * @returns {Promise<void>}
 */
export async function makeExecutable(filePath) {
  await fs.chmod(filePath, 0o755);
  debug(`Made executable: ${filePath}`);
}

/**
 * Find backup files in a directory
 * @param {string} dirPath - Directory to search
 * @param {string} [pattern] - Optional filename pattern to match
 * @returns {Promise<string[]>} Array of backup file paths
 */
export async function findBackups(dirPath, pattern = null) {
  const backups = [];

  try {
    const stat = await fs.stat(dirPath);
    if (!stat.isDirectory()) {
      return backups;
    }
  } catch {
    return backups;
  }

  try {
    const entries = await fs.readdir(dirPath, { withFileTypes: true });
    for (const entry of entries) {
      if (!entry.isFile()) continue;
      if (!BACKUP_PATTERN.test(entry.name)) continue;

      if (pattern) {
        const baseName = entry.name.replace(BACKUP_PATTERN, '');
        if (!baseName.includes(pattern)) continue;
      }

      backups.push(join(dirPath, entry.name));
    }
  } catch {
    // Ignore errors
  }

  return backups;
}

/**
 * Restore from the most recent backup
 * @param {string} filePath - File to restore
 * @returns {Promise<boolean>} True if restored, false if no backup found
 */
export async function restoreFromBackup(filePath) {
  const dir = dirname(filePath);
  const name = basename(filePath);
  const backups = await findBackups(dir, name);

  if (backups.length === 0) {
    return false;
  }

  // Sort by mtime to get most recent
  const backupStats = await Promise.all(
    backups.map(async (path) => {
      const stat = await fs.stat(path);
      return { path, mtime: stat.mtime.getTime() };
    })
  );
  backupStats.sort((a, b) => b.mtime - a.mtime);

  await fs.copy(backupStats[0].path, filePath, { overwrite: true });
  debug(`Restored from backup: ${backupStats[0].path}`);
  return true;
}

/**
 * Get the default max files limit
 * @returns {number} The default maximum files limit
 */
export function getDefaultMaxFiles() {
  return DEFAULT_MAX_FILES;
}

/**
 * Get the default max backups limit
 * @returns {number} The default maximum backups to retain
 */
export function getDefaultMaxBackups() {
  return DEFAULT_MAX_BACKUPS;
}

/**
 * Rotate backup files in a directory, keeping only the most recent N backups.
 * @param {string} backupDir - Directory containing backup files
 * @param {Object} options - Rotation options
 * @param {number} [options.maxBackups=5] - Maximum number of backups to retain
 * @param {string} [options.pattern] - Optional filename pattern to match
 * @param {boolean} [options.dryRun=false] - If true, only report what would be deleted
 * @returns {Promise<{kept: string[], deleted: string[], errors: string[]}>} Rotation results
 */
export async function rotateBackups(backupDir, options = {}) {
  const {
    maxBackups = DEFAULT_MAX_BACKUPS,
    pattern = null,
    dryRun = false
  } = options;

  if (typeof maxBackups !== 'number' || maxBackups < 0) {
    throw new Error(`maxBackups must be a non-negative number, got: ${maxBackups}`);
  }

  const kept = [];
  const deleted = [];
  const errors = [];

  try {
    const stat = await fs.stat(backupDir);
    if (!stat.isDirectory()) {
      throw new Error(`Path is not a directory: ${backupDir}`);
    }
  } catch (err) {
    if (err.code === 'ENOENT') {
      return { kept, deleted, errors };
    }
    throw err;
  }

  let entries;
  try {
    entries = await fs.readdir(backupDir, { withFileTypes: true });
  } catch (err) {
    if (err.code === 'EACCES' || err.code === 'EPERM') {
      errors.push(`Permission denied reading directory: ${backupDir}`);
      return { kept, deleted, errors };
    }
    throw err;
  }

  const backupFiles = [];
  for (const entry of entries) {
    if (!entry.isFile()) continue;
    if (!BACKUP_PATTERN.test(entry.name)) continue;

    if (pattern) {
      const baseName = entry.name.replace(BACKUP_PATTERN, '');
      if (!baseName.includes(pattern)) continue;
    }

    const fullPath = join(backupDir, entry.name);
    try {
      const stat = await fs.stat(fullPath);
      backupFiles.push({
        name: entry.name,
        path: fullPath,
        mtime: stat.mtime.getTime()
      });
    } catch (err) {
      errors.push(`Could not stat file: ${fullPath}`);
    }
  }

  backupFiles.sort((a, b) => b.mtime - a.mtime);

  for (let i = 0; i < backupFiles.length; i++) {
    const backup = backupFiles[i];
    if (i < maxBackups) {
      kept.push(backup.path);
    } else {
      if (dryRun) {
        deleted.push(backup.path);
      } else {
        try {
          await fs.unlink(backup.path);
          deleted.push(backup.path);
        } catch (err) {
          errors.push(`Failed to delete: ${backup.path} (${err.message})`);
        }
      }
    }
  }

  return { kept, deleted, errors };
}

/**
 * Clean up all backup files in a directory, optionally older than a specified age.
 * @param {string} backupDir - Directory containing backup files
 * @param {Object} options - Cleanup options
 * @param {number} [options.maxAgeDays=30] - Maximum age in days for backups (0 = delete all)
 * @param {string} [options.pattern] - Optional filename pattern to match
 * @param {boolean} [options.dryRun=false] - If true, only report what would be deleted
 * @returns {Promise<{deleted: string[], retained: string[], errors: string[]}>} Cleanup results
 */
export async function cleanupBackups(backupDir, options = {}) {
  const {
    maxAgeDays = 30,
    pattern = null,
    dryRun = false
  } = options;

  if (typeof maxAgeDays !== 'number' || maxAgeDays < 0) {
    throw new Error(`maxAgeDays must be a non-negative number, got: ${maxAgeDays}`);
  }

  const deleted = [];
  const retained = [];
  const errors = [];

  try {
    const stat = await fs.stat(backupDir);
    if (!stat.isDirectory()) {
      throw new Error(`Path is not a directory: ${backupDir}`);
    }
  } catch (err) {
    if (err.code === 'ENOENT') {
      return { deleted, retained, errors };
    }
    throw err;
  }

  let entries;
  try {
    entries = await fs.readdir(backupDir, { withFileTypes: true });
  } catch (err) {
    if (err.code === 'EACCES' || err.code === 'EPERM') {
      errors.push(`Permission denied reading directory: ${backupDir}`);
      return { deleted, retained, errors };
    }
    throw err;
  }

  const cutoffTime = Date.now() - (maxAgeDays * 24 * 60 * 60 * 1000);

  for (const entry of entries) {
    if (!entry.isFile()) continue;
    if (!BACKUP_PATTERN.test(entry.name)) continue;

    if (pattern) {
      const baseName = entry.name.replace(BACKUP_PATTERN, '');
      if (!baseName.includes(pattern)) continue;
    }

    const fullPath = join(backupDir, entry.name);
    try {
      const stat = await fs.stat(fullPath);
      const fileTime = stat.mtime.getTime();

      if (maxAgeDays === 0 || fileTime < cutoffTime) {
        if (dryRun) {
          deleted.push(fullPath);
        } else {
          try {
            await fs.unlink(fullPath);
            deleted.push(fullPath);
          } catch (unlinkErr) {
            errors.push(`Failed to delete: ${fullPath} (${unlinkErr.message})`);
          }
        }
      } else {
        retained.push(fullPath);
      }
    } catch (err) {
      errors.push(`Could not stat file: ${fullPath}`);
    }
  }

  return { deleted, retained, errors };
}

/**
 * Synchronize package assets (templates, scripts, lib, skills) to global directory.
 * @param {Object} options - Sync options
 * @param {boolean} [options.templates=true] - Sync templates directory
 * @param {boolean} [options.scripts=true] - Sync scripts directory
 * @param {boolean} [options.lib=true] - Sync lib/core directory
 * @param {boolean} [options.skills=true] - Sync skills directory
 * @param {boolean} [options.force=false] - Force overwrite even if destination exists
 * @param {Object} paths - Path configuration
 * @returns {Promise<{synced: string[], skipped: string[], errors: string[]}>} Sync results
 */
export async function syncPackageAssets(options = {}, paths) {
  const {
    templates = true,
    scripts = true,
    lib = true,
    skills = true,
    force = false
  } = options;

  const synced = [];
  const skipped = [];
  const errors = [];

  if (!paths) {
    throw new Error('paths configuration is required for syncPackageAssets');
  }

  async function syncDirectory(srcDir, destDir, name, makeScriptsExecutable = false) {
    const srcExists = await exists(srcDir);
    if (!srcExists) {
      skipped.push(`${name}: source not found (${srcDir})`);
      return;
    }

    const destExists = await exists(destDir);
    if (destExists && !force) {
      skipped.push(`${name}: already exists (use force to overwrite)`);
      return;
    }

    try {
      await copyDir(srcDir, destDir, {
        overwrite: force,
        sourceBaseDir: srcDir,
        destBaseDir: destDir
      });
      synced.push(`${name}: ${srcDir} -> ${destDir}`);

      if (makeScriptsExecutable) {
        try {
          const entries = await fs.readdir(destDir, { withFileTypes: true });
          for (const entry of entries) {
            if (entry.isFile() && entry.name.endsWith('.sh')) {
              const scriptPath = join(destDir, entry.name);
              await makeExecutable(scriptPath);
            }
          }
        } catch (execErr) {
          errors.push(`${name}: failed to make scripts executable: ${execErr.message}`);
        }
      }
    } catch (copyErr) {
      errors.push(`${name}: copy failed: ${copyErr.message}`);
    }
  }

  if (templates) {
    await syncDirectory(
      paths.PACKAGE_TEMPLATES_DIR,
      paths.GLOBAL_TEMPLATES_DIR,
      'templates'
    );
  }

  if (scripts) {
    await syncDirectory(
      paths.PACKAGE_SCRIPTS_DIR,
      paths.GLOBAL_SCRIPTS_DIR,
      'scripts',
      true
    );
  }

  if (lib) {
    await syncDirectory(
      paths.PACKAGE_LIB_CORE_DIR,
      paths.GLOBAL_LIB_DIR,
      'lib'
    );
  }

  if (skills) {
    await syncDirectory(
      paths.PACKAGE_SKILLS_DIR,
      paths.GLOBAL_SKILLS_DIR,
      'skills'
    );
  }

  return { synced, skipped, errors };
}

export default {
  ensureDir,
  exists,
  readFile,
  readJson,
  writeFile,
  writeJson,
  copyFile,
  copyDir,
  remove,
  symlink,
  isSymlink,
  readSymlink,
  listFiles,
  getStats,
  makeExecutable,
  findBackups,
  restoreFromBackup,
  getDefaultMaxFiles,
  getDefaultMaxBackups,
  rotateBackups,
  cleanupBackups,
  syncPackageAssets,
  validatePath
};
