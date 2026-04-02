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
  cell_type: 'markdown' | 'code' | 'raw'
  source?: string | string[]
  metadata?: Record<string, unknown>
  outputs?: NotebookCellOutput[]
  execution_count?: number | null
}

export type NotebookCellSourceOutput = {
  output_type: NotebookCellOutput['output_type']
  text?: string
  image?: NotebookOutputImage
}

export type NotebookCellSource = {
  id: string
  cell_type: NotebookCell['cell_type']
  source: string
  language?: string
  execution_count?: number | null
  outputs?: NotebookCellSourceOutput[]
}

export type NotebookContent = {
  metadata?: {
    kernelspec?: { language?: string }
    language_info?: { name?: string }
    [key: string]: unknown
  }
  cells: NotebookCell[]
}
