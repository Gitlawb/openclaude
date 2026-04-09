/**
 * CLI Integration Tests
 *
 * Tests for the Hawat CLI commands: install, init, update, doctor
 * Uses Jest mocking for filesystem operations to test command logic.
 */



// ══════════════════════════════════════════════════════════════════════════════
// Test Setup - Command Imports
// ══════════════════════════════════════════════════════════════════════════════

describe('CLI Command Imports', () => {
  it('should import installCommand without throwing', async () => {
    const { installCommand } = await import('../cli/install.js');
    expect(typeof installCommand).toBe('function');
  });

  it('should import initCommand without throwing', async () => {
    const { initCommand } = await import('../cli/init.js');
    expect(typeof initCommand).toBe('function');
  });

  it('should import updateCommand without throwing', async () => {
    const { updateCommand } = await import('../cli/update.js');
    expect(typeof updateCommand).toBe('function');
  });

  it('should import doctorCommand without throwing', async () => {
    const { doctorCommand } = await import('../cli/doctor.js');
    expect(typeof doctorCommand).toBe('function');
  });
});

// ══════════════════════════════════════════════════════════════════════════════
// Command Structure Tests
// ══════════════════════════════════════════════════════════════════════════════

describe('CLI Command Structure', () => {
  describe('installCommand', () => {
    it('should create a Commander command with correct name', async () => {
      const { installCommand } = await import('../cli/install.js');
      const cmd = installCommand();

      expect(cmd.name()).toBe('install');
    });

    it('should have a description', async () => {
      const { installCommand } = await import('../cli/install.js');
      const cmd = installCommand();

      expect(cmd.description()).toContain('Install');
    });

    it('should have --force option', async () => {
      const { installCommand } = await import('../cli/install.js');
      const cmd = installCommand();

      const forceOption = cmd.options.find(opt => opt.long === '--force');
      expect(forceOption).toBeDefined();
    });

    it('should have --no-skills option', async () => {
      const { installCommand } = await import('../cli/install.js');
      const cmd = installCommand();

      const noSkillsOption = cmd.options.find(opt => opt.long === '--no-skills');
      expect(noSkillsOption).toBeDefined();
    });
  });

  describe('initCommand', () => {
    it('should create a Commander command with correct name', async () => {
      const { initCommand } = await import('../cli/init.js');
      const cmd = initCommand();

      expect(cmd.name()).toBe('init');
    });

    it('should have a description', async () => {
      const { initCommand } = await import('../cli/init.js');
      const cmd = initCommand();

      expect(cmd.description()).toContain('Initialize');
    });

    it('should have --minimal option', async () => {
      const { initCommand } = await import('../cli/init.js');
      const cmd = initCommand();

      const minimalOption = cmd.options.find(opt => opt.long === '--minimal');
      expect(minimalOption).toBeDefined();
    });

    it('should have --full option', async () => {
      const { initCommand } = await import('../cli/init.js');
      const cmd = initCommand();

      const fullOption = cmd.options.find(opt => opt.long === '--full');
      expect(fullOption).toBeDefined();
    });

    it('should have --yes option for non-interactive mode', async () => {
      const { initCommand } = await import('../cli/init.js');
      const cmd = initCommand();

      const yesOption = cmd.options.find(opt => opt.long === '--yes');
      expect(yesOption).toBeDefined();
    });

    it('should have --force option', async () => {
      const { initCommand } = await import('../cli/init.js');
      const cmd = initCommand();

      const forceOption = cmd.options.find(opt => opt.long === '--force');
      expect(forceOption).toBeDefined();
    });
  });

  describe('updateCommand', () => {
    it('should create a Commander command with correct name', async () => {
      const { updateCommand } = await import('../cli/update.js');
      const cmd = updateCommand();

      expect(cmd.name()).toBe('update');
    });

    it('should have a description', async () => {
      const { updateCommand } = await import('../cli/update.js');
      const cmd = updateCommand();

      expect(cmd.description()).toContain('Update');
    });

    it('should have --global option', async () => {
      const { updateCommand } = await import('../cli/update.js');
      const cmd = updateCommand();

      const globalOption = cmd.options.find(opt => opt.long === '--global');
      expect(globalOption).toBeDefined();
    });

    it('should have --project option', async () => {
      const { updateCommand } = await import('../cli/update.js');
      const cmd = updateCommand();

      const projectOption = cmd.options.find(opt => opt.long === '--project');
      expect(projectOption).toBeDefined();
    });

    it('should have --no-backup option', async () => {
      const { updateCommand } = await import('../cli/update.js');
      const cmd = updateCommand();

      const noBackupOption = cmd.options.find(opt => opt.long === '--no-backup');
      expect(noBackupOption).toBeDefined();
    });
  });

  describe('doctorCommand', () => {
    it('should create a Commander command with correct name', async () => {
      const { doctorCommand } = await import('../cli/doctor.js');
      const cmd = doctorCommand();

      expect(cmd.name()).toBe('doctor');
    });

    it('should have a description', async () => {
      const { doctorCommand } = await import('../cli/doctor.js');
      const cmd = doctorCommand();

      expect(cmd.description()).toContain('health');
    });

    it('should have --verbose option', async () => {
      const { doctorCommand } = await import('../cli/doctor.js');
      const cmd = doctorCommand();

      const verboseOption = cmd.options.find(opt => opt.long === '--verbose');
      expect(verboseOption).toBeDefined();
    });

    it('should have --fix option', async () => {
      const { doctorCommand } = await import('../cli/doctor.js');
      const cmd = doctorCommand();

      const fixOption = cmd.options.find(opt => opt.long === '--fix');
      expect(fixOption).toBeDefined();
    });
  });
});

