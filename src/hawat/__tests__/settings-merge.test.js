/**
 * Settings Merge Tests
 *
 * Tests the deep merge logic for settings.json updates
 */

import { deepMergeSettings } from '../cli/update.js';

describe('deepMergeSettings', () => {
  describe('hook merging', () => {
    it('should add new hook types from template', () => {
      const newSettings = {
        hooks: {
          PreToolUse: [{ type: 'command', command: 'validate.sh' }],
          PostToolUse: [{ type: 'command', command: 'format.sh' }]
        }
      };
      const existingSettings = {
        hooks: {}
      };

      const result = deepMergeSettings(newSettings, existingSettings);

      expect(result.hooks.PreToolUse).toEqual([{ type: 'command', command: 'validate.sh' }]);
      expect(result.hooks.PostToolUse).toEqual([{ type: 'command', command: 'format.sh' }]);
    });

    it('should merge new entries with existing hook customizations', () => {
      const newSettings = {
        hooks: {
          PostToolUse: [{ type: 'command', command: 'new-format.sh' }]
        }
      };
      const existingSettings = {
        hooks: {
          PostToolUse: [{ type: 'command', command: 'my-custom-format.sh' }]
        }
      };

      const result = deepMergeSettings(newSettings, existingSettings);

      // Should keep user's customization AND add new entry
      expect(result.hooks.PostToolUse).toHaveLength(2);
      expect(result.hooks.PostToolUse[0]).toEqual({ type: 'command', command: 'my-custom-format.sh' });
      expect(result.hooks.PostToolUse[1]).toEqual({ type: 'command', command: 'new-format.sh' });
    });

    it('should not duplicate identical hooks', () => {
      const newSettings = {
        hooks: {
          PostToolUse: [{ type: 'command', command: 'format.sh' }]
        }
      };
      const existingSettings = {
        hooks: {
          PostToolUse: [{ type: 'command', command: 'format.sh' }]
        }
      };

      const result = deepMergeSettings(newSettings, existingSettings);

      // Should not duplicate identical hooks
      expect(result.hooks.PostToolUse).toHaveLength(1);
    });

    it('should add new hook types while preserving existing ones', () => {
      const newSettings = {
        hooks: {
          PreToolUse: [{ type: 'command', command: 'validate.sh' }],
          SessionStart: [{ type: 'command', command: 'context.sh' }]
        }
      };
      const existingSettings = {
        hooks: {
          PostToolUse: [{ type: 'command', command: 'custom.sh' }]
        }
      };

      const result = deepMergeSettings(newSettings, existingSettings);

      expect(result.hooks.PreToolUse).toEqual([{ type: 'command', command: 'validate.sh' }]);
      expect(result.hooks.SessionStart).toEqual([{ type: 'command', command: 'context.sh' }]);
      expect(result.hooks.PostToolUse).toEqual([{ type: 'command', command: 'custom.sh' }]);
    });

    it('should handle empty existing hooks', () => {
      const newSettings = {
        hooks: {
          PreToolUse: [{ type: 'command', command: 'test.sh' }]
        }
      };
      const existingSettings = {};

      const result = deepMergeSettings(newSettings, existingSettings);

      expect(result.hooks.PreToolUse).toEqual([{ type: 'command', command: 'test.sh' }]);
    });

    it('should merge hooks by matcher to avoid duplicate runs', () => {
      // Existing project has Bash matcher with 2 commands
      const existingSettings = {
        hooks: {
          PreToolUse: [
            {
              matcher: 'Bash',
              hooks: [
                { type: 'command', command: 'validate-a.sh' },
                { type: 'command', command: 'validate-b.sh' }
              ]
            }
          ]
        }
      };

      // New release adds a third command to Bash matcher
      const newSettings = {
        hooks: {
          PreToolUse: [
            {
              matcher: 'Bash',
              hooks: [
                { type: 'command', command: 'validate-a.sh' },
                { type: 'command', command: 'validate-b.sh' },
                { type: 'command', command: 'validate-c.sh' }
              ]
            }
          ]
        }
      };

      const result = deepMergeSettings(newSettings, existingSettings);

      // Should have ONE entry with merged hooks, not two duplicate matchers
      expect(result.hooks.PreToolUse).toHaveLength(1);
      expect(result.hooks.PreToolUse[0].matcher).toBe('Bash');
      expect(result.hooks.PreToolUse[0].hooks).toHaveLength(3);
      expect(result.hooks.PreToolUse[0].hooks).toContainEqual({ type: 'command', command: 'validate-a.sh' });
      expect(result.hooks.PreToolUse[0].hooks).toContainEqual({ type: 'command', command: 'validate-b.sh' });
      expect(result.hooks.PreToolUse[0].hooks).toContainEqual({ type: 'command', command: 'validate-c.sh' });
    });

    it('should add new matchers alongside existing ones', () => {
      const existingSettings = {
        hooks: {
          PreToolUse: [
            { matcher: 'Bash', hooks: [{ type: 'command', command: 'bash-check.sh' }] }
          ]
        }
      };

      const newSettings = {
        hooks: {
          PreToolUse: [
            { matcher: 'Edit', hooks: [{ type: 'command', command: 'edit-check.sh' }] }
          ]
        }
      };

      const result = deepMergeSettings(newSettings, existingSettings);

      // Should have both matchers
      expect(result.hooks.PreToolUse).toHaveLength(2);
      expect(result.hooks.PreToolUse.find(h => h.matcher === 'Bash')).toBeDefined();
      expect(result.hooks.PreToolUse.find(h => h.matcher === 'Edit')).toBeDefined();
    });
  });

  describe('permission merging', () => {
    it('should add new allow permissions', () => {
      const newSettings = {
        permissions: {
          allow: ['Bash(npm:*)', 'Bash(node:*)']
        }
      };
      const existingSettings = {
        permissions: {
          allow: ['Bash(git:*)']
        }
      };

      const result = deepMergeSettings(newSettings, existingSettings);

      expect(result.permissions.allow).toContain('Bash(git:*)');
      expect(result.permissions.allow).toContain('Bash(npm:*)');
      expect(result.permissions.allow).toContain('Bash(node:*)');
    });

    it('should not duplicate existing permissions', () => {
      const newSettings = {
        permissions: {
          allow: ['Bash(git:*)', 'Bash(npm:*)']
        }
      };
      const existingSettings = {
        permissions: {
          allow: ['Bash(git:*)']
        }
      };

      const result = deepMergeSettings(newSettings, existingSettings);

      const gitCount = result.permissions.allow.filter(p => p === 'Bash(git:*)').length;
      expect(gitCount).toBe(1);
    });

    it('should add new deny permissions', () => {
      const newSettings = {
        permissions: {
          deny: ['Bash(rm -rf /*:*)', 'Bash(sudo:*)']
        }
      };
      const existingSettings = {
        permissions: {
          deny: ['Read(.env)']
        }
      };

      const result = deepMergeSettings(newSettings, existingSettings);

      expect(result.permissions.deny).toContain('Read(.env)');
      expect(result.permissions.deny).toContain('Bash(rm -rf /*:*)');
      expect(result.permissions.deny).toContain('Bash(sudo:*)');
    });

    it('should handle empty existing permissions', () => {
      const newSettings = {
        permissions: {
          allow: ['Bash(npm:*)'],
          deny: ['Bash(sudo:*)']
        }
      };
      const existingSettings = {};

      const result = deepMergeSettings(newSettings, existingSettings);

      expect(result.permissions.allow).toContain('Bash(npm:*)');
      expect(result.permissions.deny).toContain('Bash(sudo:*)');
    });
  });

  describe('prototype pollution protection', () => {
    it('should not pollute Object.prototype via __proto__ in hooks', () => {
      // Save original prototype state
      const originalProtoKeys = Object.keys(Object.prototype);

      const maliciousSettings = {
        hooks: {
          __proto__: { polluted: true },
          PreToolUse: [{ type: 'command', command: 'safe.sh' }]
        }
      };
      const existingSettings = {
        hooks: {}
      };

      const result = deepMergeSettings(maliciousSettings, existingSettings);

      // Object.prototype should NOT be polluted
      expect(Object.prototype.polluted).toBeUndefined();
      expect(Object.keys(Object.prototype)).toEqual(originalProtoKeys);

      // Safe hook should still be merged
      expect(result.hooks.PreToolUse).toEqual([{ type: 'command', command: 'safe.sh' }]);
    });

    it('should not pollute Object.prototype via __proto__ in permissions', () => {
      const originalProtoKeys = Object.keys(Object.prototype);

      const maliciousSettings = {
        permissions: {
          __proto__: { polluted: true },
          allow: ['Bash(npm:*)']
        }
      };
      const existingSettings = {
        permissions: {}
      };

      const result = deepMergeSettings(maliciousSettings, existingSettings);

      // Object.prototype should NOT be polluted
      expect(Object.prototype.polluted).toBeUndefined();
      expect(Object.keys(Object.prototype)).toEqual(originalProtoKeys);

      // Safe permission should still be merged
      expect(result.permissions.allow).toContain('Bash(npm:*)');
    });

    it('should not pollute via constructor key', () => {
      const originalConstructor = Object.prototype.constructor;

      const maliciousSettings = {
        hooks: {
          constructor: { polluted: true },
          PreToolUse: [{ type: 'command', command: 'safe.sh' }]
        }
      };
      const existingSettings = {};

      const result = deepMergeSettings(maliciousSettings, existingSettings);

      // constructor should not be overwritten on prototype
      expect(Object.prototype.constructor).toBe(originalConstructor);

      // Safe hook should still work
      expect(result.hooks.PreToolUse).toEqual([{ type: 'command', command: 'safe.sh' }]);
    });

    it('should not pollute via prototype key', () => {
      const originalProtoKeys = Object.keys(Object.prototype);

      const maliciousSettings = {
        hooks: {
          prototype: { polluted: true },
          PreToolUse: [{ type: 'command', command: 'safe.sh' }]
        }
      };
      const existingSettings = {};

      const result = deepMergeSettings(maliciousSettings, existingSettings);

      // Object.prototype should be unchanged
      expect(Object.keys(Object.prototype)).toEqual(originalProtoKeys);

      // Safe hook should still work
      expect(result.hooks.PreToolUse).toEqual([{ type: 'command', command: 'safe.sh' }]);
    });

    it('should handle nested __proto__ in hook configurations', () => {
      const originalProtoKeys = Object.keys(Object.prototype);

      const maliciousSettings = {
        hooks: {
          PreToolUse: [
            {
              __proto__: { polluted: true },
              type: 'command',
              command: 'malicious.sh'
            }
          ]
        }
      };
      const existingSettings = {};

      const result = deepMergeSettings(maliciousSettings, existingSettings);

      // Object.prototype should NOT be polluted
      expect(Object.prototype.polluted).toBeUndefined();
      expect(Object.keys(Object.prototype)).toEqual(originalProtoKeys);
    });

    it('should not pollute when __proto__ is in top-level settings', () => {
      const originalProtoKeys = Object.keys(Object.prototype);

      const maliciousSettings = {
        __proto__: { polluted: true },
        hooks: {
          PreToolUse: [{ type: 'command', command: 'safe.sh' }]
        }
      };
      const existingSettings = {};

      const result = deepMergeSettings(maliciousSettings, existingSettings);

      // Object.prototype should NOT be polluted
      expect(Object.prototype.polluted).toBeUndefined();
      expect(Object.keys(Object.prototype)).toEqual(originalProtoKeys);
    });

    it('should safely merge when existing settings have dangerous keys', () => {
      const originalProtoKeys = Object.keys(Object.prototype);

      const newSettings = {
        hooks: {
          PreToolUse: [{ type: 'command', command: 'new.sh' }]
        }
      };
      const maliciousExisting = {
        __proto__: { polluted: true },
        hooks: {
          PreToolUse: [{ type: 'command', command: 'existing.sh' }]
        }
      };

      const result = deepMergeSettings(newSettings, maliciousExisting);

      // Object.prototype should NOT be polluted
      expect(Object.prototype.polluted).toBeUndefined();
      expect(Object.keys(Object.prototype)).toEqual(originalProtoKeys);

      // Both hooks should be present
      expect(result.hooks.PreToolUse).toHaveLength(2);
    });

    it('should not allow prototype pollution through JSON.parse attack vector', () => {
      const originalProtoKeys = Object.keys(Object.prototype);

      // Simulate a JSON.parse attack - this is how __proto__ typically gets introduced
      const jsonPayload = '{"hooks":{"__proto__":{"polluted":"yes"},"PreToolUse":[{"type":"command","command":"safe.sh"}]}}';
      const maliciousSettings = JSON.parse(jsonPayload);
      const existingSettings = {};

      const result = deepMergeSettings(maliciousSettings, existingSettings);

      // Object.prototype should NOT be polluted
      expect(Object.prototype.polluted).toBeUndefined();
      expect(({}).polluted).toBeUndefined(); // Fresh object shouldn't have it
      expect(Object.keys(Object.prototype)).toEqual(originalProtoKeys);
    });
  });

  describe('combined scenarios', () => {
    it('should handle real-world Phase 4 upgrade scenario', () => {
      // Existing settings from Phase 3
      const existingSettings = {
        hooks: {
          PostToolUse: [
            { matcher: 'Edit|Write', hooks: [{ type: 'command', command: 'prettier --write' }] }
          ]
        },
        permissions: {
          allow: ['Bash(git:*)', 'Bash(npm:*)'],
          deny: ['Bash(sudo:*)']
        }
      };

      // New settings from Phase 4 template with additional hooks
      const newSettings = {
        hooks: {
          PreToolUse: [
            { matcher: 'Bash', hooks: [{ type: 'command', command: 'validate-bash-command.sh' }] }
          ],
          PostToolUse: [
            { matcher: 'Edit|Write', hooks: [{ type: 'command', command: 'new-formatter.sh' }] }
          ],
          SessionStart: [
            { type: 'command', command: 'cat context.md' }
          ]
        },
        permissions: {
          allow: ['Bash(git:*)', 'Bash(npm:*)', 'Bash(cargo:*)'],
          deny: ['Bash(sudo:*)', 'Bash(eval:*)']
        }
      };

      const result = deepMergeSettings(newSettings, existingSettings);

      // New hook types should be added
      expect(result.hooks.PreToolUse).toBeDefined();
      expect(result.hooks.SessionStart).toBeDefined();

      // PostToolUse should merge by matcher - ONE entry with both commands
      expect(result.hooks.PostToolUse).toHaveLength(1);
      expect(result.hooks.PostToolUse[0].matcher).toBe('Edit|Write');
      expect(result.hooks.PostToolUse[0].hooks).toHaveLength(2);
      expect(result.hooks.PostToolUse[0].hooks).toContainEqual({ type: 'command', command: 'prettier --write' });
      expect(result.hooks.PostToolUse[0].hooks).toContainEqual({ type: 'command', command: 'new-formatter.sh' });

      // New permissions should be added
      expect(result.permissions.allow).toContain('Bash(cargo:*)');
      expect(result.permissions.deny).toContain('Bash(eval:*)');

      // Existing permissions should be preserved
      expect(result.permissions.allow).toContain('Bash(git:*)');
    });
  });
});
