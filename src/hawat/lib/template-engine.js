/**
 * Template Engine for Hawat CLI
 *
 * Handlebars-based template rendering with custom helpers and partials.
 */

import Handlebars from 'handlebars';
import { join } from 'path';
import { readFileSync } from 'fs';
import { readFile, listFiles, exists } from './file-manager.js';
import { PACKAGE_TEMPLATES_DIR, PACKAGE_ROOT } from '../utils/paths.js';
import { debug } from '../utils/logger.js';

/**
 * Default maximum input length in characters
 * @type {number}
 */
const DEFAULT_MAX_INPUT_LENGTH = 100000;

// Read package version at module load
let packageVersion = '1.0.0';
try {
  const packageJson = JSON.parse(readFileSync(join(PACKAGE_ROOT, 'package.json'), 'utf8'));
  packageVersion = packageJson.version || '1.0.0';
} catch {
  // Fallback to default version if package.json can't be read
}

// Create a separate Handlebars instance to avoid polluting global
const hbs = Handlebars.create();

// Track registered partials
const registeredPartials = new Set();

/**
 * Validate that input data doesn't exceed the maximum allowed length.
 * @param {*} data - Input data to validate (any JSON-serializable type)
 * @param {Object} options - Validation options
 * @param {number} [options.maxLength=100000] - Maximum allowed length in characters
 * @throws {Error} If input exceeds maxLength with descriptive message
 * @returns {boolean} True if validation passes
 */
export function validateInputLength(data, options = {}) {
  const { maxLength = DEFAULT_MAX_INPUT_LENGTH } = options;

  if (typeof maxLength !== 'number' || maxLength < 1) {
    throw new Error(`maxLength must be a positive number, got: ${maxLength}`);
  }

  if (data === null || data === undefined) {
    return true;
  }

  let serialized;
  try {
    serialized = typeof data === 'string' ? data : JSON.stringify(data);
  } catch (err) {
    throw new Error(`Input data is not serializable: ${err.message}`);
  }

  const inputLength = serialized.length;

  if (inputLength > maxLength) {
    throw new Error(
      `Input data exceeds maximum allowed length. ` +
      `Got ${inputLength.toLocaleString()} characters, maximum is ${maxLength.toLocaleString()}.`
    );
  }

  return true;
}

/**
 * Get the default maximum input length
 * @returns {number} The default maximum input length in characters
 */
export function getDefaultMaxInputLength() {
  return DEFAULT_MAX_INPUT_LENGTH;
}

/**
 * Validate that a string is valid JSON
 * @param {string} content - String content to validate as JSON
 * @returns {{valid: boolean, error?: string, parsed?: object}} Validation result
 */
export function validateJson(content) {
  if (typeof content !== 'string') {
    return {
      valid: false,
      error: 'Content must be a string'
    };
  }

  try {
    const parsed = JSON.parse(content);
    return {
      valid: true,
      parsed
    };
  } catch (err) {
    return {
      valid: false,
      error: err.message
    };
  }
}

/**
 * Register custom Handlebars helpers
 */
