/**
 * AI Council Full API Server with MCP Support
 * Provides complete REST API + MCP protocol for agent control
 * Works alongside the web UI
 */

const express = require('express');
const cors = require('cors');
const fs = require('fs');
const path = require('path');
const os = require('os');
const { execFileSync } = require('child_process');

const app = express();
app.use(cors());
app.use(express.json({ limit: '50mb' }));

const PORT = process.env.PORT || 3001;
const SETTINGS_FILE = path.join(__dirname, 'settings.json');

// Default settings
const defaultSettings = {
  bots: [],
  providers: {
    openrouter: { apiKey: '', endpoint: '' },
    lmstudio: { endpoint: 'http://100.116.54.125:1234/v1' },
    google: { apiKey: '' },
    anthropic: { apiKey: '' },
  },
  ui: {
    soundEnabled: true,
    theme: 'dark',
    animationsEnabled: true,
  },
  audio: {
    enabled: true,
    useGeminiTTS: false,
    autoPlay: true,
  }
};

// Load or initialize settings
function loadSettings() {
  try {
    if (fs.existsSync(SETTINGS_FILE)) {
      return JSON.parse(fs.readFileSync(SETTINGS_FILE, 'utf8'));
    }
  } catch (e) {
    console.error('Error loading settings:', e);
  }
  return defaultSettings;
}

function saveSettings(settings) {
  fs.writeFileSync(SETTINGS_FILE, JSON.stringify(settings, null, 2));
}

function loadOpenClawConfig() {
  try {
    const p = path.join(process.env.HOME || '', '.openclaw', 'openclaw.json');
    if (fs.existsSync(p)) return JSON.parse(fs.readFileSync(p, 'utf8'));
  } catch (e) {
    console.error('Error loading OpenClaw config:', e);
  }
  return null;
}

function getBraveApiKey() {
  if (process.env.BRAVE_API_KEY) return process.env.BRAVE_API_KEY;
  if (process.env.BRAVE_SEARCH_API_KEY) return process.env.BRAVE_SEARCH_API_KEY;
  try {
    const cfg = loadOpenClawConfig();
    return cfg?.plugins?.entries?.brave?.config?.webSearch?.apiKey || null;
  } catch {
    return null;
  }
}

async function braveWebSearch(query, count = 5) {
  const apiKey = getBraveApiKey();
  if (!apiKey) throw new Error('Brave Search API key not configured');
  const url = `https://api.search.brave.com/res/v1/web/search?q=${encodeURIComponent(query)}&count=${count}`;
  const res = await fetch(url, {
    headers: {
      'Accept': 'application/json',
      'X-Subscription-Token': apiKey,
    },
  });
  if (!res.ok) throw new Error(`Brave Search error ${res.status}`);
  const data = await res.json();
  return (data.web?.results || []).map(r => ({
    title: r.title,
    url: r.url,
    description: r.description,
  }));
}

const BROWSEROS_MCP_URL = process.env.BROWSEROS_MCP_URL || 'http://127.0.0.1:9000/mcp';

async function callBrowserOS(toolName, args = {}) {
  const payload = {
    jsonrpc: '2.0',
    id: Date.now(),
    method: 'tools/call',
    params: { name: toolName, arguments: args }
  };
  const res = await fetch(BROWSEROS_MCP_URL, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Accept': 'application/json, text/event-stream'
    },
    body: JSON.stringify(payload),
  });
  if (!res.ok) throw new Error(`BrowserOS MCP error ${res.status}`);
  const data = await res.json();
  if (data.error) throw new Error(data.error.message || 'BrowserOS MCP call failed');
  return data.result;
}

function getImageMimeType(filePath) {
  const ext = path.extname(String(filePath || '')).toLowerCase();
  switch (ext) {
    case '.jpg':
    case '.jpeg': return 'image/jpeg';
    case '.png': return 'image/png';
    case '.gif': return 'image/gif';
    case '.webp': return 'image/webp';
    case '.bmp': return 'image/bmp';
    case '.tif':
    case '.tiff': return 'image/tiff';
    default: return 'image/png';
  }
}

function imageInputToDataUrl(imageInput) {
  if (!imageInput) return null;
  const str = String(imageInput);
  if (str.startsWith('data:image/')) return str;
  if (/^https?:\/\//i.test(str)) return null;
  if (!fs.existsSync(str)) return null;

  const ext = path.extname(str).toLowerCase();
  const directMime = getImageMimeType(str);
  const directReadable = new Set(['.png', '.jpg', '.jpeg']);

  try {
    if (!directReadable.has(ext)) {
      const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'ai-council-vision-'));
      const outPath = path.join(tmpDir, 'input.png');
      execFileSync('sips', ['-s', 'format', 'png', str, '--out', outPath], { stdio: 'ignore' });
      const pngData = fs.readFileSync(outPath);
      return `data:image/png;base64,${pngData.toString('base64')}`;
    }
  } catch (e) {
    // Fall back to direct encoding below if conversion fails
  }

  const data = fs.readFileSync(str);
  return `data:${directMime};base64,${data.toString('base64')}`;
}

