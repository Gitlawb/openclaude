declare const MACRO: {
  VERSION: string
  DISPLAY_VERSION?: string
  PACKAGE_URL?: string
  NATIVE_PACKAGE_URL?: string
  VERSION_CHANGELOG?: string
  BUILD_TIME?: string
  FEEDBACK_CHANNEL?: string
  ISSUES_EXPLAINER?: string
}

declare module 'qrcode' {
  const qrcode: {
    toString(...args: any[]): Promise<string>
    toDataURL(...args: any[]): Promise<string>
    toBuffer(...args: any[]): Promise<Buffer>
  }
  export = qrcode
}

declare module 'ws' {
  export default class WebSocket {
    constructor(url: string, options?: any)
    on(event: string, handler: (...args: any[]) => void): void
    off(event: string, handler: (...args: any[]) => void): void
    send(data: string): void
    close(): void
    ping(): void
    upgradeReq?: { headers?: Record<string, string> }
  }
}

declare namespace NodeJS {
  interface ProcessEnv {
    USER_TYPE?: string
    NODE_ENV?: string
  }
}

declare module '*providerProfile.js?*' {
  const value: any
  export default value
}

declare module '*.js?*' {
  const value: any
  export = value
}

declare module '*.ts?*' {
  const value: any
  export = value
}

declare module '@ant/computer-use-mcp/sentinelApps' {
  export function getSentinelCategory(
    bundleId: string,
  ): 'shell' | 'filesystem' | 'system_settings' | null
}

declare module '@ant/computer-use-mcp/types' {
  export type CuPermissionApp = {
    name?: string
    resolved?: {
      appName: string
      bundleId: string
    } | null
  }

  export type CuPermissionRequest = {
    apps: CuPermissionApp[]
    requestedFlags: Record<string, boolean>
    reason?: string
    willHide?: string[]
    tccState?: {
      accessibility: boolean
      screenRecording: boolean
    }
  }

  export type CuPermissionResponse = {
    granted: Array<{ bundleId: string }>
    denied: string[]
    flags: Record<string, boolean>
  }

  export const DEFAULT_GRANT_FLAGS: Record<string, boolean>
}

declare module '../../tools/ReviewArtifactTool/ReviewArtifactTool.js' {
  export const ReviewArtifactTool: any
}

declare module './ReviewArtifactPermissionRequest/ReviewArtifactPermissionRequest.js' {
  export const ReviewArtifactPermissionRequest: any
}

declare module '../../tools/WorkflowTool/WorkflowTool.js' {
  export const WorkflowTool: any
}

declare module '../../tools/WorkflowTool/WorkflowPermissionRequest.js' {
  export const WorkflowPermissionRequest: any
}

declare namespace JSX {
  interface IntrinsicElements {
    'ink-box': any
    'ink-link': any
    'ink-text': any
    'ink-raw-ansi': any
  }
}

declare namespace React {
  namespace JSX {
    interface IntrinsicElements {
      'ink-box': any
      'ink-link': any
      'ink-text': any
      'ink-raw-ansi': any
    }
  }
}