function registerHelpers() {
  // Conditional helper: {{#if-eq a b}}
  hbs.registerHelper('if-eq', function (a, b, options) {
    return a === b ? options.fn(this) : options.inverse(this);
  });

  // Not equal: {{#if-ne a b}}
  hbs.registerHelper('if-ne', function (a, b, options) {
    return a !== b ? options.fn(this) : options.inverse(this);
  });

  // Greater than: {{#if-gt a b}}
  hbs.registerHelper('if-gt', function (a, b, options) {
    return a > b ? options.fn(this) : options.inverse(this);
  });

  // Contains: {{#if-contains array value}}
  hbs.registerHelper('if-contains', function (array, value, options) {
    if (!Array.isArray(array)) return options.inverse(this);
    return array.includes(value) ? options.fn(this) : options.inverse(this);
  });

  // Current date: {{current-date}}
  hbs.registerHelper('current-date', function () {
    return new Date().toISOString().split('T')[0];
  });

  // Current timestamp: {{current-timestamp}}
  hbs.registerHelper('current-timestamp', function () {
    return new Date().toISOString();
  });

  // JSON stringify: {{json-stringify obj}}
  hbs.registerHelper('json-stringify', function (obj) {
    return JSON.stringify(obj, null, 2);
  });

  // Uppercase: {{uppercase str}}
  hbs.registerHelper('uppercase', function (str) {
    return str ? str.toUpperCase() : '';
  });

  // Lowercase: {{lowercase str}}
  hbs.registerHelper('lowercase', function (str) {
    return str ? str.toLowerCase() : '';
  });

  // Capitalize: {{capitalize str}}
  hbs.registerHelper('capitalize', function (str) {
    if (!str) return '';
    return str.charAt(0).toUpperCase() + str.slice(1);
  });

  // Kebab case: {{kebab-case str}}
  hbs.registerHelper('kebab-case', function (str) {
    if (!str) return '';
    return str
      .replace(/([a-z])([A-Z])/g, '$1-$2')
      .replace(/[\s_]+/g, '-')
      .toLowerCase();
  });

  // Each with index: {{#each-index array}}{{@index}} {{this}}{{/each-index}}
  hbs.registerHelper('each-index', function (array, options) {
    if (!Array.isArray(array)) return '';
    return array.map((item, index) =>
      options.fn(item, { data: { index, first: index === 0, last: index === array.length - 1 } })
    ).join('');
  });

  // Repeat: {{#repeat n}}content{{/repeat}}
  hbs.registerHelper('repeat', function (n, options) {
    let result = '';
    for (let i = 0; i < n; i++) {
      result += options.fn(this);
    }
    return result;
  });

  // Default value: {{default value fallback}}
  hbs.registerHelper('default', function (value, defaultValue) {
    return value !== undefined && value !== null && value !== '' ? value : defaultValue;
  });

  // Join array: {{join array separator}}
  hbs.registerHelper('join', function (array, separator) {
    if (!Array.isArray(array)) return '';
    return array.join(separator || ', ');
  });

  // Indent: {{indent content spaces}}
  hbs.registerHelper('indent', function (content, spaces) {
    if (!content) return '';
    const indent = ' '.repeat(spaces || 2);
    return content.split('\n').map(line => indent + line).join('\n');
  });

  debug('Registered Handlebars helpers');
}

/**
 * Load and register all partials from the partials directory
 * @param {string} [partialsDir] - Path to partials directory
 * @returns {Promise<void>}
 */
export async function loadPartials(partialsDir) {
  const dir = partialsDir || join(PACKAGE_TEMPLATES_DIR, 'partials');

  if (!await exists(dir)) {
    debug(`No partials directory found at: ${dir}`);
    return;
  }

  const { files: partialFiles } = await listFiles(dir, { extensions: ['.hbs'] });

  for (const filePath of partialFiles) {
    const name = filePath.split('/').pop().replace('.hbs', '');
    if (!registeredPartials.has(name)) {
      const content = await readFile(filePath);
      hbs.registerPartial(name, content);
      registeredPartials.add(name);
      debug(`Registered partial: ${name}`);
    }
  }
}

/**
 * Register a single partial
 * @param {string} name - Partial name
 * @param {string} content - Partial content
 */
export function registerPartial(name, content) {
  hbs.registerPartial(name, content);
  registeredPartials.add(name);
  debug(`Registered partial: ${name}`);
}

/**
 * Register a Handlebars helper function
 * @param {string} name - Name of the helper
 * @param {Function} fn - Helper function
 */
export function registerHelper(name, fn) {
  hbs.registerHelper(name, fn);
}

/**
 * Sanitize user-provided string for safe template rendering
 * Escapes Handlebars special characters that could execute code
 * @param {string} input - User input to sanitize
 * @returns {string} - Sanitized string safe for template context
 */