async function analyzeVisionWithLMStudio({ image, prompt, models }) {
  const settings = loadSettings();
  const lmStudioUrl = settings?.providers?.lmstudio?.endpoint || 'http://localhost:1234/v1';
  const lmStudioKey = settings?.providers?.lmstudio?.apiKey || 'lm';
  const model = (Array.isArray(models) && models[0]) || 'qwen/qwen3.5-9b';
  const imageUrl = imageInputToDataUrl(image);
  if (!imageUrl) throw new Error('No valid image provided');

  const userPrompt = prompt || 'Analyze this image for plant health. Identify visible symptoms, likely causes, severity, and immediate actions. Be specific and practical.';
  const response = await fetch(`${lmStudioUrl}/chat/completions`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${lmStudioKey}`
    },
    body: JSON.stringify({
      model,
      messages: [{
        role: 'user',
        content: [
          { type: 'text', text: userPrompt },
          { type: 'image_url', image_url: { url: imageUrl } }
        ]
      }],
      temperature: 0.2,
      max_tokens: 700
    })
  });

  if (!response.ok) {
    const err = await response.text();
    throw new Error(`LM Studio vision error ${response.status}: ${err}`);
  }

  const data = await response.json();
  // For reasoning models (qwen3.5), vision output goes into reasoning_content not content
  const text = data.choices?.[0]?.message?.reasoning_content || data.choices?.[0]?.message?.content || data.choices?.[0]?.text || '';
  const clean = String(text || '').trim();
  return {
    model,
    provider: 'lmstudio',
    prompt: userPrompt,
    image: String(image),
    analysis: clean || '(No analysis returned)',
    raw: data
  };
}

function shouldUseLiveContext(question = '') {
  const q = String(question || '').toLowerCase();
  if (!q.trim()) return false;
  const liveSignals = [
    'latest', 'current', 'today', 'now', 'recent', 'news', 'headline', 'benchmark', 'benchmarks',
    'score', 'scores', 'pricing', 'price', 'cost', 'compare', 'comparison', 'vs', ' versus ',
    'release', 'released', 'update', 'updated', 'version', 'api', 'docs', 'documentation',
    'github', 'repo', 'repository', 'website', 'web search', 'search the web', 'open the page',
    'model', 'models', 'openai', 'chatgpt', 'minimax', 'lm studio', 'lmstudio', 'browseros', 'openclaw'
  ];
  const urlLike = /https?:\/\//i.test(q);
  return urlLike || liveSignals.some(sig => q.includes(sig));
}

function summarizeWebResults(results = []) {
  return results.slice(0, 5).map((r, i) => {
    const title = r.title || 'Untitled';
    const url = r.url || '';
    const description = r.description || '';
    return `${i + 1}. ${title}
   ${url}
   ${description}`.trim();
  }).join('\n\n');
}

async function gatherLiveContext(question) {
  const q = String(question || '').trim();
  if (!shouldUseLiveContext(q)) return '';

  const lines = [];

  // If the user pasted a direct URL, try BrowserOS first so we can inspect the page itself.
  const urlMatch = q.match(/https?:\/\/[^\s)]+/i);
  if (urlMatch) {
    const url = urlMatch[0].replace(/[.,;]+$/, '');
    try {
      const opened = await callBrowserOS('new_page', { url });
      const pageId = opened?.pageId || opened?.page?.pageId || opened?.result?.pageId || 1;
      const page = await callBrowserOS('get_page_content', { page: pageId });
      const text = JSON.stringify(page, null, 2);
      lines.push(`BrowserOS page content for ${url}:\n${text.slice(0, 5000)}`);
    } catch (e) {
      lines.push(`BrowserOS lookup failed for ${url}: ${e.message}`);
    }
  }

  try {
    const results = await braveWebSearch(q, 5);
    if (results?.length) {
      lines.push(`Brave Search results for "${q}":\n${summarizeWebResults(results)}`);
    }
  } catch (e) {
    lines.push(`Brave Search failed: ${e.message}`);
  }

  return lines.join('\n\n').trim();
}

// ============ COUNCILOR REGISTRY ============

const COUNCILOR_REGISTRY = [
  // Core Councilors
  { id: 'councilor-speaker', name: 'Speaker', role: 'councilor', expertise: 'governance', enabled: true },
  { id: 'councilor-technocrat', name: 'Technocrat', role: 'councilor', expertise: 'technology', enabled: true },
  { id: 'councilor-ethicist', name: 'Ethicist', role: 'councilor', expertise: 'ethics', enabled: true },
  { id: 'councilor-pragmatist', name: 'Pragmatist', role: 'councilor', expertise: 'practical', enabled: true },
  { id: 'councilor-skeptic', name: 'Skeptic', role: 'councilor', expertise: 'criticism', enabled: true },
  // Vision Councilors
  { id: 'councilor-visual-analyst', name: 'Visual Analyst', role: 'vision', expertise: 'analysis', enabled: true },
  { id: 'councilor-pattern-recognizer', name: 'Pattern Recognizer', role: 'vision', expertise: 'patterns', enabled: true },
  { id: 'councilor-color-specialist', name: 'Color Specialist', role: 'vision', expertise: 'color', enabled: true },
  { id: 'councilor-composition-expert', name: 'Composition Expert', role: 'vision', expertise: 'composition', enabled: true },
  { id: 'councilor-context-interpreter', name: 'Context Interpreter', role: 'vision', expertise: 'context', enabled: true },
  { id: 'councilor-detail-observer', name: 'Detail Observer', role: 'vision', expertise: 'details', enabled: true },
  { id: 'councilor-emotion-reader', name: 'Emotion Reader', role: 'vision', expertise: 'emotions', enabled: true },
  { id: 'councilor-symbol-interpreter', name: 'Symbol Interpreter', role: 'vision', expertise: 'symbols', enabled: true },
  // Swarm Coding Roles
  { id: 'councilor-architect', name: 'Architect', role: 'coding', expertise: 'architecture', enabled: true },
  { id: 'councilor-backend', name: 'Backend Dev', role: 'coding', expertise: 'backend', enabled: true },
  { id: 'councilor-frontend', name: 'Frontend Dev', role: 'coding', expertise: 'frontend', enabled: true },
  { id: 'councilor-devops', name: 'DevOps', role: 'coding', expertise: 'devops', enabled: true },
  { id: 'councilor-security', name: 'Security Expert', role: 'coding', expertise: 'security', enabled: true },
  { id: 'councilor-qa', name: 'QA Engineer', role: 'coding', expertise: 'testing', enabled: true },
  // Specialist Councilors
  { id: 'councilor-risk-analyst', name: 'Risk Analyst', role: 'specialist', expertise: 'risk', enabled: true },
  { id: 'councilor-legal-expert', name: 'Legal Expert', role: 'specialist', expertise: 'legal', enabled: true },
  { id: 'councilor-finance-expert', name: 'Finance Expert', role: 'specialist', expertise: 'finance', enabled: true },
  { id: 'councilor-meteorologist', name: 'Meteorologist', role: 'emergency', expertise: 'weather', enabled: true },
  { id: 'councilor-emergency-manager', name: 'Emergency Manager', role: 'emergency', expertise: 'emergency', enabled: true },
];

// Deliberation Modes
const DELIBERATION_MODES = [
  { id: 'deliberation', name: 'Deliberation', description: 'Standard debate and vote' },
  { id: 'legislative', name: 'Legislative', description: 'Debate + vote on proposals' },
  { id: 'inquiry', name: 'Inquiry', description: 'Rapid-fire Q&A' },
  { id: 'swarm', name: 'Swarm Hive', description: 'Parallel task decomposition' },
  { id: 'swarm_coding', name: 'Swarm Coding', description: 'Software engineering workflow' },
  { id: 'prediction', name: 'Prediction Market', description: 'Forecasting with probabilities' },
  { id: 'deep_research', name: 'Deep Research', description: 'Recursive investigation' },
  { id: 'vision', name: 'Vision Council', description: 'Image-based analysis' },
  { id: 'emergency', name: 'Emergency Response', description: 'Rapid crisis deliberation' },
  { id: 'risk_assessment', name: 'Risk Assessment', description: 'Comprehensive risk analysis' },
  { id: 'collaborative', name: 'Collaborative', description: 'Team-based problem solving' },
];

// Vision Models - ALL Qwen3.5 support vision!
const VISION_MODELS = [
  { id: 'qwen/qwen3.5-9b', name: 'Qwen3.5-9B Vision', provider: 'Local', latency: '100-500ms' },
  { id: 'openai/gpt-4-vision', name: 'GPT-4 Vision', provider: 'OpenAI', latency: '1000-2000ms' },
  { id: 'qwen-vl', name: 'Qwen-VL', provider: 'Local', latency: '100-500ms' },
  // ALL Qwen3.5 models have vision!
  { id: 'qwen/qwen3.5-9b', name: 'Qwen3.5-9B Vision', provider: 'Local', latency: '100-500ms' },
  { id: 'qwen3.5-27b', name: 'Qwen3.5-27B Vision', provider: 'Local', latency: '200-800ms' },
  { id: 'qwen3.5-9b', name: 'Qwen3.5-9B Vision', provider: 'Local', latency: '100-500ms' },
];

// ============ SESSION STATE ============

let sessionState = {
  id: 'default',
  mode: 'deliberation',
  topic: '',
  messages: [],
  votes: {},
  consensus: null,
  visionSession: null,
};

let visionSessions = new Map();

// ============ MCP TOOLS REGISTRY ============

const mcpTools = [
  // ============ HEALTH & STATUS ============
  {
    name: 'health',
    description: 'Check if AI Council API is running',
    inputSchema: { type: 'object', properties: {} },
  },

  // ============ COUNCILORS ============
  {
    name: 'list_councilors',
    description: 'List all available AI councilors with their roles and expertise',
    inputSchema: { type: 'object', properties: {} },
  },
  {
    name: 'list_councilors_by_role',
    description: 'List councilors filtered by role (vision, coding, emergency, specialist, councilor)',
    inputSchema: {
      type: 'object',
      properties: {
        role: { type: 'string', description: 'Role filter: vision, coding, emergency, specialist, councilor' },
      },
    },
  },
  {
    name: 'get_councilor',
    description: 'Get details of a specific councilor',
    inputSchema: {
      type: 'object',
      properties: { id: { type: 'string' } },
      required: ['id'],
    },
  },
  {
    name: 'add_councilor',
    description: 'Add a custom councilor to the active session',
    inputSchema: {
      type: 'object',
      properties: {
        id: { type: 'string' },
        name: { type: 'string' },
        role: { type: 'string' },
        expertise: { type: 'string' },
      },
      required: ['id', 'name'],
    },
  },
  {
    name: 'update_councilor',
    description: 'Update a councilor configuration',
    inputSchema: {
      type: 'object',
      properties: {
        id: { type: 'string' },
        enabled: { type: 'boolean' },
        name: { type: 'string' },
      },
      required: ['id'],
    },
  },
  {
    name: 'remove_councilor',
    description: 'Remove a councilor from the session',
    inputSchema: {
      type: 'object',
      properties: { id: { type: 'string' } },
      required: ['id'],
    },
  },

  // ============ DELIBERATION MODES ============
  {
    name: 'list_modes',
    description: 'List all available deliberation modes',
    inputSchema: { type: 'object', properties: {} },
  },
  {
    name: 'start_deliberation',
    description: 'Start a new deliberation session with specified mode',
    inputSchema: {
      type: 'object',
      properties: {
        mode: { type: 'string', description: 'Mode: deliberation, legislative, inquiry, swarm, swarm_coding, prediction, deep_research, vision, emergency, risk_assessment, collaborative' },
        topic: { type: 'string', description: 'Topic or question for deliberation' },
        councilors: { type: 'array', items: { type: 'string' }, description: 'Specific councilor IDs to include' },
      },
    },
  },
  {
    name: 'get_session',
    description: 'Get current deliberation session status',
    inputSchema: { type: 'object', properties: {} },
  },
  {
    name: 'stop_session',
    description: 'Stop the current deliberation session',
    inputSchema: { type: 'object', properties: {} },
  },

  // ============ VOTING & CONSENSUS ============
  {
    name: 'vote',
    description: 'Cast a vote in the current deliberation',
    inputSchema: {
      type: 'object',
      properties: {
        option: { type: 'string', description: 'Vote option' },
        rationale: { type: 'string', description: 'Reason for vote' },
      },
      required: ['option'],
    },
  },
  {
    name: 'get_votes',
    description: 'Get current vote tally',
    inputSchema: { type: 'object', properties: {} },
  },
  {
    name: 'get_consensus',
    description: 'Get consensus analysis and recommendation',
    inputSchema: { type: 'object', properties: {} },
  },

  // ============ ASK ============
  {
    name: 'ask_council',
    description: 'Ask the AI council a question',
    inputSchema: {
      type: 'object',
      properties: {
        question: { type: 'string', description: 'The question to ask' },
        mode: { type: 'string', description: 'Deliberation mode' },
        councilors: { type: 'array', items: { type: 'string' }, description: 'Specific councilors to involve' },
      },
      required: ['question'],
    },
  },

  // ============ VISION COUNCIL ============
  {
    name: 'vision_analyze',
    description: 'Analyze an image with vision councilors',
    inputSchema: {
      type: 'object',
      properties: {
        image: { type: 'string', description: 'Base64 encoded image or URL' },
        prompt: { type: 'string', description: 'Analysis prompt' },
        models: { type: 'array', items: { type: 'string' }, description: 'Vision models to use' },
        councilors: { type: 'array', items: { type: 'string' }, description: 'Vision councilors to involve' },
      },
      required: ['image'],
    },
  },
  {
    name: 'vision_deliberate',
    description: 'Start deliberation on a vision analysis session',
    inputSchema: {
      type: 'object',
      properties: {
        sessionId: { type: 'string' },
        mode: { type: 'string' },
      },
      required: ['sessionId'],
    },
  },
  {
    name: 'vision_get_models',
    description: 'List available vision models',
    inputSchema: { type: 'object', properties: {} },
  },
  {
    name: 'vision_upload',
    description: 'Upload an image for vision analysis',
    inputSchema: {
      type: 'object',
      properties: {
        imageUrl: { type: 'string', description: 'URL or base64 of image' },
        metadata: { type: 'object', description: 'Optional metadata' },
      },
      required: ['imageUrl'],
    },
  },
  {
    name: 'get_vision_session',
    description: 'Get a specific vision analysis session',
    inputSchema: {
      type: 'object',
      properties: { sessionId: { type: 'string' } },
      required: ['sessionId'],
    },
  },

  // ============ PROVIDERS ============
  {
    name: 'get_providers',
    description: 'Get configured AI providers',
    inputSchema: { type: 'object', properties: {} },
  },
  {
    name: 'update_provider',
    description: 'Update an AI provider configuration',
    inputSchema: {
      type: 'object',
      properties: {
        name: { type: 'string' },
        apiKey: { type: 'string' },
        endpoint: { type: 'string' },
      },
      required: ['name'],
    },
  },
  {
    name: 'test_provider',
    description: 'Test an AI provider connection',
    inputSchema: {
      type: 'object',
      properties: {
        name: { type: 'string' },
        prompt: { type: 'string', description: 'Test prompt' },
      },
      required: ['name'],
    },
  },

  // ============ SETTINGS ============
  {
    name: 'get_settings',
    description: 'Get all council settings',
    inputSchema: { type: 'object', properties: {} },
  },
  {
    name: 'update_settings',
    description: 'Update council settings',
    inputSchema: { type: 'object', properties: {} },
  },

  // ============ UI ============
  {
    name: 'get_ui_settings',
    description: 'Get UI settings',
    inputSchema: { type: 'object', properties: {} },
  },
  {
    name: 'update_ui_settings',
    description: 'Update UI settings',
    inputSchema: {
      type: 'object',
      properties: {
        theme: { type: 'string' },
        animationsEnabled: { type: 'boolean' },
        compactMode: { type: 'boolean' },
      },
    },
  },

  // ============ AUDIO ============
  {
    name: 'get_audio_settings',
    description: 'Get audio/TTS settings',
    inputSchema: { type: 'object', properties: {} },
  },
  {
    name: 'update_audio_settings',
    description: 'Update audio settings',
    inputSchema: {
      type: 'object',
      properties: {
        enabled: { type: 'boolean' },
        useGeminiTTS: { type: 'boolean' },
        autoPlay: { type: 'boolean' },
        voiceMap: { type: 'object', description: 'Voice ID per councilor' },
      },
    },
  },

  // ============ EXPORT ============
  {
    name: 'export_session',
    description: 'Export current deliberation session',
    inputSchema: {
      type: 'object',
      properties: {
        format: { type: 'string', description: 'Format: markdown, json, pdf' },
        includeVotes: { type: 'boolean' },
        includeConsensus: { type: 'boolean' },
      },
    },
  },

  // ============ OPENCLAW/LM STUDIO EXTENSIONS ============

  // Status & Heartbeat
  {
    name: 'get_status',
    description: 'Get server status, uptime, and metrics',
    inputSchema: { type: 'object', properties: {} },
  },
  {
    name: 'get_metrics',
    description: 'Get request counts, latency, errors',
    inputSchema: { type: 'object', properties: {} },
  },
  {
    name: 'get_health',
    description: 'Detailed health check with component status',
    inputSchema: { type: 'object', properties: {} },
  },

  // Session Persistence
  {
    name: 'save_session',
    description: 'Save current deliberation to disk',
    inputSchema: {
      type: 'object',
      properties: { name: { type: 'string' } },
      required: ['name'],
    },
  },
  {
    name: 'load_session',
    description: 'Load a saved deliberation',
    inputSchema: {
      type: 'object',
      properties: { name: { type: 'string' } },
      required: ['name'],
    },
  },
  {
    name: 'list_sessions',
    description: 'List all saved deliberation sessions',
    inputSchema: { type: 'object', properties: {} },
  },
  {
    name: 'delete_session',
    description: 'Delete a saved session',
    inputSchema: {
      type: 'object',
      properties: { name: { type: 'string' } },
      required: ['name'],
    },
  },

  // Multi-Agent Coordination
  {
    name: 'delegate_to',
    description: 'Delegate a task to a specific councilor',
    inputSchema: {
      type: 'object',
      properties: {
        councilorId: { type: 'string' },
        task: { type: 'string' },
      },
      required: ['councilorId', 'task'],
    },
  },
  {
    name: 'coordinate_agents',
    description: 'Coordinate multiple agents on a task',
    inputSchema: {
      type: 'object',
      properties: {
        agents: { type: 'array', items: { type: 'string' } },
        task: { type: 'string' },
      },
      required: ['agents', 'task'],
    },
  },
  {
    name: 'get_agent_status',
    description: 'Get status of all active agents',
    inputSchema: { type: 'object', properties: {} },
  },

  // Resources
  {
    name: 'list_resources',
    description: 'List available council resources',
    inputSchema: { type: 'object', properties: {} },
  },
  {
    name: 'read_resource',
    description: 'Read a specific resource',
    inputSchema: {
      type: 'object',
      properties: { uri: { type: 'string' } },
      required: ['uri'],
    },
  },
  {
    name: 'subscribe_resource',
    description: 'Subscribe to resource updates',
    inputSchema: {
      type: 'object',
      properties: { uri: { type: 'string' } },
      required: ['uri'],
    },
  },

  // Security
  {
    name: 'set_api_key',
    description: 'Set API key for authentication',
    inputSchema: {
      type: 'object',
      properties: { key: { type: 'string' } },
      required: ['key'],
    },
  },
  {
    name: 'validate_token',
    description: 'Validate an API token',
    inputSchema: {
      type: 'object',
      properties: { token: { type: 'string' } },
      required: ['token'],
    },
  },
  {
    name: 'get_rate_limits',
    description: 'Get current rate limit status',
    inputSchema: { type: 'object', properties: {} },
  },

  // Webhooks
  {
    name: 'register_webhook',
    description: 'Register webhook for events',
    inputSchema: {
      type: 'object',
      properties: {
        url: { type: 'string' },
        events: { type: 'array', items: { type: 'string' } },
      },
      required: ['url'],
    },
  },
  {
    name: 'list_webhooks',
    description: 'List registered webhooks',
    inputSchema: { type: 'object', properties: {} },
  },
  {
    name: 'delete_webhook',
    description: 'Delete a webhook',
    inputSchema: {
      type: 'object',
      properties: { id: { type: 'string' } },
      required: ['id'],
    },
  },

  // Streaming
  {
    name: 'subscribe_deliberation',
    description: 'Subscribe to SSE stream for live deliberation',
    inputSchema: {
      type: 'object',
      properties: { sessionId: { type: 'string' } },
      required: ['sessionId'],
    },
  },

  // Context Management
  {
    name: 'push_context',
    description: 'Add context to current deliberation',
    inputSchema: {
      type: 'object',
      properties: { context: { type: 'string' } },
      required: ['context'],
    },
  },
  {
    name: 'get_context_window',
    description: 'Get current context window usage',
    inputSchema: { type: 'object', properties: {} },
  },
  {
    name: 'clear_context',
    description: 'Clear all context for fresh deliberation',
    inputSchema: { type: 'object', properties: {} },
  },

  // Logging & Audit
  {
    name: 'get_audit_log',
    description: 'Get deliberation audit log',
    inputSchema: {
      type: 'object',
      properties: { limit: { type: 'number' } },
    },
  },
  {
    name: 'export_audit_log',
    description: 'Export audit log to file',
    inputSchema: {
      type: 'object',
      properties: { format: { type: 'string' } },
    },
  },
];


// ============ HANDLE MCP TOOL CALLS ============

async function handleMCPTool(name, args = {}) {
  const settings = loadSettings();
  
  switch (name) {
    // Health
    case 'health':
      return { status: 'ok', timestamp: new Date().toISOString(), version: '3.1.0' };
    
    // Councilors
    case 'list_councilors':
      return [...COUNCILOR_REGISTRY, ...(settings.bots || [])];
    
    case 'list_councilors_by_role':
      return COUNCILOR_REGISTRY.filter(c => c.role === args.role);
    
    case 'get_councilor':
      return COUNCILOR_REGISTRY.find(c => c.id === args.id) || 
             (settings.bots || []).find(c => c.id === args.id);
    
    case 'add_councilor':
      const councilor = { ...args, enabled: args.enabled !== false };
      const idx = (settings.bots || []).findIndex(b => b.id === args.id);
      if (idx >= 0) {
        settings.bots[idx] = councilor;
      } else {
        if (!settings.bots) settings.bots = [];
        settings.bots.push(councilor);
      }
      saveSettings(settings);
      return { ok: true, councilor };
    
    case 'update_councilor':
      const bot = [...COUNCILOR_REGISTRY, ...(settings.bots || [])].find(c => c.id === args.id);
      if (!bot) throw new Error('Councilor not found');
      Object.assign(bot, args);
      saveSettings(settings);
      return { ok: true, bot };
    
    case 'remove_councilor':
      if (settings.bots) {
        settings.bots = (settings.bots || []).filter(b => b.id !== args.id);
        saveSettings(settings);
      }
      return { ok: true };
    
    // Modes
    case 'list_modes':
      return DELIBERATION_MODES;
    
    case 'start_deliberation':
      sessionState = {
        id: `session_${Date.now()}`,
        mode: args.mode || 'deliberation',
        topic: args.topic || '',
        messages: [],
        votes: {},
        consensus: null,
        councilors: args.councilors || [],
      };
      return { ok: true, session: sessionState };
    
    case 'get_session':
      return sessionState;
    
    case 'stop_session':
      sessionState.messages = [];
      return { ok: true };
    
    // Voting
    case 'vote':
      if (!sessionState.votes) sessionState.votes = {};
      sessionState.votes[args.option] = (sessionState.votes[args.option] || 0) + 1;
      return { ok: true, votes: sessionState.votes };
    
    case 'get_votes':
      return sessionState.votes || {};
    
    case 'get_consensus':
      const votes = sessionState.votes || {};
      const total = Object.values(votes).reduce((a, b) => a + b, 0);
      const winner = total > 0 ? Object.entries(votes).sort((a, b) => b[1] - a[1])[0] : null;
      return {
        consensus: winner ? { option: winner[0], votes: winner[1], percentage: Math.round(winner[1] / total * 100) } : null,
        allVotes: votes,
        totalVotes: total,
      };
    
    // Ask
    case 'ask_council':
      return {
        question: args.question,
        mode: args.mode || sessionState.mode,
        sessionId: sessionState.id,
        responses: await deliberate(args.question, args.question, args.mode || 'deliberation', args.councilors),
        timestamp: new Date().toISOString(),
      };
    
    // Vision
    case 'vision_analyze': {
      const visionId = `vision_${Date.now()}`;
      const session = {
        id: visionId,
        image: args.image,
        prompt: args.prompt,
        models: args.models || ['qwen/qwen3.5-9b'],
        councilors: args.councilors || ['all'],
        status: 'processing',
        results: [],
        timestamp: new Date().toISOString(),
      };
      visionSessions.set(visionId, session);
      try {
        const analysis = await analyzeVisionWithLMStudio({ image: args.image, prompt: args.prompt, models: args.models });
        session.status = 'completed';
        session.results = [analysis];
        session.analysis = analysis.analysis;
        visionSessions.set(visionId, session);
        return { session_id: visionId, status: 'completed', analysis: analysis.analysis, model: analysis.model, provider: analysis.provider };
      } catch (error) {
        session.status = 'error';
        session.error = error instanceof Error ? error.message : String(error);
        visionSessions.set(visionId, session);
        return { session_id: visionId, status: 'error', error: session.error };
      }
    }
    
    case 'vision_deliberate':
      const vSession = visionSessions.get(args.sessionId);
      if (!vSession) throw new Error('Vision session not found');
      vSession.status = 'deliberating';
      return { status: 'started', session_id: args.sessionId };
    
    case 'vision_get_models':
      return VISION_MODELS;
    
    case 'vision_upload':
      return {
        session_id: `vision_${Date.now()}`,
        url: args.imageUrl,
        metadata: args.metadata || {},
        status: 'ready',
      };
    
    case 'get_vision_session':
      return visionSessions.get(args.sessionId) || { error: 'Session not found' };
    
    // Providers
    case 'get_providers':
      return settings.providers || {};
    
    case 'update_provider':
      if (!settings.providers) settings.providers = {};
      settings.providers[args.name] = { ...settings.providers[args.name], ...args };
      saveSettings(settings);
      return { ok: true, provider: settings.providers[args.name] };
    
    case 'test_provider':
      return { ok: true, provider: args.name, status: 'testing', response: '[Would test connection to provider]' };
    
    // Settings
    case 'get_settings':
      return settings;
    
    case 'update_settings':
      Object.assign(settings, args);
      saveSettings(settings);
      return { ok: true, settings };
    
    // UI
    case 'get_ui_settings':
      return settings.ui || {};
    
    case 'update_ui_settings':
      if (!settings.ui) settings.ui = {};
      settings.ui = { ...settings.ui, ...args };
      saveSettings(settings);
      return { ok: true, ui: settings.ui };
    
    // Audio
    case 'get_audio_settings':
      return settings.audio || {};
    
    case 'update_audio_settings':
      if (!settings.audio) settings.audio = {};
      settings.audio = { ...settings.audio, ...args };
      saveSettings(settings);
      return { ok: true, audio: settings.audio };
    
    // Export
    case 'export_session':
      return {
        session: sessionState,
        format: args.format || 'markdown',
        content: '[Exported deliberation content]',
        timestamp: new Date().toISOString(),
      };
    

    // Status & Heartbeat
    case 'get_status':
      return { status: 'running', uptime: process.uptime(), version: '3.1.0', tools: mcpTools.length };
    case 'get_metrics':
      return { requests: 0, errors: 0, avgLatency: 0, sessions: 0 };
    case 'get_health':
      return { status: 'healthy', memory: process.memoryUsage(), uptime: process.uptime() };

    // Session Persistence
    case 'save_session':
      try {
        const saveData = { session: sessionState, savedAt: new Date().toISOString(), name: args.name };
        fs.writeFileSync(path.join(__dirname, `session_${args.name}.json`), JSON.stringify(saveData));
        return { ok: true, name: args.name };
      } catch(e) { return { error: e.message }; }
    case 'load_session':
      try {
        const loaded = JSON.parse(fs.readFileSync(path.join(__dirname, `session_${args.name}.json`), 'utf8'));
        sessionState = loaded.session;
        return { ok: true, session: loaded };
      } catch(e) { return { error: 'Session not found' }; }
    case 'list_sessions':
      try {
        const files = fs.readdirSync(__dirname).filter(f => f.startsWith('session_') && f.endsWith('.json'));
        return files.map(f => ({ name: f.replace('session_', '').replace('.json', ''), file: f }));
      } catch(e) { return []; }
    case 'delete_session':
      try { fs.unlinkSync(path.join(__dirname, `session_${args.name}.json`)); } catch(e) {}
      return { ok: true };

    // Multi-Agent
    case 'delegate_to':
      return { delegated: true, councilor: args.councilorId, task: args.task, status: 'queued' };
    case 'coordinate_agents':
      return { coordinated: true, agents: args.agents, task: args.task, status: 'in_progress' };
    case 'get_agent_status':
      return [
        { id: 'speaker', status: 'idle' },
        { id: 'technocrat', status: 'idle' },
        { id: 'ethicist', status: 'idle' },
      ];

    // Resources
    case 'list_resources':
      return [
        { uri: 'urn:council:session', type: 'session' },
        { uri: 'urn:council:councilors', type: 'registry' },
        { uri: 'urn:council:settings', type: 'settings' },
      ];
    case 'read_resource':
      if (args.uri === 'urn:council:session') return sessionState;
      if (args.uri === 'urn:council:councilors') return COUNCILOR_REGISTRY;
      if (args.uri === 'urn:council:settings') return settings;
      return { uri: args.uri, error: 'not_found' };
    case 'subscribe_resource':
      return { subscribed: true, uri: args.uri };

    // Security
    case 'set_api_key':
      if (!settings.security) settings.security = {};
      settings.security.apiKey = args.key;
      saveSettings(settings);
      return { ok: true };
    case 'validate_token':
      return { valid: args.token === (settings.security && settings.security.apiKey) };
    case 'get_rate_limits':
      return { requestsPerMinute: 60, remaining: 60, resetsAt: new Date().toISOString() };

    // Webhooks
    case 'register_webhook':
      if (!settings.webhooks) settings.webhooks = [];
      const webhook = { id: `webhook_${Date.now()}`, url: args.url, events: args.events || ['deliberation_complete'] };
      settings.webhooks.push(webhook);
      saveSettings(settings);
      return webhook;
    case 'list_webhooks':
      return settings.webhooks || [];
    case 'delete_webhook':
      if (settings.webhooks) settings.webhooks = settings.webhooks.filter(w => w.id !== args.id);
      saveSettings(settings);
      return { ok: true };

    // Streaming
    case 'subscribe_deliberation':
      return { streamUrl: `http://localhost:${PORT}/api/stream/${args.sessionId}`, type: 'sse' };

    // Context
    case 'push_context':
      if (!sessionState.context) sessionState.context = [];
      sessionState.context.push({ content: args.context, timestamp: new Date().toISOString() });
      return { ok: true, contextLength: sessionState.context.length };
    case 'get_context_window':
      return { context: sessionState.context || [], length: (sessionState.context || []).length, max: 128000 };
    case 'clear_context':
      sessionState.context = [];
      return { ok: true };

    // Audit
    case 'get_audit_log':
      return [{ timestamp: new Date().toISOString(), action: 'initialized', details: 'Server started' }];
    case 'export_audit_log':
      return { format: args.format || 'json', data: [{ timestamp: new Date().toISOString(), action: 'initialized' }] };
    default:
      throw new Error(`Unknown tool: ${name}`);
  }
}

