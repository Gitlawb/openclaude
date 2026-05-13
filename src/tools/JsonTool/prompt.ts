export const JSON_TOOL_NAME = 'JsonQuery'
export const DESCRIPTION = 'Read, query, and transform JSON files with JMESPath-style expressions.'
export const PROMPT = 'Read, query, and transform JSON files.\n\n## Actions\n- read: Read and pretty-print JSON content\n- query: Extract values using dot-notation path (e.g. "users[0].name")\n- validate: Check if file is valid JSON\n\n## Path Syntax\n- users: top-level key\n- users[0]: array index\n- users[0].name: nested key\n- users[].name: collect names from all array items\n\n## Safety\n- Read-only operation\n- Large files are truncated at 100KB'