function sanitizeTemplateInput(input) {
  if (typeof input !== 'string') return input;
  // Escape Handlebars special sequences
  // Order matters: escape triple braces before double braces
  return input
    .replace(/\{\{\{/g, '&#123;&#123;&#123;')  // Triple opening braces
    .replace(/\}\}\}/g, '&#125;&#125;&#125;')  // Triple closing braces
    .replace(/\{\{/g, '&#123;&#123;')          // Double opening braces
    .replace(/\}\}/g, '&#125;&#125;');         // Double closing braces
}

/**
 * Recursively sanitize all string values in an object
 * @param {*} data - Template context data
 * @returns {*} - Sanitized data object
 */
export function sanitizeTemplateData(data) {
  if (typeof data !== 'object' || data === null) {
    return typeof data === 'string' ? sanitizeTemplateInput(data) : data;
  }

  const sanitized = Array.isArray(data) ? [] : {};
  for (const key of Object.keys(data)) {
    sanitized[key] = sanitizeTemplateData(data[key]);
  }
  return sanitized;
}

/**
 * Compile a template string
 * @param {string} template - The template string
 * @returns {HandlebarsTemplateDelegate}
 */
export function compile(template) {
  return hbs.compile(template);
}

/**
 * Render a template string with data
 * @param {string} template - The template string
 * @param {object} data - Data to render with
 * @param {object} [options] - Render options
 * @param {boolean} [options.sanitize=true] - Whether to sanitize user input (default: true)
 * @returns {string}
 */
export function render(template, data = {}, options = {}) {
  const { sanitize = true } = options;
  const safeData = sanitize ? sanitizeTemplateData(data) : data;
  const compiled = compile(template);
  return compiled(safeData);
}

/**
 * Load and render a template file
 * @param {string} templatePath - Path to the template file
 * @param {object} data - Data to render with
 * @param {object} [options] - Render options
 * @param {boolean} [options.sanitize=true] - Whether to sanitize user input (default: true)
 * @returns {Promise<string>}
 */
export async function renderFile(templatePath, data = {}, options = {}) {
  const template = await readFile(templatePath);
  return render(template, data, options);
}

/**
 * Load and render a template file with context data.
 * @param {string} templatePath - Path to the template file
 * @param {Object} context - Data context for template rendering
 * @param {Object} options - Rendering options
 * @param {number} [options.maxInputLength=100000] - Maximum input length
 * @param {boolean} [options.validateInput=true] - Whether to validate input length
 * @returns {Promise<string>} Rendered template output
 */
export async function renderTemplateFile(templatePath, context = {}, options = {}) {
  const {
    maxInputLength = DEFAULT_MAX_INPUT_LENGTH,
    validateInput = true
  } = options;

  // Validate input length if enabled
  if (validateInput) {
    validateInputLength(context, { maxLength: maxInputLength });
  }

  // Read template file
  let templateContent;
  try {
    templateContent = await readFile(templatePath);
  } catch (err) {
    throw new Error(`Failed to read template file: ${templatePath} (${err.message})`);
  }

  return renderTemplate(templateContent, context, { validateInput: false });
}

/**
 * Render a Handlebars template with context data.
 * Validates input length before rendering.
 * @param {string} templateContent - Handlebars template string
 * @param {Object} context - Data context for template rendering
 * @param {Object} options - Rendering options
 * @param {number} [options.maxInputLength=100000] - Maximum input length
 * @param {boolean} [options.validateInput=true] - Whether to validate input length
 * @returns {string} Rendered template output
 */
export function renderTemplate(templateContent, context = {}, options = {}) {
  const {
    maxInputLength = DEFAULT_MAX_INPUT_LENGTH,
    validateInput = true
  } = options;

  if (typeof templateContent !== 'string') {
    throw new Error('Template content must be a string');
  }

  if (validateInput) {
    validateInputLength(context, { maxLength: maxInputLength });
  }

  const compiled = hbs.compile(templateContent);
  return compiled(context);
}

