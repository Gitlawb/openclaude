/**
 * Template Engine Tests
 *
 * Tests for template-engine.js library functions including:
 * - MED-8: validateInputLength() input validation
 * - validateJson() JSON validation
 * - renderTemplate() and renderJsonTemplate()
 */


import { join, dirname } from 'path';
import { fileURLToPath } from 'url';
import { tmpdir } from 'os';
import fs from 'fs-extra';

// Import functions under test
import {
  validateInputLength,
  getDefaultMaxInputLength,
  validateJson,
  renderTemplate,
  renderTemplateFile,
  registerPartial,
  registerHelper,
  renderJsonTemplate
} from '../lib/template-engine.js';

// Get the directory of this test file
const __dirname = dirname(fileURLToPath(import.meta.url));

// Test directory setup
const TEST_BASE = join(tmpdir(), 'forge-template-engine-test');
let testDir;

/**
 * Create a unique test directory for each test
 */
function createTestDir() {
  const uniqueId = `${Date.now()}-${Math.random().toString(36).substr(2, 9)}`;
  return join(TEST_BASE, uniqueId);
}

beforeAll(async () => {
  await fs.ensureDir(TEST_BASE);
});

beforeEach(async () => {
  testDir = createTestDir();
  await fs.ensureDir(testDir);
});

afterEach(async () => {
  if (testDir && await fs.pathExists(testDir)) {
    await fs.remove(testDir);
  }
});

afterAll(async () => {
  if (await fs.pathExists(TEST_BASE)) {
    await fs.remove(TEST_BASE);
  }
});

