/**
 * Path constants and utilities for Hawat CLI
 *
 * Centralizes all path handling for consistent cross-platform behavior.
 * Provider-specific paths (Forge, Codex, etc.) are configurable
 * via PROVIDER_CONFIG so the codebase can be adapted for different engines.
 */

import { homedir } from 'os';
import { dirname, join, resolve } from 'path';
import { fileURLToPath } from 'url';

// Get the directory of the current module
const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

/**
 * Root directory of the hawat package
 */
export const PACKAGE_ROOT = resolve(__dirname, '..', '..');

/**
 * User's home directory
 */
export const HOME_DIR = homedir();

/**
 * Provider configuration - defaults to Atreides Forge.
 * Override individual fields to adapt for different engines (Codex, Gemini, etc.).
 * Do NOT build a full provider abstraction layer here. Just configurable constants.
 */
export const PROVIDER_CONFIG = {
  /** Config directory name (e.g. '.forge', '.codex') */
  configDirName: '.forge',
  /** Main instruction filename — Anthropic SDK convention, do NOT rename */
  instructionFile: 'CLAUDE.md',
  /** Settings filename inside configDir */
  settingsFile: 'settings.json',
  /** Context filename inside configDir */
  contextFile: 'context.md',
  /** Critical context filename inside configDir */
  criticalContextFile: 'critical-context.md',
  /** Checkpoint filename inside configDir */
  checkpointFile: 'checkpoint.md',
  /** Skills subdirectory inside configDir */
  skillsDirName: 'skills',
  /** State directory inside .hawat */
  stateDirName: 'state',
};

/**
 * Global hawat installation directory
 */
export const GLOBAL_HAWAT_DIR = join(HOME_DIR, '.hawat');

/**
 * Global hawat bin directory
 */
export const GLOBAL_BIN_DIR = join(GLOBAL_HAWAT_DIR, 'bin');

/**
 * Global hawat lib directory
 */
export const GLOBAL_LIB_DIR = join(GLOBAL_HAWAT_DIR, 'lib');

/**
 * Global templates directory (copied from package)
 */
export const GLOBAL_TEMPLATES_DIR = join(GLOBAL_HAWAT_DIR, 'templates');

/**
 * Global scripts directory (copied from package)
 */
export const GLOBAL_SCRIPTS_DIR = join(GLOBAL_HAWAT_DIR, 'scripts');

/**
 * Global skills directory
 */
export const GLOBAL_SKILLS_DIR = join(GLOBAL_HAWAT_DIR, 'skills');

/**
 * Provider config directory in user's home
 * (e.g. ~/.forge, ~/.codex)
 */
export const PROVIDER_CONFIG_DIR = join(HOME_DIR, PROVIDER_CONFIG.configDirName);

/**
 * Provider skills directory (for symlinks)
 */
export const PROVIDER_SKILLS_DIR = join(PROVIDER_CONFIG_DIR, PROVIDER_CONFIG.skillsDirName);

// Legacy aliases for backward compatibility with existing code
/** @deprecated Use PROVIDER_CONFIG_DIR */
export const CLAUDE_CONFIG_DIR = PROVIDER_CONFIG_DIR;
/** @deprecated Use PROVIDER_SKILLS_DIR */
export const CLAUDE_SKILLS_DIR = PROVIDER_SKILLS_DIR;

/**
 * Package templates directory (source)
 */
export const PACKAGE_TEMPLATES_DIR = join(PACKAGE_ROOT, 'templates');

/**
 * Package scripts directory (source)
 */
export const PACKAGE_SCRIPTS_DIR = join(PACKAGE_ROOT, 'scripts');

/**
 * Package lib/core directory (source)
 */
export const PACKAGE_LIB_CORE_DIR = join(PACKAGE_ROOT, 'lib', 'core');

/**
 * Package skills directory (source)
 */
export const PACKAGE_SKILLS_DIR = join(PACKAGE_ROOT, 'lib', 'skills');

/**
 * Get project-level paths for a given project directory
 * @param {string} [projectDir=process.cwd()] - The project directory
 * @returns {object} Object containing project-specific paths
 */
export function getProjectPaths(projectDir = process.cwd()) {
  const cfg = PROVIDER_CONFIG;
  return {
    root: projectDir,
    providerDir: join(projectDir, cfg.configDirName),
    hawatDir: join(projectDir, '.hawat'),
    claudeMd: join(projectDir, cfg.instructionFile),
    settingsJson: join(projectDir, cfg.configDirName, cfg.settingsFile),
    contextMd: join(projectDir, cfg.configDirName, cfg.contextFile),
    criticalContextMd: join(projectDir, cfg.configDirName, cfg.criticalContextFile),
    checkpointMd: join(projectDir, cfg.configDirName, cfg.checkpointFile),
    projectConfig: join(projectDir, '.hawat', 'config.json'),
    stateDir: join(projectDir, '.hawat', cfg.stateDirName)
  };
}

/**
 * Check if a path is within the global hawat directory
 * @param {string} path - Path to check
 * @returns {boolean}
 */
export function isGlobalPath(path) {
  return resolve(path).startsWith(GLOBAL_HAWAT_DIR);
}

/**
 * Check if a path is within a project's .hawat directory
 * @param {string} path - Path to check
 * @param {string} [projectDir=process.cwd()] - Project directory
 * @returns {boolean}
 */
export function isProjectPath(path, projectDir = process.cwd()) {
  const paths = getProjectPaths(projectDir);
  const resolved = resolve(path);
  return resolved.startsWith(paths.hawatDir) || resolved.startsWith(paths.providerDir);
}

/**
 * Get a relative path from the project root
 * @param {string} fullPath - Full path
 * @param {string} [projectDir=process.cwd()] - Project directory
 * @returns {string} Relative path
 */
export function getRelativePath(fullPath, projectDir = process.cwd()) {
  const resolved = resolve(fullPath);
  const projectResolved = resolve(projectDir);
  if (resolved.startsWith(projectResolved)) {
    return resolved.slice(projectResolved.length + 1);
  }
  return fullPath;
}

export default {
  PACKAGE_ROOT,
  HOME_DIR,
  GLOBAL_HAWAT_DIR,
  GLOBAL_BIN_DIR,
  GLOBAL_LIB_DIR,
  GLOBAL_TEMPLATES_DIR,
  GLOBAL_SCRIPTS_DIR,
  GLOBAL_SKILLS_DIR,
  PROVIDER_CONFIG_DIR,
  PROVIDER_SKILLS_DIR,
  CLAUDE_CONFIG_DIR,
  CLAUDE_SKILLS_DIR,
  PACKAGE_TEMPLATES_DIR,
  PACKAGE_SCRIPTS_DIR,
  PACKAGE_LIB_CORE_DIR,
  PACKAGE_SKILLS_DIR,
  PROVIDER_CONFIG,
  getProjectPaths,
  isGlobalPath,
  isProjectPath,
  getRelativePath
};
