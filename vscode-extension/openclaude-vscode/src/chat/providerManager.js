const fs = require('fs');
const os = require('os');
const path = require('path');
const crypto = require('crypto');

const PROFILE_FILE_NAME = '.openclaude-profile.json';

const SECRET_KEYS = new Set([
  'apiKey',
  'authHeaderValue',
  'OPENAI_API_KEY',
  'OPENAI_AUTH_HEADER_VALUE',
  'CODEX_API_KEY',
  'GEMINI_API_KEY',
  'GOOGLE_API_KEY',
  'MISTRAL_API_KEY',
]);

const PRESETS = [
  {
    id: 'openai',
    provider: 'openai',
    name: 'OpenAI',
    baseUrl: 'https://api.openai.com/v1',
    model: 'gpt-5.4',
    requiresApiKey: true,
  },
  {
    id: 'openrouter',
    provider: 'openai',
    name: 'OpenRouter',
    baseUrl: 'https://openrouter.ai/api/v1',
    model: 'openai/gpt-5-mini',
    requiresApiKey: true,
  },
  {
    id: 'deepseek',
    provider: 'openai',
    name: 'DeepSeek',
    baseUrl: 'https://api.deepseek.com/v1',
    model: 'deepseek-chat',
    requiresApiKey: true,
  },
  {
    id: 'groq',
    provider: 'openai',
    name: 'Groq',
    baseUrl: 'https://api.groq.com/openai/v1',
    model: 'llama-3.3-70b-versatile',
    requiresApiKey: true,
  },
  {
    id: 'lmstudio',
    provider: 'openai',
    name: 'LM Studio',
    baseUrl: 'http://localhost:1234/v1',
    model: 'local-model',
    requiresApiKey: false,
  },
  {
    id: 'ollama',
    provider: 'openai',
    name: 'Ollama',
    baseUrl: 'http://localhost:11434/v1',
    model: 'llama3.1:8b',
    requiresApiKey: false,
  },
  {
    id: 'gemini',
    provider: 'gemini',
    name: 'Google Gemini',
    baseUrl: 'https://generativelanguage.googleapis.com/v1beta/openai',
    model: 'gemini-3-flash-preview',
    requiresApiKey: true,
  },
  {
    id: 'mistral',
    provider: 'mistral',
    name: 'Mistral',
    baseUrl: 'https://api.mistral.ai/v1',
    model: 'devstral-latest',
    requiresApiKey: true,
  },
  {
    id: 'custom',
    provider: 'openai',
    name: 'Custom OpenAI-compatible',
    baseUrl: process.env.OPENAI_BASE_URL || 'http://localhost:11434/v1',
    model: process.env.OPENAI_MODEL || 'local-model',
    requiresApiKey: false,
  },
];

function trim(value) {
  return typeof value === 'string' ? value.trim() : '';
}

function parseModelList(value) {
  return trim(value)
    .split(/[,\n;]/)
    .map(item => item.trim())
    .filter(Boolean);
}

function getWorkspaceRoot() {
  const vscode = require('vscode');
  const folders = vscode.workspace.workspaceFolders;
  return folders && folders.length > 0 ? folders[0].uri.fsPath : process.cwd();
}

function getProfilePath(cwd = getWorkspaceRoot()) {
  return path.join(cwd, PROFILE_FILE_NAME);
}

function getGlobalConfigPath() {
  const configDir = process.env.CLAUDE_CONFIG_DIR || os.homedir();
  const openClaudePath = path.join(configDir, '.openclaude.json');
  const legacyPath = path.join(configDir, '.claude.json');
  return !fs.existsSync(openClaudePath) && fs.existsSync(legacyPath)
    ? legacyPath
    : openClaudePath;
}

function readJsonFile(filePath, fallback = null) {
  try {
    if (!fs.existsSync(filePath)) return fallback;
    return JSON.parse(fs.readFileSync(filePath, 'utf8'));
  } catch {
    return fallback;
  }
}

function writeJsonFile(filePath, value) {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  fs.writeFileSync(filePath, `${JSON.stringify(value, null, 2)}\n`, {
    encoding: 'utf8',
    mode: 0o600,
  });
}

function readGlobalConfig() {
  const filePath = getGlobalConfigPath();
  const config = readJsonFile(filePath, {});
  return { filePath, config: config && typeof config === 'object' ? config : {} };
}

