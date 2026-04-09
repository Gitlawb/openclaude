/**
 * Update Command
 *
 * Update Hawat global or project components.
 */

import { Command } from 'commander';
import { join, dirname } from 'path';
import logger from '../utils/logger.js';
import { confirm } from '../utils/prompts.js';
import {
  GLOBAL_HAWAT_DIR,
  GLOBAL_TEMPLATES_DIR,
  GLOBAL_SCRIPTS_DIR,
  GLOBAL_LIB_DIR,
  GLOBAL_SKILLS_DIR,
  PACKAGE_TEMPLATES_DIR,
  PACKAGE_SCRIPTS_DIR,
  PACKAGE_LIB_CORE_DIR,
  PACKAGE_SKILLS_DIR,
  PROVIDER_CONFIG,
  getProjectPaths
} from '../utils/paths.js';
import {
  exists,
  copyDir,
  syncPackageAssets,
  readJson,
  writeFile
} from '../lib/file-manager.js';
import { renderNamedTemplate, getDefaultData } from '../lib/template-engine.js';

/**
 * Create the update command
 * @returns {Command}
 */
export function updateCommand() {
  const cmd = new Command('update');

  cmd
    .description("Update Hawat components")
    .option('-g, --global', 'Update global components (default)')
    .option('-p, --project', 'Update current project files')
    .option('--no-backup', 'Skip backup creation')
    .action(async (options) => {
      try {
        if (options.project) {
          await updateProject(options);
        } else {
          await updateGlobal(options);
        }
      } catch (error) {
        logger.error(`Update failed: ${error.message}`);
        logger.debug(error.stack);
        process.exit(1);
      }
    });

  return cmd;
}

/**
 * Update global components
 * @param {object} options - Command options
 */
async function updateGlobal(options) {
  logger.title("Hawat Global Update");

  if (!await exists(GLOBAL_HAWAT_DIR)) {
    logger.error("Hawat is not installed.");
    logger.info('Run: forge install');
    process.exit(1);
  }

  // Create backup if requested
  if (options.backup !== false) {
    const backupDir = `${GLOBAL_HAWAT_DIR}.backup.${Date.now()}`;
    logger.info(`Creating backup: ${backupDir}`);
    await copyDir(GLOBAL_HAWAT_DIR, backupDir, {
      sourceBaseDir: GLOBAL_HAWAT_DIR,
      destBaseDir: dirname(GLOBAL_HAWAT_DIR)
    });
    logger.success('Backup created');
  }

  logger.info('Updating global components...');

  const syncResult = await syncPackageAssets({
    force: true
  }, {
    PACKAGE_TEMPLATES_DIR,
    PACKAGE_SCRIPTS_DIR,
    PACKAGE_LIB_CORE_DIR,
    PACKAGE_SKILLS_DIR,
    GLOBAL_TEMPLATES_DIR,
    GLOBAL_SCRIPTS_DIR,
    GLOBAL_LIB_DIR,
    GLOBAL_SKILLS_DIR
  });

  syncResult.synced.forEach(item => logger.success(`Updated: ${item}`));
  syncResult.skipped.forEach(item => logger.warn(item));
  syncResult.errors.forEach(item => logger.warn(item));

  console.log();
  logger.success('Global update complete!');
}

/**
 * Merge hook arrays by matcher, combining commands to avoid duplicate runs
 * @param {Array} existing - Existing hook entries
 * @param {Array} newHooks - New hook entries to merge
 * @returns {Array} Merged hook array
 */
function mergeHookArrays(existing, newHooks) {
  const result = [...existing];

  for (const newHook of newHooks) {
    if (newHook.matcher && newHook.hooks) {
      // PreToolUse/PostToolUse style: { matcher, hooks: [{type, command}] }
      // Find existing entry with same matcher
      const existingIndex = result.findIndex(h => h.matcher === newHook.matcher);

      if (existingIndex >= 0) {
        // Merge hooks arrays, deduplicating by command
        const existingHooks = result[existingIndex].hooks || [];
        const mergedHooks = [...existingHooks];

        for (const newSubHook of newHook.hooks) {
          const subHookSig = getSubHookSignature(newSubHook);
          const isDupe = mergedHooks.some(h => getSubHookSignature(h) === subHookSig);
          if (!isDupe) {
            mergedHooks.push(newSubHook);
          }
        }

        result[existingIndex] = { ...result[existingIndex], hooks: mergedHooks };
      } else {
        // New matcher - add the whole entry
        result.push(newHook);
      }
    } else {
      // Simple hook style or unknown format - dedupe by full signature
      const hookSignature = getHookSignature(newHook);
      const isDuplicate = result.some(h => getHookSignature(h) === hookSignature);
      if (!isDuplicate) {
        result.push(newHook);
      }
    }
  }

  return result;
}

/**
 * Generate a signature for a sub-hook (inside hooks array)
 * @param {object} subHook - Sub-hook like {type, command}
 * @returns {string} Signature string
 */
function getSubHookSignature(subHook) {
  if (subHook.command) {
    return subHook.command;
  } else if (subHook.type) {
    return subHook.type;
  }
  return JSON.stringify(subHook);
}

