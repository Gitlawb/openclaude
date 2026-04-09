/**
 * Validator for Hawat CLI
 *
 * Validates installations, configurations, and project structure.
 */

import { exists, isSymlink, readSymlink, readJson, readFile } from './file-manager.js';
import {
  GLOBAL_HAWAT_DIR,
  GLOBAL_TEMPLATES_DIR,
  GLOBAL_SCRIPTS_DIR,
  GLOBAL_SKILLS_DIR,
  CLAUDE_SKILLS_DIR,
  PROVIDER_CONFIG,
  getProjectPaths
} from '../utils/paths.js';
import { join } from 'path';
import { debug } from '../utils/logger.js';

/**
 * Validation result structure
 * @typedef {Object} ValidationResult
 * @property {boolean} valid - Whether validation passed
 * @property {string[]} errors - List of errors
 * @property {string[]} warnings - List of warnings
 * @property {Object} details - Additional details
 */

/**
 * Validate global hawat installation
 * @returns {Promise<ValidationResult>}
 */
export async function validateGlobalInstallation() {
  const errors = [];
  const warnings = [];
  const details = {
    globalDir: GLOBAL_HAWAT_DIR,
    components: {}
  };

  // Check global directory exists
  if (!await exists(GLOBAL_HAWAT_DIR)) {
    errors.push(`Global directory not found: ${GLOBAL_HAWAT_DIR}`);
    return { valid: false, errors, warnings, details };
  }

  details.components.globalDir = true;

  // Check templates directory
  if (!await exists(GLOBAL_TEMPLATES_DIR)) {
    errors.push('Templates directory not found');
    details.components.templates = false;
  } else {
    details.components.templates = true;
  }

  // Check scripts directory
  if (!await exists(GLOBAL_SCRIPTS_DIR)) {
    errors.push('Scripts directory not found');
    details.components.scripts = false;
  } else {
    details.components.scripts = true;
  }

  // Check skills directory
  if (!await exists(GLOBAL_SKILLS_DIR)) {
    warnings.push('Skills directory not found (optional)');
    details.components.skills = false;
  } else {
    details.components.skills = true;
  }

  // Check global config
  const configPath = join(GLOBAL_HAWAT_DIR, 'config.json');
  if (!await exists(configPath)) {
    warnings.push('Global config not found (will use defaults)');
    details.components.config = false;
  } else {
    try {
      await readJson(configPath);
      details.components.config = true;
    } catch {
      errors.push('Global config is not valid JSON');
      details.components.config = false;
    }
  }

  // Check skill symlink in Forge config
  const skillSymlink = join(CLAUDE_SKILLS_DIR, 'hawat');
  if (await exists(skillSymlink)) {
    if (await isSymlink(skillSymlink)) {
      const target = await readSymlink(skillSymlink);
      details.skillSymlink = { exists: true, isSymlink: true, target };
    } else {
      warnings.push('Skill path exists but is not a symlink');
      details.skillSymlink = { exists: true, isSymlink: false };
    }
  } else {
    warnings.push('Skill symlink not found in Forge config');
    details.skillSymlink = { exists: false };
  }

  debug(`Global installation validation: ${errors.length} errors, ${warnings.length} warnings`);

  return {
    valid: errors.length === 0,
    errors,
    warnings,
    details
  };
}

/**
 * Validate project initialization
 * @param {string} [projectDir] - Project directory
 * @returns {Promise<ValidationResult>}
 */
export async function validateProjectInit(projectDir) {
  const errors = [];
  const warnings = [];
  const paths = getProjectPaths(projectDir);
  const details = {
    projectDir: paths.root,
    components: {}
  };

  // Check CLAUDE.md
  if (!await exists(paths.claudeMd)) {
    errors.push('CLAUDE.md not found');
    details.components.claudeMd = false;
  } else {
    details.components.claudeMd = true;
    // Validate CLAUDE.md content
    const content = await readFile(paths.claudeMd);
    if (!content.includes('Hawat') && !content.includes('hawat') && !content.includes('Forge') && !content.includes('forge')) {
      warnings.push('CLAUDE.md may not be a Hawat/Forge-generated file');
    }
  }

  // Check .forge directory
  if (!await exists(paths.providerDir)) {
    errors.push(`${PROVIDER_CONFIG.configDirName} directory not found`);
    details.components.forgeDir = false;
  } else {
    details.components.forgeDir = true;
  }

  // Check settings.json
  if (!await exists(paths.settingsJson)) {
    warnings.push('settings.json not found (hooks disabled)');
    details.components.settingsJson = false;
  } else {
    try {
      await readJson(paths.settingsJson);
      details.components.settingsJson = true;
    } catch {
      errors.push('settings.json is not valid JSON');
      details.components.settingsJson = false;
    }
  }

  // Check .hawat directory
  if (!await exists(paths.hawatDir)) {
    warnings.push('.hawat directory not found');
    details.components.hawatDir = false;
  } else {
    details.components.hawatDir = true;
  }

  // Check project config
  if (!await exists(paths.projectConfig)) {
    warnings.push('Project config not found');
    details.components.projectConfig = false;
  } else {
    try {
      await readJson(paths.projectConfig);
      details.components.projectConfig = true;
    } catch {
      errors.push('Project config is not valid JSON');
      details.components.projectConfig = false;
    }
  }

  debug(`Project validation: ${errors.length} errors, ${warnings.length} warnings`);

  return {
    valid: errors.length === 0,
    errors,
    warnings,
    details
  };
}

