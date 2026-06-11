/**
 * Jupyter notebook (.ipynb / nbformat 4.x) types used by NotebookEditTool,
 * src/utils/notebook.ts, and the notebook permission-diff UI.
 */

export type NotebookCellType = 'code' | 'markdown'

/** Raw nbformat cell output variants (the subset Claude Code reads). */
export type NotebookCellOutput =
  | {
      output_type: 'stream'
      name?: string
      text: string | string[]
    }
  | {
      output_type: 'execute_result' | 'display_data'
      data?: {
        'text/plain'?: string | string[]
        [mimeType: string]: unknown
      }
      metadata?: Record<string, unknown>
      execution_count?: number | null
    }
  | {
      output_type: 'error'
      ename: string
      evalue: string
      traceback: string[]
    }

/** Raw nbformat cell as stored on disk. */
export type NotebookCell = {
  cell_type: NotebookCellType
  /** Present in nbformat >= 4.5. */
  id?: string
  source: string | string[]
  metadata: Record<string, unknown>
  /** Code cells only. */
  execution_count?: number | null
  /** Code cells only. */
  outputs?: NotebookCellOutput[]
}

/** Raw nbformat notebook file content. */
export type NotebookContent = {
  cells: NotebookCell[]
  metadata: {
    language_info?: { name: string }
    [key: string]: unknown
  }
  nbformat: number
  nbformat_minor: number
}

/** Image extracted from a rich cell output (base64, whitespace-stripped). */
export type NotebookOutputImage = {
  image_data: string
  media_type: 'image/png' | 'image/jpeg'
}

/** Processed (display-ready) cell output produced by readNotebook(). */
export type NotebookCellSourceOutput = {
  output_type: NotebookCellOutput['output_type']
  text: string
  image?: NotebookOutputImage | undefined
}

/** Processed cell produced by readNotebook() for tool results. */
export type NotebookCellSource = {
  cell_id: string
  cellType: NotebookCellType
  source: string
  /** Set for code cells only. */
  language?: string
  execution_count?: number | undefined
  outputs?: NotebookCellSourceOutput[]
}