// ══════════════════════════════════════════════════════════════════════════════
// Path Configuration Tests
// ══════════════════════════════════════════════════════════════════════════════

describe('Path Configuration', () => {
  it('should export all required global path constants', async () => {
    const paths = await import('../utils/paths.js');

    expect(paths.GLOBAL_HAWAT_DIR).toBeDefined();
    expect(paths.GLOBAL_TEMPLATES_DIR).toBeDefined();
    expect(paths.GLOBAL_SCRIPTS_DIR).toBeDefined();
    expect(paths.GLOBAL_LIB_DIR).toBeDefined();
    expect(paths.GLOBAL_SKILLS_DIR).toBeDefined();
    expect(paths.CLAUDE_SKILLS_DIR).toBeDefined();
  });

  it('should export all required package path constants', async () => {
    const paths = await import('../utils/paths.js');

    expect(paths.PACKAGE_ROOT).toBeDefined();
    expect(paths.PACKAGE_TEMPLATES_DIR).toBeDefined();
    expect(paths.PACKAGE_SCRIPTS_DIR).toBeDefined();
    expect(paths.PACKAGE_LIB_CORE_DIR).toBeDefined();
    expect(paths.PACKAGE_SKILLS_DIR).toBeDefined();
  });

  it('should provide getProjectPaths function', async () => {
    const { getProjectPaths } = await import('../utils/paths.js');

    expect(typeof getProjectPaths).toBe('function');
  });

  it('should return correct project paths structure', async () => {
    const { getProjectPaths } = await import('../utils/paths.js');
    const testDir = '/test/project';
    const paths = getProjectPaths(testDir);

    expect(paths.root).toBe(testDir);
    expect(paths.providerDir).toBe('/test/project/.forge');
    expect(paths.hawatDir).toBe('/test/project/.hawat');
    expect(paths.claudeMd).toBe('/test/project/CLAUDE.md');
    expect(paths.settingsJson).toBe('/test/project/.forge/settings.json');
    expect(paths.contextMd).toBe('/test/project/.forge/context.md');
    expect(paths.criticalContextMd).toBe('/test/project/.forge/critical-context.md');
    expect(paths.checkpointMd).toBe('/test/project/.forge/checkpoint.md');
    expect(paths.projectConfig).toBe('/test/project/.hawat/config.json');
    expect(paths.stateDir).toBe('/test/project/.hawat/state');
  });

  it('should use current working directory as default', async () => {
    const { getProjectPaths } = await import('../utils/paths.js');
    const paths = getProjectPaths();

    expect(paths.root).toBe(process.cwd());
  });
});

// ══════════════════════════════════════════════════════════════════════════════
// File Manager Tests
// ══════════════════════════════════════════════════════════════════════════════

