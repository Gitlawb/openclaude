/**
 * Logger utility for Hawat CLI
 *
 * Provides chalk-based colored console output for consistent messaging.
 */

import chalk from 'chalk';

const SENSITIVE_PATTERNS = [
  /\.env/i,
  /credentials?/i,
  /secret/i,
  /\.ssh/i,
  /\.aws/i,
  /\.pem/i,
  /\.key/i,
  /id_rsa/i,
  /id_ed25519/i,
  /kubeconfig/i,
  /\.tfvars/i,
  /\.tfstate/i
];

const SENSITIVE_KEYS = [
  'password',
  'secret',
  'token',
  'key',
  'credential',
  'env'
];

function redactString(value) {
  if (SENSITIVE_PATTERNS.some(pattern => pattern.test(value))) {
    return '[REDACTED]';
  }
  return value;
}

function redactValue(value, seen = new WeakSet()) {
  if (typeof value === 'string') {
    return redactString(value);
  }
  if (value === null || value === undefined) {
    return value;
  }
  if (typeof value !== 'object') {
    return value;
  }
  if (value === process.env) {
    return '[REDACTED]';
  }
  if (value instanceof Error) {
    return {
      name: value.name,
      message: redactString(value.message || '')
    };
  }
  if (seen.has(value)) {
    return '[REDACTED]';
  }
  seen.add(value);

  if (Array.isArray(value)) {
    return value.map(item => redactValue(item, seen));
  }

  const redacted = {};
  for (const [key, val] of Object.entries(value)) {
    const lowerKey = key.toLowerCase();
    if (SENSITIVE_KEYS.some(token => lowerKey.includes(token))) {
      redacted[key] = '[REDACTED]';
      continue;
    }
    redacted[key] = redactValue(val, seen);
  }
  return redacted;
}

/**
 * Log an info message
 * @param {string} message - The message to log
 * @param {...any} args - Additional arguments
 */
export function info(message, ...args) {
  console.log(chalk.blue('i'), message, ...args);
}

/**
 * Log a success message
 * @param {string} message - The message to log
 * @param {...any} args - Additional arguments
 */
export function success(message, ...args) {
  console.log(chalk.green('v'), message, ...args);
}

/**
 * Log a warning message
 * @param {string} message - The message to log
 * @param {...any} args - Additional arguments
 */
export function warn(message, ...args) {
  console.log(chalk.yellow('!'), message, ...args);
}

/**
 * Log an error message
 * @param {string} message - The message to log
 * @param {...any} args - Additional arguments
 */
export function error(message, ...args) {
  console.error(chalk.red('x'), message, ...args);
}

/**
 * Log a step in a process
 * @param {number} step - Step number
 * @param {number} total - Total steps
 * @param {string} message - The message to log
 */
export function step(step, total, message) {
  console.log(chalk.cyan(`[${step}/${total}]`), message);
}

/**
 * Log a heading/title
 * @param {string} title - The title to display
 */
export function title(title) {
  console.log();
  console.log(chalk.bold.white(title));
  console.log(chalk.gray('-'.repeat(title.length)));
}

/**
 * Log a debug message (only if DEBUG env var is set)
 * @param {string} message - The message to log
 * @param {...any} args - Additional arguments
 */
export function debug(message, ...args) {
  if (process.env.DEBUG || process.env.HAWAT_DEBUG) {
    const safeMessage = redactValue(message);
    const safeArgs = args.map(arg => redactValue(arg));
    console.log(chalk.gray('[debug]'), safeMessage, ...safeArgs);
  }
}

/**
 * Log a dimmed/secondary message
 * @param {string} message - The message to log
 * @param {...any} args - Additional arguments
 */
export function dim(message, ...args) {
  console.log(chalk.dim(message), ...args);
}

/**
 * Format a list of items for display
 * @param {string[]} items - Array of items to display
 * @param {string} [bullet='-'] - Bullet character to use
 */
export function list(items, bullet = '-') {
  for (const item of items) {
    console.log(chalk.gray(`  ${bullet}`), item);
  }
}

export default {
  info,
  success,
  warn,
  error,
  step,
  title,
  debug,
  dim,
  list
};
