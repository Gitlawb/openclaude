/**
 * Ambient declarations for optional/native packages that are loaded lazily or
 * kept external by the bundled build. These declarations describe only the
 * surface used by this repository so `tsc --noEmit` can typecheck without the
 * optional packages installed.
 */

declare module '@anthropic-ai/claude-agent-sdk' {
  export type PermissionMode =
    | 'default'
    | 'acceptEdits'
    | 'bypassPermissions'
    | 'plan'
}

declare module 'asciichart' {
  export function plot(
    series: number[] | number[][],
    options?: {
      height?: number
      colors?: string[]
      format?: (value: number) => string
    },
  ): string
}

declare module 'plist' {
  export function parse(input: string): Record<string, unknown>
}

declare module 'cacache' {
  export const ls: {
    stream(path: string): AsyncIterable<{ key: string; time: number }>
  }

  export const rm: {
    entry(path: string, key: string): Promise<void>
  }
}

declare module 'url-handler-napi' {
  export function waitForUrlEvent(timeoutMs: number): string | null
}

declare module 'audio-capture-napi' {
  export function isNativeAudioAvailable(): boolean
  export function isNativeRecordingActive(): boolean
  export function startNativeRecording(
    onData: (data: Buffer) => void,
    onEnd: () => void,
  ): boolean
  export function stopNativeRecording(): void
  export function startRecording(options: unknown): Promise<unknown>
  export function stopRecording(): Promise<unknown>
  export const cancelRecording: (() => Promise<void>) | undefined
}

declare module 'image-processor-napi' {
  type SharpInstance = {
    metadata(): Promise<{ width: number; height: number; format: string }>
    resize(
      width: number,
      height: number,
      options?: { fit?: string; withoutEnlargement?: boolean },
    ): SharpInstance
    jpeg(options?: { quality?: number }): SharpInstance
    png(options?: {
      compressionLevel?: number
      palette?: boolean
      colors?: number
    }): SharpInstance
    webp(options?: { quality?: number }): SharpInstance
    toBuffer(): Promise<Buffer>
  }

  type SharpFunction = (input: Buffer) => SharpInstance
  type ClipboardImage = {
    png: Buffer
    width: number
    height: number
    originalWidth: number
    originalHeight: number
  }

  export const __stub: boolean | undefined
  export const sharp: SharpFunction
  export default sharp

  export function getNativeModule():
    | {
        hasClipboardImage?: () => boolean
        readClipboardImage?: (
          maxWidth: number,
          maxHeight: number,
        ) => ClipboardImage | null
      }
    | undefined
}

declare module '@aws-sdk/client-sts' {
  export class STSClient {
    send(command: GetCallerIdentityCommand): Promise<unknown>
  }

  export class GetCallerIdentityCommand {
    constructor(input?: Record<string, never>)
  }
}

declare module '@aws-sdk/client-bedrock' {
  export type BedrockClientConfig = {
    region?: string
    endpoint?: string
    credentials?: {
      accessKeyId: string
      secretAccessKey: string
      sessionToken?: string
    }
    requestHandler?: unknown
    httpAuthSchemes?: unknown[]
    httpAuthSchemeProvider?: () => unknown[]
  }

  export type InferenceProfileSummary = {
    inferenceProfileId?: string
  }

  export type ListInferenceProfilesCommandOutput = {
    inferenceProfileSummaries?: InferenceProfileSummary[]
    nextToken?: string
  }

  export type GetInferenceProfileCommandOutput = {
    models?: Array<{ modelArn?: string }>
  }

  export class BedrockClient {
    constructor(config?: BedrockClientConfig)
    send(
      command: ListInferenceProfilesCommand,
    ): Promise<ListInferenceProfilesCommandOutput>
    send(
      command: GetInferenceProfileCommand,
    ): Promise<GetInferenceProfileCommandOutput>
  }

  export class ListInferenceProfilesCommand {
    readonly input: { nextToken?: string; typeEquals?: string }
    constructor(input: { nextToken?: string; typeEquals?: string })
  }

  export class GetInferenceProfileCommand {
    readonly input: { inferenceProfileIdentifier: string }
    constructor(input: { inferenceProfileIdentifier: string })
  }
}

declare module '@anthropic-ai/mcpb' {
  export type McpbUserConfigurationOption = {
    type: 'string' | 'number' | 'boolean' | 'file' | 'directory' | string
    title?: string
    required?: boolean
    multiple?: boolean
    min?: number
    max?: number
    sensitive?: boolean
  }