/**
 * Load and render a template by name from the templates directory
 * @param {string} templateName - Template name (with or without .hbs extension)
 * @param {object} data - Data to render with
 * @param {object} [options] - Render options
 * @param {string} [options.templatesDir] - Optional templates directory
 * @param {boolean} [options.sanitize=true] - Whether to sanitize user input (default: true)
 * @returns {Promise<string>}
 */
export async function renderNamedTemplate(templateName, data = {}, options = {}) {
  // Support legacy third argument as templatesDir string
  const resolvedOptions = typeof options === 'string'
    ? { templatesDir: options }
    : options;
  const { templatesDir, sanitize = true } = resolvedOptions;

  const dir = templatesDir || PACKAGE_TEMPLATES_DIR;
  const name = templateName.endsWith('.hbs') ? templateName : `${templateName}.hbs`;
  const templatePath = join(dir, name);

  // Ensure partials are loaded
  await loadPartials(join(dir, 'partials'));

  return renderFile(templatePath, data, { sanitize });
}

/**
 * Get default template data with common values
 * @param {object} [overrides] - Values to override defaults
 * @returns {object}
 */
export function getDefaultData(overrides = {}) {
  return {
    date: new Date().toISOString().split('T')[0],
    timestamp: new Date().toISOString(),
    year: new Date().getFullYear(),
    version: packageVersion,
    ...overrides
  };
}

/**
 * List available templates
 * @param {string} [templatesDir] - Templates directory
 * @returns {Promise<string[]>}
 */
export async function listTemplates(templatesDir) {
  const dir = templatesDir || PACKAGE_TEMPLATES_DIR;
  const { files } = await listFiles(dir, { extensions: ['.hbs'] });
  return files.map(f => f.split('/').pop().replace('.hbs', ''));
}

/**
 * Check if a template exists
 * @param {string} templateName - Template name
 * @param {string} [templatesDir] - Templates directory
 * @returns {Promise<boolean>}
 */
export async function templateExists(templateName, templatesDir) {
  const dir = templatesDir || PACKAGE_TEMPLATES_DIR;
  const name = templateName.endsWith('.hbs') ? templateName : `${templateName}.hbs`;
  return exists(join(dir, name));
}

/**
 * Render a JSON template and validate the output.
 * @param {string} templateContent - Handlebars template string
 * @param {Object} context - Data context for template rendering
 * @param {Object} options - Rendering options
 * @param {number} [options.maxInputLength=100000] - Maximum input length
 * @param {Object} [options.fallback=null] - Fallback object if JSON validation fails
 * @returns {{output: string, parsed: Object|null, usedFallback: boolean, error?: string}}
 */
export function renderJsonTemplate(templateContent, context = {}, options = {}) {
  const {
    maxInputLength = DEFAULT_MAX_INPUT_LENGTH,
    fallback = null
  } = options;

  let output;
  try {
    validateInputLength(context, { maxLength: maxInputLength });
    output = render(templateContent, context);
  } catch (err) {
    if (fallback !== null) {
      return {
        output: JSON.stringify(fallback, null, 2),
        parsed: fallback,
        usedFallback: true,
        error: err.message
      };
    }
    throw err;
  }

  const validation = validateJson(output);

  if (!validation.valid) {
    if (fallback !== null) {
      return {
        output: JSON.stringify(fallback, null, 2),
        parsed: fallback,
        usedFallback: true,
        error: validation.error
      };
    }
    throw new Error(`Rendered template is not valid JSON: ${validation.error}`);
  }

  return {
    output,
    parsed: validation.parsed,
    usedFallback: false
  };
}

// Initialize helpers on module load
registerHelpers();

export default {
  loadPartials,
  registerPartial,
  registerHelper,
  compile,
  render,
  renderFile,
  renderTemplateFile,
  renderTemplate,
  getDefaultData,
  listTemplates,
  templateExists,
  sanitizeTemplateData,
  validateInputLength,
  getDefaultMaxInputLength,
  validateJson,
  renderJsonTemplate
};
