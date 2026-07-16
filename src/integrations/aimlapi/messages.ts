/** Canonical AIMLAPI onboarding copy ported from Zero. */

export const AIMLAPI_MESSAGES = {
  apiKeyInputPrompt: 'Enter your aimlapi.com key.',
  apiKeyHiddenHint: 'Your API key will be hidden and verified automatically.',
  apiKeyInvalid:
    'API key is invalid. Please make sure you enter a valid aimlapi.com key.',
  pickPathPrompt: 'Do you have aimlapi.com key?',
  pickPathHaveKey: 'I already have aimlapi.com key',
  pickPathNewUser: 'I am a new user',
  enterEmail: 'Enter your email.',
  emailInvalid: 'Email format is incorrect.',
  codeSent: (email: string) => `Enter the 6-digit code sent to ${email}.`,
  codeIncorrect: "Code you've entered is incorrect.",
  lowBalance: 'Your aimlapi.com credits are running low - top up now?',
  lowBalanceTopUp: "Sure, let's do that",
  lowBalanceSkip: "I'll skip for now",
  topUpPrompt: 'Add credits (min $20).',
  amountRequired: 'Please enter a top-up amount.',
  topUpBrowserFallback:
    'If the browser did not open automatically please use this link to top up your account:',
  topUpFailed: 'Top up failed. Please try again.',
  everythingRuns: 'Everything is ready.',
  topUpSuccess: (amountUsd: string) =>
    `Top-up successful - $${amountUsd} credited to your account`,
  successMagicLink: (email: string) =>
    `We've emailed you a magic link to ${email}. Use it to access your aimlapi.com account and review your usage.`,
} as const