  export type McpbManifest = {
    name: string
    version?: string
    author: { name: string }
    server?: unknown
    user_config?: Record<string, McpbUserConfigurationOption>
  }

  export const McpbManifestSchema: {
    safeParse(input: unknown):
      | { success: true; data: McpbManifest }
      | {
          success: false
          error: {
            flatten(): {
              fieldErrors: Record<string, string[] | undefined>
              formErrors?: string[]
            }
          }
        }
  }

  export function getMcpConfigForManifest(input: {
    manifest: McpbManifest
    extensionPath: string
    systemDirs: unknown
    userConfig: Record<string, string | number | boolean | string[]>
    pathSeparator: string
  }): Promise<unknown>
}

declare module '@ant/claude-for-chrome-mcp' {
  export type Logger = {
    silly(message: string, ...args: unknown[]): void
    debug(message: string, ...args: unknown[]): void
    info(message: string, ...args: unknown[]): void
    warn(message: string, ...args: unknown[]): void
    error(message: string, ...args: unknown[]): void
  }

  export type PermissionMode =
    | 'ask'
    | 'skip_all_permission_checks'
    | 'follow_a_plan'

  export type ClaudeForChromeContext = {
    serverName: string
    logger: Logger
    socketPath: string
    getSocketPaths: () => string[]
    clientTypeId: string
    onAuthenticationError: () => void
    onToolCallDisconnected: () => string
    onExtensionPaired: (deviceId: string, name: string) => void
    getPersistedDeviceId: () => string | undefined
    bridgeConfig?: unknown
    initialPermissionMode?: PermissionMode
    callAnthropicMessages?: (request: unknown) => Promise<unknown>
    trackEvent: (eventName: string, metadata?: Record<string, unknown>) => void
  }

  export const BROWSER_TOOLS: Array<{ name: string }>

  export function createClaudeForChromeMcpServer(
    context: ClaudeForChromeContext,
  ): {
    connect(transport: unknown): Promise<void>
    close(): Promise<void>
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

  export type FrontmostApp = {
    bundleId: string
    displayName: string
  }

  export type ComputerUseApp = FrontmostApp & {
    path?: string
  }

  export type AppGrant = FrontmostApp & {
    grantedAt: number
  }

  export type DisplayGeometry = {
    id?: number
    width: number
    height: number
    scaleFactor: number
  }

  export type InstalledApp = FrontmostApp & {
    path?: string
    iconDataUrl?: string
  }

  export type RunningApp = FrontmostApp

  export type ResolvePrepareCaptureResult = unknown

  export type ScreenshotResult = {
    base64: string
    width: number
    height: number
  }

  export type CuGrantFlags = {
    clipboardRead: boolean
    clipboardWrite: boolean
    systemKeyCombos: boolean
  }

  export const DEFAULT_GRANT_FLAGS: CuGrantFlags

  export type CuPermissionRequest = {
    tccState?: { accessibility: boolean; screenRecording: boolean }
    apps?: ComputerUseApp[]
    grantFlags?: CuGrantFlags
  }

  export type CuPermissionResponse = {
    granted: AppGrant[]
    denied: ComputerUseApp[]
    flags: CuGrantFlags
  }

  export type Logger = {
    silly(message: string, ...args: unknown[]): void
    debug(message: string, ...args: unknown[]): void
    info(message: string, ...args: unknown[]): void
    warn(message: string, ...args: unknown[]): void
    error(message: string, ...args: unknown[]): void
  }

  export type ComputerExecutor = {
    capabilities: {
      screenshotFiltering: 'native'
      platform: 'darwin'
      hostBundleId: string
    }
    prepareForAction(
      allowlistBundleIds: string[],
      displayId?: number,
    ): Promise<string[]>
    previewHideSet(
      allowlistBundleIds: string[],
      displayId?: number,
    ): Promise<Array<{ bundleId: string; displayName: string }>>
    getDisplaySize(displayId?: number): Promise<DisplayGeometry>
    listDisplays(): Promise<DisplayGeometry[]>
    findWindowDisplays(
      bundleIds: string[],
    ): Promise<Array<{ bundleId: string; displayIds: number[] }>>
    resolvePrepareCapture(opts: {
      allowedBundleIds: string[]
      preferredDisplayId?: number
      autoResolve: boolean
      doHide?: boolean
    }): Promise<ResolvePrepareCaptureResult>
    screenshot(opts: {
      allowedBundleIds: string[]
      displayId?: number
    }): Promise<ScreenshotResult>
    zoom(
      regionLogical: { x: number; y: number; w: number; h: number },
      allowedBundleIds: string[],
      displayId?: number,
    ): Promise<ScreenshotResult>
    key(keySequence: string, repeat?: number): Promise<void>
    holdKey(keyNames: string[], durationMs: number): Promise<void>
    type(text: string, opts: { viaClipboard: boolean }): Promise<void>
    readClipboard(): Promise<string>
    writeClipboard(text: string): Promise<void>
    moveMouse(x: number, y: number): Promise<void>
    click(
      x: number,
      y: number,
      button: 'left' | 'right' | 'middle',
      count: 1 | 2 | 3,
      modifiers?: string[],
    ): Promise<void>
    mouseDown(): Promise<void>
    mouseUp(): Promise<void>
    getCursorPosition(): Promise<{ x: number; y: number }>
    drag(
      from: { x: number; y: number } | undefined,
      to: { x: number; y: number },
    ): Promise<void>
    scroll(x: number, y: number, dx: number, dy: number): Promise<void>
    getFrontmostApp(): Promise<FrontmostApp | null>
    appUnderPoint(
      x: number,
      y: number,
    ): Promise<{ bundleId: string; displayName: string } | null>
    listInstalledApps(): Promise<InstalledApp[]>
    getAppIcon(path: string): Promise<string | undefined>
    listRunningApps(): Promise<RunningApp[]>
    openApp(bundleId: string): Promise<void>
  }

  export type ComputerUseHostAdapter = {
    serverName: string
    logger: Logger
    executor: ComputerExecutor
    ensureOsPermissions: () => Promise<
      | { granted: true }
      | { granted: false; accessibility: boolean; screenRecording: boolean }
    >
    isDisabled: () => boolean
    getSubGates: () => CuSubGates
    getAutoUnhideEnabled: () => boolean
    cropRawPatch: () => null
  }
}

declare module '@ant/computer-use-mcp' {
  import type {
    AppGrant,
    ComputerExecutor,
    ComputerUseHostAdapter,
    CoordinateMode,
    CuGrantFlags,
    CuPermissionRequest,
    CuPermissionResponse,
    DisplayGeometry,
    FrontmostApp,
    InstalledApp,
    ResolvePrepareCaptureResult,
    RunningApp,
    ScreenshotResult,
  } from '@ant/computer-use-mcp/types'

