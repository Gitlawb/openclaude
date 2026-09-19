
import { expect, test, mock, describe, beforeEach, afterEach } from "bun:test";
import { randomBytes } from 'node:crypto';
import * as fs from 'node:fs';
import { deflateRawSync, inflateRawSync } from 'node:zlib';
import { linuxSecretStorage } from "./linuxSecretStorage.js";
import { windowsCredentialStorage } from "./windowsCredentialStorage.js";
import { macOsKeychainStorage } from "./macOsKeychainStorage.js";
import { getSecureStorageServiceName, CREDENTIALS_SERVICE_SUFFIX, keychainCacheState } from "./macOsKeychainHelpers.js";
import {
  acquireSharedMutationLock,
  releaseSharedMutationLock,
} from "../../test/sharedMutationLock.js";

// Mock execaSync. Keep the call tuple explicit so command assertions stay
// type-safe without weakening production code.
type MockExecaCall = [string, string[], { input?: string; reject?: boolean; timeout?: number }]
const mockExecaSync = mock((..._args: unknown[]): { exitCode: number; stdout: string; stderr?: string } => ({ exitCode: 0, stdout: "" }));
const execaCalls = (): MockExecaCall[] => mockExecaSync.mock.calls as unknown as MockExecaCall[]
const powershellScript = (index = 0): string => {
  const args = execaCalls()[index][1]
  return args[args.indexOf('-Command') + 1]
}
mock.module("execa", () => ({
  execaSync: mockExecaSync,
}));

const realReadFileSync = fs.readFileSync;
let encryptedFile: string | Error = 'encrypted-fixture';
let fileGeneration = 0;
mock.module('node:fs', () => ({
  ...fs,
  readFileSync: (...args: Parameters<typeof fs.readFileSync>) => {
    if (String(args[0]).endsWith('.secure.dpapi')) {
      if (encryptedFile instanceof Error) throw encryptedFile;
      return encryptedFile;
    }
    return realReadFileSync(...args);
  },
}));

