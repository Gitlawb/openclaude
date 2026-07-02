export type ClinePassUsageWindow = {
  label: string
  type: string
  usedPercent: number
  resetsAt?: string
}

export type ClinePassUsageData =
  | {
      availability: 'available'
      planName?: string
      windows: ClinePassUsageWindow[]
    }
  | {
      availability: 'unknown'
      planName?: string
      windows: ClinePassUsageWindow[]
      message: string
    }

export type ClinePassUsageRow = {
  kind: 'window'
  label: string
  usedPercent: number
  resetsAt?: string
}

export const DEFAULT_CLINEPASS_BASE_URL = 'https://api.cline.bot'
export const DEFAULT_CLINEPASS_UNAVAILABLE_MESSAGE =
  'Usage details are not available for this ClinePass account.'