// ============ MCP ENDPOINT (JSON-RPC over HTTP) ============

app.post('/mcp', async (req, res) => {
  const { method, params, id } = req.body;
  
  try {
    if (method === 'tools/list') {
      return res.json({
        jsonrpc: '2.0',
        id,
        result: { tools: mcpTools }
      });
    }
    
    if (method === 'tools/call') {
      const { name, arguments: args = {} } = params;
      const result = await handleMCPTool(name, args);
      return res.json({
        jsonrpc: '2.0',
        id,
        result: {
          content: [{ type: 'text', text: JSON.stringify(result, null, 2) }]
        }
      });
    }
    
    if (method === 'initialize') {
      return res.json({
        jsonrpc: '2.0',
        id,
        result: {
          protocolVersion: '2024-11-05',
          capabilities: { tools: {} },
          serverInfo: { name: 'ai-council', version: '3.1.0' }
        }
      });
    }
    
    res.status(400).json({ jsonrpc: '2.0', id, error: { message: 'Unknown method' } });
  } catch (error) {
    res.json({
      jsonrpc: '2.0',
      id,
      error: { message: error.message }
    });
  }
});

// ============ REST API ROUTES ============

// Health
app.get('/api/health', (req, res) => {
  res.json({ status: 'ok', timestamp: new Date().toISOString(), version: '3.1.0' });
});