/**
 * Generate a signature for a hook entry for deduplication
 * @param {object} hook - Hook configuration
 * @returns {string} Signature string
 */
function getHookSignature(hook) {
  if (hook.matcher && hook.hooks) {
    // PreToolUse/PostToolUse style: { matcher, hooks: [{type, command}] }
    const commands = hook.hooks.map(h => h.command || h.type).sort().join('|');
    return `${hook.matcher}:${commands}`;
  } else if (hook.type && hook.command) {
    // Simple hook style: { type, command }
    return `${hook.type}:${hook.command}`;
  }
  // Fallback to JSON
  return JSON.stringify(hook);
}

/**
 * Deep merge settings with smart hook/permission handling
 * - New hook types are added
 * - New entries within existing hook types are merged with deduplication
 * - Existing hook customizations are preserved
 * - Permissions are merged with deduplication
 * @param {object} newSettings - New settings from template
 * @param {object} existingSettings - User's existing settings
 * @returns {object} Merged settings
 */
function deepMergeSettings(newSettings, existingSettings) {
  const merged = { ...existingSettings };

  // Merge hooks: add new hook types AND merge entries within existing types
  if (newSettings.hooks) {
    merged.hooks = merged.hooks || {};
    for (const [hookType, hookConfig] of Object.entries(newSettings.hooks)) {
      if (!merged.hooks[hookType]) {
        // New hook type - add it
        merged.hooks[hookType] = hookConfig;
      } else if (Array.isArray(hookConfig) && Array.isArray(merged.hooks[hookType])) {
        // Merge hook arrays, deduplicating by command string
        merged.hooks[hookType] = mergeHookArrays(merged.hooks[hookType], hookConfig);
      }
      // If hook type exists but isn't an array, keep user's customization
    }
  }

  // Merge permissions: combine arrays with deduplication
  if (newSettings.permissions) {
    merged.permissions = merged.permissions || {};

    // Merge allow list
    if (newSettings.permissions.allow) {
      const existingAllow = merged.permissions.allow || [];
      const newAllow = newSettings.permissions.allow.filter(
        p => !existingAllow.includes(p)
      );
      merged.permissions.allow = [...existingAllow, ...newAllow];
    }

    // Merge deny list
    if (newSettings.permissions.deny) {
      const existingDeny = merged.permissions.deny || [];
      const newDeny = newSettings.permissions.deny.filter(
        p => !existingDeny.includes(p)
      );
      merged.permissions.deny = [...existingDeny, ...newDeny];
    }
  }

  return merged;
}

/**
 * Update project files
 * @param {object} options - Command options
 */
async function updateProject(options) {
  const paths = getProjectPaths();
  const baseDir = paths.root;

  logger.title("Hawat Project Update");

  if (!await exists(paths.providerDir)) {
    logger.error("No Hawat project found in current directory.");
    logger.info('Run: forge init');
    process.exit(1);
  }

  // Confirm update
  const proceed = await confirm(
    'This will update project files. Continue?',
    true
  );

  if (!proceed) {
    logger.info('Update cancelled.');
    return;
  }

  // Load existing project config
  let projectConfig = {};
  if (await exists(paths.projectConfig)) {
    try {
      projectConfig = await readJson(paths.projectConfig);
    } catch {
      logger.warn('Could not read project config, using defaults');
    }
  }

  // Prepare template data
  const templateData = {
    ...getDefaultData(),
    ...projectConfig,
    configDirName: PROVIDER_CONFIG.configDirName,
    updated: new Date().toISOString()
  };

  logger.info('Updating project files...');

  // Update settings.json (preserving custom settings)
  if (await exists(paths.settingsJson)) {
    try {
      const existingSettings = await readJson(paths.settingsJson);
      const newSettings = await renderNamedTemplate('settings.json', templateData);
      const newSettingsObj = JSON.parse(newSettings);

      // Deep merge settings: new values fill gaps, existing customizations preserved
      const mergedSettings = deepMergeSettings(newSettingsObj, existingSettings);

      await writeFile(paths.settingsJson, JSON.stringify(mergedSettings, null, 2), {
        backup: options.backup !== false,
        baseDir
      });
      logger.success(`Updated: ${PROVIDER_CONFIG.configDirName}/settings.json`);
    } catch (error) {
      logger.warn(`Could not update settings.json: ${error.message}`);
    }
  }

  // Update context.md if empty or minimal
  if (await exists(paths.contextMd)) {
    // Don't overwrite user's context
    logger.dim(`Skipped: ${PROVIDER_CONFIG.configDirName}/context.md (preserving user content)`);
  }

  // Update project config version
  if (await exists(paths.projectConfig)) {
    try {
      projectConfig.updated = new Date().toISOString();
      await writeFile(paths.projectConfig, JSON.stringify(projectConfig, null, 2), {
        backup: options.backup !== false,
        baseDir
      });
      logger.success('Updated: .hawat/config.json');
    } catch (error) {
      logger.warn(`Could not update config: ${error.message}`);
    }
  }

  console.log();
  logger.success('Project update complete!');
  console.log();
  logger.info('Note: CLAUDE.md and context files were not modified to preserve your customizations.');
  logger.info('To regenerate, run: forge init --force');
}

// Export for testing
export { deepMergeSettings };
