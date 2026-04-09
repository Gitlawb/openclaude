const test = require('node:test');
const assert = require('node:assert/strict');
const { mock } = require('bun:test');

function createStatus(overrides = {}) {
  return {
    installed: true,
    executable: 'forge',
    launchCommand: 'forge --project-aware',
    terminalName: 'Atreides Forge',
    shimEnabled: false,
    workspaceFolder: '/workspace/forge/very/long/path/example-project',
    workspaceSourceLabel: 'active editor workspace',
    launchCwd: '/workspace/forge/very/long/path/example-project',
    launchCwdLabel: '/workspace/forge/very/long/path/example-project',
    canLaunchInWorkspaceRoot: true,
    profileStatusLabel: 'Found',
    profileStatusHint: '/workspace/forge/very/long/path/example-project/.forge-profile.json',
    workspaceProfilePath: '/workspace/forge/very/long/path/example-project/.forge-profile.json',
    providerState: {
      label: 'Codex',
      detail: 'gpt-5.4',
      source: 'profile',
    },
    providerSourceLabel: 'saved profile',
    ...overrides,
  };
}

function loadExtension() {
  const extensionPath = require.resolve('./extension');
  delete require.cache[extensionPath];
  mock.module('vscode', () => ({
    workspace: {
      workspaceFolders: [],
      getConfiguration: () => ({
        get: (_key, fallback) => fallback,
      }),
      getWorkspaceFolder: () => null,
    },
    window: {
      activeTextEditor: null,
      createWebviewPanel: () => ({}),
      registerWebviewViewProvider: () => ({ dispose() {} }),
      showInformationMessage: async () => undefined,
      showErrorMessage: async () => undefined,
    },
    env: {
      openExternal: async () => true,
    },
    commands: {
      registerCommand: () => ({ dispose() {} }),
      executeCommand: async () => undefined,
    },
    Uri: { parse: value => value, file: value => value },
    ViewColumn: { Active: 1 },
  }));
  return require('./extension');
}