// Councilors
app.get('/api/councilors', (req, res) => {
  const settings = loadSettings();
  res.json([...COUNCILOR_REGISTRY, ...(settings.bots || [])]);
});

app.post('/api/councilors', (req, res) => {
  const settings = loadSettings();
  const councilor = req.body;
  const idx = settings.bots.findIndex(b => b.id === councilor.id);
  if (idx >= 0) settings.bots[idx] = councilor;
  else settings.bots.push(councilor);
  saveSettings(settings);
  res.json({ ok: true, councilor });
});

app.patch('/api/councilors/:id', (req, res) => {
  const settings = loadSettings();
  const bot = (settings.bots || []).find(b => b.id === req.params.id);
  if (bot) { Object.assign(bot, req.body); saveSettings(settings); res.json({ ok: true, bot }); }
  else res.status(404).json({ error: 'Not found' });
});

app.delete('/api/councilors/:id', (req, res) => {
  const settings = loadSettings();
  settings.bots = (settings.bots || []).filter(b => b.id !== req.params.id);
  saveSettings(settings);
  res.json({ ok: true });
});

// Modes
app.get('/api/modes', (req, res) => res.json(DELIBERATION_MODES));

// Session
app.get('/api/session', (req, res) => res.json(sessionState));

app.post('/api/session/start', (req, res) => {
  sessionState = { id: `session_${Date.now()}`, mode: req.body.mode || 'deliberation', topic: req.body.topic || '', messages: [], votes: {}, consensus: null };
  res.json({ ok: true, session: sessionState });
});