function readStartupProfile(cwd = getWorkspaceRoot()) {
  const filePath = getProfilePath(cwd);
  const parsed = readJsonFile(filePath, null);
  if (!parsed || typeof parsed !== 'object' || !parsed.profile || !parsed.env) {
    return { profile: null, filePath };
  }
  return { profile: parsed, filePath };
}

function maskSecret(value) {
  const text = trim(value);
  if (!text) return '';
  if (text.length <= 8) return '••••';
  return `${text.slice(0, 4)}••••${text.slice(-4)}`;
}

function normalizeProvider(provider) {
  return provider === 'gemini' || provider === 'mistral' || provider === 'anthropic'
    ? provider
    : 'openai';
}

function inferProviderLabel(profile) {
  if (!profile) return 'Unknown';
  if (profile.provider === 'gemini') return 'Gemini';
  if (profile.provider === 'mistral') return 'Mistral';
  if (profile.provider === 'anthropic') return 'Anthropic';
  const baseUrl = String(profile.baseUrl || '').toLowerCase();
  const model = String(profile.model || '').toLowerCase();
  if (baseUrl.includes('hicap')) return 'Hicap';
  if (baseUrl.includes('openrouter')) return 'OpenRouter';
  if (baseUrl.includes('deepseek') || model.includes('deepseek')) return 'DeepSeek';
  if (baseUrl.includes('groq')) return 'Groq';
  if (baseUrl.includes('localhost:11434') || baseUrl.includes('127.0.0.1:11434')) return 'Ollama';
  if (baseUrl.includes('localhost:1234') || baseUrl.includes('127.0.0.1:1234')) return 'LM Studio';
  if (baseUrl.includes('mistral')) return 'Mistral';
  if (baseUrl.includes('api.openai.com')) return 'OpenAI';
  return profile.name || 'OpenAI-compatible';
}

function profileFromStartup(startupProfile) {
  if (!startupProfile?.env) return null;
  const env = startupProfile.env;
  const provider = startupProfile.profile === 'gemini'
    ? 'gemini'
    : startupProfile.profile === 'mistral'
      ? 'mistral'
      : 'openai';
  const profile = {
    id: 'startup-profile',
    source: 'startup',
    name: `${inferProviderLabel({
      provider,
      baseUrl: env.OPENAI_BASE_URL || env.GEMINI_BASE_URL || env.MISTRAL_BASE_URL,
      model: env.OPENAI_MODEL || env.GEMINI_MODEL || env.MISTRAL_MODEL,
    })} startup profile`,
    provider,
    baseUrl: env.OPENAI_BASE_URL || env.GEMINI_BASE_URL || env.MISTRAL_BASE_URL || '',
    model: env.OPENAI_MODEL || env.GEMINI_MODEL || env.MISTRAL_MODEL || '',
    apiKey: env.OPENAI_API_KEY || env.GEMINI_API_KEY || env.MISTRAL_API_KEY || '',
    apiFormat: env.OPENAI_API_FORMAT || 'responses',
    authHeader: env.OPENAI_AUTH_HEADER || '',
    authScheme: env.OPENAI_AUTH_SCHEME || '',
    authHeaderValue: env.OPENAI_AUTH_HEADER_VALUE || '',
  };
  return profile;
}

function sanitizeProfile(profile) {
  if (!profile || typeof profile !== 'object') return null;
  const id = trim(profile.id);
  const name = trim(profile.name);
  const baseUrl = trim(profile.baseUrl);
  const model = trim(profile.model);
  if (!id || !name || !baseUrl || !model) return null;
  const sanitized = {
    id,
    name,
    provider: normalizeProvider(profile.provider),
    baseUrl,
    model,
  };
  if (trim(profile.apiKey)) sanitized.apiKey = trim(profile.apiKey);
  if (profile.apiFormat === 'chat_completions' || profile.apiFormat === 'responses') {
    sanitized.apiFormat = profile.apiFormat;
  }
  if (trim(profile.authHeader)) sanitized.authHeader = trim(profile.authHeader);
  if (profile.authScheme === 'bearer' || profile.authScheme === 'raw') sanitized.authScheme = profile.authScheme;
  if (trim(profile.authHeaderValue)) sanitized.authHeaderValue = trim(profile.authHeaderValue);
  return sanitized;
}

