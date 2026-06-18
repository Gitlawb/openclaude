import { expect, test, mock, describe, beforeEach, afterEach, afterAll, beforeAll } from "bun:test";
import * as realExeca from "execa";
import { getSecureStorageServiceName, CREDENTIALS_SERVICE_SUFFIX } from "./macOsKeychainHelpers.js";
import {
  acquireSharedMutationLock,
  releaseSharedMutationLock,
} from "../../test/sharedMutationLock.js";
import type { linuxSecretStorage as LinuxSecretStorage } from "./linuxSecretStorage.js";
import type { windowsCredentialStorage as WindowsCredentialStorage } from "./windowsCredentialStorage.js";

type MockExecaOptions = {
  input?: string;
  reject?: boolean;
};

type MockExecaArgs = [
  command: string,
  args?: readonly string[],
  options?: MockExecaOptions,
];

type MockExecaResult = {
  exitCode: number;
  stdout: string | readonly string[] | Uint8Array;
  stderr: string | readonly string[] | Uint8Array;
};

function execaResult(overrides: Partial<MockExecaResult> = {}): MockExecaResult {
  return {
    exitCode: 0,
    stdout: "",
    stderr: "",
    ...overrides,
  };
}

// Mock execaSync
const mockExecaSync = mock((..._args: MockExecaArgs) => execaResult());

function getExecaCall(index: number): MockExecaArgs {
  const call = mockExecaSync.mock.calls[index];
  expect(call).toBeDefined();
  return call;
}

function getCommandArgs(index: number): readonly string[] {
  const args = getExecaCall(index)[1];
  expect(Array.isArray(args)).toBe(true);
  return args ?? [];
}

function getPowerShellScript(index = 0): string {
  const script = getCommandArgs(index)[1];
  expect(typeof script).toBe("string");
  return script ?? "";
}

function getCommandOptions(index = 0): MockExecaOptions {
  const options = getExecaCall(index)[2];
  expect(options).toBeDefined();
  return options ?? {};
}

function getCommandInput(index = 0): string {
  const input = getCommandOptions(index).input;
  expect(typeof input).toBe("string");
  return input ?? "";
}

function getSecretToolArgs(index = 0): readonly string[] {
  const command = getExecaCall(index)[0];
  expect(command).toBe("secret-tool");
  return getCommandArgs(index);
}

