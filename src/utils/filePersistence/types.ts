// Stub — types not included in source snapshot
export const OUTPUTS_SUBDIR = 'tool-results'
export const DEFAULT_UPLOAD_CONCURRENCY = 5
export const FILE_COUNT_LIMIT = 100

export type TurnStartTime = number

export interface PersistedFile {
  filename: string
  file_id: string
  fileId?: string
  path?: string
  content?: string
  size?: number
}

export interface FailedPersistence {
  filename: string
  error: string
}

export interface FilesPersistedEventData {
  files: PersistedFile[]
  failed: FailedPersistence[]
}
