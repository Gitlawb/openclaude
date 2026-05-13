export const CSV_TOOL_NAME = 'CsvQuery'
export const DESCRIPTION = 'Read, query, and analyze CSV files with filtering and column selection.'
export const PROMPT = 'Read, query, and analyze CSV files.\n\n## Actions\n- read: Read rows with optional column selection and limit\n- query: Read with filter expression (e.g. "age > 18")\n- stats: Get column statistics (count, unique, min, max)\n\n## Filter Syntax\ncolumn operator value\nOperators: =, !=, >, <, >=, <=\n\n## Safety\n- Read-only operation\n- Result size is limited to prevent memory issues'