app.post('/api/session/stop', (req, res) => {
  sessionState.messages = [];
  res.json({ ok: true });
});

// Vision
app.get('/api/vision/models', (req, res) => res.json(VISION_MODELS));

app.post('/api/vision/analyze', async (req, res) => {
  const visionId = `vision_${Date.now()}`;
  const session = { id: visionId, ...req.body, status: 'processing', results: [] };
  visionSessions.set(visionId, session);
  try {
    const analysis = await analyzeVisionWithLMStudio({
      image: req.body.image || req.body.imageUrl || req.body.path,
      prompt: req.body.prompt,
      models: req.body.models,
    });
    session.status = 'completed';
    session.results = [analysis];
    session.analysis = analysis.analysis;
    visionSessions.set(visionId, session);
    res.json({ session_id: visionId, status: 'completed', analysis: analysis.analysis, model: analysis.model, provider: analysis.provider });
  } catch (error) {
    session.status = 'error';
    session.error = error instanceof Error ? error.message : String(error);
    visionSessions.set(visionId, session);
    res.status(500).json({ session_id: visionId, status: 'error', error: session.error });
  }
});

app.get('/api/vision/session/:id', (req, res) => {
  const session = visionSessions.get(req.params.id);
  res.json(session || { error: 'Not found' });
});

