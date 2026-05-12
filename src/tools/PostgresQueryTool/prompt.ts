export const POSTGRES_QUERY_TOOL_NAME = 'PostgresQuery'

export const DESCRIPTION =
  'Execute SQL queries against a PostgreSQL database. Supports SELECT, INSERT, UPDATE, DELETE, and DDL statements. Uses the psql CLI or a direct connection string.'

export const PROMPT = `Execute SQL queries against a PostgreSQL database.

## Usage
- Provide a connection string or use environment variable PGDATABASE_URL
- Queries run with a configurable timeout (default: 30s)
- SELECT queries return rows as formatted text
- INSERT/UPDATE/DELETE return affected row count
- DDL statements return success/failure status

## Connection Priority
1. Explicit connection parameter
2. PGDATABASE_URL environment variable
3. Individual PG* environment variables (PGHOST, PGPORT, PGUSER, PGPASSWORD, PGDATABASE)

## Safety
- Queries are validated before execution
- Long-running queries are terminated after timeout
- Result size is limited to prevent memory issues
- Write operations prompt for confirmation
`