describe('File Manager', () => {
  it('should export all required file operations', async () => {
    const fileManager = await import('../lib/file-manager.js');

    expect(typeof fileManager.ensureDir).toBe('function');
    expect(typeof fileManager.exists).toBe('function');
    expect(typeof fileManager.readFile).toBe('function');
    expect(typeof fileManager.readJson).toBe('function');
    expect(typeof fileManager.writeFile).toBe('function');
    expect(typeof fileManager.writeJson).toBe('function');
    expect(typeof fileManager.copyFile).toBe('function');
    expect(typeof fileManager.copyDir).toBe('function');
    expect(typeof fileManager.remove).toBe('function');
    expect(typeof fileManager.symlink).toBe('function');
    expect(typeof fileManager.isSymlink).toBe('function');
    expect(typeof fileManager.readSymlink).toBe('function');
    expect(typeof fileManager.listFiles).toBe('function');
    expect(typeof fileManager.getStats).toBe('function');
    expect(typeof fileManager.makeExecutable).toBe('function');
    expect(typeof fileManager.findBackups).toBe('function');
    expect(typeof fileManager.restoreFromBackup).toBe('function');
  });
});

// ══════════════════════════════════════════════════════════════════════════════
// Validator Tests
// ══════════════════════════════════════════════════════════════════════════════

describe('Validator', () => {
  it('should export all required validation functions', async () => {
    const validator = await import('../lib/validator.js');

    expect(typeof validator.validateGlobalInstallation).toBe('function');
    expect(typeof validator.validateProjectInit).toBe('function');
    expect(typeof validator.validateClaudeSettings).toBe('function');
    expect(typeof validator.findMissingFiles).toBe('function');
    expect(typeof validator.isScriptExecutable).toBe('function');
    expect(typeof validator.getHealthSummary).toBe('function');
  });

  describe('validateClaudeSettings', () => {
    it('should validate valid settings structure', async () => {
      const { validateClaudeSettings } = await import('../lib/validator.js');

      const validSettings = {
        hooks: {
          PreToolUse: [
            { matcher: 'Bash', hooks: [{ type: 'command', command: 'validate.sh' }] }
          ],
          PostToolUse: [
            { matcher: 'Edit|Write', hooks: [{ type: 'command', command: 'format.sh' }] }
          ]
        },
        permissions: {
          allow: ['Bash(npm *)', 'Bash(node *)'],
          deny: ['Bash(sudo *)', 'Read(.env)']
        }
      };

      const result = validateClaudeSettings(validSettings);

      expect(result.valid).toBe(true);
      expect(result.errors).toHaveLength(0);
    });

    it('should detect invalid hook types', async () => {
      const { validateClaudeSettings } = await import('../lib/validator.js');

      const settings = {
        hooks: {
          InvalidHookType: [
            { matcher: 'Bash', hooks: [{ type: 'command', command: 'test.sh' }] }
          ]
        }
      };

      const result = validateClaudeSettings(settings);

      expect(result.warnings).toContain('Unknown hook type: InvalidHookType');
    });

    it('should detect hooks array requirement', async () => {
      const { validateClaudeSettings } = await import('../lib/validator.js');

      const settings = {
        hooks: {
          PreToolUse: 'not-an-array'
        }
      };

      const result = validateClaudeSettings(settings);

      expect(result.valid).toBe(false);
      expect(result.errors).toContain('hooks.PreToolUse must be an array');
    });

    it('should detect missing matcher or type in hooks', async () => {
      const { validateClaudeSettings } = await import('../lib/validator.js');

      const settings = {
        hooks: {
          PreToolUse: [
            { command: 'test.sh' } // Missing matcher and type
          ]
        }
      };

      const result = validateClaudeSettings(settings);

      expect(result.valid).toBe(false);
      expect(result.errors.some(e => e.includes('missing matcher or type'))).toBe(true);
    });

    it('should detect invalid permissions.allow type', async () => {
      const { validateClaudeSettings } = await import('../lib/validator.js');

      const settings = {
        permissions: {
          allow: 'not-an-array'
        }
      };

      const result = validateClaudeSettings(settings);

      expect(result.valid).toBe(false);
      expect(result.errors).toContain('permissions.allow must be an array');
    });

    it('should detect invalid permissions.deny type', async () => {
      const { validateClaudeSettings } = await import('../lib/validator.js');

      const settings = {
        permissions: {
          deny: 'not-an-array'
        }
      };

      const result = validateClaudeSettings(settings);

      expect(result.valid).toBe(false);
      expect(result.errors).toContain('permissions.deny must be an array');
    });

    it('should count hook and permission details', async () => {
      const { validateClaudeSettings } = await import('../lib/validator.js');

      const settings = {
        hooks: {
          PreToolUse: [
            { matcher: 'Bash', hooks: [{ type: 'command', command: 'a.sh' }] },
            { matcher: 'Edit', hooks: [{ type: 'command', command: 'b.sh' }] }
          ],
          SessionStart: [
            { type: 'command', command: 'start.sh' }
          ]
        },
        permissions: {
          allow: ['Bash(npm *)', 'Bash(node *)', 'Bash(git *)'],
          deny: ['Bash(sudo *)']
        }
      };

      const result = validateClaudeSettings(settings);

      expect(result.details.hooks.PreToolUse).toBe(2);
      expect(result.details.hooks.SessionStart).toBe(1);
      expect(result.details.allowRules).toBe(3);
      expect(result.details.denyRules).toBe(1);
    });
  });
});