function getConfiguredProfiles(config) {
  const seen = new Set();
  const profiles = [];
  for (const profile of Array.isArray(config.providerProfiles) ? config.providerProfiles : []) {
    const sanitized = sanitizeProfile(profile);
    if (!sanitized || seen.has(sanitized.id)) continue;
    seen.add(sanitized.id);
    profiles.push({ ...sanitized, source: 'configured' });
  }
  return profiles;
}

function getPrimaryActiveProfile(config, startupProfile) {
  const configured = getConfiguredProfiles(config);
  const activeId = trim(config.activeProviderProfileId);
  const activeConfigured = configured.find(profile => profile.id === activeId) || configured[0] || null;
  return activeConfigured || profileFromStartup(startupProfile) || null;
}

function normalizeModelOption(option) {
  if (typeof option === 'string') {
    return { value: option, label: option, description: '' };
  }
  if (!option || typeof option !== 'object') return null;
  const value = trim(option.value || option.name || option.id || option.label);
  if (!value) return null;
  return {
    value,
    label: trim(option.label) || value,
    description: trim(option.description),
  };
}

function getCachedModelOptionsForProfile(config, profile) {
  if (!profile) return [];
  const byProfile = config.openaiAdditionalModelOptionsCacheByProfile;
  const scoped = byProfile && typeof byProfile === 'object'
    ? byProfile[profile.id]
    : null;
  const fallback = Array.isArray(config.openaiAdditionalModelOptionsCache)
    ? config.openaiAdditionalModelOptionsCache
    : [];
  const rawOptions = Array.isArray(scoped) ? scoped : fallback;
  return rawOptions.map(normalizeModelOption).filter(Boolean);
}

function getModelEndpointCandidates(baseUrl) {
  const raw = trim(baseUrl).replace(/\/+$/, '');
  if (!raw) return [];
  const candidates = raw.endsWith('/v1')
    ? [`${raw}/models`]
    : [`${raw}/v1/models`, `${raw}/models`];
  return [...new Set(candidates)];
}

function getAuthHeaders(profile) {
  const headers = { accept: 'application/json' };
  const headerName = trim(profile?.authHeader);
  const headerValue = trim(profile?.authHeaderValue);
  const scheme = trim(profile?.authScheme).toLowerCase();
  if (headerName && headerValue) {
    const lower = headerName.toLowerCase();
    const shouldBearer = scheme === 'bearer' || (!scheme && lower === 'authorization');
    headers[headerName] = shouldBearer ? `Bearer ${headerValue}` : headerValue;
    return headers;
  }
  if (trim(profile?.apiKey)) {
    headers.authorization = `Bearer ${trim(profile.apiKey)}`;
  }
  return headers;
}

function parseModelDiscoveryPayload(payload) {
  const rawModels = Array.isArray(payload?.data)
    ? payload.data
    : Array.isArray(payload?.models)
      ? payload.models
      : Array.isArray(payload)
        ? payload
        : [];
  return rawModels.map(model => {
    if (typeof model === 'string') return normalizeModelOption(model);
    if (!model || typeof model !== 'object') return null;
    return normalizeModelOption({
      value: model.id || model.name || model.model,
      label: model.id || model.name || model.model,
      description: model.owned_by || model.description || '',
    });
  }).filter(Boolean);
}

async function discoverModelOptions(activeProfile) {
  if (!activeProfile || activeProfile.provider !== 'openai' || typeof fetch !== 'function') return [];
  const endpoints = getModelEndpointCandidates(activeProfile.baseUrl);
  if (endpoints.length === 0) return [];
  const headers = getAuthHeaders(activeProfile);

  for (const endpoint of endpoints) {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 3500);
    try {
      const response = await fetch(endpoint, { headers, signal: controller.signal });
      if (!response.ok) continue;
      const payload = await response.json();
      const models = parseModelDiscoveryPayload(payload);
      if (models.length > 0) return models;
    } catch {
      // Ignore discovery failures; the UI can still use configured and cached models.
    } finally {
      clearTimeout(timeout);
    }
  }
  return [];
}

function mergeModelOptions(activeProfile, ...optionGroups) {
  const seen = new Set();
  const options = [];
  const add = (value, label = value, description = '') => {
    const model = trim(value);
    if (!model || seen.has(model)) return;
    seen.add(model);
    options.push({ value: model, label: trim(label) || model, description: trim(description) });
  };

  for (const model of parseModelList(activeProfile?.model)) {
    add(model, model, activeProfile?.name ? `Provider: ${activeProfile.name}` : '');
  }

  for (const group of optionGroups) {
    for (const option of group || []) {
      add(option.value, option.label, option.description);
    }
  }

  return options;
}

