const fs = require('fs');
const path = require('path');

const SAVED_PROFILES = new Set([
  'openai',
  'ollama',
  'codex',
  'gemini',
  'atomic-chat',
]);

const CODEX_ALIAS_MODELS = new Set([
  'codexplan',
  'codexspark',
  'gpt-5.4',
  'gpt-5.4-mini',
  'gpt-5.3-codex',
  'gpt-5.3-codex-spark',
  'gpt-5.2',
  'gpt-5.2-codex',
  'gpt-5.1-codex-max',
  'gpt-5.1-codex-mini',
]);

function asNonEmptyString(value) {
  return typeof value === 'string' && value.trim() ? value.trim() : null;
}

function isEnvTruthy(value) {
  const normalized = asNonEmptyString(value);
  if (!normalized) {
    return false;
  }

  const lowered = normalized.toLowerCase();
  return lowered !== '0' && lowered !== 'false' && lowered !== 'no';
}

function chooseLaunchWorkspace({ activeWorkspacePath, workspacePaths }) {
  const activePath = asNonEmptyString(activeWorkspacePath);
  if (activePath) {
    return { workspacePath: activePath, source: 'active-workspace' };
  }

  const firstWorkspacePath = Array.isArray(workspacePaths)
    ? asNonEmptyString(workspacePaths[0])
    : null;

  if (firstWorkspacePath) {
    return { workspacePath: firstWorkspacePath, source: 'first-workspace' };
  }

  return { workspacePath: null, source: 'none' };
}

function sanitizeProfileEnv(env) {
  if (!env || typeof env !== 'object' || Array.isArray(env)) {
    return {};
  }

  return Object.fromEntries(
    Object.entries(env).filter(([, value]) => typeof value === 'string' && value.trim()),
  );
}

function parseProfileFile(raw) {
  try {
    const parsed = JSON.parse(raw);
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
      return null;
    }

    const profile = asNonEmptyString(parsed.profile);
    if (!profile || !SAVED_PROFILES.has(profile)) {
      return null;
    }

    if (!parsed.env || typeof parsed.env !== 'object' || Array.isArray(parsed.env)) {
      return null;
    }

    return {
      profile,
      env: sanitizeProfileEnv(parsed.env),
      createdAt: asNonEmptyString(parsed.createdAt),
    };
  } catch {
    return null;
  }
}

function isLocalBaseUrl(baseUrl) {
  const normalized = asNonEmptyString(baseUrl);
  if (!normalized) {
    return false;
  }

  try {
    const hostname = new URL(normalized).hostname.toLowerCase();
    return (
      hostname === 'localhost' ||
      hostname === '127.0.0.1' ||
      hostname === '0.0.0.0' ||
      hostname === '::1' ||
      hostname.endsWith('.local')
    );
  } catch {
    return false;
  }
}

function resolveCommandCheckPath(command, workspacePath) {
  const normalized = asNonEmptyString(command);
  if (!normalized) {
    return null;
  }

  if (!normalized.includes(path.sep) && !normalized.includes('/')) {
    return null;
  }

  if (path.isAbsolute(normalized)) {
    return normalized;
  }

  return workspacePath
    ? path.resolve(workspacePath, normalized)
    : path.resolve(normalized);
}

function getEnvValue(env, key) {
  if (!env || typeof env !== 'object') {
    return '';
  }

  const matchedKey = Object.keys(env).find(candidate => candidate.toUpperCase() === key);
  return matchedKey ? env[matchedKey] : '';
}

function canAccessExecutable(filePath, platform) {
  try {
    fs.accessSync(filePath, platform === 'win32' ? fs.constants.F_OK : fs.constants.X_OK);
    return true;
  } catch {
    return false;
  }
}

