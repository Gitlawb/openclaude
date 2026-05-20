export type NotebookCellType = 'code' | 'markdown' | 'raw'

export type NotebookOutputImage = {
  image_data: string
  media_type: 'image/png' | 'image/jpeg'
}

export type NotebookCellOutput =
  | {
      output_type: 'stream'
      text?: string | string[]
    }
  | {
      output_type: 'execute_result' | 'display_data'
      data?: Record<string, unknown>
    }
  | {
      output_type: 'error'
      ename: string
      evalue: string
      traceback: string[]
    }

export type NotebookCell = {
  id?: string
  cell_type: NotebookCellType
  source: string | string[]
  execution_count?: number | null
  outputs?: NotebookCellOutput[]
}

export type NotebookCellSourceOutput = {
  output_type: 'stream' | 'execute_result' | 'display_data' | 'error'
  text?: string
  image?: NotebookOutputImage
}

export type NotebookCellSource = {
  cellType: NotebookCellType
  source: string
  execution_count?: number
  cell_id: string
  language?: string
  outputs?: NotebookCellSourceOutput[]
}

export type NotebookContent = {
  cells: NotebookCell[]
  metadata: {
    language_info?: {
      name?: string
    }
    [key: string]: unknown
  }
  [key: string]: unknown
}
