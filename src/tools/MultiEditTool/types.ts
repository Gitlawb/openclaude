import { z } from 'zod/v4'
import { lazySchema } from '../../utils/lazySchema.js'
import { semanticBoolean } from '../../utils/semanticBoolean.js'

const editEntrySchema = lazySchema(() =>
  z.strictObject({
    file_path: z.string().describe('The absolute path to the file to modify'),
    old_string: z.string().describe('The text to replace'),
    new_string: z
      .string()
      .describe(
        'The text to replace it with (must be different from old_string)',
      ),
    replace_all: semanticBoolean(
      z.boolean().optional(),
    ).describe('Replace all occurrences of old_string (default false)'),
  }),
)

const inputSchema = lazySchema(() =>
  z.strictObject({
    edits: z
      .array(editEntrySchema())
      .describe('Array of edits to apply atomically'),
  }),
)
type InputSchema = ReturnType<typeof inputSchema>

export type MultiEditInput = z.output<InputSchema>

export type MultiEditEntry = z.output<ReturnType<typeof editEntrySchema>>

// Output schema for MultiEditTool
const outputSchema = lazySchema(() =>
  z.object({
    editCount: z.number().describe('Number of edits applied'),
    filePaths: z
      .array(z.string())
      .describe('List of file paths that were edited'),
  }),
)
type OutputSchema = ReturnType<typeof outputSchema>

export type MultiEditOutput = z.infer<OutputSchema>

export { inputSchema, outputSchema }
