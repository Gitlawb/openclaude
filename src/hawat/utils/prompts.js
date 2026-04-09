/**
 * Prompts utility for Hawat CLI
 *
 * Wraps inquirer for consistent prompting across commands.
 */

import inquirer from 'inquirer';
import chalk from 'chalk';

/**
 * Prompt for confirmation
 * @param {string} message - The confirmation message
 * @param {boolean} [defaultValue=false] - Default value
 * @returns {Promise<boolean>}
 */
export async function confirm(message, defaultValue = false) {
  const { confirmed } = await inquirer.prompt([
    {
      type: 'confirm',
      name: 'confirmed',
      message,
      default: defaultValue
    }
  ]);
  return confirmed;
}

/**
 * Prompt for text input
 * @param {string} message - The prompt message
 * @param {object} [options] - Options
 * @param {string} [options.default] - Default value
 * @param {Function} [options.validate] - Validation function
 * @returns {Promise<string>}
 */
export async function input(message, options = {}) {
  const { answer } = await inquirer.prompt([
    {
      type: 'input',
      name: 'answer',
      message,
      default: options.default,
      validate: options.validate
    }
  ]);
  return answer;
}

/**
 * Prompt for selection from a list
 * @param {string} message - The prompt message
 * @param {Array<string|{name: string, value: any}>} choices - List of choices
 * @param {object} [options] - Options
 * @param {any} [options.default] - Default value
 * @returns {Promise<any>}
 */
export async function select(message, choices, options = {}) {
  const { answer } = await inquirer.prompt([
    {
      type: 'list',
      name: 'answer',
      message,
      choices,
      default: options.default
    }
  ]);
  return answer;
}

/**
 * Prompt for multiple selections
 * @param {string} message - The prompt message
 * @param {Array<string|{name: string, value: any, checked?: boolean}>} choices - List of choices
 * @returns {Promise<any[]>}
 */
export async function multiSelect(message, choices) {
  const { answers } = await inquirer.prompt([
    {
      type: 'checkbox',
      name: 'answers',
      message,
      choices
    }
  ]);
  return answers;
}

/**
 * Prompt for password/secret input
 * @param {string} message - The prompt message
 * @returns {Promise<string>}
 */
export async function password(message) {
  const { answer } = await inquirer.prompt([
    {
      type: 'password',
      name: 'answer',
      message,
      mask: '*'
    }
  ]);
  return answer;
}

/**
 * Prompt for project initialization details
 * @returns {Promise<object>} Project configuration object
 */
export async function projectInit() {
  const answers = await inquirer.prompt([
    {
      type: 'input',
      name: 'projectName',
      message: 'Project name:',
      default: process.cwd().split('/').pop(),
      validate: (input) => {
        if (!input.trim()) return 'Project name is required';
        return true;
      }
    },
    {
      type: 'input',
      name: 'description',
      message: 'Project description:',
      default: ''
    },
    {
      type: 'list',
      name: 'projectType',
      message: 'Project type:',
      choices: [
        { name: 'Node.js/JavaScript', value: 'node' },
        { name: 'TypeScript', value: 'typescript' },
        { name: 'Python', value: 'python' },
        { name: 'Go', value: 'go' },
        { name: 'Rust', value: 'rust' },
        { name: 'Other', value: 'other' }
      ],
      default: 'node'
    },
    {
      type: 'list',
      name: 'orchestrationLevel',
      message: 'Orchestration level:',
      choices: [
        { name: 'Minimal - Basic CLAUDE.md only', value: 'minimal' },
        { name: 'Standard - CLAUDE.md + settings + context', value: 'standard' },
        { name: 'Full - All features including hooks and scripts', value: 'full' }
      ],
      default: 'standard'
    },
    {
      type: 'list',
      name: 'codebaseMaturity',
      message: 'Codebase maturity level:',
      choices: [
        { name: 'Greenfield - New project, establishing patterns', value: 'GREENFIELD' },
        { name: 'Transitional - Mixed patterns, evolving (default)', value: 'TRANSITIONAL' },
        { name: 'Disciplined - High test coverage, consistent patterns', value: 'DISCIPLINED' },
        { name: 'Legacy - Technical debt, inconsistent patterns', value: 'LEGACY' }
      ],
      default: 'TRANSITIONAL'
    },
    {
      type: 'confirm',
      name: 'useHooks',
      message: 'Enable Forge hooks?',
      default: true,
      when: (answers) => answers.orchestrationLevel !== 'minimal'
    },
    {
      type: 'confirm',
      name: 'useAgentDelegation',
      message: 'Enable agent delegation?',
      default: true,
      when: (answers) => answers.orchestrationLevel === 'full'
    }
  ]);

  return answers;
}

/**
 * Show a message before prompting
 * @param {string} message - The message to show
 */
export function showMessage(message) {
  console.log();
  console.log(chalk.cyan(message));
  console.log();
}

/**
 * Prompt with a custom separator/section header
 * @param {string} title - Section title
 */
export function section(title) {
  console.log();
  console.log(chalk.bold.white('--- ' + title + ' ---'));
  console.log();
}

export default {
  confirm,
  input,
  select,
  multiSelect,
  password,
  projectInit,
  showMessage,
  section
};