describe("Secure Storage Platform Implementations", () => {
  const originalEnv = process.env;
  let linuxSecretStorage: typeof LinuxSecretStorage;
  let windowsCredentialStorage: typeof WindowsCredentialStorage;

  beforeAll(async () => {
    await acquireSharedMutationLock("platformStorage.test.ts");
    mock.restore();
    mock.module("execa", () => ({
      ...realExeca,
      execaSync: mockExecaSync,
    }));
    const moduleSuffix = `?platformStorageTest=${Date.now()}-${Math.random()}`;
    ({ linuxSecretStorage } = await import(`./linuxSecretStorage.js${moduleSuffix}`));
    ({ windowsCredentialStorage } = await import(`./windowsCredentialStorage.js${moduleSuffix}`));
  });

  beforeEach(() => {
    process.env = { ...originalEnv };
    mockExecaSync.mockClear();
    // Default mock behavior
    mockExecaSync.mockImplementation(() => execaResult());
  });

  afterEach(() => {
    process.env = originalEnv;
  });

  afterAll(() => {
    try {
      mock.module("execa", () => realExeca);
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
    test("service name changes with CLAUDE_CONFIG_DIR", () => {
      delete process.env.OPENCLAUDE_CONFIG_DIR;
      delete process.env.CLAUDE_CONFIG_DIR;
      const defaultName = getSecureStorageServiceName(CREDENTIALS_SERVICE_SUFFIX);

      process.env.CLAUDE_CONFIG_DIR = "/tmp/other-config";
      const otherName = getSecureStorageServiceName(CREDENTIALS_SERVICE_SUFFIX);

      expect(otherName).not.toBe(defaultName);
      expect(otherName).toContain("Claude Code");
      expect(otherName).toContain(CREDENTIALS_SERVICE_SUFFIX);
    });

    test("service name changes with OPENCLAUDE_CONFIG_DIR", () => {
      delete process.env.OPENCLAUDE_CONFIG_DIR;
      delete process.env.CLAUDE_CONFIG_DIR;
      const defaultName = getSecureStorageServiceName(CREDENTIALS_SERVICE_SUFFIX);

      process.env.OPENCLAUDE_CONFIG_DIR = "/tmp/preferred-config";
      delete process.env.CLAUDE_CONFIG_DIR;
      const preferredName = getSecureStorageServiceName(CREDENTIALS_SERVICE_SUFFIX);

      expect(preferredName).not.toBe(defaultName);
      expect(preferredName).toContain("Claude Code");
      expect(preferredName).toContain(CREDENTIALS_SERVICE_SUFFIX);
    });

    test("Linux storage uses scoped service name", () => {
      delete process.env.OPENCLAUDE_CONFIG_DIR;
      delete process.env.CLAUDE_CONFIG_DIR;
      process.env.CLAUDE_CONFIG_DIR = "/tmp/linux-scoped";
      const expectedName = getSecureStorageServiceName(CREDENTIALS_SERVICE_SUFFIX);

      linuxSecretStorage.update(testData);

      const args = getSecretToolArgs();
      expect(args).toContain(expectedName);
    });

    test("Linux storage uses OPENCLAUDE_CONFIG_DIR scoped service name", () => {
      process.env.OPENCLAUDE_CONFIG_DIR = "/tmp/linux-preferred-scoped";
      delete process.env.CLAUDE_CONFIG_DIR;
      const expectedName = getSecureStorageServiceName(CREDENTIALS_SERVICE_SUFFIX);

      linuxSecretStorage.update(testData);

      const args = getSecretToolArgs();
      expect(args).toContain(expectedName);
    });

    test("Windows storage uses scoped resource name", () => {
      delete process.env.OPENCLAUDE_CONFIG_DIR;
      delete process.env.CLAUDE_CONFIG_DIR;
      process.env.CLAUDE_CONFIG_DIR = "/tmp/win-scoped";
      const expectedName = getSecureStorageServiceName(CREDENTIALS_SERVICE_SUFFIX);

      windowsCredentialStorage.update(testData);

      const script = getPowerShellScript();
      expect(script).toContain(expectedName);
      expect(script).toContain("ProtectedData");
      expect(getCommandInput()).toContain("secret-token");
    });

    test("Windows storage uses OPENCLAUDE_CONFIG_DIR scoped resource name", () => {
      process.env.OPENCLAUDE_CONFIG_DIR = "/tmp/win-preferred-scoped";
      delete process.env.CLAUDE_CONFIG_DIR;
      const expectedName = getSecureStorageServiceName(CREDENTIALS_SERVICE_SUFFIX);

      windowsCredentialStorage.update(testData);

      const script = getPowerShellScript();
      expect(script).toContain(expectedName);
      expect(script).toContain("ProtectedData");
      expect(getCommandInput()).toContain("secret-token");
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

      const script = getPowerShellScript();
      expect(script).toContain("[Console]::In.ReadToEnd()");
      expect(getCommandInput()).toContain("token-with-$env:USERNAME");

      const dataWithQuote = { mcpOAuth: { "s": { accessToken: "token'quote", expiresAt: 1, serverName: "s", serverUrl: "u" } } };
      windowsCredentialStorage.update(dataWithQuote);
      expect(getCommandInput(1)).toContain("token'quote");
    });

    test("delete() skips legacy PasswordVault by default", () => {
      windowsCredentialStorage.delete();
      expect(mockExecaSync).toHaveBeenCalledTimes(1);
      const script = getPowerShellScript();
      expect(script).not.toContain("System.Runtime.WindowsRuntime");
    });

    test("delete() includes legacy assembly load when explicitly enabled", () => {
      process.env.OPENCLAUDE_ENABLE_LEGACY_WINDOWS_PASSWORDVAULT = "1";
      windowsCredentialStorage.delete();
      const script = getPowerShellScript(1);
      expect(script).toContain("Add-Type -AssemblyName System.Runtime.WindowsRuntime");
    });

    test("escapes double quotes in username", () => {
      process.env.OPENCLAUDE_ENABLE_LEGACY_WINDOWS_PASSWORDVAULT = "1";
      process.env.USER = 'user"name';
      windowsCredentialStorage.read();
      const script = getPowerShellScript(1);
      expect(script).toContain('user`"name');
      expect(script).not.toContain('user"name');
    });

    test("read() does not touch legacy PasswordVault by default", () => {
      mockExecaSync.mockImplementationOnce(() => execaResult({ exitCode: 1 }));

      const result = windowsCredentialStorage.read();

      expect(result).toBeNull();
      expect(mockExecaSync).toHaveBeenCalledTimes(1);
    });

    test("read() falls back to legacy PasswordVault when explicitly enabled", () => {
      process.env.OPENCLAUDE_ENABLE_LEGACY_WINDOWS_PASSWORDVAULT = "1";
      mockExecaSync
        .mockImplementationOnce(() => execaResult({ stdout: "{not-json" }))
        .mockImplementationOnce(() => execaResult({ stdout: JSON.stringify(testData) }));

      const result = windowsCredentialStorage.read();

      expect(result).toEqual(testData);
      expect(mockExecaSync).toHaveBeenCalledTimes(2);
    });

    test("read() fails closed when the legacy PasswordVault payload is invalid JSON", () => {
      process.env.OPENCLAUDE_ENABLE_LEGACY_WINDOWS_PASSWORDVAULT = "1";
      mockExecaSync
        .mockImplementationOnce(() => execaResult({ exitCode: 1 }))
        .mockImplementationOnce(() => execaResult({ stdout: "{not-json" }));

      const result = windowsCredentialStorage.read();

      expect(result).toBeNull();
      expect(mockExecaSync).toHaveBeenCalledTimes(2);
    });

    test("read() parses byte stdout from the DPAPI path", () => {
      mockExecaSync.mockReturnValueOnce(
        execaResult({ stdout: Buffer.from(JSON.stringify(testData), "utf8") }),
      );

      const result = windowsCredentialStorage.read();

      expect(result).toEqual(testData);
      expect(mockExecaSync).toHaveBeenCalledTimes(1);
    });

    test("read() parses string-array stdout from the DPAPI path", () => {
      mockExecaSync.mockReturnValueOnce(
        execaResult({ stdout: JSON.stringify(testData, null, 2).split("\n") }),
      );

      const result = windowsCredentialStorage.read();

      expect(result).toEqual(testData);
      expect(mockExecaSync).toHaveBeenCalledTimes(1);
    });

    test("update() reports byte stderr when DPAPI write fails", () => {
      mockExecaSync.mockReturnValueOnce(
        execaResult({
          exitCode: 1,
          stderr: Buffer.from("dpapi failed", "utf8"),
        }),
      );

      const result = windowsCredentialStorage.update(testData);

      expect(result).toEqual({
        success: false,
        warning: "dpapi failed",
      });
    });

    test("update() reports string-array stderr when DPAPI write fails", () => {
      mockExecaSync.mockReturnValueOnce(
        execaResult({
          exitCode: 1,
          stderr: ["dpapi failed", ""],
        }),
      );

      const result = windowsCredentialStorage.update(testData);

      expect(result).toEqual({
        success: false,
        warning: "dpapi failed",
      });
    });
  });

  describe("Linux secret-tool Interaction", () => {
    test("update passes payload via stdin", () => {
      linuxSecretStorage.update(testData);

      expect(getCommandInput()).toContain("secret-token");
    });

    test("read parses stdout", () => {
      mockExecaSync.mockReturnValue(execaResult({ stdout: JSON.stringify(testData) }));
      const result = linuxSecretStorage.read();

      expect(result).toEqual(testData);
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