  export type {
    AppGrant,
    ComputerExecutor,
    ComputerUseHostAdapter,
    CoordinateMode,
    CuPermissionRequest,
    CuPermissionResponse,
    DisplayGeometry,
    FrontmostApp,
    InstalledApp,
    ResolvePrepareCaptureResult,
    RunningApp,
    ScreenshotResult,
  }

  export type ScreenshotDims = {
    displayId?: number
    originX?: number
    originY?: number
    width: number
    height: number
    displayWidth: number
    displayHeight: number
  }

  export type ComputerUseSessionContext = {
    getAllowedApps: () => readonly AppGrant[]
    getGrantFlags: () => CuGrantFlags
    getUserDeniedBundleIds: () => string[]
    getSelectedDisplayId: () => number | undefined
    getDisplayPinnedByModel: () => boolean
    getDisplayResolvedForApps: () => string | undefined
    getLastScreenshotDims: () => ScreenshotDims | undefined
    onPermissionRequest: (
      request: CuPermissionRequest,
      dialogSignal?: AbortSignal,
    ) => Promise<CuPermissionResponse>
    onAllowedAppsChanged: (
      apps: readonly AppGrant[],
      flags: CuGrantFlags,
    ) => void
    onAppsHidden: (bundleIds: string[]) => void
    onResolvedDisplayUpdated: (displayId: number | undefined) => void
    onDisplayPinned: (displayId: number | undefined) => void
    onDisplayResolvedForApps: (key: string) => void
    onScreenshotCaptured: (dims: ScreenshotDims) => void
    checkCuLock: () => Promise<{ holder?: string; isSelf: boolean }>
    acquireCuLock: () => Promise<void>
    formatLockHeldMessage: (holder: string) => string
  }

  export type CuCallToolResult = {
    content?:
      | Array<
          | { type: 'image'; data: string; mimeType?: string }
          | { type: 'text'; text: string }
          | { type: 'audio' | 'resource' }
        >
      | unknown
    telemetry?: {
      error_kind?: string
    }
  }

