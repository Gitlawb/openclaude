import { feature } from 'bun:bundle';
import {
  applyProfileEnvToProcessEnv,
  buildStartupEnvFromProfile,
} from '../utils/providerProfile.js'
import {
  getProviderValidationError,
  validateProviderEnvOrExit,
} from '../utils/providerValidation.js'

// OpenClaude: disable experimental API betas by default.
// Tool search (defer_loading), global cache scope, and context management
// require internal API support not available to external accounts → 500.
// Users can opt-in with CLAUDE_CODE_DISABLE_EXPERIMENTAL_BETAS=false.
// eslint-disable-next-line custom-rules/no-top-level-side-effects
process.env.CLAUDE_CODE_DISABLE_EXPERIMENTAL_BETAS ??= 'true'

// Bugfix for corepack auto-pinning, which adds yarnpkg to peoples' package.jsons
// eslint-disable-next-line custom-rules/no-top-level-side-effects
process.env.COREPACK_ENABLE_AUTO_PIN = '0';

// Set max heap size for child processes in CCR environments (containers have 16GB)
// eslint-disable-next-line custom-rules/no-top-level-side-effects, custom-rules/no-process-env-top-level, custom-rules/safe-env-boolean-check
if (process.env.CLAUDE_CODE_REMOTE === 'true') {
  // eslint-disable-next-line custom-rules/no-top-level-side-effects, custom-rules/no-process-env-top-level
  const existing = process.env.NODE_OPTIONS || '';
  // eslint-disable-next-line custom-rules/no-top-level-side-effects, custom-rules/no-process-env-top-level
  process.env.NODE_OPTIONS = existing ? `${existing} --max-old-space-size=8192` : '--max-old-space-size=8192';
}

// Harness-science L0 ablation baseline. Inlined here (not init.ts) because
// BashTool/AgentTool/PowerShellTool capture DISABLE_BACKGROUND_TASKS into
// module-level consts at import time — init() runs too late. feature() gate
// DCEs this entire block from external builds.
// eslint-disable-next-line custom-rules/no-top-level-side-effects, custom-rules/no-process-env-top-level
if (feature('ABLATION_BASELINE') && process.env.CLAUDE_CODE_ABLATION_BASELINE) {
  for (const k of ['CLAUDE_CODE_SIMPLE', 'CLAUDE_CODE_DISABLE_THINKING', 'DISABLE_INTERLEAVED_THINKING', 'DISABLE_COMPACT', 'DISABLE_AUTO_COMPACT', 'CLAUDE_CODE_DISABLE_AUTO_MEMORY', 'CLAUDE_CODE_DISABLE_BACKGROUND_TASKS']) {
    // eslint-disable-next-line custom-rules/no-top-level-side-effects, custom-rules/no-process-env-top-level
    process.env[k] ??= '1';
  }
}

function isEnvTruthy(value: string | undefined): boolean {
  if (!value) return false
  const normalized = value.trim().toLowerCase()
  return normalized !== '' && normalized !== '0' && normalized !== 'false' && normalized !== 'no'
}

type GithubTokenStatus = 'valid' | 'expired' | 'invalid_format'

function checkGithubTokenStatus(token: string): GithubTokenStatus {
  // Copilot token format: "tid=...;exp=1775219566;sku=..."
  // Check this first because the token may include '.' in values
  // (for example domains), which would otherwise look JWT-like.
  const expMatch = token.match(/exp=(\d+)/)
  if (expMatch) {
    const expSeconds = Number(expMatch[1])
    if (!Number.isNaN(expSeconds)) {
      return Date.now() >= expSeconds * 1000 ? 'expired' : 'valid'
    }
  }

  // JWT format (OAuth-style tokens): decode only if token looks like JWT.
  // Require exactly 3 dot-separated base64url segments.
  const parts = token.split('.')
  const looksLikeJwt =
    parts.length === 3 && parts.every(part => /^[A-Za-z0-9_-]+$/.test(part))
  if (looksLikeJwt) {
    try {
      const normalized = parts[1].replace(/-/g, '+').replace(/_/g, '/')
      const padded = normalized + '='.repeat((4 - (normalized.length % 4)) % 4)
      const json = Buffer.from(padded, 'base64').toString('utf8')
      const parsed = JSON.parse(json)
      if (parsed && typeof parsed === 'object' && parsed.exp) {
        return Date.now() >= (parsed.exp as number) * 1000 ? 'expired' : 'valid'
      }
    } catch {
      return 'invalid_format'
    }
  }

  // No recognizable expiration found — token format is unknown
  return 'invalid_format'
}