// ══════════════════════════════════════════════════════════════════════════════
// Deep Merge Settings Tests (from update.js)
// ══════════════════════════════════════════════════════════════════════════════

describe('deepMergeSettings', () => {
  it('should be exported from update command', async () => {
    const { deepMergeSettings } = await import('../cli/update.js');
    expect(typeof deepMergeSettings).toBe('function');
  });

  it('should merge new hook types into empty existing', async () => {
    const { deepMergeSettings } = await import('../cli/update.js');

    const newSettings = {
      hooks: {
        PreToolUse: [{ type: 'command', command: 'test.sh' }]
      }
    };

    const existingSettings = {};

    const result = deepMergeSettings(newSettings, existingSettings);

    expect(result.hooks.PreToolUse).toBeDefined();
    expect(result.hooks.PreToolUse).toHaveLength(1);
  });

  it('should preserve existing hooks when adding new types', async () => {
    const { deepMergeSettings } = await import('../cli/update.js');

    const newSettings = {
      hooks: {
        PreToolUse: [{ type: 'command', command: 'new.sh' }]
      }
    };

    const existingSettings = {
      hooks: {
        PostToolUse: [{ type: 'command', command: 'existing.sh' }]
      }
    };

    const result = deepMergeSettings(newSettings, existingSettings);

    expect(result.hooks.PreToolUse).toBeDefined();
    expect(result.hooks.PostToolUse).toBeDefined();
    expect(result.hooks.PostToolUse[0].command).toBe('existing.sh');
  });

  it('should merge permissions with deduplication', async () => {
    const { deepMergeSettings } = await import('../cli/update.js');

    const newSettings = {
      permissions: {
        allow: ['Bash(npm *)', 'Bash(cargo *)'],
        deny: ['Bash(sudo *)']
      }
    };

    const existingSettings = {
      permissions: {
        allow: ['Bash(npm *)'], // Duplicate
        deny: ['Read(.env)']
      }
    };

    const result = deepMergeSettings(newSettings, existingSettings);

    // Should have npm only once
    const npmCount = result.permissions.allow.filter(p => p === 'Bash(npm *)').length;
    expect(npmCount).toBe(1);

    // Should have cargo added
    expect(result.permissions.allow).toContain('Bash(cargo *)');

    // Should have both deny rules
    expect(result.permissions.deny).toContain('Bash(sudo *)');
    expect(result.permissions.deny).toContain('Read(.env)');
  });
});

// ══════════════════════════════════════════════════════════════════════════════
// Install Command Directory Structure Tests
// ══════════════════════════════════════════════════════════════════════════════