test('renderControlCenterHtml uses the Atreides Forge wordmark, status rail, and warm action hierarchy', () => {
  const { renderControlCenterHtml } = loadExtension();
  const html = renderControlCenterHtml(createStatus(), { nonce: 'test-nonce', platform: 'win32' });

  assert.match(html, /Open<span class="wordmark-accent">Claude<\/span>/);
  assert.match(html, /class="status-rail"/);
  assert.match(html, /\.sunset-gradient\s*\{/);
  assert.match(html, /class="action-button primary" id="launch"/);
  assert.match(html, /class="action-button secondary" id="launchRoot"/);
  assert.match(
    html,
    /title="\/workspace\/forge\/very\/long\/path\/example-project"[^>]*>\/workspace\/forge\/very\/long\/path\/example-project<\//,
  );
});

test('renderControlCenterHtml shows explicit disabled and empty states when workspace data is missing', () => {
  const { renderControlCenterHtml } = loadExtension();
  const html = renderControlCenterHtml(
    createStatus({
      workspaceFolder: null,
      workspaceSourceLabel: 'no workspace open',
      launchCwd: null,
      launchCwdLabel: 'VS Code default terminal cwd',
      canLaunchInWorkspaceRoot: false,
      profileStatusLabel: 'No workspace',
      profileStatusHint: 'Open a workspace folder to detect a saved profile',
      workspaceProfilePath: null,
    }),
    { nonce: 'test-nonce', platform: 'linux' },
  );

  assert.match(
    html,
    /class="action-button secondary" id="launchRoot"[^>]*disabled[^>]*>[\s\S]*Open a workspace folder to enable workspace-root launch/,
  );
  assert.match(html, /No workspace profile yet/);
  assert.match(html, /Open a workspace folder to detect a saved profile/);
  assert.doesNotMatch(html, /id="openProfile"/);
});

test('ForgeControlCenterProvider.getHtml supplies a nonce to the redesigned renderer', () => {
  const { ForgeControlCenterProvider } = loadExtension();
  const provider = new ForgeControlCenterProvider();

  assert.doesNotThrow(() => provider.getHtml(createStatus()));

  const html = provider.getHtml(createStatus());
  assert.match(html, /script-src 'nonce-[^']+'/);
  assert.match(html, /<script nonce="[^"]+">/);
  assert.doesNotMatch(html, /nonce-undefined/);
  assert.doesNotMatch(html, /<script nonce="undefined">/);
});

test('resolveLaunchTargets distinguishes project-aware launch from workspace-root launch', () => {
  const { resolveLaunchTargets } = loadExtension();

  assert.deepEqual(
    resolveLaunchTargets({
      activeFilePath: '/workspace/forge/src/panels/control-center.js',
      workspacePath: '/workspace/forge',
      workspaceSourceLabel: 'active editor workspace',
    }),
    {
      projectAwareCwd: '/workspace/forge/src/panels',
      projectAwareCwdLabel: '/workspace/forge/src/panels',
      projectAwareSourceLabel: 'active file directory',
      workspaceRootCwd: '/workspace/forge',
      workspaceRootCwdLabel: '/workspace/forge',
      launchActionsShareTarget: false,
      launchActionsShareTargetReason: null,
    },
  );
});

test('resolveLaunchTargets anchors relative launch commands to the workspace root', () => {
  const { resolveLaunchTargets } = loadExtension();

  assert.deepEqual(
    resolveLaunchTargets({
      executable: './node_modules/.bin/forge',
      activeFilePath: '/workspace/forge/src/panels/control-center.js',
      workspacePath: '/workspace/forge',
      workspaceSourceLabel: 'active editor workspace',
    }),
    {
      projectAwareCwd: '/workspace/forge',
      projectAwareCwdLabel: '/workspace/forge',
      projectAwareSourceLabel: 'workspace root (required by relative launch command)',
      workspaceRootCwd: '/workspace/forge',
      workspaceRootCwdLabel: '/workspace/forge',
      launchActionsShareTarget: true,
      launchActionsShareTargetReason: 'relative-launch-command',
    },
  );
});

test('resolveLaunchTargets ignores active files outside the selected workspace', () => {
  const { resolveLaunchTargets } = loadExtension();

  assert.deepEqual(
    resolveLaunchTargets({
      executable: 'forge',
      activeFilePath: '/tmp/notes/scratch.js',
      workspacePath: '/workspace/forge',
      workspaceSourceLabel: 'first workspace folder',
    }),
    {
      projectAwareCwd: '/workspace/forge',
      projectAwareCwdLabel: '/workspace/forge',
      projectAwareSourceLabel: 'first workspace folder',
      workspaceRootCwd: '/workspace/forge',
      workspaceRootCwdLabel: '/workspace/forge',
      launchActionsShareTarget: true,
      launchActionsShareTargetReason: null,
    },
  );
});

test('renderControlCenterHtml restores landmark and heading semantics', () => {
  const { renderControlCenterHtml } = loadExtension();
  const html = renderControlCenterHtml(createStatus(), { nonce: 'test-nonce', platform: 'win32' });

  assert.match(html, /<main class="shell" aria-labelledby="control-center-title">/);
  assert.match(html, /<header class="hero">/);
  assert.match(html, /<h1 class="headline-title" id="control-center-title">/);
  assert.match(html, /<section class="modules" aria-label="Control center details">/);
  assert.match(html, /<h2 class="module-title" id="section-project">Project<\/h2>/);
  assert.match(html, /<section class="actions-layout" aria-label="Control center actions">/);
});

test('renderControlCenterHtml explains distinct launch targets when an active file directory is available', () => {
  const { renderControlCenterHtml } = loadExtension();
  const html = renderControlCenterHtml(
    createStatus({
      launchCwd: '/workspace/forge/src/panels',
      launchCwdLabel: '/workspace/forge/src/panels',
      launchCwdSourceLabel: 'active file directory',
      workspaceRootCwd: '/workspace/forge',
      workspaceRootCwdLabel: '/workspace/forge',
    }),
    { nonce: 'test-nonce', platform: 'linux' },
  );

  assert.match(html, /Starts beside the active file · \/workspace\/forge\/src\/panels/);
  assert.match(html, /Always starts at the workspace root · \/workspace\/forge/);
});

test('renderControlCenterHtml makes shared workspace-root launches explicit for relative commands', () => {
  const { renderControlCenterHtml } = loadExtension();
  const html = renderControlCenterHtml(
    createStatus({
      launchCwd: '/workspace/forge',
      launchCwdLabel: '/workspace/forge',
      launchCwdSourceLabel: 'workspace root (required by relative launch command)',
      workspaceRootCwd: '/workspace/forge',
      workspaceRootCwdLabel: '/workspace/forge',
      launchActionsShareTarget: true,
      launchActionsShareTargetReason: 'relative-launch-command',
    }),
    { nonce: 'test-nonce', platform: 'linux' },
  );

  assert.match(html, /Project-aware launch is anchored to the workspace root by the relative command · \/workspace\/forge/);
  assert.match(html, /Same workspace-root target as Launch Atreides Forge because the relative command resolves from the workspace root · \/workspace\/forge/);
});

test('renderControlCenterHtml escapes hostile text and title values', () => {
  const { renderControlCenterHtml } = loadExtension();
  const html = renderControlCenterHtml(
    createStatus({
      launchCommand: '<img src=x onerror="boom()">',
      workspaceFolder: '"/><script>workspace()</script>',
      workspaceSourceLabel: 'active <b>workspace</b>',
      launchCwdLabel: '"><script>cwd()</script>',
      profileStatusHint: '<svg onload="profile()">',
      workspaceProfilePath: '"/><script>profile-path()</script>',
      providerState: {
        label: 'Provider "><img src=x onerror="label()">',
        detail: '<script>provider-detail()</script>',
        source: 'profile',
      },
    }),
    { nonce: 'test-nonce', platform: 'linux' },
  );

  assert.match(html, /&lt;img src=x onerror=&quot;boom\(\)&quot;&gt;/);
  assert.match(html, /&quot;\/&gt;&lt;script&gt;workspace\(\)&lt;\/script&gt;/);
  assert.match(html, /active &lt;b&gt;workspace&lt;\/b&gt;/);
  assert.match(html, /&lt;svg onload=&quot;profile\(\)&quot;&gt;/);
  assert.match(html, /Provider &quot;&gt;&lt;img src=x onerror=&quot;label\(\)&quot;&gt;/);
  assert.match(html, /&lt;script&gt;provider-detail\(\)&lt;\/script&gt; · saved profile/);
  assert.doesNotMatch(html, /<script>workspace\(\)<\/script>/);
  assert.doesNotMatch(html, /<img src=x onerror="boom\(\)">/);
});