function getProviderValidationError(
  env: NodeJS.ProcessEnv = process.env,
): string | null {
  const useOpenAI = isEnvTruthy(env.CLAUDE_CODE_USE_OPENAI)
  const useGithub = isEnvTruthy(env.CLAUDE_CODE_USE_GITHUB)

  if (isEnvTruthy(env.CLAUDE_CODE_USE_GEMINI)) {
    if (!(env.GEMINI_API_KEY ?? env.GOOGLE_API_KEY)) {
      return 'GEMINI_API_KEY is required when CLAUDE_CODE_USE_GEMINI=1.'
    }
    return null
  }

  if (useGithub && !useOpenAI) {
    const token = (env.GITHUB_TOKEN?.trim() || env.GH_TOKEN?.trim()) ?? ''
    if (!token) {
      return 'GitHub Copilot authentication required.\n' +
        'Run /onboard-github in the CLI to sign in with your GitHub account.\n' +
        'This will store your OAuth token securely and enable Copilot models.'
    }
    const status = checkGithubTokenStatus(token)
    if (status === 'expired') {
      return 'GitHub Copilot token has expired.\n' +
        'Run /onboard-github to sign in again and get a fresh token.'
    }
    if (status === 'invalid_format') {
      return 'GitHub Copilot token is invalid or corrupted.\n' +
        'Run /onboard-github to sign in again with your GitHub account.'
    }
    return null
  }

  if (!useOpenAI) {
    return null
  }

  const request = resolveProviderRequest({
    model: env.OPENAI_MODEL,
    baseUrl: env.OPENAI_BASE_URL,
  })

  if (env.OPENAI_API_KEY === 'SUA_CHAVE') {
    return 'Invalid OPENAI_API_KEY: placeholder value SUA_CHAVE detected. Set a real key or unset for local providers.'
  }

  if (request.transport === 'codex_responses') {
    const credentials = resolveCodexApiCredentials(env)
    if (!credentials.apiKey) {
      const authHint = credentials.authPath
        ? ` or put auth.json at ${credentials.authPath}`
        : ''
      const safeModel =
        redactSecretValueForDisplay(request.requestedModel, env) ??
        'the requested model'
      return `Codex auth is required for ${safeModel}. Set CODEX_API_KEY${authHint}.`
    }
    if (!credentials.accountId) {
      return 'Codex auth is missing chatgpt_account_id. Re-login with Codex or set CHATGPT_ACCOUNT_ID/CODEX_ACCOUNT_ID.'
    }
    return null
  }

  if (!env.OPENAI_API_KEY && !isLocalProviderUrl(request.baseUrl)) {
    const hasGithubToken = !!(env.GITHUB_TOKEN?.trim() || env.GH_TOKEN?.trim())
    if (useGithub && hasGithubToken) {
      return null
    }
    return 'OPENAI_API_KEY is required when CLAUDE_CODE_USE_OPENAI=1 and OPENAI_BASE_URL is not local.'
  }

  return null
}

function validateProviderEnvOrExit(): void {
  const error = getProviderValidationError()
  if (error) {
    console.error(error)
    process.exit(1)
  }
}

/**
 * Bootstrap entrypoint - checks for special flags before loading the full CLI.
 * All imports are dynamic to minimize module evaluation for fast paths.
 * Fast-path for --version has zero imports beyond this file.
 */