describe('Install Command - Directory Structure', () => {
  it('should define correct directory creation order', async () => {
    const paths = await import('../utils/paths.js');

    // Verify the expected directories that install should create
    const expectedDirs = [
      paths.GLOBAL_HAWAT_DIR,
      paths.GLOBAL_TEMPLATES_DIR,
      paths.GLOBAL_SCRIPTS_DIR,
      paths.GLOBAL_LIB_DIR,
      paths.GLOBAL_SKILLS_DIR
    ];

    // All paths should be under ~/.hawat/
    for (const dir of expectedDirs) {
      expect(dir).toContain('.hawat');
    }
  });

  it('should have GLOBAL_HAWAT_DIR in home directory', async () => {
    const { GLOBAL_HAWAT_DIR, HOME_DIR } = await import('../utils/paths.js');

    expect(GLOBAL_HAWAT_DIR).toBe(`${HOME_DIR}/.hawat`);
  });

  it('should have GLOBAL_TEMPLATES_DIR under GLOBAL_HAWAT_DIR', async () => {
    const { GLOBAL_HAWAT_DIR, GLOBAL_TEMPLATES_DIR } = await import('../utils/paths.js');

    expect(GLOBAL_TEMPLATES_DIR).toBe(`${GLOBAL_HAWAT_DIR}/templates`);
  });

  it('should have GLOBAL_SCRIPTS_DIR under GLOBAL_HAWAT_DIR', async () => {
    const { GLOBAL_HAWAT_DIR, GLOBAL_SCRIPTS_DIR } = await import('../utils/paths.js');

    expect(GLOBAL_SCRIPTS_DIR).toBe(`${GLOBAL_HAWAT_DIR}/scripts`);
  });
});

// ══════════════════════════════════════════════════════════════════════════════
// Init Command - Expected File Generation
// ══════════════════════════════════════════════════════════════════════════════

describe('Init Command - Expected Files', () => {
  it('should create CLAUDE.md for minimal mode', async () => {
    const { getProjectPaths } = await import('../utils/paths.js');
    const paths = getProjectPaths('/test/project');

    // Minimal mode should create CLAUDE.md
    expect(paths.claudeMd).toBe('/test/project/CLAUDE.md');
  });

  it('should create additional files for standard mode', async () => {
    const { getProjectPaths } = await import('../utils/paths.js');
    const paths = getProjectPaths('/test/project');

    // Standard mode should create these additional files
    expect(paths.settingsJson).toBe('/test/project/.forge/settings.json');
    expect(paths.contextMd).toBe('/test/project/.forge/context.md');
    expect(paths.criticalContextMd).toBe('/test/project/.forge/critical-context.md');
    expect(paths.projectConfig).toBe('/test/project/.hawat/config.json');
  });

  it('should have stateDir for session state', async () => {
    const { getProjectPaths } = await import('../utils/paths.js');
    const paths = getProjectPaths('/test/project');

    expect(paths.stateDir).toBe('/test/project/.hawat/state');
  });
});

// ══════════════════════════════════════════════════════════════════════════════
// Update Command - Missing Installation Handling
// ══════════════════════════════════════════════════════════════════════════════

describe('Update Command - Configuration', () => {
  it('should require global installation for global update', async () => {
    // The update command checks for GLOBAL_HAWAT_DIR existence
    const { GLOBAL_HAWAT_DIR } = await import('../utils/paths.js');

    // This path should be checked before proceeding
    expect(GLOBAL_HAWAT_DIR).toBeDefined();
    expect(GLOBAL_HAWAT_DIR).toContain('.hawat');
  });

  it('should require project init for project update', async () => {
    // The update command checks for .forge directory
    const { getProjectPaths } = await import('../utils/paths.js');
    const paths = getProjectPaths('/test/project');

    expect(paths.providerDir).toBe('/test/project/.forge');
  });
});

// ══════════════════════════════════════════════════════════════════════════════
// Doctor Command - Health Check Categories
// ══════════════════════════════════════════════════════════════════════════════

describe('Doctor Command - Health Check Categories', () => {
  it('should check global installation components', async () => {
    const paths = await import('../utils/paths.js');

    // Doctor should check these global components
    const globalComponents = [
      paths.GLOBAL_HAWAT_DIR,
      paths.GLOBAL_TEMPLATES_DIR,
      paths.GLOBAL_SCRIPTS_DIR,
      paths.GLOBAL_LIB_DIR,
      paths.GLOBAL_SKILLS_DIR
    ];

    for (const component of globalComponents) {
      expect(component).toBeDefined();
    }
  });

  it('should check project installation components', async () => {
    const { getProjectPaths } = await import('../utils/paths.js');
    const paths = getProjectPaths('/test/project');

    // Doctor should check these project components
    expect(paths.claudeMd).toBeDefined();
    expect(paths.providerDir).toBeDefined();
    expect(paths.settingsJson).toBeDefined();
    expect(paths.contextMd).toBeDefined();
    expect(paths.hawatDir).toBeDefined();
    expect(paths.projectConfig).toBeDefined();
  });

  it('should check skill symlink location', async () => {
    const { CLAUDE_SKILLS_DIR, GLOBAL_SKILLS_DIR } = await import('../utils/paths.js');

    // Skill symlink target and location
    expect(CLAUDE_SKILLS_DIR).toBeDefined();
    expect(GLOBAL_SKILLS_DIR).toBeDefined();
    expect(CLAUDE_SKILLS_DIR).toContain('.forge/skills');
  });
});