describe('Template Engine', () => {
  describe('getDefaultMaxInputLength()', () => {
    it('should return default max input length of 100000', () => {
      expect(getDefaultMaxInputLength()).toBe(100000);
    });
  });

  describe('validateInputLength() - MED-8', () => {
    describe('valid input', () => {
      it('should accept null input', () => {
        expect(validateInputLength(null)).toBe(true);
      });

      it('should accept undefined input', () => {
        expect(validateInputLength(undefined)).toBe(true);
      });

      it('should accept empty string', () => {
        expect(validateInputLength('')).toBe(true);
      });

      it('should accept empty object', () => {
        expect(validateInputLength({})).toBe(true);
      });

      it('should accept empty array', () => {
        expect(validateInputLength([])).toBe(true);
      });

      it('should accept string under limit', () => {
        const input = 'a'.repeat(1000);
        expect(validateInputLength(input)).toBe(true);
      });

      it('should accept object under limit', () => {
        const input = { key: 'value', number: 42 };
        expect(validateInputLength(input)).toBe(true);
      });

      it('should accept nested object under limit', () => {
        const input = {
          level1: {
            level2: {
              level3: { data: 'value' }
            }
          }
        };
        expect(validateInputLength(input)).toBe(true);
      });

      it('should accept string at exactly the limit', () => {
        const input = 'a'.repeat(100000);
        expect(validateInputLength(input)).toBe(true);
      });

      it('should use custom maxLength', () => {
        const input = 'a'.repeat(500);
        expect(validateInputLength(input, { maxLength: 1000 })).toBe(true);
      });
    });

    describe('oversized input rejection (MED-8)', () => {
      it('should reject string exceeding default limit', () => {
        const input = 'a'.repeat(100001);

        expect(() => validateInputLength(input)).toThrow('exceeds maximum allowed length');
      });

      it('should reject object exceeding default limit', () => {
        // Create large object
        const input = { data: 'x'.repeat(100000) };

        expect(() => validateInputLength(input)).toThrow('exceeds maximum allowed length');
      });

      it('should reject input exceeding custom maxLength', () => {
        const input = 'a'.repeat(101);

        expect(() => validateInputLength(input, { maxLength: 100 }))
          .toThrow('exceeds maximum allowed length');
      });

      it('should include input size in error message', () => {
        const input = 'a'.repeat(200);

        expect(() => validateInputLength(input, { maxLength: 100 }))
          .toThrow('200');
      });

      it('should include max length in error message', () => {
        const input = 'a'.repeat(200);

        expect(() => validateInputLength(input, { maxLength: 100 }))
          .toThrow('100');
      });

      it('should NOT include preview in error message (MED-5 security fix)', () => {
        const input = 'abcdefghij'.repeat(20);

        // MED-5: Error messages should not include data previews to avoid sensitive data exposure
        expect(() => validateInputLength(input, { maxLength: 100 }))
          .not.toThrow('Preview:');
      });
    });

    describe('invalid maxLength parameter', () => {
      it('should throw error for maxLength of 0', () => {
        expect(() => validateInputLength('test', { maxLength: 0 }))
          .toThrow('maxLength must be a positive number');
      });

      it('should throw error for negative maxLength', () => {
        expect(() => validateInputLength('test', { maxLength: -100 }))
          .toThrow('maxLength must be a positive number');
      });

      it('should throw error for non-numeric maxLength', () => {
        expect(() => validateInputLength('test', { maxLength: 'invalid' }))
          .toThrow('maxLength must be a positive number');
      });
    });

    describe('non-serializable input', () => {
      it('should throw error for circular references', () => {
        const circular = { name: 'test' };
        circular.self = circular;

        expect(() => validateInputLength(circular))
          .toThrow('not serializable');
      });

      it('should throw error for BigInt values', () => {
        const input = { value: BigInt(9007199254740991) };

        expect(() => validateInputLength(input))
          .toThrow('not serializable');
      });
    });
  });

  describe('validateJson()', () => {
    describe('valid JSON', () => {
      it('should validate empty object', () => {
        const result = validateJson('{}');
        expect(result.valid).toBe(true);
        expect(result.parsed).toEqual({});
      });

      it('should validate empty array', () => {
        const result = validateJson('[]');
        expect(result.valid).toBe(true);
        expect(result.parsed).toEqual([]);
      });

      it('should validate complex object', () => {
        const input = JSON.stringify({
          name: 'test',
          count: 42,
          nested: { key: 'value' },
          array: [1, 2, 3]
        });

        const result = validateJson(input);
        expect(result.valid).toBe(true);
        expect(result.parsed.name).toBe('test');
        expect(result.parsed.count).toBe(42);
      });

      it('should validate JSON with unicode', () => {
        const result = validateJson('{"emoji": "\ud83d\ude80", "text": "\u4e2d\u6587"}');
        expect(result.valid).toBe(true);
      });

      it('should validate JSON with special characters', () => {
        const result = validateJson('{"path": "C:\\\\Users\\\\test"}');
        expect(result.valid).toBe(true);
      });
    });

    describe('invalid JSON', () => {
      it('should reject non-string input', () => {
        const result = validateJson({});
        expect(result.valid).toBe(false);
        expect(result.error).toBe('Content must be a string');
      });

      it('should reject null input', () => {
        const result = validateJson(null);
        expect(result.valid).toBe(false);
        expect(result.error).toBe('Content must be a string');
      });

      it('should reject malformed JSON - missing quote', () => {
        const result = validateJson('{"key: "value"}');
        expect(result.valid).toBe(false);
        expect(result.error).toBeDefined();
      });

      it('should reject malformed JSON - trailing comma', () => {
        const result = validateJson('{"key": "value",}');
        expect(result.valid).toBe(false);
      });

      it('should reject plain text', () => {
        const result = validateJson('not json at all');
        expect(result.valid).toBe(false);
      });

      it('should reject empty string', () => {
        const result = validateJson('');
        expect(result.valid).toBe(false);
      });

      it('should reject single quotes', () => {
        const result = validateJson("{'key': 'value'}");
        expect(result.valid).toBe(false);
      });
    });
  });

  describe('renderTemplate()', () => {
    describe('basic rendering', () => {
      it('should render simple variable substitution', () => {
        const result = renderTemplate('Hello {{name}}!', { name: 'World' });
        expect(result).toBe('Hello World!');
      });

      it('should render multiple variables', () => {
        const result = renderTemplate('{{greeting}} {{name}}!', {
          greeting: 'Hello',
          name: 'World'
        });
        expect(result).toBe('Hello World!');
      });

      it('should handle missing variables gracefully', () => {
        const result = renderTemplate('Hello {{name}}!', {});
        expect(result).toBe('Hello !');
      });

      it('should render nested object properties', () => {
        const result = renderTemplate('{{user.name}}', {
          user: { name: 'Alice' }
        });
        expect(result).toBe('Alice');
      });

      it('should render with default empty context', () => {
        const result = renderTemplate('Static content');
        expect(result).toBe('Static content');
      });
    });

    describe('input validation integration (MED-8)', () => {
      it('should validate input by default', () => {
        const largeContext = { data: 'x'.repeat(100001) };

        expect(() => renderTemplate('{{data}}', largeContext))
          .toThrow('exceeds maximum allowed length');
      });

      it('should skip validation when disabled', () => {
        const largeContext = { data: 'x'.repeat(100001) };

        // Should not throw
        const result = renderTemplate('{{data}}', largeContext, {
          validateInput: false
        });
        expect(result.length).toBeGreaterThan(100000);
      });

      it('should respect custom maxInputLength', () => {
        const context = { data: 'x'.repeat(500) };

        expect(() => renderTemplate('{{data}}', context, { maxInputLength: 100 }))
          .toThrow('exceeds maximum allowed length');
      });
    });

    describe('error handling', () => {
      it('should throw for non-string template', () => {
        expect(() => renderTemplate(123, {}))
          .toThrow('Template content must be a string');
      });

      it('should throw for null template', () => {
        expect(() => renderTemplate(null, {}))
          .toThrow('Template content must be a string');
      });
    });

    describe('Handlebars features', () => {
      it('should support #if helper', () => {
        const result = renderTemplate(
          '{{#if show}}visible{{/if}}',
          { show: true }
        );
        expect(result).toBe('visible');
      });

      it('should support #each helper', () => {
        const result = renderTemplate(
          '{{#each items}}{{this}}{{/each}}',
          { items: ['a', 'b', 'c'] }
        );
        expect(result).toBe('abc');
      });

      it('should support #unless helper', () => {
        const result = renderTemplate(
          '{{#unless hidden}}shown{{/unless}}',
          { hidden: false }
        );
        expect(result).toBe('shown');
      });
    });
  });

  describe('renderTemplateFile()', () => {
    it('should render template from file', async () => {
      const templatePath = join(testDir, 'template.hbs');
      await fs.writeFile(templatePath, 'Hello {{name}}!');

      const result = await renderTemplateFile(templatePath, { name: 'World' });
      expect(result).toBe('Hello World!');
    });

    it('should throw for missing file', async () => {
      await expect(renderTemplateFile(join(testDir, 'missing.hbs'), {}))
        .rejects.toThrow('Failed to read template file');
    });

    it('should validate input length', async () => {
      const templatePath = join(testDir, 'template.hbs');
      await fs.writeFile(templatePath, '{{data}}');

      const largeContext = { data: 'x'.repeat(100001) };

      await expect(renderTemplateFile(templatePath, largeContext))
        .rejects.toThrow('exceeds maximum allowed length');
    });
  });

  describe('registerPartial() and registerHelper()', () => {
    it('should register and use a partial', () => {
      registerPartial('greeting', 'Hello {{name}}!');

      const result = renderTemplate('{{> greeting}}', { name: 'World' });
      expect(result).toBe('Hello World!');
    });

    it('should register and use a helper', () => {
      registerHelper('uppercase', (str) => str.toUpperCase());

      const result = renderTemplate('{{uppercase name}}', { name: 'hello' });
      expect(result).toBe('HELLO');
    });
  });

  describe('renderJsonTemplate()', () => {
    describe('successful rendering', () => {
      it('should render valid JSON template', () => {
        const result = renderJsonTemplate(
          '{"name": "{{name}}"}',
          { name: 'test' }
        );

        expect(result.valid || result.usedFallback === false).toBeTruthy();
        expect(result.parsed.name).toBe('test');
        expect(result.usedFallback).toBe(false);
      });

      it('should handle complex JSON templates', () => {
        const template = `{
          "name": "{{name}}",
          "count": {{count}},
          "enabled": {{enabled}}
        }`;

        const result = renderJsonTemplate(template, {
          name: 'test',
          count: 42,
          enabled: true
        });

        expect(result.usedFallback).toBe(false);
        expect(result.parsed.name).toBe('test');
        expect(result.parsed.count).toBe(42);
        expect(result.parsed.enabled).toBe(true);
      });
    });

    describe('fallback behavior', () => {
      it('should use fallback when template produces invalid JSON', () => {
        const fallback = { default: true };

        // Use trailing comma to produce invalid JSON (renders fine, but invalid JSON)
        const result = renderJsonTemplate(
          '{"key": "{{value}}",}',
          { value: 'test' },
          { fallback }
        );

        expect(result.usedFallback).toBe(true);
        expect(result.parsed).toEqual(fallback);
        expect(result.error).toBeDefined();
      });

      it('should use fallback when input validation fails', () => {
        const fallback = { default: true };
        const largeContext = { data: 'x'.repeat(100001) };

        const result = renderJsonTemplate(
          '{"data": "{{data}}"}',
          largeContext,
          { fallback }
        );

        expect(result.usedFallback).toBe(true);
        expect(result.parsed).toEqual(fallback);
      });

      it('should throw when no fallback and invalid JSON', () => {
        // Use a template that renders but produces invalid JSON
        // (trailing comma makes it invalid)
        expect(() => renderJsonTemplate(
          '{"key": "{{value}}",}',
          { value: 'test' }  // Will produce {"key": "test",} which is invalid JSON
        )).toThrow('not valid JSON');
      });
    });

    describe('edge cases', () => {
      it('should handle empty context', () => {
        const result = renderJsonTemplate('{"static": "value"}', {});
        expect(result.parsed.static).toBe('value');
      });

      it('should handle JSON arrays', () => {
        const result = renderJsonTemplate(
          '[{"name": "{{name}}"}]',
          { name: 'test' }
        );

        expect(Array.isArray(result.parsed)).toBe(true);
        expect(result.parsed[0].name).toBe('test');
      });

      it('should handle escaped quotes in values', () => {
        const result = renderJsonTemplate(
          '{"message": "Hello \\"World\\""}',
          {}
        );

        expect(result.parsed.message).toBe('Hello "World"');
      });
    });
  });
});
