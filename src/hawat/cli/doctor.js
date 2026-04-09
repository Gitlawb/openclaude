/**
 * Doctor Command
 *
 * Health check for Hawat installation.
 */

import { Command } from 'commander';
import { join } from 'path';
import logger from '../utils/logger.js';
import {
  GLOBAL_HAWAT_DIR,
  GLOBAL_TEMPLATES_DIR,
  GLOBAL_SCRIPTS_DIR,
  GLOBAL_LIB_DIR,
  GLOBAL_SKILLS_DIR,
  CLAUDE_SKILLS_DIR,
  PROVIDER_CONFIG,
  getProjectPaths
} from '../utils/paths.js';
import {
  isScriptExecutable
} from '../lib/validator.js';
import {
  exists,
  isSymlink,
  readSymlink,
  listFiles,
  makeExecutable,
  cleanupBackups
} from '../lib/file-manager.js';

/**
 * Create the doctor command
 * @returns {Command}
 */
export function doctorCommand() {
  const cmd = new Command('doctor');

  cmd
    .description("Check Hawat installation health")
    .option('-v, --verbose', 'Show detailed check results')
    .option('--fix', 'Attempt to fix found issues')
    .option('--cleanup-backups', 'Clean up backup files')
    .option('--dry-run', 'Preview changes without making them')
    .action(async (options) => {
      try {
        await runDoctor(options);
      } catch (error) {
        logger.error(`Health check failed: ${error.message}`);
        logger.debug(error.stack);
        process.exit(1);
      }
    });

  return cmd;
}

/**
 * Run the health check
 * @param {object} options - Command options
 */
