declare module 'url-handler-napi' {
  export function waitForUrlEvent(timeoutMs?: number): string | null
}

declare module 'semver' {
  export type SemVer = {
    compare(other: SemVer): number
    version: string
  }

  export function coerce(version: string): SemVer | null
  export function gt(a: string, b: string, options?: { loose?: boolean }): boolean
  export function gte(a: string, b: string, options?: { loose?: boolean }): boolean
  export function lt(a: string, b: string, options?: { loose?: boolean }): boolean
  export function lte(a: string, b: string, options?: { loose?: boolean }): boolean
  export function satisfies(
    version: string,
    range: string,
    options?: { loose?: boolean },
  ): boolean
  export function compare(
    a: string,
    b: string,
    options?: { loose?: boolean },
  ): -1 | 0 | 1
}

declare module 'diff' {
  export type StructuredPatchHunk = {
    oldStart: number
    oldLines: number
    newStart: number
    newLines: number
    lines: string[]
  }

  export type StructuredPatch = {
    hunks: StructuredPatchHunk[]
  }

  export function structuredPatch(
    oldFileName: string,
    newFileName: string,
    oldStr: string,
    newStr: string,
    oldHeader?: string,
    newHeader?: string,
    options?: {
      context?: number
      ignoreWhitespace?: boolean
      timeout?: number
    },
  ): StructuredPatch | undefined

  export function diffLines(
    oldStr: string,
    newStr: string,
  ): Array<{ value?: string; added?: boolean; removed?: boolean }>
}

declare module 'proper-lockfile' {
  export type LockOptions = Record<string, unknown>
  export type UnlockOptions = Record<string, unknown>
  export type CheckOptions = Record<string, unknown>

  export function lock(
    file: string,
    options?: LockOptions,
  ): Promise<() => Promise<void>>
  export function lockSync(file: string, options?: LockOptions): () => void
  export function unlock(file: string, options?: UnlockOptions): Promise<void>
  export function check(file: string, options?: CheckOptions): Promise<boolean>
}

declare module 'ws' {
  export default class WebSocket {
    readonly readyState: number
    on(event: string, listener: (...args: unknown[]) => void): this
    off(event: string, listener: (...args: unknown[]) => void): this
    send(data: string, cb?: (error?: Error) => void): void
    close(): void
  }
}

declare module '@aws-sdk/client-bedrock' {
  export class BedrockClient {
    constructor(config?: Record<string, unknown>)
    send(command: unknown): Promise<any>
  }
  export class ListInferenceProfilesCommand {
    constructor(input?: Record<string, unknown>)
  }
  export class GetInferenceProfileCommand {
    constructor(input?: Record<string, unknown>)
  }
}

declare module '@anthropic-ai/mcpb' {
  export type McpbManifest = {
    name: string
    author: { name: string }
    user_config?: Record<string, McpbUserConfigurationOption>
    [key: string]: unknown
  }

  export type McpbUserConfigurationOption = {
    type?: string
    title?: string
    description?: string
    default?: unknown
    sensitive?: boolean
    items?: unknown
    enum?: unknown[]
    [key: string]: unknown
  }

  export const McpbManifestSchema: {
    safeParse(input: unknown):
      | { success: true; data: McpbManifest }
      | {
          success: false
          error: {
            flatten(): {
              fieldErrors: Record<string, string[] | undefined>
              formErrors: string[]
            }
          }
        }
  }
}

declare module '@ant/computer-use-mcp/types' {
  export type CoordinateMode = 'pixels' | 'normalized'

  export type CuSubGates = {
    pixelValidation: boolean
    clipboardPasteMultiline: boolean
    mouseAnimation: boolean
    hideBeforeAction: boolean
    autoTargetDisplay: boolean
    clipboardGuard: boolean
  }

  export interface Logger {
    silly(message: string, ...args: unknown[]): void
    debug(message: string, ...args: unknown[]): void
    info(message: string, ...args: unknown[]): void
    warn(message: string, ...args: unknown[]): void
    error(message: string, ...args: unknown[]): void
  }

  export type InstalledApp = {
    name: string
    bundleId: string
    pid?: number
  }

  export type RunningApp = InstalledApp
  export type FrontmostApp = InstalledApp | null

  export type DisplayGeometry = {
    id?: number
    width: number
    height: number
    x?: number
    y?: number
    scaleFactor?: number
  }

  export type ScreenshotResult = {
    imageDataBase64: string
    width: number
    height: number
  }

  export type ResolvePrepareCaptureResult = {
    displayId?: number
    originX?: number
    originY?: number
    width: number
    height: number
    scaleFactor?: number
  }

  export type ScreenshotDims = {
    width: number
    height: number
    displayWidth: number
    displayHeight: number
    displayId?: number
    originX?: number
    originY?: number
  }

  export type CuPermissionRequest = Record<string, unknown>
  export type CuPermissionResponse = Record<string, unknown>
  export type CuCallToolResult = {
    content?: unknown
    isError?: boolean
    telemetry?: { error_kind?: string }
    [key: string]: unknown
  }

