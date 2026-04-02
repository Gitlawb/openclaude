export const OUTPUTS_SUBDIR = 'outputs'

export type PersistedFile = {
  filename: string
  file_id?: string
}

export type FailedPersistence = {
  filename: string
  error: string
}

export type FilesPersistedEventData = {
  files: PersistedFile[]
  failed: FailedPersistence[]
}

export type TurnStartTime = number

export const DEFAULT_UPLOAD_CONCURRENCY = 5
export const FILE_COUNT_LIMIT = 100
