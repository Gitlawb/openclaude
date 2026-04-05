---
name: Token Tracking on Dashboard
description: Add API token usage tracking and display on minimalist dashboard
type: feature
---

# Token Tracking on Dashboard

## Overview

Add token usage tracking to the OpenClaude proxy server and display cumulative statistics on the admin dashboard in a minimalist style.

## Requirements

- Track input_tokens and output_tokens from API responses
- Store cumulative counters persistently in DB
- Display token statistics on dashboard alongside existing metrics
- Maintain existing minimalist dark design aesthetic

## Architecture

### Data Storage

Use existing DB (db.go) to store three counters:
- `tokens_input` — cumulative input tokens
- `tokens_output` — cumulative output tokens  
- `tokens_total` — cumulative total tokens

All counters stored as int64 values in JSON.

### Token Extraction

In `forward()` function (main.go), after receiving non-streaming response:

1. Parse response body JSON
2. Extract `usage.input_tokens` and `usage.output_tokens` fields
3. Calculate total = input + output
4. Atomically increment DB counters

For streaming responses: skip token tracking (SSE format doesn't provide usage data in parseable form).

### Dashboard Updates

**Backend (auth.go `handleAdminDash`):**
- Read token counters from DB
- Pass to template as `InputTokens`, `OutputTokens`, `TotalTokens`
- Handle missing keys (return 0 for new installations)

**Frontend (templates/dashboard.html):**
- Change grid from 3 columns to 2 rows × 3 columns
- Add three new stat cards:
  - Input Tokens
  - Output Tokens
  - Total Tokens
- Maintain existing dark theme (#0d0d0d background, #1a1a1a borders)
- Use same card styling as existing stats

## Implementation Details

### DB Helper Methods

Add to Server struct:
```go
func (s *Server) incrementTokens(input, output int64) error
```

Reads current values, adds deltas, writes back atomically.

### Response Parsing

After `io.ReadAll(resp.Body)` in non-streaming path:
```go
var usage struct {
    Usage struct {
        InputTokens  int64 `json:"input_tokens"`
        OutputTokens int64 `json:"output_tokens"`
    } `json:"usage"`
}
if json.Unmarshal(respBody, &usage) == nil {
    s.incrementTokens(usage.Usage.InputTokens, usage.Usage.OutputTokens)
}
```

### Error Handling

- If DB read/write fails: log error, continue serving request
- If usage field missing: skip increment (not all endpoints return usage)
- If JSON parse fails: skip increment

## UI Design

Grid layout:
```
[Total Requests] [Mode] [Status]
[Input Tokens] [Output Tokens] [Total Tokens]
```

Token cards use same styling:
- Border: 1px solid #1a1a1a
- Background: #111
- Label: 11px uppercase #555
- Value: 28px font-weight 300

## Testing

Manual verification:
1. Start server
2. Send API request through proxy
3. Check dashboard shows incremented tokens
4. Restart server, verify persistence
5. Send multiple requests, verify accumulation

## Out of Scope

- Per-request token display in logs table
- Token usage graphs/charts
- Token cost calculation
- Streaming response token tracking
- Historical token data (only cumulative totals)
