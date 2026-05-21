export class SDKRateLimitError extends Error {
  constructor(message = "Rate limited by API") {
    super(message);
    this.name = "SDKRateLimitError";
  }
}

export class SDKAuthenticationError extends Error {
  constructor(message = "Authentication failed") {
    super(message);
    this.name = "SDKAuthenticationError";
  }
}

export class SDKServerError extends Error {
  constructor(message = "Server error") {
    super(message);
    this.name = "SDKServerError";
  }
}

/**
 * Maps SDK errors to user-friendly Telegram messages.
 */
export function mapSDKError(err: unknown): string {
  if (err instanceof SDKRateLimitError) {
    return "API rate limited. Please wait a moment and try again.";
  }
  if (err instanceof SDKAuthenticationError) {
    return "Authentication error. Please check your API key configuration.";
  }
  if (err instanceof SDKServerError) {
    return "API server error. Please try again later.";
  }
  if (err instanceof Error) {
    return `Error: ${err.message}`;
  }
  return "An unknown error occurred.";
}