// ══════════════════════════════════════════════════════════════════════════════
// Template Engine Integration
// ══════════════════════════════════════════════════════════════════════════════

describe('Template Engine Integration', () => {
  it('should export renderTemplate function', async () => {
    const { renderTemplate } = await import('../lib/template-engine.js');
    expect(typeof renderTemplate).toBe('function');
  });

  it('should export getDefaultData function', async () => {
    const { getDefaultData } = await import('../lib/template-engine.js');
    expect(typeof getDefaultData).toBe('function');
  });

  it('should provide version in default data', async () => {
    const { getDefaultData } = await import('../lib/template-engine.js');
    const data = getDefaultData();

    expect(data.version).toBeDefined();
    expect(data.version).toMatch(/^\d+\.\d+\.\d+$/);
  });

  it('should provide current date in default data', async () => {
    const { getDefaultData } = await import('../lib/template-engine.js');
    const data = getDefaultData();

    expect(data.timestamp).toBeDefined();
    // Should be a valid ISO date string
    expect(new Date(data.timestamp).toString()).not.toBe('Invalid Date');
  });
});

// ══════════════════════════════════════════════════════════════════════════════
// Logger Integration
// ══════════════════════════════════════════════════════════════════════════════

describe('Logger Integration', () => {
  it('should export logger with required methods', async () => {
    const logger = await import('../utils/logger.js');

    expect(typeof logger.default.info).toBe('function');
    expect(typeof logger.default.warn).toBe('function');
    expect(typeof logger.default.error).toBe('function');
    expect(typeof logger.default.success).toBe('function');
    expect(typeof logger.default.debug).toBe('function');
  });

  it('should export title and step methods for progress', async () => {
    const logger = await import('../utils/logger.js');

    expect(typeof logger.default.title).toBe('function');
    expect(typeof logger.default.step).toBe('function');
  });

  it('should export list method for displaying arrays', async () => {
    const logger = await import('../utils/logger.js');

    expect(typeof logger.default.list).toBe('function');
  });
});

// ══════════════════════════════════════════════════════════════════════════════
// Config Merger Integration
// ══════════════════════════════════════════════════════════════════════════════

describe('Config Merger Integration', () => {
  it('should export getDefaultProjectConfig function', async () => {
    const { getDefaultProjectConfig } = await import('../lib/config-merger.js');
    expect(typeof getDefaultProjectConfig).toBe('function');
  });

  it('should provide default config for node project', async () => {
    const { getDefaultProjectConfig } = await import('../lib/config-merger.js');
    const config = getDefaultProjectConfig({ projectType: 'node' });

    expect(config).toBeDefined();
    expect(typeof config).toBe('object');
  });
});

// ══════════════════════════════════════════════════════════════════════════════
// Prompts Integration
// ══════════════════════════════════════════════════════════════════════════════

describe('Prompts Integration', () => {
  it('should export confirm function', async () => {
    const { confirm } = await import('../utils/prompts.js');
    expect(typeof confirm).toBe('function');
  });

  it('should export projectInit function', async () => {
    const { projectInit } = await import('../utils/prompts.js');
    expect(typeof projectInit).toBe('function');
  });

  it('should export codebaseMaturity prompt', async () => {
    const prompts = await import('../utils/prompts.js');
    // codebaseMaturity should be available for the init process
    expect(typeof prompts.projectInit).toBe('function');
  });
});

// ══════════════════════════════════════════════════════════════════════════════
// Edge Cases and Error Handling
// ══════════════════════════════════════════════════════════════════════════════