async function buildModelOptions(config, activeProfile) {
  const cached = getCachedModelOptionsForProfile(config, activeProfile);
  const discovered = await discoverModelOptions(activeProfile);
  return mergeModelOptions(activeProfile, discovered, cached);
}

function redactProfile(profile) {
  if (!profile) return null;
  return Object.fromEntries(
    Object.entries(profile).map(([key, value]) => [
      key,
      SECRET_KEYS.has(key) ? maskSecret(value) : value,
    ]),
  );
}

function buildForm(profile) {
  return {
    profileId: profile?.source === 'configured' || profile?.source === 'startup' ? profile.id : '',
    name: profile?.source === 'configured' ? profile.name : (profile?.name || ''),
    provider: normalizeProvider(profile?.provider),
    model: profile?.model || '',
    baseUrl: profile?.baseUrl || '',
    apiKeyMasked: maskSecret(profile?.apiKey),
    authHeaderValueMasked: maskSecret(profile?.authHeaderValue),
    apiFormat: profile?.apiFormat || 'responses',
    authHeader: profile?.authHeader || '',
    authScheme: profile?.authScheme || '',
  };
}

function summarizeProfile(profile, activeId) {
  return {
    id: profile.id,
    source: profile.source || 'configured',
    name: profile.name,
    provider: profile.provider,
    label: inferProviderLabel(profile),
    model: profile.model,
    baseUrl: profile.baseUrl,
    apiFormat: profile.apiFormat || 'responses',
    authHeader: profile.authHeader || '',
    authScheme: profile.authScheme || '',
    apiKeyMasked: maskSecret(profile.apiKey),
    authHeaderValueMasked: maskSecret(profile.authHeaderValue),
    isActive: profile.source === 'configured' && profile.id === activeId,
    hasApiKey: Boolean(profile.apiKey),
    hasAuthHeaderValue: Boolean(profile.authHeaderValue),
  };
}

async function buildProviderManagerState() {
  const cwd = getWorkspaceRoot();
  const startup = readStartupProfile(cwd);
  const { filePath: globalConfigPath, config } = readGlobalConfig();
  const configuredProfiles = getConfiguredProfiles(config);
  const startupAsProfile = profileFromStartup(startup.profile);
  const activeProfile = getPrimaryActiveProfile(config, startup.profile);
  const activeId = trim(config.activeProviderProfileId);
  const listedProfiles = configuredProfiles.length > 0
    ? configuredProfiles
    : (startupAsProfile ? [startupAsProfile] : []);

  return {
    cwd,
    startupProfilePath: startup.filePath,
    globalConfigPath,
    activeProviderProfileId: activeId || '',
    activeProfile: redactProfile(activeProfile),
    configuredProfiles: listedProfiles.map(profile => summarizeProfile(profile, activeId)),
    presets: PRESETS,
    models: await buildModelOptions(config, activeProfile),
    form: buildForm(activeProfile || PRESETS[0]),
  };
}

function buildStartupEnv(profile) {
  if (profile.provider === 'gemini') {
    return {
      profile: 'gemini',
      env: {
        GEMINI_BASE_URL: profile.baseUrl,
        GEMINI_MODEL: profile.model,
        ...(profile.apiKey ? { GEMINI_API_KEY: profile.apiKey } : {}),
      },
    };
  }
  if (profile.provider === 'mistral') {
    return {
      profile: 'mistral',
      env: {
        MISTRAL_BASE_URL: profile.baseUrl,
        MISTRAL_MODEL: profile.model,
        ...(profile.apiKey ? { MISTRAL_API_KEY: profile.apiKey } : {}),
      },
    };
  }
  return {
    profile: 'openai',
    env: {
      OPENAI_BASE_URL: profile.baseUrl,
      OPENAI_MODEL: profile.model,
      ...(profile.apiFormat ? { OPENAI_API_FORMAT: profile.apiFormat } : {}),
      ...(profile.authHeader ? { OPENAI_AUTH_HEADER: profile.authHeader } : {}),
      ...(profile.authScheme ? { OPENAI_AUTH_SCHEME: profile.authScheme } : {}),
      ...(profile.authHeaderValue ? { OPENAI_AUTH_HEADER_VALUE: profile.authHeaderValue } : {}),
      ...(profile.apiKey || profile.authHeaderValue
        ? { OPENAI_API_KEY: profile.apiKey || profile.authHeaderValue }
        : {}),
    },
  };
}

