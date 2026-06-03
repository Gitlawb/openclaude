const test = require('node:test');
const assert = require('node:assert/strict');
const { buildPermissionControlResult } = require('./permissionResponse');

test('buildPermissionControlResult allow includes behavior and updatedInput', () => {
  const input = { file_path: 'C:\\project\\foo.txt', old_string: 'a', new_string: 'b' };
  assert.deepEqual(buildPermissionControlResult('allow', {
    input,
    toolUseId: 'toolu_123',
  }), {
    behavior: 'allow',
    updatedInput: input,
    toolUseID: 'toolu_123',
  });
});

test('buildPermissionControlResult allow-session attaches permission suggestions', () => {
  const suggestions = [{
    type: 'addRules',
    rules: [{ toolName: 'Edit', ruleContent: 'C:\\project' }],
    behavior: 'allow',
    destination: 'session',
  }];
  assert.deepEqual(buildPermissionControlResult('allow-session', {
    input: { file_path: 'C:\\project\\foo.txt' },
    toolUseId: 'toolu_456',
    permissionSuggestions: suggestions,
  }), {
    behavior: 'allow',
    updatedInput: { file_path: 'C:\\project\\foo.txt' },
    toolUseID: 'toolu_456',
    updatedPermissions: suggestions,
  });
});

test('buildPermissionControlResult deny uses deny behavior', () => {
  assert.deepEqual(buildPermissionControlResult('deny', { toolUseId: 'toolu_789' }), {
    behavior: 'deny',
    message: 'User denied permission',
    toolUseID: 'toolu_789',
  });
});
