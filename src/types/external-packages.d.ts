/**
 * Type declarations for external packages not installed in this snapshot.
 * See src/types/message.ts for the same scoping caveat (issue #473).
 */

/* eslint-disable @typescript-eslint/no-explicit-any */
declare module '@ant/claude-for-chrome-mcp' {
  export type BROWSER_TOOLS = any
  export const BROWSER_TOOLS: any
  export type ClaudeForChromeContext = any
  export const ClaudeForChromeContext: any
  export const createClaudeForChromeMcpServer: any
  export type Logger = any
  export const Logger: any
  export type PermissionMode = any
  export const PermissionMode: any
}
declare module '@ant/computer-use-input' {
  export type ComputerUseInput = any
  export const ComputerUseInput: any
  export type ComputerUseInputAPI = any
  export const ComputerUseInputAPI: any
}
declare module '@ant/computer-use-mcp' {
  export type ComputerExecutor = any
  export const ComputerExecutor: any
  export type DisplayGeometry = any
  export const DisplayGeometry: any
  export type FrontmostApp = any
  export const FrontmostApp: any
  export type InstalledApp = any
  export const InstalledApp: any
  export type ResolvePrepareCaptureResult = any
  export const ResolvePrepareCaptureResult: any
  export type RunningApp = any
  export const RunningApp: any
  export type ScreenshotResult = any
  export const ScreenshotResult: any
  export type ScreenshotDims = any
  export const ScreenshotDims: any
  export const API_RESIZE_PARAMS: any
  export const targetImageSize: any
  export const buildComputerUseTools: any
  export const createComputerUseMcpServer: any
  export const bindSessionContext: any
  export type CuPermissionResponse = any
  export const CuPermissionResponse: any
  export const DEFAULT_GRANT_FLAGS: any
  export type ComputerUseSessionContext = any
  export const ComputerUseSessionContext: any
  export type CuCallToolResult = any
  export const CuCallToolResult: any
  export type CuPermissionRequest = any
  export const CuPermissionRequest: any
}
declare module '@ant/computer-use-mcp/sentinelApps' {
  export const sentinelApps: any[]
}
declare module '@ant/computer-use-mcp/types' {
  export type SentinelApp = any
}
declare module '@ant/computer-use-swift' {
  export type ComputerUseAPI = any
  export const ComputerUseAPI: any
}
declare module '@anthropic-ai/mcpb' {
  export type McpbManifest = any
  export const McpbManifest: any
  export type McpbUserConfigurationOption = any
  export const McpbUserConfigurationOption: any
}
declare module '@aws-sdk/client-bedrock' {
  export class BedrockClient { }
  export const ListFoundationModelsCommand: any
}
declare module '@aws-sdk/client-sts' {
  export class STSClient { }
}
declare module '@opentelemetry/exporter-logs-otlp-grpc' { export class OTLPLogExporter {} }
declare module '@opentelemetry/exporter-logs-otlp-proto' { export class OTLPLogExporter {} }
declare module '@opentelemetry/exporter-metrics-otlp-grpc' { export class OTLPMetricExporter {} }
declare module '@opentelemetry/exporter-metrics-otlp-http' { export class OTLPMetricExporter {} }
declare module '@opentelemetry/exporter-metrics-otlp-proto' { export class OTLPMetricExporter {} }
declare module '@opentelemetry/exporter-prometheus' { export class PrometheusExporter {} }
declare module '@opentelemetry/exporter-trace-otlp-http' { export class OTLPTraceExporter {} }
declare module '@opentelemetry/exporter-trace-otlp-proto' { export class OTLPTraceExporter {} }
declare module 'asciichart' { export function plot(data: number[], options?: any): string }
declare module 'audio-capture-napi' {
  const _: any
  export default _
  export function isNativeAudioAvailable(): boolean
  export function isNativeRecordingActive(): boolean
  export function startNativeRecording(): void
  export function stopNativeRecording(): void
}
declare module 'cacache' { const _: any; export default _ }
declare module 'image-processor-napi' { const _: any; export default _ }
declare module 'plist' { export function parse(input: string): any; export function build(obj: any): string }
declare module 'url-handler-napi' { const _: any; export default _ }