async function runDoctor(options) {
  logger.title("Hawat Health Check");

  // Handle --cleanup-backups option
  if (options.cleanupBackups) {
    const backupDir = GLOBAL_HAWAT_DIR;
    logger.info('Cleaning up Backup files...');

    const result = await cleanupBackups(backupDir, {
      dryRun: options.dryRun,
      maxAgeDays: 30
    });

    if (options.dryRun) {
      logger.info('Dry run - no files deleted');
      if (result.deleted.length > 0) {
        logger.info(`Would delete ${result.deleted.length} backup file(s):`);
        result.deleted.forEach(f => logger.dim(`  - ${f}`));
      } else {
        logger.info('No backup files to clean up');
      }
    } else {
      if (result.deleted.length > 0) {
        logger.success(`Deleted ${result.deleted.length} backup file(s)`);
        if (options.verbose) {
          result.deleted.forEach(f => logger.dim(`  - ${f}`));
        }
      } else {
        logger.info('No backup files to clean up');
      }
    }

    if (result.errors.length > 0) {
      result.errors.forEach(e => logger.warn(e));
    }

    return;
  }

  const issues = [];
  const warnings = [];

  // ======================================================================
  // Global Installation Checks
  // ======================================================================

  console.log();
  logger.info('Global Installation:');

  // Check global directory
  const globalExists = await exists(GLOBAL_HAWAT_DIR);
  if (globalExists) {
    logger.success(`  Global directory: ${GLOBAL_HAWAT_DIR}`);
  } else {
    logger.error('  Global directory: Not found');
    issues.push({
      name: 'Global directory missing',
      fix: 'Run: forge install'
    });
  }

  if (globalExists) {
    // Check templates
    const templatesExist = await exists(GLOBAL_TEMPLATES_DIR);
    if (templatesExist) {
      const { files: templates } = await listFiles(GLOBAL_TEMPLATES_DIR, { extensions: ['.hbs'] });
      logger.success(`  Templates: ${templates.length} found`);
      if (options.verbose) {
        templates.forEach(t => logger.dim(`    - ${t.split('/').pop()}`));
      }
    } else {
      logger.error('  Templates: Not found');
      issues.push({
        name: 'Templates missing',
        fix: 'Run: forge install --force'
      });
    }

    // Check scripts
    const scriptsExist = await exists(GLOBAL_SCRIPTS_DIR);
    if (scriptsExist) {
      const { files: scripts } = await listFiles(GLOBAL_SCRIPTS_DIR, { extensions: ['.sh'] });
      logger.success(`  Scripts: ${scripts.length} found`);

      // Check if scripts are executable
      let allExecutable = true;
      for (const script of scripts) {
        const executable = await isScriptExecutable(script);
        if (!executable) {
          allExecutable = false;
          warnings.push({
            name: `Script not executable: ${script.split('/').pop()}`,
            fix: `chmod +x ${script}`,
            autoFix: async () => await makeExecutable(script)
          });
        }
      }

      if (!allExecutable) {
        logger.warn('  Scripts executable: Some scripts need chmod +x');
      } else {
        logger.success('  Scripts executable: All OK');
      }
    } else {
      logger.warn('  Scripts: Not found (hooks will not work)');
      warnings.push({
        name: 'Scripts missing',
        fix: 'Run: forge install --force'
      });
    }

    // Check lib/core
    const libExists = await exists(join(GLOBAL_LIB_DIR, 'README.md'));
    if (libExists) {
      logger.success('  Core library: OK');
    } else {
      logger.warn('  Core library: Not found');
      warnings.push({
        name: 'Core library missing',
        fix: 'Run: forge install --force'
      });
    }

    // Check skills
    const skillsExist = await exists(GLOBAL_SKILLS_DIR);
    if (skillsExist) {
      logger.success('  Skills directory: OK');
    } else {
      logger.warn('  Skills directory: Not found (optional)');
    }

    // Check skill symlink
    const skillLink = join(CLAUDE_SKILLS_DIR, 'hawat');
    if (await exists(skillLink)) {
      if (await isSymlink(skillLink)) {
        const target = await readSymlink(skillLink);
        logger.success(`  Skill symlink: OK -> ${target}`);
      } else {
        logger.warn('  Skill symlink: Exists but is not a symlink');
        warnings.push({
          name: 'Skill path is not a symlink',
          fix: 'Remove and recreate with forge install --force'
        });
      }
    } else {
      logger.dim('  Skill symlink: Not configured (optional)');
    }
  }

  // ======================================================================
  // Project Installation Checks
  // ======================================================================

  const paths = getProjectPaths();
  const hasProject = await exists(paths.claudeMd) || await exists(paths.providerDir);

  if (hasProject) {
    console.log();
    logger.info('Project Installation:');

    // Check CLAUDE.md
    if (await exists(paths.claudeMd)) {
      logger.success('  CLAUDE.md: OK');
    } else {
      logger.warn('  CLAUDE.md: Not found');
      warnings.push({
        name: 'CLAUDE.md missing',
        fix: 'Run: forge init'
      });
    }

    // Check provider directory
    if (await exists(paths.providerDir)) {
      logger.success(`  ${PROVIDER_CONFIG.configDirName} directory: OK`);
    } else {
      logger.error(`  ${PROVIDER_CONFIG.configDirName} directory: Not found`);
      issues.push({
        name: `${PROVIDER_CONFIG.configDirName} directory missing`,
        fix: 'Run: forge init'
      });
    }

    // Check settings.json
    if (await exists(paths.settingsJson)) {
      try {
        const { readJson } = await import('../lib/file-manager.js');
        await readJson(paths.settingsJson);
        logger.success('  settings.json: Valid JSON');
      } catch {
        logger.error('  settings.json: Invalid JSON');
        issues.push({
          name: 'settings.json is Invalid JSON',
          fix: 'Fix JSON syntax or run: forge init --force'
        });
      }
    } else {
      logger.dim('  settings.json: Not found (hooks disabled)');
    }

    // Check context files
    if (await exists(paths.contextMd)) {
      logger.success('  context.md: OK');
    } else {
      logger.dim('  context.md: Not found (optional)');
    }

    // Check .hawat directory
    if (await exists(paths.hawatDir)) {
      logger.success('  .hawat directory: OK');
    } else {
      logger.dim('  .hawat directory: Not found (optional)');
    }

    // Check project config
    if (await exists(paths.projectConfig)) {
      try {
        const { readJson } = await import('../lib/file-manager.js');
        await readJson(paths.projectConfig);
        logger.success('  Project config: Valid JSON');
      } catch {
        logger.warn('  Project config: Invalid JSON');
        warnings.push({
          name: 'Project config is invalid JSON',
          fix: 'Fix JSON syntax or run: forge init --force'
        });
      }
    } else {
      logger.dim('  Project config: Not found (optional)');
    }
  } else {
    console.log();
    logger.dim('No project detected in current directory.');
    logger.dim('Run "forge init" to initialize a project.');
  }

  // ======================================================================
  // Summary
  // ======================================================================

  console.log();
  console.log('-'.repeat(50));
  console.log();

  if (issues.length === 0 && warnings.length === 0) {
    logger.success('All checks passed! Installation is healthy.');
  } else {
    if (issues.length > 0) {
      logger.error(`${issues.length} issue(s) found:`);
      issues.forEach(issue => {
        logger.list([`${issue.name}`]);
        if (options.verbose) {
          logger.dim(`    Fix: ${issue.fix}`);
        }
      });
    }

    if (warnings.length > 0) {
      console.log();
      logger.warn(`${warnings.length} warning(s):`);
      warnings.forEach(warning => {
        logger.list([`${warning.name}`]);
        if (options.verbose) {
          logger.dim(`    Fix: ${warning.fix}`);
        }
      });
    }

    // Auto-fix if requested
    if (options.fix) {
      console.log();
      logger.info('Attempting fixes...');

      for (const warning of warnings) {
        if (warning.autoFix) {
          try {
            await warning.autoFix();
            logger.success(`Fixed: ${warning.name}`);
          } catch (error) {
            logger.error(`Could not fix ${warning.name}: ${error.message}`);
          }
        }
      }

      if (issues.length > 0) {
        console.log();
        logger.info('Some issues require manual intervention:');
        issues.forEach(issue => {
          logger.list([issue.fix]);
        });
      }
    } else if (warnings.some(w => w.autoFix)) {
      console.log();
      logger.info('Run with --fix to automatically fix some issues.');
    }
  }

  // Exit with appropriate code
  process.exit(issues.length > 0 ? 1 : 0);
}