function persistStartupProfile(profile) {
  const startup = buildStartupEnv(profile);
  writeJsonFile(getProfilePath(), {
    profile: startup.profile,
    env: startup.env,
    createdAt: new Date().toISOString(),
  });
}

function buildProfileFromForm(form, existing) {
  const useCustomHeader = Boolean(trim(form.authHeader) && trim(form.authHeaderValue));
  const existingSame = existing && existing.id === form.profileId ? existing : null;
  const authHeaderValue = trim(form.authHeaderValue) || existingSame?.authHeaderValue || '';
  const profile = {
    id: trim(form.profileId) || `provider_${crypto.randomBytes(6).toString('hex')}`,
    name: trim(form.name) || 'Custom provider',
    provider: normalizeProvider(form.provider),
    baseUrl: trim(form.baseUrl),
    model: trim(form.model),
    apiKey: useCustomHeader
      ? authHeaderValue
      : (trim(form.apiKey) || existingSame?.apiKey || ''),
    apiFormat: form.apiFormat === 'chat_completions' ? 'chat_completions' : 'responses',
    authHeader: trim(form.authHeader),
    authScheme: form.authScheme === 'bearer' || form.authScheme === 'raw' ? form.authScheme : undefined,
    authHeaderValue,
  };
  if (profile.provider !== 'openai') {
    delete profile.apiFormat;
    delete profile.authHeader;
    delete profile.authScheme;
    delete profile.authHeaderValue;
  }
  return sanitizeProfile(profile);
}

async function saveProviderProfile(form) {
  const { filePath, config } = readGlobalConfig();
  const currentProfiles = getConfiguredProfiles(config);
  const startup = profileFromStartup(readStartupProfile().profile);
  const existing = currentProfiles.find(profile => profile.id === form.profileId) ||
    (startup?.id === form.profileId ? startup : null);
  const profile = buildProfileFromForm(form, existing);
  if (!profile) {
    throw new Error('Provider profile needs a name, base URL, and model.');
  }

  const nextProfiles = existing
    ? currentProfiles.map(item => item.id === profile.id ? profile : item)
    : [...currentProfiles, profile];
  const nextConfig = {
    ...config,
    providerProfiles: nextProfiles.map(({ source, ...item }) => item),
    activeProviderProfileId: profile.id,
  };
  writeJsonFile(filePath, nextConfig);
  persistStartupProfile(profile);
  return buildProviderManagerState();
}

async function setActiveProviderProfile(profileId) {
  const { filePath, config } = readGlobalConfig();
  const profiles = getConfiguredProfiles(config);
  const profile = profiles.find(item => item.id === profileId);
  if (!profile) return buildProviderManagerState();
  writeJsonFile(filePath, {
    ...config,
    providerProfiles: profiles.map(({ source, ...item }) => item),
    activeProviderProfileId: profile.id,
  });
  persistStartupProfile(profile);
  return buildProviderManagerState();
}

async function deleteProviderProfile(profileId) {
  const { filePath, config } = readGlobalConfig();
  const profiles = getConfiguredProfiles(config);
  const remaining = profiles.filter(profile => profile.id !== profileId);
  const nextActive = config.activeProviderProfileId === profileId
    ? remaining[0]?.id
    : config.activeProviderProfileId;
  writeJsonFile(filePath, {
    ...config,
    providerProfiles: remaining.map(({ source, ...item }) => item),
    activeProviderProfileId: nextActive,
  });
  if (nextActive) {
    const active = remaining.find(profile => profile.id === nextActive);
    if (active) persistStartupProfile(active);
  } else {
    fs.rmSync(getProfilePath(), { force: true });
  }
  return buildProviderManagerState();
}

async function clearProviderProfile() {
  fs.rmSync(getProfilePath(), { force: true });
  return buildProviderManagerState();
}

module.exports = {
  buildProviderManagerState,
  clearProviderProfile,
  deleteProviderProfile,
  getProfilePath,
  saveProviderProfile,
  setActiveProviderProfile,
};
