export const HTTP_REQUEST_TOOL_NAME = 'HttpRequest'
export const DESCRIPTION = 'Make HTTP requests to test and debug REST APIs. Supports GET, POST, PUT, PATCH, DELETE, HEAD, OPTIONS with custom headers, query params, and request body.'
export const PROMPT = `Make HTTP requests to test and debug REST APIs.

## Usage
- Supports all common HTTP methods
- Automatic JSON body serialization
- Custom headers, query parameters, and timeouts
- Follows redirects by default with configurable limit

## Methods
- GET: Retrieve resources
- POST: Create resources
- PUT: Update resources
- PATCH: Partial updates
- DELETE: Remove resources
- HEAD: Headers only
- OPTIONS: Available methods

## Safety
- Timeout prevents hanging requests (default: 30s)
- Response size limited to prevent memory issues
- Redirects followed but configurable
- No automatic credential forwarding
`
