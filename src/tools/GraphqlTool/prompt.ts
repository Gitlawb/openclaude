export const GRAPHQL_TOOL_NAME = 'GraphqlQuery'
export const DESCRIPTION = 'Execute GraphQL queries and mutations against GraphQL endpoints. Supports variables, headers, and schema introspection.'
export const PROMPT = `Execute GraphQL queries and mutations.

## Usage
- Specify endpoint URL and GraphQL query
- Optional variables as key-value pairs
- Optional custom headers for authentication
- Supports introspection queries

## Safety
- Read-only by default (queries only for introspection)
- Timeout prevents hanging (default: 30s)
- Response size limited
`
