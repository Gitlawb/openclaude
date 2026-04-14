import React, { useCallback, useEffect, useRef, useState } from 'react';
import { type AnalyticsMetadata_I_VERIFIED_THIS_IS_NOT_CODE_OR_FILEPATHS, logEvent } from 'src/services/analytics/index.js';
import { installOAuthTokens } from '../cli/handlers/auth.js';
import { useTerminalSize } from '../hooks/useTerminalSize.js';
import { setClipboard } from '../ink/termio/osc.js';
import { useTerminalNotification } from '../ink/useTerminalNotification.js';
import { Box, Link, Text } from '../ink.js';
import { useKeybinding } from '../keybindings/useKeybinding.js';
import { getSSLErrorHint } from '../services/api/errorUtils.js';
import { sendNotification } from '../services/notifier.js';
import { OAuthService } from '../services/oauth/index.js';
import { getOauthAccountInfo, validateForceLoginOrg } from '../utils/auth.js';
import { mayHaveGeminiAdcCredentials } from '../utils/geminiAuth.js';
import { saveGeminiAccessToken } from '../utils/geminiCredentials.js';
import { useGeminiOAuthFlow } from './useGeminiOAuthFlow.js';
import { logError } from '../utils/log.js';
import { getSettings_DEPRECATED } from '../utils/settings/settings.js';
import { ProviderManager } from './ProviderManager.js';
import { Select } from './CustomSelect/select.js';
import { KeyboardShortcutHint } from './design-system/KeyboardShortcutHint.js';
import { Spinner } from './Spinner.js';
import TextInput from './TextInput.js';
export type ConsoleOAuthFlowResult = {
  type: 'oauth';
} | {
  type: 'provider-setup';
  message: string;
};
type Props = {
  onDone(result?: ConsoleOAuthFlowResult): void;
  startingMessage?: string;
  mode?: 'login' | 'setup-token';
  forceLoginMethod?: 'claudeai' | 'console';
  initialStatus?: OAuthStatus;
};
type OAuthStatus = {
  state: 'idle';
} // Initial state, waiting to select login method
| {
  state: 'gemini_setup';
} // Show Gemini authentication options
| {
  state: 'platform_setup';
} // Show third-party provider setup flow
| {
  state: 'platform_setup_complete';
  message: string;
}
| {
  state: 'ready_to_start';
} // Flow started, waiting for browser to open
| {
  state: 'waiting_for_login';
  url: string;
} // Browser opened, waiting for user to login
| {
  state: 'creating_api_key';
} // Got access token, creating API key
| {
  state: 'about_to_retry';
  nextState: OAuthStatus;
} | {
  state: 'success';
  token?: string;
} | {
  state: 'error';
  message: string;
  toRetry?: OAuthStatus;
};
const PASTE_HERE_MSG = 'Paste code here if prompted > ';
export function ConsoleOAuthFlow({
  onDone,
  startingMessage,
  mode = 'login',
  forceLoginMethod: forceLoginMethodProp,
  initialStatus
}: Props): React.ReactNode {
  const settings = getSettings_DEPRECATED() || {};
  const forceLoginMethod = forceLoginMethodProp ?? settings.forceLoginMethod;
  const orgUUID = settings.forceLoginOrgUUID;
  const forcedMethodMessage = forceLoginMethod === 'claudeai' ? 'Login method pre-selected: Subscription Plan (Claude Pro/Max)' : forceLoginMethod === 'console' ? 'Login method pre-selected: API Usage Billing (Anthropic Console)' : null;
  const terminal = useTerminalNotification();
  const [oauthStatus, setOAuthStatus] = useState<OAuthStatus>(() => {
    if (initialStatus) {
      return initialStatus;
    }
    if (mode === 'setup-token') {
      return {
        state: 'ready_to_start'
      };
    }
    if (forceLoginMethod === 'claudeai' || forceLoginMethod === 'console') {
      return {
        state: 'ready_to_start'
      };
    }
    return {
      state: 'idle'
    };
  });
  const [pastedCode, setPastedCode] = useState('');
  const [cursorOffset, setCursorOffset] = useState(0);
  const [oauthService] = useState(() => new OAuthService());
  const [loginWithClaudeAi, setLoginWithClaudeAi] = useState(() => {
    // Use Claude AI auth for setup-token mode to support user:inference scope
    return mode === 'setup-token' || forceLoginMethod === 'claudeai';
  });
  // After a few seconds we suggest the user to copy/paste url if the
  // browser did not open automatically. In this flow we expect the user to
  // copy the code from the browser and paste it in the terminal
  const [showPastePrompt, setShowPastePrompt] = useState(false);
  const [urlCopied, setUrlCopied] = useState(false);
  const textInputColumns = useTerminalSize().columns - PASTE_HERE_MSG.length - 1;

  // Log forced login method on mount
  useEffect(() => {
    if (forceLoginMethod === 'claudeai') {
      logEvent('tengu_oauth_claudeai_forced', {});
    } else if (forceLoginMethod === 'console') {
      logEvent('tengu_oauth_console_forced', {});
    }
  }, [forceLoginMethod]);

  // Retry logic
  useEffect(() => {
    if (oauthStatus.state === 'about_to_retry') {
      const timer = setTimeout(setOAuthStatus, 1000, oauthStatus.nextState);
      return () => clearTimeout(timer);
    }
  }, [oauthStatus]);

  // Handle Enter to continue on success state
  useKeybinding('confirm:yes', () => {
    logEvent('tengu_oauth_success', {
      loginWithClaudeAi
    });
    onDone({
      type: 'oauth'
    });
  }, {
    context: 'Confirmation',
    isActive: oauthStatus.state === 'success' && mode !== 'setup-token'
  });

  // Handle Enter to continue after third-party provider setup
  useKeybinding('confirm:yes', () => {
    if (oauthStatus.state !== 'platform_setup_complete') {
      return;
    }
    onDone({
      type: 'provider-setup',
      message: oauthStatus.message
    });
  }, {
    context: 'Confirmation',
    isActive: oauthStatus.state === 'platform_setup_complete'
  });

  // Handle Enter to retry on error state
  useKeybinding('confirm:yes', () => {
    if (oauthStatus.state === 'error' && oauthStatus.toRetry) {
      setPastedCode('');
      setOAuthStatus({
        state: 'about_to_retry',
        nextState: oauthStatus.toRetry
      });
    }
  }, {
    context: 'Confirmation',
    isActive: oauthStatus.state === 'error' && !!oauthStatus.toRetry
  });
  useEffect(() => {
    if (pastedCode === 'c' && oauthStatus.state === 'waiting_for_login' && showPastePrompt && !urlCopied) {
      void setClipboard(oauthStatus.url).then(raw => {
        if (raw) process.stdout.write(raw);
        setUrlCopied(true);
        setTimeout(setUrlCopied, 2000, false);
      });
      setPastedCode('');
    }
  }, [pastedCode, oauthStatus, showPastePrompt, urlCopied]);
  async function handleSubmitCode(value: string, url: string) {
    try {
      // Expecting format "authorizationCode#state" from the authorization callback URL
      const [authorizationCode, state] = value.split('#');
      if (!authorizationCode || !state) {
        setOAuthStatus({
          state: 'error',
          message: 'Invalid code. Please make sure the full code was copied',
          toRetry: {
            state: 'waiting_for_login',
            url
          }
        });
        return;
      }

      // Track which path the user is taking (manual code entry)
      logEvent('tengu_oauth_manual_entry', {});
      oauthService.handleManualAuthCodeInput({
        authorizationCode,
        state
      });
    } catch (err: unknown) {
      logError(err);
      setOAuthStatus({
        state: 'error',
        message: (err as Error).message,
        toRetry: {
          state: 'waiting_for_login',
          url
        }
      });
    }
  }
  const startOAuth = useCallback(async () => {
    try {
      logEvent('tengu_oauth_flow_start', {
        loginWithClaudeAi
      });
      const result = await oauthService.startOAuthFlow(async url_0 => {
        setOAuthStatus({
          state: 'waiting_for_login',
          url: url_0
        });
        setTimeout(setShowPastePrompt, 3000, true);
      }, {
        loginWithClaudeAi,
        inferenceOnly: mode === 'setup-token',
        expiresIn: mode === 'setup-token' ? 365 * 24 * 60 * 60 : undefined,
        // 1 year for setup-token
        orgUUID
      }).catch(err_1 => {
        const isTokenExchangeError = err_1.message.includes('Token exchange failed');
        // Enterprise TLS proxies (Zscaler et al.) intercept the token
        // exchange POST and cause cryptic SSL errors. Surface an
        // actionable hint so the user isn't stuck in a login loop.
        const sslHint_0 = getSSLErrorHint(err_1);
        setOAuthStatus({
          state: 'error',
          message: sslHint_0 ?? (isTokenExchangeError ? 'Failed to exchange authorization code for access token. Please try again.' : err_1.message),
          toRetry: mode === 'setup-token' ? {
            state: 'ready_to_start'
          } : {
            state: 'idle'
          }
        });
        logEvent('tengu_oauth_token_exchange_error', {
          error: err_1.message,
          ssl_error: sslHint_0 !== null
        });
        throw err_1;
      });
      if (mode === 'setup-token') {
        // For setup-token mode, return the OAuth access token directly (it can be used as an API key)
        // Don't save to keychain - the token is displayed for manual use with CLAUDE_CODE_OAUTH_TOKEN
        setOAuthStatus({
          state: 'success',
          token: result.accessToken
        });
      } else {
        await installOAuthTokens(result);
        const orgResult = await validateForceLoginOrg();
        if (!orgResult.valid) {
          throw new Error(orgResult.message);
        }
        setOAuthStatus({
          state: 'success'
        });
        void sendNotification({
          message: 'Claude Code login successful',
          notificationType: 'auth_success'
        }, terminal);
      }
    } catch (err_0) {
      const errorMessage = (err_0 as Error).message;
      const sslHint = getSSLErrorHint(err_0);
      setOAuthStatus({
        state: 'error',
        message: sslHint ?? errorMessage,
        toRetry: {
          state: mode === 'setup-token' ? 'ready_to_start' : 'idle'
        }
      });
      logEvent('tengu_oauth_error', {
        error: errorMessage as AnalyticsMetadata_I_VERIFIED_THIS_IS_NOT_CODE_OR_FILEPATHS,
        ssl_error: sslHint !== null
      });
    }
  }, [oauthService, setShowPastePrompt, loginWithClaudeAi, mode, orgUUID]);
  const pendingOAuthStartRef = useRef(false);
  useEffect(() => {
    if (oauthStatus.state === 'ready_to_start' && !pendingOAuthStartRef.current) {
      pendingOAuthStartRef.current = true;
      process.nextTick((startOAuth_0: () => Promise<void>, pendingOAuthStartRef_0: React.MutableRefObject<boolean>) => {
        void startOAuth_0();
        pendingOAuthStartRef_0.current = false;
      }, startOAuth, pendingOAuthStartRef);
    }
  }, [oauthStatus.state, startOAuth]);

  // Auto-exit for setup-token mode
  useEffect(() => {
    if (mode === 'setup-token' && oauthStatus.state === 'success') {
      // Delay to ensure static content is fully rendered before exiting
      const timer_0 = setTimeout((loginWithClaudeAi_0, onDone_0) => {
        logEvent('tengu_oauth_success', {
          loginWithClaudeAi: loginWithClaudeAi_0
        });
        // Don't clear terminal so the token remains visible
        onDone_0();
      }, 500, loginWithClaudeAi, onDone);
      return () => clearTimeout(timer_0);
    }
  }, [mode, oauthStatus, loginWithClaudeAi, onDone]);

  // Cleanup OAuth service when component unmounts
  useEffect(() => {
    return () => {
      oauthService.cleanup();
    };
  }, [oauthService]);
  return <Box flexDirection="column" gap={1}>
      {oauthStatus.state === 'waiting_for_login' && showPastePrompt && <Box flexDirection="column" key="urlToCopy" gap={1} paddingBottom={1}>
          <Box paddingX={1}>
            <Text dimColor>
              Browser didn&apos;t open? Use the url below to sign in{' '}
            </Text>
            {urlCopied ? <Text color="success">(Copied!)</Text> : <Text dimColor>
                <KeyboardShortcutHint shortcut="c" action="copy" parens />
              </Text>}
          </Box>
          <Link url={oauthStatus.url}>
            <Text dimColor>{oauthStatus.url}</Text>
          </Link>
        </Box>}
      {mode === 'setup-token' && oauthStatus.state === 'success' && oauthStatus.token && <Box key="tokenOutput" flexDirection="column" gap={1} paddingTop={1}>
            <Text color="success">
              ✓ Long-lived authentication token created successfully!
            </Text>
            <Box flexDirection="column" gap={1}>
              <Text>Your OAuth token (valid for 1 year):</Text>
              <Text color="warning">{oauthStatus.token}</Text>
              <Text dimColor>
                Store this token securely. You won&apos;t be able to see it
                again.
              </Text>
              <Text dimColor>
                Use this token by setting: export
                CLAUDE_CODE_OAUTH_TOKEN=&lt;token&gt;
              </Text>
            </Box>
          </Box>}
      <Box paddingLeft={1} flexDirection="column" gap={1}>
        <OAuthStatusMessage oauthStatus={oauthStatus} mode={mode} startingMessage={startingMessage} forcedMethodMessage={forcedMethodMessage} showPastePrompt={showPastePrompt} pastedCode={pastedCode} setPastedCode={setPastedCode} cursorOffset={cursorOffset} setCursorOffset={setCursorOffset} textInputColumns={textInputColumns} handleSubmitCode={handleSubmitCode} setOAuthStatus={setOAuthStatus} setLoginWithClaudeAi={setLoginWithClaudeAi} />
      </Box>
    </Box>;
}
type OAuthStatusMessageProps = {
  oauthStatus: OAuthStatus;
  mode: 'login' | 'setup-token';
  startingMessage: string | undefined;
  forcedMethodMessage: string | null;
  showPastePrompt: boolean;
  pastedCode: string;
  setPastedCode: (value: string) => void;
  cursorOffset: number;
  setCursorOffset: (offset: number) => void;
  textInputColumns: number;
  handleSubmitCode: (value: string, url: string) => void;
  setOAuthStatus: (status: OAuthStatus) => void;
  setLoginWithClaudeAi: (value: boolean) => void;
};
function OAuthStatusMessage({
  oauthStatus,
  mode,
  startingMessage,
  forcedMethodMessage,
  showPastePrompt,
  pastedCode,
  setPastedCode,
  cursorOffset,
  setCursorOffset,
  textInputColumns,
  handleSubmitCode,
  setOAuthStatus,
  setLoginWithClaudeAi,
}: OAuthStatusMessageProps) {
  switch (oauthStatus.state) {
    case 'idle': {
      const promptText =
        startingMessage ||
        'Claude Code can be used with your Claude subscription or billed based on API usage through your Console account.'

      const loginOptions = [
        {
          label: (
            <Text>
              Claude account with subscription ·{' '}
              <Text dimColor>Pro, Max, Team, or Enterprise</Text>
              {'\n'}
            </Text>
          ),
          value: 'claudeai' as const,
        },
        {
          label: (
            <Text>
              Anthropic Console account ·{' '}
              <Text dimColor>API usage billing</Text>
              {'\n'}
            </Text>
          ),
          value: 'console' as const,
        },
        {
          label: (
            <Text>
              Google Gemini ·{' '}
              <Text dimColor>OAuth, API Key, or ADC</Text>
              {'\n'}
            </Text>
          ),
          value: 'gemini' as const,
        },
        {
          label: (
            <Text>
              3rd-party platform ·{' '}
              <Text dimColor>OpenAI, Gemini, Bedrock, Ollama, and more</Text>
              {'\n'}
            </Text>
          ),
          value: 'platform' as const,
        },
      ]

      return (
        <Box flexDirection="column" gap={1} marginTop={1}>
          <Text bold>{promptText}</Text>
          <Text>Select login method:</Text>
          <Box>
            <Select
              options={loginOptions}
              onChange={(value: string) => {
                if (value === 'gemini') {
                  logEvent('tengu_oauth_platform_selected', {})
                  setOAuthStatus({ state: 'gemini_setup' })
                  return
                }

                if (value === 'platform') {
                  logEvent('tengu_oauth_platform_selected', {})
                  setOAuthStatus({ state: 'platform_setup' })
                  return
                }

                setOAuthStatus({ state: 'ready_to_start' })
                if (value === 'claudeai') {
                  logEvent('tengu_oauth_claudeai_selected', {})
                  setLoginWithClaudeAi(true)
                } else {
                  logEvent('tengu_oauth_console_selected', {})
                  setLoginWithClaudeAi(false)
                }
              }}
            />
          </Box>
        </Box>
      )
    }

    case 'gemini_setup':
      return (
        <GeminiSetupView
          onDone={success => {
            if (success) {
              setOAuthStatus({
                state: 'platform_setup_complete',
                message: 'Gemini authentication successful. You can now use the Gemini provider.',
              })
            } else {
              setOAuthStatus({ state: 'idle' })
            }
          }}
          onCancel={() => setOAuthStatus({ state: 'idle' })}
        />
      )

    case 'platform_setup':
      return (
        <ProviderManager
          mode="first-run"
          onDone={result => {
            if (!result || result.action !== 'saved' || !result.message) {
              setOAuthStatus({ state: 'idle' })
              return
            }

            setOAuthStatus({
              state: 'platform_setup_complete',
              message: result.message,
            })
          }}
        />
      )

    case 'platform_setup_complete':
      return (
        <Box flexDirection="column" gap={1}>
          <Text color="success">{oauthStatus.message}</Text>
          <Text dimColor>
            Press <Text bold>Enter</Text> to continue.
          </Text>
        </Box>
      )

    case 'waiting_for_login':
      return (
        <Box flexDirection="column" gap={1}>
          {forcedMethodMessage ? (
            <Box>
              <Text dimColor>{forcedMethodMessage}</Text>
            </Box>
          ) : null}
          {!showPastePrompt ? (
            <Box>
              <Spinner />
              <Text>Opening browser to sign in…</Text>
            </Box>
          ) : null}
          {showPastePrompt ? (
            <Box>
              <Text>{PASTE_HERE_MSG}</Text>
              <TextInput
                value={pastedCode}
                onChange={setPastedCode}
                onSubmit={value => handleSubmitCode(value, oauthStatus.url)}
                cursorOffset={cursorOffset}
                onChangeCursorOffset={setCursorOffset}
                columns={textInputColumns}
                mask="*"
              />
            </Box>
          ) : null}
        </Box>
      )

    case 'creating_api_key':
      return (
        <Box flexDirection="column" gap={1}>
          <Box>
            <Spinner />
            <Text>Creating API key for Claude Code…</Text>
          </Box>
        </Box>
      )

    case 'about_to_retry':
      return (
        <Box flexDirection="column" gap={1}>
          <Text color="permission">Retrying…</Text>
        </Box>
      )

    case 'success':
      return (
        <Box flexDirection="column">
          {mode === 'setup-token' && oauthStatus.token ? null : (
            <>
              {getOauthAccountInfo()?.emailAddress ? (
                <Text dimColor>
                  Logged in as <Text>{getOauthAccountInfo()?.emailAddress}</Text>
                </Text>
              ) : null}
              <Text color="success">
                Login successful. Press <Text bold>Enter</Text> to continue…
              </Text>
            </>
          )}
        </Box>
      )

    case 'error':
      return (
        <Box flexDirection="column" gap={1}>
          <Text color="error">OAuth error: {oauthStatus.message}</Text>
          {oauthStatus.toRetry ? (
            <Box marginTop={1}>
              <Text color="permission">
                Press <Text bold>Enter</Text> to retry.
              </Text>
            </Box>
          ) : null}
        </Box>
      )

    default:
      return null
  }
}