describe("Secure Storage Platform Implementations", () => {
  const originalEnv = process.env;

  beforeEach(async () => {
    await acquireSharedMutationLock("platformStorage.test.ts");
    process.env = { ...originalEnv };
    encryptedFile = `encrypted-fixture-${++fileGeneration}`;
    mockExecaSync.mockClear();
    // Default mock behavior
    mockExecaSync.mockImplementation(() => ({ exitCode: 0, stdout: "" }));
  });

  afterEach(() => {
    try {
      process.env = originalEnv;
    } finally {
      releaseSharedMutationLock();
    }
  });

  const testData = {
    mcpOAuth: {
      "test-server": {
        accessToken: "secret-token",
        expiresAt: 123456789,
        serverName: "test",
        serverUrl: "http://test"
      }
    }
  };

  describe("Config-Dir Isolation", () => {
    test("service name changes with VERBOO_CONFIG_DIR", () => {
      const defaultName = getSecureStorageServiceName(CREDENTIALS_SERVICE_SUFFIX);

      process.env.VERBOO_CONFIG_DIR = "/tmp/other-verboo-config";
      const otherName = getSecureStorageServiceName(CREDENTIALS_SERVICE_SUFFIX);

      expect(otherName).not.toBe(defaultName);
      expect(otherName).toContain("Verboo Code");
      expect(otherName).toContain(CREDENTIALS_SERVICE_SUFFIX);
    });

    test("Linux storage uses scoped service name", () => {
      process.env.VERBOO_CONFIG_DIR = "/tmp/linux-scoped";
      const expectedName = getSecureStorageServiceName(CREDENTIALS_SERVICE_SUFFIX);

      linuxSecretStorage.update(testData);

      const args = execaCalls()[0];
      expect(args[1]).toContain(expectedName);
    });

    test("Linux classified reads distinguish a missing item", () => {
      mockExecaSync.mockReturnValue({ exitCode: 1, stdout: "", stderr: "" });
      expect(linuxSecretStorage.readResult?.()).toEqual({ kind: "missing" });
    });

    test("Linux classified reads identify malformed JSON", () => {
      mockExecaSync.mockReturnValue({ exitCode: 0, stdout: "legacy-token", stderr: "" });
      expect(linuxSecretStorage.readResult?.()).toEqual({
        kind: "error",
        warning: "Secret Service returned malformed JSON.",
      });
    });

    test("Windows classified reads distinguish a missing DPAPI file", () => {
      encryptedFile = Object.assign(new Error('Missing'), { code: 'ENOENT' });
      expect(windowsCredentialStorage.readResult?.()).toEqual({ kind: "missing" });
      expect(mockExecaSync).not.toHaveBeenCalled();
    });

    test("Keychain classified reads bypass the process cache", () => {
      keychainCacheState.cache = { data: { mcpOAuth: {} }, cachedAt: Date.now() };
      const fresh = { mcpOAuth: { fresh: testData.mcpOAuth["test-server"] } };
      mockExecaSync.mockReturnValue({ exitCode: 0, stdout: JSON.stringify(fresh), stderr: "" });

      expect(macOsKeychainStorage.readResult?.()).toEqual({ kind: "ok", data: fresh });
    });

    test("Windows storage uses scoped resource name", () => {
      process.env.VERBOO_CONFIG_DIR = "/tmp/win-scoped";
      const expectedName = getSecureStorageServiceName(CREDENTIALS_SERVICE_SUFFIX);

      windowsCredentialStorage.update(testData);

      const script = powershellScript();
      const options = execaCalls()[0][2];
      expect(script).toContain(expectedName);
      expect(script).toContain("ProtectedData");
      expect(options.input).toContain("secret-token");
    });
  });

  /**
   * Issue #77 — DPAPI file must be UTF-8 without BOM.
   *
   * LIMIT: form-only. These tests assert the generated PowerShell script.
   * Real Windows PowerShell 5.1 / .NET Framework / DPAPI is not exercisable
   * on this host (macOS).
   */
  describe("Windows DPAPI write encoding (issue #77)", () => {
    function updateScript(): string {
      windowsCredentialStorage.update(testData);
      return powershellScript();
    }

    function writePath(script: string): string {
      const idx = script.indexOf("[System.IO.File]::WriteAllText");
      expect(idx).toBeGreaterThan(-1);
      return script.slice(idx);
    }

    test("WriteAllText uses UTF8Encoding($false) and not Encoding::UTF8", () => {
      const write = writePath(updateScript());

      expect(write).toContain("New-Object System.Text.UTF8Encoding($false)");
      expect(write).not.toContain("[System.Text.Encoding]::UTF8");
      expect(write).not.toMatch(/\bOut-File\b/);
      expect(write).not.toMatch(/\bSet-Content\b/);
    });

    test("post-write validation re-reads bytes and FromBase64String-decodes without BOM strip", () => {
      const write = writePath(updateScript());

      expect(write).toContain("[System.IO.File]::ReadAllBytes");
      expect(write).toContain("[Convert]::FromBase64String");
      expect(write).toContain("-cne $protectedBase64");
      expect(write).toMatch(/Write-Error/);
      expect(write).toMatch(/exit\s+1/);
    });
  });

  describe("Windows PowerShell Escaping", () => {
    test("credential reads do not load profiles or wait for terminal input", () => {
      windowsCredentialStorage.read();
      const [command, args, options] = execaCalls()[0];
      expect(command).toBe('powershell.exe');
      expect(args.slice(0, 4)).toEqual(['-NoLogo', '-NoProfile', '-NonInteractive', '-Command']);
      expect(options.input).toBe(encryptedFile);
      expect(options.timeout).toBe(10_000);
    });

    test("a timed-out credential reader remains an error for classified reads", () => {
      mockExecaSync.mockImplementation(() => { throw Object.assign(new Error('Timed out'), { timedOut: true }); });
      expect(windowsCredentialStorage.readResult?.()).toMatchObject({ kind: 'error' });
      expect(windowsCredentialStorage.read()).toBeNull();
      expect(windowsCredentialStorage.update(testData).success).toBe(false);
    });

    test("escapes single quotes and prevents $ expansion", () => {
      const dataWithDollar = {
        mcpOAuth: {
          "server": {
            accessToken: "token-with-$env:USERNAME",
            expiresAt: 123,
            serverName: "s",
            serverUrl: "u"
          }
        }
      };

      windowsCredentialStorage.update(dataWithDollar);

      const script = powershellScript();
      const options = execaCalls()[0][2];
      expect(script).toContain("[Console]::In.ReadToEnd()");
      expect(options.input).toContain("token-with-$env:USERNAME");

      const dataWithQuote = { mcpOAuth: { "s": { accessToken: "token'quote", expiresAt: 1, serverName: "s", serverUrl: "u" } } };
      windowsCredentialStorage.update(dataWithQuote);
      const options2 = execaCalls()[1][2];
      expect(options2.input).toContain("token'quote");
    });

    test("delete() skips legacy PasswordVault by default", () => {
      windowsCredentialStorage.delete();
      expect(mockExecaSync).toHaveBeenCalledTimes(1);
      const script = powershellScript();
      expect(script).not.toContain("System.Runtime.WindowsRuntime");
    });

    test("delete() includes legacy assembly load when explicitly enabled", () => {
      process.env.VERBOO_ENABLE_LEGACY_WINDOWS_PASSWORDVAULT = "1";
      windowsCredentialStorage.delete();
      const script = powershellScript(1);
      expect(script).toContain("Add-Type -AssemblyName System.Runtime.WindowsRuntime");
    });

    test("escapes double quotes in username", () => {
      process.env.VERBOO_ENABLE_LEGACY_WINDOWS_PASSWORDVAULT = "1";
      process.env.USER = 'user"name 日本語';
      windowsCredentialStorage.read();
      const script = powershellScript(1);
      expect(script).toContain('user`"name');
      expect(script).toContain('日本語');
      expect(script).not.toContain('user"name');
    });

    test("read() does not touch legacy PasswordVault by default", () => {
      mockExecaSync.mockImplementationOnce(() => ({ exitCode: 1, stdout: "" }));

      const result = windowsCredentialStorage.read();

      expect(result).toBeNull();
      expect(mockExecaSync).toHaveBeenCalledTimes(1);
    });

    test("read() falls back to legacy PasswordVault when explicitly enabled", () => {
      process.env.VERBOO_ENABLE_LEGACY_WINDOWS_PASSWORDVAULT = "1";
      mockExecaSync
        .mockImplementationOnce(() => ({ exitCode: 0, stdout: "{not-json" }))
        .mockImplementationOnce(() => ({
          exitCode: 0,
          stdout: JSON.stringify(testData),
        }));

      const result = windowsCredentialStorage.read();

      expect(result).toEqual(testData);
      expect(mockExecaSync).toHaveBeenCalledTimes(2);
    });

    test("read() fails closed when the legacy PasswordVault payload is invalid JSON", () => {
      process.env.VERBOO_ENABLE_LEGACY_WINDOWS_PASSWORDVAULT = "1";
      mockExecaSync
        .mockImplementationOnce(() => ({ exitCode: 1, stdout: "" }))
        .mockImplementationOnce(() => ({ exitCode: 0, stdout: "{not-json" }));

      const result = windowsCredentialStorage.read();

      expect(result).toBeNull();
      expect(mockExecaSync).toHaveBeenCalledTimes(2);
    });
  });

  describe('Windows credential read cache', () => {
    const freshData = { verbooInstallationId: 'fresh-installation' };
    const respondWith = (data: object) => mockExecaSync.mockReturnValue({ exitCode: 0, stdout: JSON.stringify(data) });

    test('an absent file never starts PowerShell during repeated agent reads', async () => {
      encryptedFile = Object.assign(new Error('Missing'), { code: 'ENOENT' });
      for (let i = 0; i < 20; i++) expect(await windowsCredentialStorage.readAsync()).toBeNull();
      expect(mockExecaSync).not.toHaveBeenCalled();
    });

    test('filesystem permission errors stay distinct from missing credentials', () => {
      encryptedFile = Object.assign(new Error('Denied'), { code: 'EACCES' });
      expect(windowsCredentialStorage.readResult?.()).toMatchObject({ kind: 'error' });
      expect(windowsCredentialStorage.read()).toBeNull();
      expect(mockExecaSync).not.toHaveBeenCalled();
    });

    test('concurrent-agent reads decrypt an unchanged record only once', async () => {
      respondWith(testData);
      const records = await Promise.all(Array.from({ length: 20 }, () => windowsCredentialStorage.readAsync()));
      expect(records).toEqual(Array.from({ length: 20 }, () => testData));
      expect(mockExecaSync).toHaveBeenCalledTimes(1);
      expect(execaCalls()[0][2].input).toBe(encryptedFile);
      expect(execaCalls()[0][1].join(' ')).not.toContain(encryptedFile as string);
    });

    test('classifying a read always bypasses and invalidates the cache', () => {
      respondWith(testData);
      expect(windowsCredentialStorage.read()).toEqual(testData);
      respondWith(freshData);
      expect(windowsCredentialStorage.readResult?.()).toEqual({ kind: 'ok', data: freshData });
      expect(windowsCredentialStorage.read()).toEqual(freshData);
      expect(mockExecaSync).toHaveBeenCalledTimes(3);
    });

    test('a changed encrypted record is visible without a TTL delay', () => {
      respondWith(testData);
      windowsCredentialStorage.read();
      encryptedFile = (encryptedFile as string).replace('fixture', 'changed');
      respondWith(freshData);
      expect(windowsCredentialStorage.read()).toEqual(freshData);
      expect(mockExecaSync).toHaveBeenCalledTimes(2);
    });

    test('logout and recreation cannot recover an old cached record', () => {
      const original = encryptedFile;
      respondWith(testData);
      windowsCredentialStorage.read();
      encryptedFile = Object.assign(new Error('Missing'), { code: 'ENOENT' });
      expect(windowsCredentialStorage.read()).toBeNull();
      encryptedFile = original;
      respondWith(freshData);
      expect(windowsCredentialStorage.read()).toEqual(freshData);
      expect(mockExecaSync).toHaveBeenCalledTimes(2);
    });

    test('a failed write invalidates previously decrypted data', () => {
      respondWith(testData);
      windowsCredentialStorage.read();
      mockExecaSync.mockReturnValue({ exitCode: 1, stdout: '' });
      expect(windowsCredentialStorage.update(freshData).success).toBe(false);
      respondWith(freshData);
      expect(windowsCredentialStorage.read()).toEqual(freshData);
      expect(mockExecaSync).toHaveBeenCalledTimes(3);
    });

    test('deleting credentials invalidates previously decrypted data', () => {
      respondWith(testData);
      windowsCredentialStorage.read();
      expect(windowsCredentialStorage.delete()).toBe(true);
      respondWith(freshData);
      expect(windowsCredentialStorage.read()).toEqual(freshData);
      expect(mockExecaSync).toHaveBeenCalledTimes(3);
    });

    test('scoped configurations cannot share a decrypted record', () => {
      respondWith(testData);
      windowsCredentialStorage.read();
      process.env.VERBOO_CONFIG_DIR = '/tmp/another-credential-cache-scope';
      respondWith(freshData);
      expect(windowsCredentialStorage.read()).toEqual(freshData);
      expect(mockExecaSync).toHaveBeenCalledTimes(2);
    });

    test('mutating a returned object cannot poison the cached snapshot', () => {
      respondWith(testData);
      const record = windowsCredentialStorage.read()!;
      record.mcpOAuth!['test-server'].accessToken = 'mutated';
      expect(windowsCredentialStorage.read()).toEqual(testData);
      expect(mockExecaSync).toHaveBeenCalledTimes(1);
    });

    test('decryption failures are not cached', () => {
      mockExecaSync.mockReturnValue({ exitCode: 3, stdout: '' });
      expect(windowsCredentialStorage.read()).toBeNull();
      respondWith(testData);
      expect(windowsCredentialStorage.read()).toEqual(testData);
      expect(windowsCredentialStorage.read()).toEqual(testData);
      expect(mockExecaSync).toHaveBeenCalledTimes(2);
    });

    test('the decrypted input and cache key remain the same snapshot during replacement', () => {
      const before = encryptedFile;
      mockExecaSync.mockImplementationOnce(() => {
        encryptedFile = 'replacement-during-decrypt';
        return { exitCode: 0, stdout: JSON.stringify(testData) };
      });
      expect(windowsCredentialStorage.read()).toEqual(testData);
      expect(execaCalls()[0][2].input).toBe(before);
      respondWith(freshData);
      expect(windowsCredentialStorage.read()).toEqual(freshData);
      expect(execaCalls()[1][2].input).toBe('replacement-during-decrypt');
    });

    test('missing native files retain explicitly enabled legacy reads', () => {
      process.env.VERBOO_ENABLE_LEGACY_WINDOWS_PASSWORDVAULT = '1';
      encryptedFile = Object.assign(new Error('Missing'), { code: 'ENOENT' });
      respondWith(testData);
      expect(windowsCredentialStorage.read()).toEqual(testData);
      expect(mockExecaSync).toHaveBeenCalledTimes(1);
      expect(powershellScript()).toContain('PasswordVault');
    });
  });

  describe("Linux secret-tool Interaction", () => {
    test("update passes payload via stdin", () => {
      linuxSecretStorage.update(testData);

      const options = execaCalls()[0][2];
      expect(options.input?.startsWith("verboo-secure-v1:")).toBe(true);
      const encoded = options.input!.slice("verboo-secure-v1:".length);
      const decoded = inflateRawSync(Buffer.from(encoded, 'base64')).toString('utf8');
      expect(decoded).toContain("secret-token");
    });

    test("read parses stdout", () => {
      mockExecaSync.mockReturnValue({ exitCode: 0, stdout: JSON.stringify(testData) });
      const result = linuxSecretStorage.read();

      expect(result).toEqual(testData);
    });

    test("read parses the compressed payload written for KWallet", () => {
      const json = JSON.stringify(testData);
      const payload = `verboo-secure-v1:${deflateRawSync(Buffer.from(json)).toString('base64')}`;
      mockExecaSync.mockReturnValue({ exitCode: 0, stdout: payload });

      expect(linuxSecretStorage.read()).toEqual(testData);
    });

    test("rejects a compressed payload that exceeds KWallet's limit", () => {
      const oversized = {
        mcpOAuth: {
          server: {
            accessToken: randomBytes(20_000).toString('base64'),
            expiresAt: 1,
            serverName: 'server',
            serverUrl: 'https://example.invalid',
          },
        },
      };

      const result = linuxSecretStorage.update(oversized);

      expect(result).toEqual({
        success: false,
        warning: 'Secure Service payload exceeds the Linux keyring limit.',
      });
      expect(mockExecaSync).not.toHaveBeenCalled();
    });
  });

  describe("Platform Selection", () => {
    const originalPlatform = process.platform;

    async function importFreshSecureStorage() {
      return import(`./index.js?ts=${Date.now()}-${Math.random()}`);
    }

    afterEach(() => {
      Object.defineProperty(process, 'platform', { value: originalPlatform });
    });

    test("darwin returns keychain with fallback", async () => {
      Object.defineProperty(process, 'platform', { value: 'darwin' });
      const { getSecureStorage } = await importFreshSecureStorage();
      const storage = getSecureStorage();
      expect(storage.name).toContain("keychain");
    });

    test("linux returns libsecret with fallback", async () => {
      Object.defineProperty(process, 'platform', { value: 'linux' });
      const { getSecureStorage } = await importFreshSecureStorage();
      const storage = getSecureStorage();
      expect(storage.name).toContain("libsecret");
    });

    test("win32 returns credential-locker with fallback", async () => {
      Object.defineProperty(process, 'platform', { value: 'win32' });
      const { getSecureStorage } = await importFreshSecureStorage();
      const storage = getSecureStorage();
      expect(storage.name).toContain("credential-locker");
    });
  });
});
