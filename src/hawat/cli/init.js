/**
 * Init Command
 *
 * Initialize Hawat in the current project directory.
 */

import { Command } from 'commander';
import { basename } from 'path';
import logger from '../utils/logger.js';
import { confirm, projectInit } from '../utils/prompts.js';
import {
  GLOBAL_HAWAT_DIR,
  GLOBAL_SCRIPTS_DIR,
  GLOBAL_SKILLS_DIR,
  PROVIDER_CONFIG,
  getProjectPaths
} from '../utils/paths.js';
import {
  ensureDir,
  exists,
  writeFile,
  syncPackageAssets
} from '../lib/file-manager.js';
import { renderNamedTemplate, getDefaultData, validateJson } from '../lib/template-engine.js';
import { getDefaultProjectConfig } from '../lib/config-merger.js';

/**
 * Create the init command
 * @returns {Command}
 */
export function initCommand() {
  const cmd = new Command('init');

  cmd
    .description("Initialize Hawat in current project")
    .option('-m, --minimal', 'Minimal initialization (CLAUDE.md only)')
    .option('-f, --full', 'Full initialization with all features')
    .option('-y, --yes', 'Accept all defaults (non-interactive)')
    .option('--force', 'Overwrite existing files without confirmation')
    .action(async (options) => {
      try {
        await runInit(options);
      } catch (error) {
        logger.error(`Initialization failed: ${error.message}`);
        logger.debug(error.stack);
        process.exit(1);
      }
    });

  return cmd;
}

/**
 * Run the initialization process
 * @param {object} options - Command options
 */