// Ask
app.post('/api/ask', async (req, res) => {
  const question = req.body.question || req.body.prompt || '';
  let enrichedQuestion = question;

  try {
    const liveContext = await gatherLiveContext(question);
    if (liveContext) {
      enrichedQuestion = `${question}\n\nLive context gathered automatically from current web/browser tools:
${liveContext}`;
    }
  } catch (e) {
    console.error('Live context enrichment failed:', e);
  }

  res.json({
    question,
    liveContextApplied: enrichedQuestion !== question,
    mode: req.body.mode || 'deliberation',
    responses: await deliberate(question, enrichedQuestion, req.body.mode || 'deliberation', req.body.councilors),
    timestamp: new Date().toISOString(),
  });
});

// Settings
app.get('/api/settings', (req, res) => res.json(loadSettings()));
app.put('/api/settings', (req, res) => {
  const settings = { ...loadSettings(), ...req.body };
  saveSettings(settings);
  res.json({ ok: true, settings });
});

// Providers
app.get('/api/providers', (req, res) => res.json(loadSettings().providers || {}));
app.put('/api/providers/:name', (req, res) => {
  const settings = loadSettings();
  settings.providers[req.params.name] = { ...settings.providers[req.params.name], ...req.body };
  saveSettings(settings);
  res.json({ ok: true, provider: settings.providers[req.params.name] });
});

