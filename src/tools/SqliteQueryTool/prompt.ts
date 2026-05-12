export const SQLITE_QUERY_TOOL_NAME = 'SqliteQuery'

export const DESCRIPTION =
  'Execute SQL queries against a local SQLite database file. Supports all SQL statements including SELECT, INSERT, UPDATE, DELETE, and DDL.'

export const PROMPT = `Execute SQL queries against a local SQLite database file.

## Usage
- Provide the path to a SQLite database file
- Queries run synchronously with a configurable timeout
- SELECT queries return rows as formatted results
- INSERT/UPDATE/DELETE return affected row count
- DDL statements return success/failure status

## Safety
- Write operations are tracked and flagged
- Result size is limited to prevent memory issues
- Database file must be within the project directory
- Large results are automatically truncated
`