async function runInit(options) {
  const paths = getProjectPaths();
  const baseDir = paths.root;

  logger.title("Hawat Project Initialization");

  // Check global installation
  if (!await exists(GLOBAL_HAWAT_DIR)) {
    logger.error("Hawat is not installed globally.");
    logger.info("Run: forge install");
    process.exit(1);
  }

  // Check for existing files
  const existingFiles = [];
  if (await exists(paths.claudeMd)) existingFiles.push(PROVIDER_CONFIG.instructionFile);
  if (await exists(paths.providerDir)) existingFiles.push(PROVIDER_CONFIG.configDirName + '/');
  if (await exists(paths.hawatDir)) existingFiles.push('.hawat/');

  if (existingFiles.length > 0 && !options.force) {
    logger.warn("Existing Hawat files detected:");
    logger.list(existingFiles);

    const proceed = await confirm('Overwrite existing files?', false);

    if (!proceed) {
      logger.info('Initialization cancelled.');
      return;
    }
  }

  // Gather configuration
  let config;

  if (options.yes) {
    // Use defaults
    config = {
      projectName: basename(process.cwd()),
      description: '',
      projectType: 'node',
      orchestrationLevel: options.minimal ? 'minimal' : options.full ? 'full' : 'standard',
      codebaseMaturity: 'TRANSITIONAL',
      useHooks: !options.minimal,
      useAgentDelegation: options.full
    };
  } else {
    // Interactive prompts
    config = await projectInit();
    if (options.minimal) {
      config.orchestrationLevel = 'minimal';
      config.useHooks = false;
      config.useAgentDelegation = false;
    }
    if (options.full) {
      config.orchestrationLevel = 'full';
      config.useHooks = true;
      config.useAgentDelegation = true;
    }
  }

  // Add template defaults
  const cfg = PROVIDER_CONFIG;
  const cfgDir = cfg.configDirName;  // e.g. '.forge'
  const templateData = {
    ...getDefaultData(),
    ...config,
    ...getDefaultProjectConfig(config),
    configDirName: PROVIDER_CONFIG.configDirName
  };

  // Determine what to create based on orchestration level
  const isMinimal = config.orchestrationLevel === 'minimal';
  const isFull = config.orchestrationLevel === 'full';

  logger.info('Creating project files...');

  // Only create .forge directory if not minimal mode
  if (!isMinimal) {
    await ensureDir(paths.providerDir);
  }

  // Create CLAUDE.md (always — concise project summary per B-1)
  try {
    const claudeMd = await renderNamedTemplate('CLAUDE.md', templateData);
    await writeFile(paths.claudeMd, claudeMd, { backup: !options.force, baseDir });
    logger.success('Created: CLAUDE.md');
  } catch (error) {
    logger.warn(`Could not create CLAUDE.md: ${error.message}`);
    // Create a basic CLAUDE.md if template fails
    const basicClaudeMd = createBasicClaudeMd(config);
    await writeFile(paths.claudeMd, basicClaudeMd, { backup: !options.force, baseDir });
    logger.success('Created: CLAUDE.md (basic)');
  }

  if (!isMinimal) {
    // Create .hawat directory
    await ensureDir(paths.hawatDir);
    await ensureDir(paths.stateDir);

    // Create .forge/orchestration.md (B-1: bulk orchestration rules go here)
    try {
      const orchestrationMd = await renderNamedTemplate('orchestration.md', templateData);
      const orchestrationPath = `${paths.providerDir}/orchestration.md`;
      await writeFile(orchestrationPath, orchestrationMd, { backup: !options.force, baseDir });
      logger.success(`Created: ${cfgDir}/orchestration.md`);
    } catch (error) {
      logger.warn(`Could not create orchestration.md: ${error.message}`);
      const basicOrchestration = createBasicOrchestration(config);
      const orchestrationPath = `${paths.providerDir}/orchestration.md`;
      await writeFile(orchestrationPath, basicOrchestration, { backup: !options.force, baseDir });
      logger.success(`Created: ${cfgDir}/orchestration.md (basic)`);
    }

    // Create settings.json
    try {
      const settings = await renderNamedTemplate('settings.json', templateData);
      const validation = validateJson(settings);
      if (!validation.valid) {
        throw new Error(`settings.json template rendered invalid JSON: ${validation.error}`);
      }
      await writeFile(paths.settingsJson, settings, { backup: !options.force, baseDir });
      logger.success(`Created: ${cfgDir}/settings.json`);
    } catch (error) {
      logger.warn(`Could not create settings.json: ${error.message}`);
      const basicSettings = createBasicSettings(config);
      await writeFile(paths.settingsJson, JSON.stringify(basicSettings, null, 2), { backup: !options.force, baseDir });
      logger.success(`Created: ${cfgDir}/settings.json (basic)`);
    }

    // Create context.md
    try {
      const context = await renderNamedTemplate('context.md', templateData);
      await writeFile(paths.contextMd, context, { backup: !options.force, baseDir });
      logger.success(`Created: ${cfgDir}/context.md`);
    } catch (error) {
      logger.warn(`Could not create context.md: ${error.message}`);
      const basicContext = createBasicContext(config);
      await writeFile(paths.contextMd, basicContext, { backup: !options.force, baseDir });
      logger.success(`Created: ${cfgDir}/context.md (basic)`);
    }

    // Create critical-context.md
    try {
      const criticalContext = await renderNamedTemplate('critical-context.md', templateData);
      await writeFile(paths.criticalContextMd, criticalContext, { backup: !options.force, baseDir });
      logger.success(`Created: ${cfgDir}/critical-context.md`);
    } catch (error) {
      const basicCritical = createBasicCriticalContext();
      await writeFile(paths.criticalContextMd, basicCritical, { backup: !options.force, baseDir });
      logger.success(`Created: ${cfgDir}/critical-context.md (basic)`);
    }

    // Create project config
    try {
      const projectConfig = await renderNamedTemplate('config.json', templateData);
      await writeFile(paths.projectConfig, projectConfig, { backup: !options.force, baseDir });
      logger.success('Created: .hawat/config.json');
    } catch (error) {
      const basicConfig = getDefaultProjectConfig(config);
      await writeFile(paths.projectConfig, JSON.stringify(basicConfig, null, 2), { backup: !options.force, baseDir });
      logger.success('Created: .hawat/config.json (basic)');
    }
  }

  // Copy scripts/skills from global install into the project
  if (config.useHooks || isFull) {
    const projectScriptsDir = `${paths.providerDir}/scripts`;
    const projectSkillsDir = `${paths.providerDir}/skills`;

    const syncResult = await syncPackageAssets({
      templates: false,
      lib: false,
      scripts: config.useHooks,
      skills: isFull,
      force: true
    }, {
      PACKAGE_TEMPLATES_DIR: null,
      GLOBAL_TEMPLATES_DIR: null,
      PACKAGE_SCRIPTS_DIR: GLOBAL_SCRIPTS_DIR,
      GLOBAL_SCRIPTS_DIR: projectScriptsDir,
      PACKAGE_LIB_CORE_DIR: null,
      GLOBAL_LIB_DIR: null,
      PACKAGE_SKILLS_DIR: GLOBAL_SKILLS_DIR,
      GLOBAL_SKILLS_DIR: projectSkillsDir
    });

    if (syncResult.synced.some(item => item.startsWith('scripts:'))) {
      logger.success(`Copied: ${cfgDir}/scripts/`);
    }
    if (syncResult.synced.some(item => item.startsWith('skills:'))) {
      logger.success(`Copied: ${cfgDir}/skills/`);
    }

    syncResult.skipped.forEach(item => logger.warn(item));
    syncResult.errors.forEach(item => logger.warn(item));
  }

  // Success message
  console.log();
  logger.success("Hawat initialized successfully!");
  console.log();
  logger.info('Files created:');
  logger.list([
    cfg.instructionFile,
    ...(isMinimal ? [] : [
      `${cfgDir}/orchestration.md`,
      `${cfgDir}/settings.json`,
      `${cfgDir}/context.md`,
      `${cfgDir}/critical-context.md`,
      '.hawat/config.json'
    ]),
    ...(config.useHooks ? [`${cfgDir}/scripts/`] : []),
    ...(isFull ? [`${cfgDir}/skills/hawat/`] : [])
  ]);
  console.log();
  logger.info("You're all set! Forge will now use Hawat orchestration.");
}

