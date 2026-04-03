
import { expect, test, mock, describe, beforeEach, afterEach } from "bun:test";
import { getSecureStorage } from "./index.js";
import { linuxSecretStorage } from "./linuxSecretStorage.js";
import { windowsCredentialStorage } from "./windowsCredentialStorage.js";
import { getSecureStorageServiceName, CREDENTIALS_SERVICE_SUFFIX } from "./macOsKeychainHelpers.js";

// Mock execaSync
const mockExecaSync = mock(() => ({ exitCode: 0, stdout: "" }));
mock.module("execa", () => ({
  execaSync: mockExecaSync,
}));

describe("Secure Storage Platform Implementations", () => {
  const originalEnv = process.env;

  beforeEach(() => {
    process.env = { ...originalEnv };
    mockExecaSync.mockClear();
    // Default mock behavior
    mockExecaSync.mockImplementation(() => ({ exitCode: 0, stdout: "" }));
  });

  afterEach(() => {
    process.env = originalEnv;
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
    test("service name changes with CLAUDE_CONFIG_DIR", () => {
      const defaultName = getSecureStorageServiceName(CREDENTIALS_SERVICE_SUFFIX);
      
      process.env.CLAUDE_CONFIG_DIR = "/tmp/other-config";
      const otherName = getSecureStorageServiceName(CREDENTIALS_SERVICE_SUFFIX);
      
      expect(otherName).not.toBe(defaultName);
      expect(otherName).toContain("Claude Code");
      expect(otherName).toContain(CREDENTIALS_SERVICE_SUFFIX);
    });

    test("Linux storage uses scoped service name", () => {
      process.env.CLAUDE_CONFIG_DIR = "/tmp/linux-scoped";
      const expectedName = getSecureStorageServiceName(CREDENTIALS_SERVICE_SUFFIX);
      
      linuxSecretStorage.update(testData);
      
      const args = mockExecaSync.mock.calls[0];
      expect(args[1]).toContain(expectedName);
    });

    test("Windows storage uses scoped resource name", () => {
      process.env.CLAUDE_CONFIG_DIR = "/tmp/win-scoped";
      const expectedName = getSecureStorageServiceName(CREDENTIALS_SERVICE_SUFFIX);
      
      windowsCredentialStorage.update(testData);
      
      const script = mockExecaSync.mock.calls[0][1][1];
      expect(script).toContain(expectedName);
      expect(script).toContain("Add-Type -AssemblyName System.Runtime.WindowsRuntime");
    });
  });

  describe("Windows PowerShell Escaping", () => {
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
      
      const script = mockExecaSync.mock.calls[0][1][1];
      // Should use single quotes for the payload
      expect(script).toMatch(/'\{.*\}'/);
      // Should escape ' by doubling it
      expect(script).not.toContain("'token-with-$env:USERNAME'");
      // But since it's JSON, the value will be "token-with-$env:USERNAME" inside the single-quoted string
      // The JSON itself shouldn't have single quotes unless the data has them.
      
      const dataWithQuote = { mcpOAuth: { "s": { accessToken: "token'quote", expiresAt: 1, serverName: "s", serverUrl: "u" } } };
      windowsCredentialStorage.update(dataWithQuote);
      const script2 = mockExecaSync.mock.calls[1][1][1];
      expect(script2).toContain("token''quote");
    });

    test("delete() includes assembly load", () => {
      windowsCredentialStorage.delete();
      const script = mockExecaSync.mock.calls[0][1][1];
      expect(script).toContain("Add-Type -AssemblyName System.Runtime.WindowsRuntime");
    });
  });

  describe("Linux secret-tool Interaction", () => {
    test("update passes payload via stdin", () => {
      linuxSecretStorage.update(testData);
      
      const options = mockExecaSync.mock.calls[0][2];
      expect(options.input).toContain("secret-token");
    });

    test("read parses stdout", () => {
      mockExecaSync.mockReturnValue({ exitCode: 0, stdout: JSON.stringify(testData) });
      const result = linuxSecretStorage.read();
      
      expect(result).toEqual(testData);
    });
  });

  describe("Platform Selection", () => {
    const originalPlatform = process.platform;

    afterEach(() => {
      Object.defineProperty(process, 'platform', { value: originalPlatform });
    });

    test("darwin returns keychain with fallback", () => {
      Object.defineProperty(process, 'platform', { value: 'darwin' });
      const storage = getSecureStorage();
      expect(storage.name).toContain("keychain");
    });

    test("linux returns libsecret with fallback", () => {
      Object.defineProperty(process, 'platform', { value: 'linux' });
      const storage = getSecureStorage();
      expect(storage.name).toContain("libsecret");
    });

    test("win32 returns credential-locker with fallback", () => {
      Object.defineProperty(process, 'platform', { value: 'win32' });
      const storage = getSecureStorage();
      expect(storage.name).toContain("credential-locker");
    });
  });
});