async function main(): Promise<void> {
  const args = process.argv.slice(2);

  // Fast-path for --version/-v: zero module loading needed
  if (args.length === 1 && (args[0] === '--version' || args[0] === '-v' || args[0] === '-V')) {
    // MACRO.VERSION is inlined at build time
    // biome-ignore lint/suspicious/noConsole:: intentional console output
    console.log(`${MACRO.DISPLAY_VERSION ?? MACRO.VERSION} (Open Claude)`);
    return;
  }

  // --provider: set provider env vars early so saved-profile resolution,
  // validation, and the startup banner all see the intended provider/model.
  if (args.includes('--provider')) {
    const { applyProviderFlagFromArgs } = await import('../utils/providerFlag.js');
    const result = applyProviderFlagFromArgs(args);
    if (result?.error) {
      // biome-ignore lint/suspicious/noConsole:: intentional error output
      console.error(`Error: ${result.error}`);
      process.exit(1);
    }
  }

  {
    const { enableConfigs } = await import('../utils/config.js')
    enableConfigs()
    const { applySafeConfigEnvironmentVariables } = await import('../utils/managedEnv.js')
    applySafeConfigEnvironmentVariables()
    const { hydrateGeminiAccessTokenFromSecureStorage } = await import('../utils/geminiCredentials.js')
    hydrateGeminiAccessTokenFromSecureStorage()
    const { hydrateGithubModelsTokenFromSecureStorage } = await import('../utils/githubModelsCredentials.js')
    hydrateGithubModelsTokenFromSecureStorage()
  }

  const startupEnv = await buildStartupEnvFromProfile({
    processEnv: process.env,
  })
  if (startupEnv !== process.env) {
    const startupProfileError = await getProviderValidationError(startupEnv)
    if (startupProfileError) {
      console.error(
        `Warning: ignoring saved provider profile. ${startupProfileError}`,
      )
    } else {
      applyProfileEnvToProcessEnv(process.env, startupEnv)
    }
  }

  await validateProviderEnvOrExit()

  // Print the gradient startup screen before the Ink UI loads
  const { printStartupScreen } = await import('../components/StartupScreen.js')
  printStartupScreen()

  // For all other paths, load the startup profiler
  const {
    profileCheckpoint
  } = await import('../utils/startupProfiler.js');
  profileCheckpoint('cli_entry');

  // Fast-path for --dump-system-prompt: output the rendered system prompt and exit.
  // Used by prompt sensitivity evals to extract the system prompt at a specific commit.
  // Ant-only: eliminated from external builds via feature flag.
  if (feature('DUMP_SYSTEM_PROMPT') && args[0] === '--dump-system-prompt') {
    profileCheckpoint('cli_dump_system_prompt_path');
    const {
      enableConfigs
    } = await import('../utils/config.js');
    enableConfigs();
    const {
      getMainLoopModel
    } = await import('../utils/model/model.js');
    const modelIdx = args.indexOf('--model');
    const model = modelIdx !== -1 && args[modelIdx + 1] || getMainLoopModel();
    const {
      getSystemPrompt
    } = await import('../constants/prompts.js');
    const prompt = await getSystemPrompt([], model);
    // biome-ignore lint/suspicious/noConsole:: intentional console output
    console.log(prompt.join('\n'));
    return;
  }
  if (process.argv[2] === '--claude-in-chrome-mcp') {
    profileCheckpoint('cli_claude_in_chrome_mcp_path');
    const {
      runClaudeInChromeMcpServer
    } = await import('../utils/claudeInChrome/mcpServer.js');
    await runClaudeInChromeMcpServer();
    return;
  } else if (process.argv[2] === '--chrome-native-host') {
    profileCheckpoint('cli_chrome_native_host_path');
    const {
      runChromeNativeHost
    } = await import('../utils/claudeInChrome/chromeNativeHost.js');
    await runChromeNativeHost();
    return;
  } else if (feature('CHICAGO_MCP') && process.argv[2] === '--computer-use-mcp') {
    profileCheckpoint('cli_computer_use_mcp_path');
    const {
      runComputerUseMcpServer
    } = await import('../utils/computerUse/mcpServer.js');
    await runComputerUseMcpServer();
    return;
  }

  // Fast-path for `--daemon-worker=<kind>` (internal — supervisor spawns this).
  // Must come before the daemon subcommand check: spawned per-worker, so
  // perf-sensitive. No enableConfigs(), no analytics sinks at this layer —
  // workers are lean. If a worker kind needs configs/auth (assistant will),
  // it calls them inside its run() fn.
  if (feature('DAEMON') && args[0] === '--daemon-worker') {
    const {
      runDaemonWorker
    } = await import('../daemon/workerRegistry.js');
    await runDaemonWorker(args[1]);
    return;
  }

  // Fast-path for `claude remote-control` (also accepts legacy `claude remote` / `claude sync` / `claude bridge`):
  // serve local machine as bridge environment.
  // feature() must stay inline for build-time dead code elimination;
  // isBridgeEnabled() checks the runtime GrowthBook gate.
  if (feature('BRIDGE_MODE') && (args[0] === 'remote-control' || args[0] === 'rc' || args[0] === 'remote' || args[0] === 'sync' || args[0] === 'bridge')) {
    profileCheckpoint('cli_bridge_path');
    const {
      enableConfigs
    } = await import('../utils/config.js');
    enableConfigs();
    const {
      getBridgeDisabledReason,
      checkBridgeMinVersion
    } = await import('../bridge/bridgeEnabled.js');
    const {
      BRIDGE_LOGIN_ERROR
    } = await import('../bridge/types.js');
    const {
      bridgeMain
    } = await import('../bridge/bridgeMain.js');
    const {
      exitWithError
    } = await import('../utils/process.js');

    // Auth check must come before the GrowthBook gate check — without auth,
    // GrowthBook has no user context and would return a stale/default false.
    // getBridgeDisabledReason awaits GB init, so the returned value is fresh
    // (not the stale disk cache), but init still needs auth headers to work.
    const {
      getClaudeAIOAuthTokens
    } = await import('../utils/auth.js');
    if (!getClaudeAIOAuthTokens()?.accessToken) {
      exitWithError(BRIDGE_LOGIN_ERROR);
    }
    const disabledReason = await getBridgeDisabledReason();
    if (disabledReason) {
      exitWithError(`Error: ${disabledReason}`);
    }
    const versionError = checkBridgeMinVersion();
    if (versionError) {
      exitWithError(versionError);
    }

    // Bridge is a remote control feature - check policy limits
    const {
      waitForPolicyLimitsToLoad,
      isPolicyAllowed
    } = await import('../services/policyLimits/index.js');
    await waitForPolicyLimitsToLoad();
    if (!isPolicyAllowed('allow_remote_control')) {
      exitWithError("Error: Remote Control is disabled by your organization's policy.");
    }
    await bridgeMain(args.slice(1));
    return;
  }

  // Fast-path for `claude daemon [subcommand]`: long-running supervisor.
  if (feature('DAEMON') && args[0] === 'daemon') {
    profileCheckpoint('cli_daemon_path');
    const {
      enableConfigs
    } = await import('../utils/config.js');
    enableConfigs();
    const {
      initSinks
    } = await import('../utils/sinks.js');
    initSinks();
    const {
      daemonMain
    } = await import('../daemon/main.js');
    await daemonMain(args.slice(1));
    return;
  }

  // Fast-path for `claude ps|logs|attach|kill` and `--bg`/`--background`.
  // Session management against the ~/.claude/sessions/ registry. Flag
  // literals are inlined so bg.js only loads when actually dispatching.
  if (feature('BG_SESSIONS') && (args[0] === 'ps' || args[0] === 'logs' || args[0] === 'attach' || args[0] === 'kill' || args.includes('--bg') || args.includes('--background'))) {
    profileCheckpoint('cli_bg_path');
    const {
      enableConfigs
    } = await import('../utils/config.js');
    enableConfigs();
    const bg = await import('../cli/bg.js');
    switch (args[0]) {
      case 'ps':
        await bg.psHandler(args.slice(1));
        break;
      case 'logs':
        await bg.logsHandler(args[1]);
        break;
      case 'attach':
        await bg.attachHandler(args[1]);
        break;
      case 'kill':
        await bg.killHandler(args[1]);
        break;
      default:
        await bg.handleBgFlag(args);
    }
    return;
  }

  // Fast-path for template job commands.
  if (feature('TEMPLATES') && (args[0] === 'new' || args[0] === 'list' || args[0] === 'reply')) {
    profileCheckpoint('cli_templates_path');
    const {
      templatesMain
    } = await import('../cli/handlers/templateJobs.js');
    await templatesMain(args);
    // process.exit (not return) — mountFleetView's Ink TUI can leave event
    // loop handles that prevent natural exit.
    // eslint-disable-next-line custom-rules/no-process-exit
    process.exit(0);
  }

  // Fast-path for `claude environment-runner`: headless BYOC runner.
  // feature() must stay inline for build-time dead code elimination.
  if (feature('BYOC_ENVIRONMENT_RUNNER') && args[0] === 'environment-runner') {
    profileCheckpoint('cli_environment_runner_path');
    const {
      environmentRunnerMain
    } = await import('../environment-runner/main.js');
    await environmentRunnerMain(args.slice(1));
    return;
  }

  // Fast-path for `claude self-hosted-runner`: headless self-hosted-runner
  // targeting the SelfHostedRunnerWorkerService API (register + poll; poll IS
  // heartbeat). feature() must stay inline for build-time dead code elimination.
  if (feature('SELF_HOSTED_RUNNER') && args[0] === 'self-hosted-runner') {
    profileCheckpoint('cli_self_hosted_runner_path');
    const {
      selfHostedRunnerMain
    } = await import('../self-hosted-runner/main.js');
    await selfHostedRunnerMain(args.slice(1));
    return;
  }

  // Fast-path for --worktree --tmux: exec into tmux before loading full CLI
  const hasTmuxFlag = args.includes('--tmux') || args.includes('--tmux=classic');
  if (hasTmuxFlag && (args.includes('-w') || args.includes('--worktree') || args.some(a => a.startsWith('--worktree=')))) {
    profileCheckpoint('cli_tmux_worktree_fast_path');
    const {
      enableConfigs
    } = await import('../utils/config.js');
    enableConfigs();
    const {
      isWorktreeModeEnabled
    } = await import('../utils/worktreeModeEnabled.js');
    if (isWorktreeModeEnabled()) {
      const {
        execIntoTmuxWorktree
      } = await import('../utils/worktree.js');
      const result = await execIntoTmuxWorktree(args);
      if (result.handled) {
        return;
      }
      // If not handled (e.g., error), fall through to normal CLI
      if (result.error) {
        const {
          exitWithError
        } = await import('../utils/process.js');
        exitWithError(result.error);
      }
    }
  }

  // Redirect common update flag mistakes to the update subcommand
  if (args.length === 1 && (args[0] === '--update' || args[0] === '--upgrade')) {
    process.argv = [process.argv[0]!, process.argv[1]!, 'update'];
  }

  // --bare: set SIMPLE early so gates fire during module eval / commander
  // option building (not just inside the action handler).
  if (args.includes('--bare')) {
    process.env.CLAUDE_CODE_SIMPLE = '1';
  }

  // No special flags detected, load and run the full CLI
  if (process.env.OPENCLAUDE_DISABLE_EARLY_INPUT !== '1') {
    const {
      startCapturingEarlyInput
    } = await import('../utils/earlyInput.js');
    startCapturingEarlyInput();
  }
  profileCheckpoint('cli_before_main_import');
  const {
    main: cliMain
  } = await import('../main.js');
  profileCheckpoint('cli_after_main_import');
  await cliMain();
  profileCheckpoint('cli_after_main_complete');
}

// eslint-disable-next-line custom-rules/no-top-level-side-effects
void main();