function GeminiSetupView({
  onDone,
  onCancel,
}: {
  onDone: (success: boolean) => void
  onCancel: () => void
}) {
  const [method, setMethod] = useState<'menu' | 'api-key' | 'oauth'>('menu')
  const [apiKey, setApiKey] = useState('')
  const hasAdc = mayHaveGeminiAdcCredentials()

  const oauthStatus = useGeminiOAuthFlow({
    onAuthenticated: (tokens, persistCredentials) => {
      persistCredentials()
      process.env.GEMINI_AUTH_MODE = 'access-token'
      process.env.CLAUDE_CODE_USE_GEMINI = '1'
      onDone(true)
    },
  })

  if (method === 'api-key') {
    return (
      <Box flexDirection="column" gap={1}>
        <Text bold color="remember">Gemini API Key Setup</Text>
        <Text>Enter your Gemini API key:</Text>
        <TextInput
          value={apiKey}
          onChange={setApiKey}
          onSubmit={val => {
            if (val.trim()) {
              process.env.GEMINI_API_KEY = val.trim()
              process.env.GEMINI_AUTH_MODE = 'api-key'
              process.env.CLAUDE_CODE_USE_GEMINI = '1'
              onDone(true)
            }
          }}
          mask="*"
          columns={40}
          cursorOffset={0}
          onChangeCursorOffset={() => {}}
        />
        <Text dimColor>Press Esc to cancel.</Text>
      </Box>
    )
  }

  if (method === 'oauth') {
    return (
      <Box flexDirection="column" gap={1}>
        <Text bold color="remember">Gemini OAuth Setup</Text>
        {oauthStatus.state === 'starting' && <Text>Initializing OAuth...</Text>}
        {oauthStatus.state === 'waiting' && (
          <Box flexDirection="column" gap={1}>
            <Text>Opening browser to sign in...</Text>
            {'authUrl' in oauthStatus && oauthStatus.authUrl && (
              <Link url={oauthStatus.authUrl}>
                <Text dimColor>{oauthStatus.authUrl}</Text>
              </Link>
            )}
          </Box>
        )}
        {oauthStatus.state === 'error' && (
          <Box flexDirection="column" gap={1}>
            <Text color="error">Error: {oauthStatus.message}</Text>
            <Text dimColor>Press Esc to cancel.</Text>
          </Box>
        )}
      </Box>
    )
  }

  const options = [
    { label: 'Google Account (OAuth)', value: 'oauth', description: 'Sign in through your browser' },
    { label: 'API Key', value: 'api-key', description: 'Enter a Gemini API key manually' },
  ]
  if (hasAdc) {
    options.push({ label: 'Google ADC', value: 'adc', description: 'Use Application Default Credentials' })
  }
  options.push({ label: 'Back', value: 'back', description: 'Return to login options' })

  return (
    <Box flexDirection="column" gap={1}>
      <Text bold color="remember">Google Gemini Authentication</Text>
      <Text>Select how you want to authenticate with Gemini:</Text>
      <Select
        options={options as any}
        onChange={(val: string) => {
          if (val === 'back') onCancel()
          else if (val === 'adc') {
            process.env.GEMINI_AUTH_MODE = 'adc'
            process.env.CLAUDE_CODE_USE_GEMINI = '1'
            onDone(true)
          } else setMethod(val as 'api-key' | 'oauth')
        }}
        onCancel={onCancel}
      />
    </Box>
  )
}
