export type MiniMaxUsageWindow = {
  label: string
  usedPercent: number
  remaining?: number
  total?: number
  resetsAt?: string
}

export type MiniMaxUsageSnapshot = {
  limitName: string
  windows: MiniMaxUsageWindow[]
}

export type MiniMaxUsageRow =
  | {
      kind: 'window'
      label: string
      usedPercent: number
      resetsAt?: string
      extraSubtext?: string
    }
  | {
      kind: 'text'
      label: string
      value: string
    }

export type MiniMaxUsageData =
  | {
      availability: 'available'
      planType?: string
      snapshots: MiniMaxUsageSnapshot[]
    }
  | {
      availability: 'unknown'
      planType?: string
      snapshots: MiniMaxUsageSnapshot[]
      message: string
    }

export const DEFAULT_MINIMAX_BASE_URL = 'https://api.minimax.io/v1'
export const DEFAULT_MINIMAX_UNAVAILABLE_MESSAGE =
  'Usage details are not available for this MiniMax account. This plan or MiniMax endpoint may not expose quota status.'