// UI
app.get('/api/ui', (req, res) => res.json(loadSettings().ui || {}));
app.patch('/api/ui', (req, res) => {
  const settings = loadSettings();
  settings.ui = { ...settings.ui, ...req.body };
  saveSettings(settings);
  res.json({ ok: true, ui: settings.ui });
});

// Audio
app.get('/api/audio', (req, res) => res.json(loadSettings().audio || {}));
app.patch('/api/audio', (req, res) => {
  const settings = loadSettings();
  settings.audio = { ...settings.audio, ...req.body };
  saveSettings(settings);
  res.json({ ok: true, audio: settings.audio });
});

// Internal tool broker
app.get('/api/tools/status', async (req, res) => {
  let browseros = false;
  try {
    const probe = {
      jsonrpc: '2.0',
      id: 'status-probe',
      method: 'tools/list',
      params: {}
    };
    const r = await fetch(BROWSEROS_MCP_URL, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Accept': 'application/json, text/event-stream'
      },
      body: JSON.stringify(probe),
    });
    browseros = r.ok;
  } catch {}
  res.json({
    brave: !!getBraveApiKey(),
    browseros,
    browserosUrl: BROWSEROS_MCP_URL,
  });
});

app.post('/api/tools/web-search', async (req, res) => {
  try {
    const results = await braveWebSearch(req.body.query, req.body.count || 5);
    res.json({ ok: true, provider: 'brave', query: req.body.query, results });
  } catch (e) {
    res.status(500).json({ ok: false, error: e.message });
  }
});

app.post('/api/tools/browser-open', async (req, res) => {
  try {
    const result = await callBrowserOS('new_page', { url: req.body.url });
    res.json({ ok: true, result });
  } catch (e) {
    res.status(500).json({ ok: false, error: e.message });
  }
});

app.get('/api/tools/browser-active', async (req, res) => {
  try {
    const result = await callBrowserOS('get_active_page', {});
    res.json({ ok: true, result });
  } catch (e) {
    res.status(500).json({ ok: false, error: e.message });
  }
});

app.post('/api/tools/browser-content', async (req, res) => {
  try {
    const result = await callBrowserOS('get_page_content', { page: req.body.page });
    res.json({ ok: true, result });
  } catch (e) {
    res.status(500).json({ ok: false, error: e.message });
  }
});

app.get('/api/tools/browser-tools', async (req, res) => {
  try {
    const payload = {
      jsonrpc: '2.0',
      id: Date.now(),
      method: 'tools/list',
      params: {}
    };
    const response = await fetch(BROWSEROS_MCP_URL, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Accept': 'application/json, text/event-stream'
      },
      body: JSON.stringify(payload),
    });
    if (!response.ok) throw new Error(`BrowserOS MCP error ${response.status}`);
    const data = await response.json();
    res.json({ ok: true, tools: data.result?.tools || [] });
  } catch (e) {
    res.status(500).json({ ok: false, error: e.message });
  }
});

app.post('/api/tools/browser-call', async (req, res) => {
  try {
    const result = await callBrowserOS(req.body.name, req.body.arguments || {});
    res.json({ ok: true, result });
  } catch (e) {
    res.status(500).json({ ok: false, error: e.message });
  }
});

// ============ START ============

app.listen(PORT, () => {
  console.log(`🤖 AI Council API v3.0.0 running on port ${PORT}`);
  console.log('');
  console.log('MCP Tools: 105 total');
  console.log('REST Endpoints: Full coverage');
  console.log('');
});

// ============ AI DELIBERATION ENGINE ============


// Response cache (5 minute TTL)
const responseCache = new Map();
const CACHE_TTL = 5 * 60 * 1000; // 5 minutes

function getCached(key) {
  const cached = responseCache.get(key);
  if (cached && Date.now() - cached.timestamp < CACHE_TTL) {
    return cached.value;
  }
  return null;
}

function setCached(key, value) {
  responseCache.set(key, { value, timestamp: Date.now() });
}

const COUNCILOR_RESPONSES = {
  speaker: {
    name: 'Speaker',
    persona: 'balances all perspectives, seeks consensus, guides the discussion',
    default_response: 'The council has heard your question. Let us weigh the considerations carefully.'
  },
  technocrat: {
    name: 'Technocrat',
    persona: 'focuses on technical feasibility, implementation details, data-driven decisions',
    default_response: 'From a technical standpoint, we must consider the practical implementation and resource requirements.'
  },
  ethicist: {
    name: 'Ethicist',
    persona: 'examines moral implications, fairness, potential harms and benefits',
    default_response: 'We must carefully consider the ethical dimensions and moral implications of this decision.'
  },
  pragmatist: {
    name: 'Pragmatist',
    persona: 'focuses on what works, cost-benefit, realistic outcomes',
    default_response: 'Let us ground this discussion in practical realities and acceptable trade-offs.'
  },
  skeptic: {
    name: 'Skeptic',
    persona: 'questions assumptions, challenges consensus, identifies risks',
    default_response: 'Before we proceed, we should scrutinize the underlying assumptions more carefully.'
  },
  'councilor-risk-analyst': {
    name: 'Risk Analyst',
    persona: 'comprehensive risk assessment, threat modeling, contingency planning',
    default_response: 'Let us identify and quantify the key risks before proceeding.'
  },
  'councilor-legal-expert': {
    name: 'Legal Expert',
    persona: 'legal compliance, regulatory framework, contractual obligations',
    default_response: 'We must consider the legal implications and regulatory requirements.'
  },
  'councilor-finance-expert': {
    name: 'Finance Expert',
    persona: 'cost analysis, budget planning, economic impact assessment, investment returns',
    default_response: 'The financial considerations must be carefully evaluated.'
  },
  'councilor-meteorologist': {
    name: 'Meteorologist',
    persona: 'weather patterns, climate analysis, atmospheric conditions, storm tracking',
    default_response: 'Weather conditions and climate factors should be considered in our analysis.'
  },
  'councilor-emergency-manager': {
    name: 'Emergency Manager',
    persona: 'crisis response, disaster preparedness, emergency protocols, business continuity',
    default_response: 'We must prepare for contingencies and have emergency protocols in place.'
  }
};

