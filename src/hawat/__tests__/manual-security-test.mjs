#!/usr/bin/env node
/**
 * Manual Security Verification Script
 * Tests path traversal and command injection protection
 */

import { validatePath, writeFile, writeJson, copyFile, copyDir } from '../lib/file-manager.js';
import { mkdtemp, rm } from 'fs/promises';
import { tmpdir } from 'os';
import { join } from 'path';

const results = {
  passed: 0,
  failed: 0,
  tests: []
};

function test(name, fn) {
  const result = { name, status: 'pending' };
  results.tests.push(result);

  return fn()
    .then(() => {
      result.status = 'passed';
      results.passed++;
      console.log(`✅ PASS: ${name}`);
    })
    .catch((err) => {
      result.status = 'failed';
      result.error = err.message;
      results.failed++;
      console.log(`❌ FAIL: ${name} - ${err.message}`);
    });
}

async function expectThrows(fn, expectedMessage) {
  let threw = false;
  let message = '';

  try {
    await fn();
  } catch (e) {
    threw = true;
    message = e.message;
  }

  if (!threw) {
    throw new Error('Expected function to throw, but it did not');
  }

  if (expectedMessage && !message.includes(expectedMessage)) {
    throw new Error(`Expected error containing "${expectedMessage}", got "${message}"`);
  }
}

async function runTests() {
  console.log('\n🔒 SECURITY VERIFICATION - PATH TRAVERSAL TESTS\n');
  console.log('=' .repeat(60));

  // Create temp directory for tests
  const tempDir = await mkdtemp(join(tmpdir(), 'security-test-'));
  console.log(`\nTest directory: ${tempDir}\n`);

  // =====================================================
  // validatePath Tests
  // =====================================================
  console.log('\n--- validatePath() Tests ---\n');

  await test('validatePath: blocks ../../../etc/passwd', async () => {
    await expectThrows(
      () => Promise.resolve(validatePath('../../../etc/passwd', tempDir)),
      'Path traversal attempt detected'
    );
  });

  await test('validatePath: blocks ../../etc/passwd', async () => {
    await expectThrows(
      () => Promise.resolve(validatePath('../../etc/passwd', tempDir)),
      'Path traversal attempt detected'
    );
  });

  await test('validatePath: blocks nested foo/../../../../../../etc/passwd', async () => {
    await expectThrows(
      () => Promise.resolve(validatePath('foo/bar/../../../../../../etc/passwd', tempDir)),
      'Path traversal attempt detected'
    );
  });

  await test('validatePath: blocks absolute path outside base', async () => {
    await expectThrows(
      () => Promise.resolve(validatePath('/etc/passwd', tempDir)),
      'Path traversal attempt detected'
    );
  });

  await test('validatePath: allows valid relative path', async () => {
    const result = validatePath('subdir/file.txt', tempDir);
    if (!result.startsWith(tempDir)) {
      throw new Error(`Expected path to start with ${tempDir}, got ${result}`);
    }
  });

  await test('validatePath: allows path equal to base directory', async () => {
    const result = validatePath('.', tempDir);
    if (result !== tempDir) {
      throw new Error(`Expected ${tempDir}, got ${result}`);
    }
  });

  // =====================================================
  // writeFile with baseDir Tests
  // =====================================================
  console.log('\n--- writeFile() with baseDir Tests ---\n');

  await test('writeFile: blocks path traversal with baseDir', async () => {
    await expectThrows(
      () => writeFile('../../../etc/cron.d/evil', 'malicious', { baseDir: tempDir }),
      'Path traversal attempt detected'
    );
  });

  await test('writeFile: allows valid path with baseDir', async () => {
    await writeFile('safe-file.txt', 'safe content', { baseDir: tempDir });
  });

  // =====================================================
  // writeJson with baseDir Tests
  // =====================================================
  console.log('\n--- writeJson() with baseDir Tests ---\n');

  await test('writeJson: blocks path traversal with baseDir', async () => {
    await expectThrows(
      () => writeJson('../../evil.json', { evil: true }, { baseDir: tempDir }),
      'Path traversal attempt detected'
    );
  });

  await test('writeJson: allows valid path with baseDir', async () => {
    await writeJson('safe-config.json', { safe: true }, { baseDir: tempDir });
  });

  // =====================================================
  // copyFile with baseDir Tests
  // =====================================================
  console.log('\n--- copyFile() with baseDir Tests ---\n');

  // First create a source file
  await writeFile(join(tempDir, 'source.txt'), 'source content', { baseDir: tempDir });

  await test('copyFile: blocks dest path traversal with baseDir', async () => {
    await expectThrows(
      () => copyFile(join(tempDir, 'source.txt'), '../../../evil-copy.txt', { baseDir: tempDir }),
      'Path traversal attempt detected'
    );
  });

  await test('copyFile: allows valid dest with baseDir', async () => {
    await copyFile(join(tempDir, 'source.txt'), 'safe-copy.txt', { baseDir: tempDir });
  });

  // =====================================================
  // copyDir with baseDir Tests
  // =====================================================
  console.log('\n--- copyDir() with baseDir Tests ---\n');

  // Create a source directory
  await writeFile(join(tempDir, 'src-dir', 'file.txt'), 'dir content', { baseDir: tempDir });

  await test('copyDir: blocks dest path traversal with baseDir', async () => {
    await expectThrows(
      () => copyDir(join(tempDir, 'src-dir'), '../../evil-dir', { baseDir: tempDir }),
      'Path traversal attempt detected'
    );
  });

  await test('copyDir: allows valid dest with baseDir', async () => {
    await copyDir(join(tempDir, 'src-dir'), 'safe-dir-copy', { baseDir: tempDir });
  });

  // Cleanup
  await rm(tempDir, { recursive: true, force: true });

  // =====================================================
  // Summary
  // =====================================================
  console.log('\n' + '='.repeat(60));
  console.log('\n📊 SECURITY TEST SUMMARY\n');
  console.log(`Total tests: ${results.passed + results.failed}`);
  console.log(`Passed: ${results.passed}`);
  console.log(`Failed: ${results.failed}`);

  if (results.failed > 0) {
    console.log('\n❌ SECURITY VERIFICATION FAILED\n');
    process.exit(1);
  } else {
    console.log('\n✅ ALL SECURITY TESTS PASSED\n');
    process.exit(0);
  }
}

runTests().catch(err => {
  console.error('Test runner error:', err);
  process.exit(1);
});