function findCommandPath(command, options = {}) {
  const normalized = asNonEmptyString(command);
  if (!normalized) {
    return null;
  }

  const cwd = asNonEmptyString(options.cwd);
  const env = options.env || process.env;
  const platform = options.platform || process.platform;
  const hasPathSeparators = normalized.includes(path.sep) || normalized.includes('/');

  if (hasPathSeparators) {
    if (!path.isAbsolute(normalized) && !cwd) {
      return null;
    }

    const directPath = resolveCommandCheckPath(normalized, cwd);
    return directPath && canAccessExecutable(directPath, platform) ? directPath : null;
  }

  const pathValue = getEnvValue(env, 'PATH');
  if (!pathValue) {
    return null;
  }

  const pathExtValue = getEnvValue(env, 'PATHEXT');
  const hasExplicitExtension = Boolean(path.extname(normalized));
  const extensions = platform === 'win32'
    ? (hasExplicitExtension
        ? ['']
        : (pathExtValue || '.COM;.EXE;.BAT;.CMD')
            .split(';')
            .map(extension => extension.trim())
            .filter(Boolean))
    : [''];

  for (const directory of pathValue.split(path.delimiter)) {
    const baseDirectory = asNonEmptyString(directory);
    if (!baseDirectory) {
      continue;
    }

    for (const extension of extensions) {
      const candidatePath = path.join(baseDirectory, `${normalized}${extension}`);
      if (canAccessExecutable(candidatePath, platform)) {
        return candidatePath;
      }
    }
  }

  return null;
}

function isPathInsideWorkspace(filePath, workspacePath) {
  const normalizedFilePath = asNonEmptyString(filePath);
  const normalizedWorkspacePath = asNonEmptyString(workspacePath);
  if (!normalizedFilePath || !normalizedWorkspacePath) {
    return false;
  }

  const resolvedFilePath = path.resolve(normalizedFilePath);
  const resolvedWorkspacePath = path.resolve(normalizedWorkspacePath);
  const comparableFilePath = process.platform === 'win32'
    ? resolvedFilePath.toLowerCase()
    : resolvedFilePath;
  const comparableWorkspacePath = process.platform === 'win32'
    ? resolvedWorkspacePath.toLowerCase()
    : resolvedWorkspacePath;
  const relativePath = path.relative(comparableWorkspacePath, comparableFilePath);

  return relativePath === '' || (!relativePath.startsWith('..') && !path.isAbsolute(relativePath));
}

function hasCodexBaseUrl(baseUrl) {
  const normalized = asNonEmptyString(baseUrl);
  if (!normalized) {
    return false;
  }

  return /chatgpt\.com\/backend-api\/codex/i.test(normalized);
}

function hasCodexAlias(model) {
  const normalized = asNonEmptyString(model);
  if (!normalized) {
    return false;
  }

  const baseModel = normalized.toLowerCase().split('?', 1)[0] || normalized.toLowerCase();
  return CODEX_ALIAS_MODELS.has(baseModel);
}

function getOpenAICompatibleLabel(baseUrl, model) {
  const normalizedBaseUrl = (asNonEmptyString(baseUrl) || '').toLowerCase();
  const normalizedModel = (asNonEmptyString(model) || '').toLowerCase();

  if (hasCodexBaseUrl(baseUrl) || (!baseUrl && hasCodexAlias(model))) {
    return 'Codex';
  }

  if (/localhost:11434|127\.0\.0\.1:11434|0\.0\.0\.0:11434/i.test(normalizedBaseUrl)) {
    return 'Ollama';
  }

  if (/localhost:1234|127\.0\.0\.1:1234|0\.0\.0\.0:1234/i.test(normalizedBaseUrl)) {
    return 'LM Studio';
  }

  if (normalizedBaseUrl.includes('deepseek') || normalizedModel.includes('deepseek')) {
    return 'DeepSeek';
  }

  if (normalizedBaseUrl.includes('openrouter')) {
    return 'OpenRouter';
  }

  if (normalizedBaseUrl.includes('together')) {
    return 'Together AI';
  }

  if (normalizedBaseUrl.includes('groq')) {
    return 'Groq';
  }

  if (normalizedBaseUrl.includes('mistral') || normalizedModel.includes('mistral')) {
    return 'Mistral';
  }

  if (normalizedBaseUrl.includes('azure')) {
    return 'Azure OpenAI';
  }

  if (normalizedBaseUrl.includes('api.openai.com') || !normalizedBaseUrl) {
    return 'OpenAI';
  }

  if (isLocalBaseUrl(normalizedBaseUrl)) {
    return 'Local OpenAI-compatible';
  }

  return 'OpenAI-compatible';
}