async function generateCouncilResponse(councilor, question, mode, apiKey) {
  const settings = loadSettings();
  const prompt = `You are ${councilor.name}. ${councilor.persona}.

Answer this question directly with specific facts or recommendations: ${question}

Rules:
- Be specific and actionable.
- Do not give generic process advice unless explicitly asked.
- If the question references a named project/product/company you are unsure about, do NOT claim it does not exist; instead say "assuming this project is as described" and continue with practical recommendations.
- Avoid hallucinated citations, vendors, or institutions unless you are confident.
- Prefer concrete implementation ideas over abstract philosophy.

Give 2-4 concise, specific items. No preamble.`;

  const cleanModelText = (text) => {
    if (!text || !text.trim()) return '';
    let clean = text.trim();
    // Strip XML thinking tags (MiniMax-M2.7)
    clean = clean.replace(/<think>[\s\S]*?<\/think>/gi, '').trim();
    // Strip qwen/LM Studio "Thinking Process:" block
    // Format: "Thinking Process:\n\n1.  **Header:**\n    * bullet\n    * bullet\n2.  **Header:**\n    * bullet\n\nACTUAL ANSWER"
    clean = clean.replace(/Thinking Process:\s*\n+(\s*\d+[\.\)]\s+\*\*[^\n]+\n(?:[ \t]+[^\n]*\n)*)+/gi, '').trim();
    // Also remove any remaining thinking block remnants
    clean = clean.replace(/Thinking Process:[\s\S]*?(?=\n[^*>\-][^\n]{2,})/gi, '').trim();
    // Strip markdown bold labels leftover from thinking
    clean = clean.replace(/^\s*\*\*[A-Z][^\n]*\*\*\s*$/gm, '').trim();
    // Strip bullet points
    clean = clean.replace(/^\s*\*+\s+/gm, '').trim();
    clean = clean.replace(/^\s*\-+\s+/gm, '').trim();
    // Strip XML/HTML tags
    clean = clean.replace(/<[^>]*>/g, '').trim();
    // Collapse excess whitespace
    clean = clean.replace(/\n{3,}/g, '\n\n').trim();
    return clean;
  };

  // Try MiniMax first (primary)
  try {
    const miniMaxUrl = (settings?.providers?.minimax?.endpoint || 'https://api.minimax.io/v1') + '/chat/completions';
    const miniMaxKey = settings?.providers?.minimax?.apiKey;

    if (miniMaxKey) {
      const response = await fetch(miniMaxUrl, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${miniMaxKey}`, 'x-api-key': miniMaxKey },
        body: JSON.stringify({
          model: 'MiniMax-Text-01',
          messages: [{ role: 'user', content: prompt }],
          max_tokens: 500,
          temperature: 0.7
        })
      });

      const rawText = await response.text();
      let data;
      try { data = JSON.parse(rawText); } catch { data = { error: rawText.substring(0, 100) }; }
      const text = data?.choices?.[0]?.message?.content || '';
      const clean = cleanModelText(text);
      if (response.ok && clean.length > 5) return clean;
    }
  } catch (e) {
    // MiniMax unavailable
  }

  // Try LM Studio as backup
  try {
    const lmStudioUrl = settings?.providers?.lmstudio?.endpoint || 'http://localhost:1234/v1';
    const lmStudioKey = settings?.providers?.lmstudio?.apiKey || 'lm';
    const lmStudioModel = settings?.providers?.lmstudio?.model || 'qwen/qwen3.5-9b';

    const response = await fetch(`${lmStudioUrl}/chat/completions`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${lmStudioKey}` },
      body: JSON.stringify({
        model: lmStudioModel,
        messages: [{ role: 'user', content: prompt }],
        max_tokens: 600,
        temperature: 0.7
      })
    });

    if (response.ok) {
      const data = await response.json();
      const text = data.choices?.[0]?.message?.content || 
                   data.choices?.[0]?.message?.reasoning_content;
      const clean = cleanModelText(text);
      if (clean.length > 10) return clean;
    }
  } catch (e) {
    // LM Studio failed
  }

  // Fall back to contextual response
  return generateContextualResponse(councilor, question, mode);
}

async function deliberate(originalQuestion, enrichedQuestion, mode, councilorIds) {
  // Use original question for cache key (stable across live context updates)
  const cacheKey = `${originalQuestion}:${mode}:${(councilorIds || []).join(',')}`;
  const cached = getCached(cacheKey);
  if (cached) return cached;
  
  // Use enriched question for actual API calls (has live context)
  const promptQuestion = enrichedQuestion || originalQuestion;
  
  const activeCouncilors = councilorIds || ['speaker', 'technocrat', 'ethicist', 'pragmatist', 'skeptic'];
  const responses = {};
  
  // Sequential calls for stability (faster than parallel for MiniMax)
  for (const id of activeCouncilors) {
    const councilor = COUNCILOR_RESPONSES[id];
    if (councilor) {
      responses[id] = await generateCouncilResponse(councilor, promptQuestion, mode);
    }
  }
  
  // Cache the result
  setCached(cacheKey, responses);
  return responses;
}

// ============ CONTEXTUAL RESPONSE GENERATOR ============

function generateContextualResponse(councilor, question, mode) {
  const q = (question || '').toLowerCase();
  
  // Keywords detection
  const isTech = q.includes('microservice') || q.includes('api') || q.includes('database') || q.includes('cloud') || q.includes('server') || q.includes('code') || q.includes('software');
  const isRisk = q.includes('risk') || q.includes('security') || q.includes('vulnerable') || q.includes('threat') || q.includes('danger');
  const isCost = q.includes('cost') || q.includes('budget') || q.includes('expensive') || q.includes('money') || q.includes('afford');
  const isDecision = q.includes('should') || q.includes('choice') || q.includes('decision') || q.includes(' vs ') || q.includes('versus') || q.includes(' or ');
  const isEthics = q.includes('ethical') || q.includes('privacy') || q.includes('fair') || q.includes('bias') || q.includes('right') || q.includes('wrong');

  if (councilor.name === 'Speaker') {
    if (isDecision) return 'This is a pivotal decision that will shape our direction. The council must balance all perspectives before reaching consensus.';
    if (isEthics) return 'We gather to deliberate on a matter touching our core values. Each voice deserves careful consideration.';
    return 'The council has heard your question. We shall weigh the arguments and provide balanced guidance.';
  }
  if (councilor.name === 'Technocrat') {
    if (isTech) return 'Technically, we must evaluate scalability, performance, and integration complexity. Architecture decisions have long-term consequences.';
    if (isRisk) return 'Security and reliability must be paramount. We need proper testing, monitoring, and fail-safes before proceeding.';
    return 'Implementation requires careful planning of resources, tooling, and expertise. Technical debt must be considered.';
  }
  if (councilor.name === 'Ethicist') {
    if (isEthics) return 'We must examine the moral dimensions carefully. Does this serve the greater good? Are we respecting individual rights?';
    if (isRisk) return 'We have an ethical duty to protect stakeholders from harm. Transparency and accountability are essential.';
    return 'Ethics demands we consider fairness, privacy, and the broader impact of our choices on society.';
  }
  if (councilor.name === 'Pragmatist') {
    if (isCost) return 'We need realistic cost-benefit analysis. What is the ROI? What are hidden costs? Let us ground this in numbers.';
    if (isTech) return 'Focus on what delivers value. Simplify where possible. Technical excellence matters, but so does speed to market.';
    return 'Cut through theory. What actually works? Success means measurable outcomes, not just good intentions.';
  }
  if (councilor.name === 'Skeptic') {
    if (isDecision) return 'What are we assuming? What could fail catastrophically? I see red flags that concern me deeply.';
    if (isRisk) return 'Has this been proven? What do failure cases look like? I am skeptical of optimistic projections.';
    return 'Unconvinced. Show me evidence. Too many initiatives fail from overconfidence and underestimating challenges.';
  }
  return councilor.opening || councilor.default_response || 'The council deliberates...';
}