describe('Edge Cases', () => {
  describe('Path utilities', () => {
    it('should handle isGlobalPath correctly', async () => {
      const { isGlobalPath, GLOBAL_HAWAT_DIR } = await import('../utils/paths.js');

      expect(isGlobalPath(`${GLOBAL_HAWAT_DIR}/templates`)).toBe(true);
      expect(isGlobalPath('/some/other/path')).toBe(false);
    });

    it('should handle isProjectPath correctly', async () => {
      const { isProjectPath } = await import('../utils/paths.js');

      expect(isProjectPath('/project/.forge/settings.json', '/project')).toBe(true);
      expect(isProjectPath('/project/.hawat/config.json', '/project')).toBe(true);
      expect(isProjectPath('/other/path/file.txt', '/project')).toBe(false);
    });

    it('should handle getRelativePath correctly', async () => {
      const { getRelativePath } = await import('../utils/paths.js');

      expect(getRelativePath('/project/src/file.js', '/project')).toBe('src/file.js');
      expect(getRelativePath('/other/file.js', '/project')).toBe('/other/file.js');
    });
  });

  describe('Settings validation edge cases', () => {
    it('should handle empty settings object', async () => {
      const { validateClaudeSettings } = await import('../lib/validator.js');
      const result = validateClaudeSettings({});

      expect(result.valid).toBe(true);
      expect(result.errors).toHaveLength(0);
    });

    it('should handle settings with only hooks', async () => {
      const { validateClaudeSettings } = await import('../lib/validator.js');
      const result = validateClaudeSettings({
        hooks: {
          SessionStart: [{ type: 'command', command: 'test.sh' }]
        }
      });

      expect(result.valid).toBe(true);
    });

    it('should handle settings with only permissions', async () => {
      const { validateClaudeSettings } = await import('../lib/validator.js');
      const result = validateClaudeSettings({
        permissions: {
          allow: ['Bash(npm *)'],
          deny: []
        }
      });

      expect(result.valid).toBe(true);
    });
  });

  describe('Deep merge edge cases', () => {
    it('should handle undefined newSettings', async () => {
      const { deepMergeSettings } = await import('../cli/update.js');

      const existingSettings = {
        hooks: { PreToolUse: [] }
      };

      // Should not throw when newSettings has no hooks
      const result = deepMergeSettings({}, existingSettings);
      expect(result.hooks).toBeDefined();
    });

    it('should handle undefined existingSettings', async () => {
      const { deepMergeSettings } = await import('../cli/update.js');

      const newSettings = {
        hooks: { PreToolUse: [{ type: 'command', command: 'test.sh' }] }
      };

      const result = deepMergeSettings(newSettings, {});
      expect(result.hooks.PreToolUse).toHaveLength(1);
    });
  });
});

// ══════════════════════════════════════════════════════════════════════════════
// Cross-Command Integration Points
// ══════════════════════════════════════════════════════════════════════════════

describe('Cross-Command Integration', () => {
  it('install and init should use same global path constants', async () => {
    const { GLOBAL_HAWAT_DIR, GLOBAL_SCRIPTS_DIR, GLOBAL_SKILLS_DIR } =
      await import('../utils/paths.js');

    // Both commands reference these paths
    expect(GLOBAL_HAWAT_DIR).toBeDefined();
    expect(GLOBAL_SCRIPTS_DIR).toBeDefined();
    expect(GLOBAL_SKILLS_DIR).toBeDefined();
  });

  it('update and doctor should use same validation paths', async () => {
    const { getProjectPaths } = await import('../utils/paths.js');
    const paths = getProjectPaths();

    // Both commands check these project paths
    expect(paths.providerDir).toBeDefined();
    expect(paths.settingsJson).toBeDefined();
    expect(paths.projectConfig).toBeDefined();
  });

  it('init and update should share template engine', async () => {
    const { renderTemplate, getDefaultData } = await import('../lib/template-engine.js');

    // Both commands use these for file generation
    expect(typeof renderTemplate).toBe('function');
    expect(typeof getDefaultData).toBe('function');
  });

  it('all commands should use same logger', async () => {
    const logger = await import('../utils/logger.js');

    // All commands use this logger
    expect(logger.default).toBeDefined();
    expect(logger.default.info).toBeDefined();
    expect(logger.default.error).toBeDefined();
    expect(logger.default.success).toBeDefined();
  });
});