  export type ComputerExecutor = {
    capabilities: Record<string, unknown>
    listInstalledApps(): Promise<InstalledApp[]>
  } & Record<string, (...args: any[]) => any>

  export type ComputerUseSessionContext = {
    getAllowedApps(): Array<{ bundleId: string }>
    getGrantFlags(): Record<string, boolean>
    getUserDeniedBundleIds(): string[]
    getSelectedDisplayId(): number | undefined
    getDisplayPinnedByModel(): boolean
    getDisplayResolvedForApps(): string | undefined
    getLastScreenshotDims(): ScreenshotDims | undefined
    onPermissionRequest(req: CuPermissionRequest, signal?: AbortSignal): Promise<CuPermissionResponse>
    onAllowedAppsChanged(apps: Array<{ bundleId: string }>, flags: Record<string, boolean>): void
    onAppsHidden(ids: string[]): void
    onResolvedDisplayUpdated(id: number | undefined): void
    onDisplayPinned(id: number | undefined): void
    onDisplayResolvedForApps(key: string | undefined): void
    onScreenshotCaptured(dims: ScreenshotDims): void
    checkCuLock(): Promise<{ holder?: string; isSelf: boolean }>
    acquireCuLock(): Promise<void>
    formatLockHeldMessage(holder: string): string
  }

  export type ComputerUseHostAdapter = {
    serverName: string
    logger: Logger
    executor: ComputerExecutor
    ensureOsPermissions(): Promise<{ granted: boolean; accessibility?: boolean; screenRecording?: boolean }>
    isDisabled(): boolean
    getSubGates(): CuSubGates
    getAutoUnhideEnabled(): boolean
    cropRawPatch(): null
  }
}

declare module '@ant/computer-use-mcp' {
  import type {
    ComputerExecutor,
    ComputerUseHostAdapter,
    ComputerUseSessionContext,
    CoordinateMode,
    CuCallToolResult,
    CuPermissionRequest,
    CuPermissionResponse,
    DisplayGeometry,
    FrontmostApp,
    InstalledApp,
    ResolvePrepareCaptureResult,
    RunningApp,
    ScreenshotDims,
    ScreenshotResult,
  } from '@ant/computer-use-mcp/types'

  export type {
    ComputerExecutor,
    ComputerUseHostAdapter,
    ComputerUseSessionContext,
    CoordinateMode,
    CuCallToolResult,
    CuPermissionRequest,
    CuPermissionResponse,
    DisplayGeometry,
    FrontmostApp,
    InstalledApp,
    ResolvePrepareCaptureResult,
    RunningApp,
    ScreenshotDims,
    ScreenshotResult,
  }

  export const API_RESIZE_PARAMS: Record<string, unknown>
  export const DEFAULT_GRANT_FLAGS: Record<string, boolean>

  export function targetImageSize(
    width: number,
    height: number,
    params: Record<string, unknown>,
  ): [number, number]

  export function buildComputerUseTools(
    capabilities: Record<string, unknown>,
    coordinateMode: CoordinateMode,
    installedAppNames?: string[],
  ): Array<{ name: string }>

  export function createComputerUseMcpServer(
    adapter: ComputerUseHostAdapter,
    coordinateMode: CoordinateMode,
  ): {
    connect(transport: unknown): Promise<void>
    setRequestHandler(schema: unknown, handler: (...args: unknown[]) => unknown): void
  }

  export function bindSessionContext(
    adapter: ComputerUseHostAdapter,
    coordinateMode: CoordinateMode,
    context: ComputerUseSessionContext,
  ): (name: string, args: unknown) => Promise<CuCallToolResult>
}

declare module '@ant/computer-use-input' {
  export type ComputerUseInputAPI = {
    moveMouse(x: number, y: number, smooth?: boolean): Promise<void>
    key(key: string, action?: 'press' | 'release'): Promise<void>
    keys(keys: string[]): Promise<void>
  } & Record<string, (...args: any[]) => any>

  export type ComputerUseInput =
    | ({ isSupported: true } & ComputerUseInputAPI)
    | { isSupported: false }
}

declare module '@ant/computer-use-swift' {
  export type ComputerUseAPI = {
    tcc: {
      checkAccessibility(): boolean
      checkScreenRecording(): boolean
    }
    apps?: Record<string, unknown>
  } & Record<string, any>
}

declare module '@opentelemetry/exporter-metrics-otlp-grpc'
declare module '@opentelemetry/exporter-metrics-otlp-http'
declare module '@opentelemetry/exporter-metrics-otlp-proto'
declare module '@opentelemetry/exporter-prometheus'
declare module '@opentelemetry/exporter-logs-otlp-grpc'
declare module '@opentelemetry/exporter-logs-otlp-proto'
declare module '@opentelemetry/exporter-trace-otlp-http'
declare module '@opentelemetry/exporter-trace-otlp-proto'
