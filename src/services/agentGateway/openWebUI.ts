import { spawn } from 'child_process'
import { mkdir } from 'fs/promises'
import type { AgentGatewayConfig } from './config.js'

export type OpenWebUICommandPreview = {
  install: string
  serve: string
  url: string
}

export type OpenWebUIProcessResult = {
  command: string
  pid?: number
}

export function getOpenWebUIUrl(config: AgentGatewayConfig): string {
  return `http://${config.openWebUI.host}:${config.openWebUI.port}`
}

function getAgentApiBaseUrl(config: AgentGatewayConfig): string {
  const host =
    config.api.host === '0.0.0.0' || config.api.host === '::'
      ? '127.0.0.1'
      : config.api.host
  return `http://${host}:${config.api.port}/v1`
}

function getOpenWebUIAuthMode(): string {
  return process.env.OPEN_WEBUI_AUTH || 'False'
}

function getOpenWebUIRuntimeEnv(): Record<string, string> {
  return {
    LANG: process.env.LANG || 'C.UTF-8',
    PYTHONUTF8: process.env.PYTHONUTF8 || '1',
    PYTHONIOENCODING: process.env.PYTHONIOENCODING || 'utf-8',
  }
}

export function getOpenWebUICommandPreview(
  config: AgentGatewayConfig,
): OpenWebUICommandPreview {
  const python = config.openWebUI.pythonCommand || defaultPythonCommand()
  const dataPrefix = config.openWebUI.dataDir
    ? envAssignment('DATA_DIR', config.openWebUI.dataDir)
    : ''
  const openAIBase = getAgentApiBaseUrl(config)
  const openAIKey = config.api.apiKey || 'openclaude-local'
  const envPrefix = [
    dataPrefix,
    ...Object.entries(getOpenWebUIRuntimeEnv()).map(([name, value]) =>
      envAssignment(name, value),
    ),
    envAssignment('WEBUI_AUTH', getOpenWebUIAuthMode()),
    envAssignment('OPENAI_API_BASE_URLS', openAIBase),
    envAssignment('OPENAI_API_KEYS', maskSecret(openAIKey)),
  ].filter(Boolean).join(' ')

  return {
    install: `${python} -m pip install open-webui`,
    serve: `${envPrefix ? `${envPrefix} ` : ''}open-webui serve --host ${config.openWebUI.host} --port ${config.openWebUI.port}`,
    url: getOpenWebUIUrl(config),
  }
}

export async function installOpenWebUI(
  config: AgentGatewayConfig,
): Promise<OpenWebUIProcessResult> {
  const parsed = parseCommand(config.openWebUI.pythonCommand || defaultPythonCommand())
  return runToCompletion(parsed.command, [
    ...parsed.args,
    '-m',
    'pip',
    'install',
    'open-webui',
  ])
}

export async function startOpenWebUI(
  config: AgentGatewayConfig,
): Promise<OpenWebUIProcessResult> {
  if (config.openWebUI.dataDir) {
    await mkdir(config.openWebUI.dataDir, { recursive: true })
  }

  const child = spawn(
    'open-webui',
    ['serve', '--host', config.openWebUI.host, '--port', String(config.openWebUI.port)],
    {
      detached: true,
      stdio: 'ignore',
      shell: process.platform === 'win32',
      env: {
        ...process.env,
        ...getOpenWebUIRuntimeEnv(),
        ...(config.openWebUI.dataDir ? { DATA_DIR: config.openWebUI.dataDir } : {}),
        WEBUI_AUTH: getOpenWebUIAuthMode(),
        OPENAI_API_BASE_URLS: getAgentApiBaseUrl(config),
        OPENAI_API_KEYS: config.api.apiKey || 'openclaude-local',
      },
    },
  )
  child.unref()
  return {
    command: getOpenWebUICommandPreview(config).serve,
    pid: child.pid,
  }
}

function runToCompletion(
  command: string,
  args: string[],
): Promise<OpenWebUIProcessResult> {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, {
      stdio: 'ignore',
      shell: process.platform === 'win32',
    })
    child.on('error', reject)
    child.on('close', code => {
      if (code === 0) {
        resolve({
          command: [command, ...args].join(' '),
          pid: child.pid,
        })
      } else {
        reject(new Error(`command failed with exit code ${code}: ${command}`))
      }
    })
  })
}

function defaultPythonCommand(): string {
  return process.platform === 'win32' ? 'py -3.11' : 'python3.11'
}

function parseCommand(commandLine: string): { command: string; args: string[] } {
  const parts = commandLine.match(/(?:[^\s"]+|"[^"]*")+/g) ?? []
  const [command = defaultPythonCommand(), ...args] = parts.map(part =>
    part.replace(/^"|"$/g, ''),
  )
  return { command, args }
}

function envAssignment(name: string, value: string): string {
  const escaped = `"${value.replace(/"/g, '\\"')}"`
  if (process.platform === 'win32') {
    return `$env:${name}=${escaped}`
  }
  return `${name}=${escaped}`
}

function maskSecret(value: string): string {
  if (value.length <= 8) return '***'
  return `${value.slice(0, 4)}...${value.slice(-4)}`
}