  export const DEFAULT_GRANT_FLAGS: CuGrantFlags
  export const API_RESIZE_PARAMS: unknown

  export function targetImageSize(
    width: number,
    height: number,
    params: unknown,
  ): [number, number]

  export function buildComputerUseTools(
    capabilities: unknown,
    coordinateMode: CoordinateMode,
    installedAppNames?: string[],
  ): Array<{ name: string }>

  export function createComputerUseMcpServer(
    adapter: ComputerUseHostAdapter,
    coordinateMode: CoordinateMode,
  ): {
    connect(transport: unknown): Promise<void>
    close(): Promise<void>
    setRequestHandler(schema: unknown, handler: () => Promise<unknown>): void
  }

  export function bindSessionContext(
    adapter: ComputerUseHostAdapter,
    coordinateMode: CoordinateMode,
    context: ComputerUseSessionContext,
  ): (name: string, args: unknown) => Promise<CuCallToolResult>
}

declare module '@ant/computer-use-mcp/sentinelApps' {
  export function getSentinelCategory(bundleId: string): string | undefined
}

declare module '@ant/computer-use-input' {
  export type ComputerUseInputAPI = {
    moveMouse(x: number, y: number, animated?: boolean): Promise<void>
    key(name: string, action: 'press' | 'release'): Promise<void>
    keys(names: string[]): Promise<void>
    typeText(text: string): Promise<void>
    mouseButton(
      button: 'left' | 'right' | 'middle',
      action: 'click' | 'press' | 'release',
      count?: 1 | 2 | 3,
    ): Promise<void>
    mouseLocation(): Promise<{ x: number; y: number }>
    mouseScroll(delta: number, axis: 'vertical' | 'horizontal'): Promise<void>
    getFrontmostAppInfo(): { bundleId?: string; appName: string } | null
  }

  export type ComputerUseInput =
    | ({ isSupported: true } & ComputerUseInputAPI)
    | { isSupported: false }
}

declare module '@ant/computer-use-swift' {
  export type ComputerUseAPI = {
    _drainMainRunLoop(): void
    dispatchMainRunOnce(timeoutMs: number): void
    tcc: {
      checkAccessibility(): boolean
      checkScreenRecording(): boolean
    }
    hotkey: {
      register(onEscape: () => void): void
      registerEscape(onEscape: () => void): boolean
      unregister(): void
      notifyExpectedEscape(): void
    }
    apps: {
      prepareDisplay(
        allowlistBundleIds: string[],
        hostBundleId: string,
        displayId?: number,
      ): Promise<{ activated?: string; hidden: string[] }>
      previewHideSet(
        allowlistBundleIds: string[],
        displayId?: number,
      ): Promise<Array<{ bundleId: string; displayName: string }>>
      findWindowDisplays(
        bundleIds: string[],
      ): Promise<Array<{ bundleId: string; displayIds: number[] }>>
      appUnderPoint(
        x: number,
        y: number,
      ): Promise<{ bundleId: string; displayName: string } | null>
      listInstalled(): Promise<
        Array<{ bundleId: string; displayName: string; path?: string }>
      >
      iconDataUrl(path: string): string | null
      listRunning(): Promise<Array<{ bundleId: string; displayName: string }>>
      open(bundleId: string): Promise<void>
      unhide(bundleIds: string[]): Promise<void>
    }
    display: {
      getSize(displayId?: number): {
        id?: number
        width: number
        height: number
        scaleFactor: number
      }
      listAll(): Promise<
        Array<{
          id?: number
          width: number
          height: number
          scaleFactor: number
        }>
      >
    }
    resolvePrepareCapture(
      allowedBundleIds: string[],
      hostBundleId: string,
      quality: number,
      targetWidth: number,
      targetHeight: number,
      preferredDisplayId?: number,
      autoResolve?: boolean,
      doHide?: boolean,
    ): Promise<unknown>
    screenshot: {
      captureExcluding(
        allowedBundleIds: string[],
        quality: number,
        targetWidth: number,
        targetHeight: number,
        displayId?: number,
      ): Promise<{ base64: string; width: number; height: number }>
      captureRegion(
        allowedBundleIds: string[],
        x: number,
        y: number,
        width: number,
        height: number,
        targetWidth: number,
        targetHeight: number,
        quality: number,
        displayId?: number,
      ): Promise<{ base64: string; width: number; height: number }>
    }
  }
}
