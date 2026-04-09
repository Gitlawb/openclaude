/**
 * Uninstall Command
 *
 * Removes Hawat global components and optionally project files.
 */

import { Command } from 'commander';
import { join } from 'path';
import logger from '../utils/logger.js';
import { confirm } from '../utils/prompts.js';
import {
  GLOBAL_HAWAT_DIR,
  CLAUDE_SKILLS_DIR,
  PROVIDER_CONFIG,
  getProjectPaths
} from '../utils/paths.js';
import {
  exists,
  remove
} from '../lib/file-manager.js';

/**
 * Create the uninstall command
 * @returns {Command}
 */
export function uninstallCommand() {
  const cmd = new Command('uninstall');

  cmd
    .description("Uninstall Hawat components")
    .option('-g, --global', 'Uninstall global components (default)')
    .option('-p, --project', `Also remove project files (${PROVIDER_CONFIG.configDirName}/, .hawat/)`)
    .option('-f, --force', 'Skip confirmation prompts')
    .action(async (options) => {
      try {
        await runUninstall(options);
      } catch (error) {
        logger.error(`Uninstall failed: ${error.message}`);
        logger.debug(error.stack);
        process.exit(1);
      }
    });

  return cmd;
}

/**
 * Run the uninstall process
 * @param {object} options - Command options
 */
async function runUninstall(options) {
  logger.title("Hawat Uninstall");

  const hasGlobal = await exists(GLOBAL_HAWAT_DIR);
  const skillLink = join(CLAUDE_SKILLS_DIR, 'hawat');
  const hasSkillLink = await exists(skillLink);
  const paths = getProjectPaths();
  const hasProject = await exists(paths.providerDir) || await exists(paths.hawatDir);

  if (!hasGlobal && !hasSkillLink && (!options.project || !hasProject)) {
    logger.info("Hawat is not installed.");
    return;
  }

  // Show what will be removed
  console.log();
  logger.info('The following will be removed:');
  console.log();

  if (hasGlobal) {
    logger.dim(`  - ${GLOBAL_HAWAT_DIR}/ (global components)`);
  }
  if (hasSkillLink) {
    logger.dim(`  - ${skillLink} (skill symlink)`);
  }
  if (options.project && hasProject) {
    if (await exists(paths.providerDir)) {
      logger.dim(`  - ${paths.providerDir}/ (project settings)`);
    }
    if (await exists(paths.hawatDir)) {
      logger.dim(`  - ${paths.hawatDir}/ (project config)`);
    }
  }

  console.log();

  // Confirm unless --force
  if (!options.force) {
    const proceed = await confirm(
      'Are you sure you want to uninstall?',
      false
    );

    if (!proceed) {
      logger.info('Uninstall cancelled.');
      return;
    }
  }

  console.log();
  logger.info('Uninstalling...');

  // Remove skill symlink first
  if (hasSkillLink) {
    try {
      await remove(skillLink);
      logger.success('Removed: skill symlink');
    } catch (error) {
      logger.warn(`Could not remove skill symlink: ${error.message}`);
    }
  }

  // Remove global directory
  if (hasGlobal) {
    try {
      await remove(GLOBAL_HAWAT_DIR);
      logger.success('Removed: global components');
    } catch (error) {
      logger.warn(`Could not remove global directory: ${error.message}`);
    }
  }

  // Remove project files if requested
  if (options.project && hasProject) {
    if (await exists(paths.providerDir)) {
      try {
        await remove(paths.providerDir);
        logger.success(`Removed: ${PROVIDER_CONFIG.configDirName}/`);
      } catch (error) {
        logger.warn(`Could not remove ${PROVIDER_CONFIG.configDirName}/: ${error.message}`);
      }
    }

    if (await exists(paths.hawatDir)) {
      try {
        await remove(paths.hawatDir);
        logger.success('Removed: .hawat/');
      } catch (error) {
        logger.warn(`Could not remove .hawat/: ${error.message}`);
      }
    }
  }

  console.log();
  logger.success('Uninstall complete!');

  if (!options.project && hasProject) {
    console.log();
    logger.info('Note: Project files were preserved.');
    logger.info('To remove project files, run: forge uninstall --project');
  }
}

export default uninstallCommand;
