/**
 * Config Merger for Hawat CLI
 *
 * Handles merging of global and project configurations with smart array handling.
 */

import { readJson, exists } from './file-manager.js';
import { GLOBAL_HAWAT_DIR, getProjectPaths } from '../utils/paths.js';
import { join } from 'path';
import { debug } from '../utils/logger.js';

/**
 * Keys that could be used for prototype pollution attacks
 * These are filtered out during object merging to prevent security vulnerabilities
 * @type {string[]}
 */
const DANGEROUS_KEYS = ['__proto__', 'constructor', 'prototype'];

/**
 * Deep merge two objects
 *
 * Rules:
 * - Objects are recursively merged
 * - Arrays are concatenated (duplicates removed)
 * - Primitives from source override target
 *
 * @param {object} target - Target object
 * @param {object} source - Source object (overrides target)
 * @returns {object} Merged object
 */
export function deepMerge(target, source) {
  const result = { ...target };

  for (const key of Object.keys(source)) {
    // Skip dangerous prototype-polluting keys
    if (DANGEROUS_KEYS.includes(key)) {
      debug(`Skipping dangerous key in deepMerge: ${key}`);
      continue;
    }

    const targetValue = target[key];
    const sourceValue = source[key];

    if (isObject(targetValue) && isObject(sourceValue)) {
      // Recursively merge objects
      result[key] = deepMerge(targetValue, sourceValue);
    } else if (Array.isArray(targetValue) && Array.isArray(sourceValue)) {
      // Concatenate arrays, removing duplicates for primitives
      result[key] = mergeArrays(targetValue, sourceValue);
    } else if (sourceValue !== undefined) {
      // Source value overrides
      result[key] = sourceValue;
    }
  }

  return result;
}

/**
 * Check if a value is a plain object
 * @param {any} value - Value to check
 * @returns {boolean}
 */
function isObject(value) {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

/**
 * Merge two arrays, removing duplicates
 * For primitives: exact match deduplication
 * For objects: deep equality check via JSON.stringify
 *
 * @param {any[]} target - Target array
 * @param {any[]} source - Source array
 * @returns {any[]} Merged array
 */
function mergeArrays(target, source) {
  const result = [...target];

  for (const item of source) {
    if (typeof item === 'object' && item !== null) {
      // For objects, check deep equality via JSON
      const itemStr = JSON.stringify(item);
      const isDuplicate = result.some(
        existing => typeof existing === 'object' && existing !== null &&
          JSON.stringify(existing) === itemStr
      );
      if (!isDuplicate) {
        result.push(item);
      }
    } else {
      // For primitives, only add if not present
      if (!result.includes(item)) {
        result.push(item);
      }
    }
  }

  return result;
}

/**
 * Load global hawat configuration
 * @returns {Promise<object>}
 */
export async function loadGlobalConfig() {
  const configPath = join(GLOBAL_HAWAT_DIR, 'config.json');

  if (!await exists(configPath)) {
    debug('No global config found');
    return getDefaultGlobalConfig();
  }

  try {
    const config = await readJson(configPath);
    debug('Loaded global config');
    return config;
  } catch (error) {
    debug(`Error loading global config: ${error.message}`);
    return getDefaultGlobalConfig();
  }
}

/**
 * Load project hawat configuration
 * @param {string} [projectDir] - Project directory
 * @returns {Promise<object>}
 */
export async function loadProjectConfig(projectDir) {
  const paths = getProjectPaths(projectDir);

  if (!await exists(paths.projectConfig)) {
    debug('No project config found');
    return {};
  }

  try {
    const config = await readJson(paths.projectConfig);
    debug('Loaded project config');
    return config;
  } catch (error) {
    debug(`Error loading project config: ${error.message}`);
    return {};
  }
}

/**
 * Get merged configuration (global + project)
 * @param {string} [projectDir] - Project directory
 * @returns {Promise<object>}
 */
export async function getMergedConfig(projectDir) {
  const globalConfig = await loadGlobalConfig();
  const projectConfig = await loadProjectConfig(projectDir);

  const merged = deepMerge(globalConfig, projectConfig);
  debug('Merged global and project configs');

  return merged;
}

/**
 * Get default global configuration
 * @returns {object}
 */
export function getDefaultGlobalConfig() {
  return {
    version: '1.0.0',
    defaults: {
      orchestrationLevel: 'standard',
      useHooks: true,
      useAgentDelegation: true,
      modelPreferences: {
        exploration: 'sonnet',
        implementation: 'opus',
        architecture: 'opus'
      }
    },
    permissions: {
      allow: [],
      deny: []
    },
    hooks: {
      enabled: true
    }
  };
}

/**
 * Get default project configuration
 * @param {object} [options] - Options from project init
 * @returns {object}
 */
export function getDefaultProjectConfig(options = {}) {
  return {
    version: '1.0.0',
    projectName: options.projectName || 'untitled',
    projectType: options.projectType || 'other',
    description: options.description || '',
    orchestrationLevel: options.orchestrationLevel || 'standard',
    created: new Date().toISOString(),
    settings: {
      useHooks: options.useHooks ?? true,
      useAgentDelegation: options.useAgentDelegation ?? false
    }
  };
}

/**
 * Load Forge settings.json
 * @param {string} [projectDir] - Project directory
 * @returns {Promise<object>}
 */
export async function loadClaudeSettings(projectDir) {
  const paths = getProjectPaths(projectDir);

  if (!await exists(paths.settingsJson)) {
    debug('No Forge settings found');
    return {};
  }

  try {
    const settings = await readJson(paths.settingsJson);
    debug('Loaded Forge settings');
    return settings;
  } catch (error) {
    debug(`Error loading Forge settings: ${error.message}`);
    return {};
  }
}

/**
 * Merge Forge settings with hawat hooks
 * @param {object} existingSettings - Existing settings.json content
 * @param {object} hawatHooks - Hawat hook configurations
 * @returns {object} Merged settings
 */
export function mergeClaudeSettings(existingSettings, hawatHooks) {
  return deepMerge(existingSettings, hawatHooks);
}

/**
 * Validate configuration structure
 * @param {object} config - Configuration to validate
 * @param {string} [type='project'] - Type: 'global' or 'project'
 * @returns {{valid: boolean, errors: string[]}}
 */
export function validateConfig(config, type = 'project') {
  const errors = [];

  if (!config.version) {
    errors.push('Missing required field: version');
  }

  if (type === 'project') {
    if (!config.projectName) {
      errors.push('Missing required field: projectName');
    }
  }

  if (config.permissions) {
    if (config.permissions.allow && !Array.isArray(config.permissions.allow)) {
      errors.push('permissions.allow must be an array');
    }
    if (config.permissions.deny && !Array.isArray(config.permissions.deny)) {
      errors.push('permissions.deny must be an array');
    }
  }

  return {
    valid: errors.length === 0,
    errors
  };
}

export default {
  deepMerge,
  loadGlobalConfig,
  loadProjectConfig,
  getMergedConfig,
  getDefaultGlobalConfig,
  getDefaultProjectConfig,
  loadClaudeSettings,
  mergeClaudeSettings,
  validateConfig
};