function buildProviderState(label, detail, source) {
  return {
    label,
    detail,
    source,
  };
}

function getDetail(env, fallback) {
  return (
    asNonEmptyString(env.OPENAI_MODEL) ||
    asNonEmptyString(env.GEMINI_MODEL) ||
    asNonEmptyString(env.OPENAI_BASE_URL) ||
    asNonEmptyString(env.GEMINI_BASE_URL) ||
    fallback
  );
}

function describeOpenAICompatible(env, source) {
  const baseUrl = asNonEmptyString(env.OPENAI_BASE_URL) || asNonEmptyString(env.OPENAI_API_BASE);
  const model = asNonEmptyString(env.OPENAI_MODEL);
  const label = getOpenAICompatibleLabel(baseUrl, model);

  if (label === 'Codex') {
    return buildProviderState('Codex', model || 'ChatGPT Codex', source);
  }

  return buildProviderState(label, model || baseUrl || 'OpenAI-compatible runtime', source);
}

function describeSavedProfile(profile) {
  switch (profile.profile) {
    case 'ollama':
      return buildProviderState('Ollama', getDetail(profile.env, 'saved profile'), 'profile');
    case 'gemini':
      return buildProviderState('Gemini', getDetail(profile.env, 'saved profile'), 'profile');
    case 'codex':
      return buildProviderState('Codex', getDetail(profile.env, 'saved profile'), 'profile');
    case 'atomic-chat':
      return buildProviderState('Atomic Chat', getDetail(profile.env, 'saved profile'), 'profile');
    case 'openai':
    default:
      return describeOpenAICompatible(profile.env, 'profile');
  }
}

function describeProviderState({ shimEnabled, env, profile }) {
  if (profile) {
    return describeSavedProfile(profile);
  }

  if (isEnvTruthy(env.CLAUDE_CODE_USE_GEMINI)) {
    return buildProviderState('Gemini', getDetail(env, 'from environment'), 'env');
  }

  if (isEnvTruthy(env.CLAUDE_CODE_USE_GITHUB)) {
    return buildProviderState('GitHub Models', getDetail(env, 'from environment'), 'env');
  }

  if (isEnvTruthy(env.CLAUDE_CODE_USE_BEDROCK)) {
    return buildProviderState('Bedrock', 'from environment', 'env');
  }

  if (isEnvTruthy(env.CLAUDE_CODE_USE_VERTEX)) {
    return buildProviderState('Vertex AI', 'from environment', 'env');
  }

  if (isEnvTruthy(env.CLAUDE_CODE_USE_FOUNDRY)) {
    return buildProviderState('Foundry', 'from environment', 'env');
  }

  if (isEnvTruthy(env.CLAUDE_CODE_USE_OPENAI)) {
    return describeOpenAICompatible(env, 'env');
  }

  if (shimEnabled) {
    return buildProviderState(
      'OpenAI-compatible (provider unknown)',
      'launch shim enabled',
      'shim',
    );
  }

  return buildProviderState(
    'Unknown',
    'no saved profile or provider env detected',
    'unknown',
  );
}

module.exports = {
  chooseLaunchWorkspace,
  describeProviderState,
  findCommandPath,
  isPathInsideWorkspace,
  parseProfileFile,
  resolveCommandCheckPath,
};