/**
 * Create basic CLAUDE.md content (concise per B-1)
 * @param {object} config - Project config
 * @returns {string}
 */
function createBasicClaudeMd(config) {
  return `# ${config.projectName}

## Project Overview

**Project**: ${config.projectName}
**Type**: ${config.projectType}
**Description**: ${config.description || 'A project using Hawat orchestration'}

## Quick Reference

- Full orchestration rules: \`.forge/orchestration.md\`
- Settings: \`.forge/settings.json\`
- Project config: \`.hawat/config.json\`

## Quality Standards

- Write clean, maintainable code
- Follow existing project patterns
- Test changes before committing
- Document significant decisions

---

*Generated by Hawat - OmO-style orchestration for Atreides Forge*
*Initialized: ${new Date().toISOString().split('T')[0]}*
`;
}

/**
 * Create basic orchestration.md content (B-1: bulk rules here)
 * @param {object} config - Project config
 * @returns {string}
 */
function createBasicOrchestration(config) {
  return `# Orchestration Rules

## Task Management

1. **Use TodoWrite for any task with 3+ steps**
2. **Mark todos complete only when fully verified**
3. **Never stop with incomplete todos**
4. **Break complex work into atomic tasks**

## 3-Strikes Error Recovery

After **3 consecutive failures** on same operation:

1. **STOP** - Halt modifications
2. **REVERT** - \`git checkout\` to working state
3. **DOCUMENT** - Record failure details
4. **ASK** - Request user guidance

## Code Quality

- Write clean, maintainable code
- Follow existing project patterns
- Test changes before committing
- Document significant decisions

---

*Generated by Hawat - OmO-style orchestration for Atreides Forge*
*Initialized: ${new Date().toISOString().split('T')[0]}*
`;
}

/**
 * Create basic settings.json content
 * @param {object} config - Project config
 * @returns {object}
 */
function createBasicSettings(_config) {
  return {
    hooks: {},
    permissions: {
      allow: [],
      deny: []
    }
  };
}

/**
 * Create basic context.md content
 * @param {object} config - Project config
 * @returns {string}
 */
function createBasicContext(config) {
  return `# Project Context

## Overview

**Project**: ${config.projectName}
**Type**: ${config.projectType}

## Key Information

Add project-specific context here that Claude should know about.

## Important Patterns

Document any important patterns or conventions used in this project.

---

*Updated: ${new Date().toISOString().split('T')[0]}*
`;
}

/**
 * Create basic critical-context.md content
 * @returns {string}
 */
function createBasicCriticalContext() {
  return `# Critical Context

This file contains information that must survive context compaction.

## Must Remember

- Add critical information here
- This content persists through long sessions

---

*Updated: ${new Date().toISOString().split('T')[0]}*
`;
}
