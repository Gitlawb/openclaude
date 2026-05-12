import { spawnSync } from 'child_process'
import { z } from 'zod/v4'
import { buildTool } from '../../Tool.js'
import { lazySchema } from '../../utils/lazySchema.js'
import { DESCRIPTION, NETWORK_DIAGNOSTIC_TOOL_NAME, PROMPT } from './prompt.js'

const inputSchema = lazySchema(() =>
  z.strictObject({
    action: z.enum(['ping', 'dns', 'traceroute', 'port-check', 'ssl-cert', 'http-status', 'latency']).describe('Diagnostic action'),
    target: z.string().min(1).describe('Hostname or IP address'),
    port: z.number().min(1).max(65535).optional().describe('Port for port-check/latency/ssl-cert'),
    recordType: z.enum(['A', 'AAAA', 'MX', 'NS', 'TXT', 'CNAME', 'SOA']).optional().default('A').describe('DNS record type'),
    timeout: z.number().min(1).max(120).optional().default(15).describe('Timeout in seconds'),
  }),
)
type InputSchema = ReturnType<typeof inputSchema>

const outputSchema = lazySchema(() =>
  z.object({
    success: z.boolean(),
    action: z.string(),
    target: z.string(),
    output: z.string(),
    durationMs: z.number(),
    error: z.string().optional(),
  }),
)
type OutputSchema = ReturnType<typeof outputSchema>
export type Output = z.infer<OutputSchema>

const MAX_OUTPUT_CHARS = 20_000
const SAFE_TARGET = /^[a-zA-Z0-9.\-_:]+$/

export const NetworkDiagnosticTool = buildTool({
  name: NETWORK_DIAGNOSTIC_TOOL_NAME,
  searchHint: 'run network diagnostics (ping, dns, traceroute)',
  maxResultSizeChars: MAX_OUTPUT_CHARS,
  strict: true,
  get inputSchema(): InputSchema { return inputSchema() },
  get outputSchema(): OutputSchema { return outputSchema() },
  userFacingName: () => 'Network Diagnostic',
  isReadOnly() { return true },
  isDestructive() { return false },
  toAutoClassifierInput(input) { return `${input.action} ${input.target}${input.port ? `:${input.port}` : ''}` },
  async description() { return DESCRIPTION },
  async prompt() { return PROMPT },
  async validateInput(input) {
    if (!input.target) return { result: false, message: 'Missing required parameter: target', errorCode: 1 }
    if ((input.action === 'port-check' || input.action === 'latency') && !input.port) return { result: false, message: `Port required for ${input.action}`, errorCode: 1 }
    if (!SAFE_TARGET.test(input.target)) return { result: false, message: 'Invalid characters in target', errorCode: 1 }
    return { result: true }
  },
  async checkPermissions(input) {
    return { behavior: 'ask', askReason: `Run ${input.action} on ${input.target}${input.port ? `:${input.port}` : ''}?`, updatedInput: input }
  },
  mapToolResultToToolResultBlockParam(output, toolUseID) {
    return { tool_use_id: toolUseID, type: 'tool_result', content: JSON.stringify(output) }
  },
  renderToolUseMessage(input) {
    return { type: 'text', text: `${input.action} ${input.target}${input.port ? `:${input.port}` : ''}` }
  },
  renderToolResultMessage(output) {
    if (!output.success) return { type: 'text', text: `${output.action} to ${output.target} failed: ${output.error}` }
    return { type: 'text', text: `${output.action} to ${output.target} completed in ${output.durationMs}ms` }
  },
  async call(input, _ctx, _canUseTool?, _parentMessage?, _onProgress?) {
    const startTime = Date.now()
    const timeout = (input.timeout ?? 15) * 1000
    try {
      let binary = ''; const args: string[] = []
      switch (input.action) {
        case 'ping': binary = 'ping'; args.push(process.platform === 'win32' ? '-n' : '-c', '4'); if (process.platform !== 'win32') args.push('-W', String(input.timeout ?? 15)); args.push(input.target); break
        case 'dns': binary = process.platform === 'win32' ? 'nslookup' : 'dig'; if (process.platform !== 'win32') args.push(input.target, input.recordType ?? 'A', `+timeout=${input.timeout ?? 15}`); else args.push('-type=' + (input.recordType ?? 'A'), input.target); break
        case 'traceroute': binary = process.platform === 'win32' ? 'tracert' : 'traceroute'; if (process.platform !== 'win32') args.push('-m', '15', '-w', String(Math.min(input.timeout ?? 15, 5))); else args.push('-h', '15'); args.push(input.target); break
        case 'port-check': binary = 'bash'; args.push('-c', `echo > /dev/tcp/${input.target}/${input.port} 2>&1 && echo 'open' || echo 'closed'`); break
        case 'ssl-cert': binary = 'openssl'; args.push('s_client', '-connect', `${input.target}:${input.port ?? 443}`, '-servername', input.target); break
        case 'http-status': binary = 'curl'; args.push('-sI', '-o', '/dev/null', '-w', '%{http_code}', '--max-time', String(input.timeout ?? 10), `https://${input.target}${input.port ? `:${input.port}` : ''}`); break
        case 'latency': binary = 'bash'; args.push('-c', `T0=$(date +%s%N); echo > /dev/tcp/${input.target}/${input.port ?? 80} 2>/dev/null; echo $((($(date +%s%N)-T0)/1000000)) ms`); break
      }
      const result = spawnSync(binary, args, { timeout, maxBuffer: MAX_OUTPUT_CHARS, encoding: 'utf-8' })
      const stdout = (result.stdout ?? '').slice(0, MAX_OUTPUT_CHARS)
      const stderr = (result.stderr ?? '').slice(0, 2000)
      return { data: { success: (result.status ?? 1) === 0, action: input.action, target: input.target, output: stdout || stderr || 'No output', durationMs: Date.now() - startTime, error: stderr || undefined } }
    } catch (err) {
      return { data: { success: false, action: input.action, target: input.target, output: err instanceof Error ? err.message : String(err), durationMs: Date.now() - startTime, error: err instanceof Error ? err.message : String(err) } }
    }
  },
})
