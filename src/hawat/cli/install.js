/**
 * Install Command
 *
 * Installs or repairs global Hawat components to ~/.hawat/
 */

import { Command } from 'commander';
import logger from '../utils/logger.js';
import {
  GLOBAL_HAWAT_DIR,
  GLOBAL_TEMPLATES_DIR,
  GLOBAL_SCRIPTS_DIR,
  GLOBAL_LIB_DIR,
  GLOBAL_SKILLS_DIR,
  CLAUDE_SKILLS_DIR,
  PACKAGE_TEMPLATES_DIR,
  PACKAGE_SCRIPTS_DIR,
  PACKAGE_LIB_CORE_DIR,
  PACKAGE_SKILLS_DIR
} from '../utils/paths.js';
import {
  ensureDir,
  exists,
  syncPackageAssets,
  symlink,
  remove
} from '../lib/file-manager.js';
import { join } from 'path';

/**
 * Create the install command
 * @returns {Command}
 */
export function installCommand() {
  const cmd = new Command('install');

  cmd
    .description("Install or repair global Hawat components")
    .option('-f, --force', 'Force reinstall even if already installed')
    .option('--no-skills', 'Skip skill symlink creation')
    .action(async (options) => {
      try {
        await runInstall(options);
      } catch (error) {
        logger.error(`Installation failed: ${error.message}`);
        logger.debug(error.stack);
        process.exit(1);
      }
    });

  return cmd;
}

/**
 * Run the installation process
 * @param {object} options - Command options
 */
async function runInstall(options) {
  const totalSteps = options.skills !== false ? 4 : 3;
  let currentStep = 0;

  logger.title("Hawat Installation");

  // Step 1: Check existing installation
  currentStep++;
  logger.step(currentStep, totalSteps, 'Checking existing installation...');

  const isInstalled = await exists(GLOBAL_HAWAT_DIR);

  if (isInstalled && !options.force) {
    logger.warn("Hawat is already installed.");
    logger.info('Use --force to reinstall.');
    logger.dim(`Location: ${GLOBAL_HAWAT_DIR}`);
    return;
  }

  if (isInstalled && options.force) {
    logger.info('Removing existing installation...');
    await remove(GLOBAL_HAWAT_DIR);
  }

  // Step 2: Create directory structure
  currentStep++;
  logger.step(currentStep, totalSteps, 'Creating directory structure...');

  const dirs = [
    GLOBAL_HAWAT_DIR,
    GLOBAL_TEMPLATES_DIR,
    GLOBAL_SCRIPTS_DIR,
    GLOBAL_LIB_DIR,
    GLOBAL_SKILLS_DIR
  ];

  for (const dir of dirs) {
    await ensureDir(dir);
    logger.debug(`Created: ${dir}`);
  }

  // Step 3: Copy files from package
  currentStep++;
  logger.step(currentStep, totalSteps, 'Copying files...');

  const syncResult = await syncPackageAssets({
    force: true,
    skills: options.skills !== false
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

  syncResult.synced.forEach(item => logger.debug(`Synced: ${item}`));
  syncResult.skipped.forEach(item => logger.warn(item));
  syncResult.errors.forEach(item => logger.warn(item));

  // Step 4: Create skill symlink (optional)
  if (options.skills !== false) {
    currentStep++;
    logger.step(currentStep, totalSteps, 'Creating skill symlink...');

    await ensureDir(CLAUDE_SKILLS_DIR);

    const skillLink = join(CLAUDE_SKILLS_DIR, 'hawat');
    const skillTarget = join(GLOBAL_SKILLS_DIR, 'hawat');

    if (await exists(skillTarget)) {
      await symlink(skillTarget, skillLink, { force: true });
      logger.debug(`Created symlink: ${skillLink} -> ${skillTarget}`);
    } else {
      logger.warn('Skill source not found, skipping symlink');
    }
  }

  // Success message
  console.log();
  logger.success("Hawat installed successfully!");
  logger.info('Installation complete');
  logger.dim(`Location: ${GLOBAL_HAWAT_DIR}`);
  console.log();
  logger.info('Next steps:');
  logger.list([
    'cd into your project directory',
    'Run: forge init'
  ]);
}