/**
 * Validate Forge settings.json structure
 * @param {object} settings - Settings object to validate
 * @returns {ValidationResult}
 */
export function validateClaudeSettings(settings) {
  const errors = [];
  const warnings = [];
  const details = { hooks: {} };

  // Check hooks structure
  if (settings.hooks) {
    const validHookTypes = [
      'PreToolUse',
      'PostToolUse',
      'SessionStart',
      'Stop',
      'PreCompact',
      'PostCompact',
      'PreSubagent',
      'PostSubagent'
    ];

    for (const hookType of Object.keys(settings.hooks)) {
      if (!validHookTypes.includes(hookType)) {
        warnings.push(`Unknown hook type: ${hookType}`);
      }

      const hooks = settings.hooks[hookType];
      if (!Array.isArray(hooks)) {
        errors.push(`hooks.${hookType} must be an array`);
        continue;
      }

      details.hooks[hookType] = hooks.length;

      for (const hook of hooks) {
        if (!hook.matcher && !hook.type) {
          errors.push(`Hook in ${hookType} missing matcher or type`);
        }
        if (!hook.command && !hook.hooks) {
          errors.push(`Hook in ${hookType} missing command or nested hooks`);
        }
      }
    }
  }

  // Check permissions
  if (settings.permissions) {
    if (settings.permissions.allow) {
      if (!Array.isArray(settings.permissions.allow)) {
        errors.push('permissions.allow must be an array');
      }
      details.allowRules = settings.permissions.allow?.length || 0;
    }
    if (settings.permissions.deny) {
      if (!Array.isArray(settings.permissions.deny)) {
        errors.push('permissions.deny must be an array');
      }
      details.denyRules = settings.permissions.deny?.length || 0;
    }
  }

  return {
    valid: errors.length === 0,
    errors,
    warnings,
    details
  };
}

/**
 * Check if a required file is missing
 * @param {string[]} files - Array of file paths to check
 * @returns {Promise<string[]>} Array of missing file paths
 */
export async function findMissingFiles(files) {
  const missing = [];
  for (const file of files) {
    if (!await exists(file)) {
      missing.push(file);
    }
  }
  return missing;
}

/**
 * Validate script is executable
 * @param {string} scriptPath - Path to script
 * @returns {Promise<boolean>}
 */
export async function isScriptExecutable(scriptPath) {
  if (!await exists(scriptPath)) {
    return false;
  }

  try {
    const { statSync } = await import('fs');
    const stats = statSync(scriptPath);
    // Check if any execute bit is set
    return (stats.mode & 0o111) !== 0;
  } catch {
    return false;
  }
}

/**
 * Get a summary of installation health
 * @param {string} [projectDir] - Optional project directory
 * @returns {Promise<object>}
 */
export async function getHealthSummary(projectDir) {
  const globalResult = await validateGlobalInstallation();
  const projectResult = projectDir ? await validateProjectInit(projectDir) : null;

  return {
    global: {
      healthy: globalResult.valid && globalResult.warnings.length === 0,
      valid: globalResult.valid,
      errors: globalResult.errors.length,
      warnings: globalResult.warnings.length,
      details: globalResult.details
    },
    project: projectResult ? {
      healthy: projectResult.valid && projectResult.warnings.length === 0,
      valid: projectResult.valid,
      errors: projectResult.errors.length,
      warnings: projectResult.warnings.length,
      details: projectResult.details
    } : null,
    overall: globalResult.valid && (projectResult?.valid ?? true)
  };
}

export default {
  validateGlobalInstallation,
  validateProjectInit,
  validateClaudeSettings,
  findMissingFiles,
  isScriptExecutable,
  getHealthSummary
};
