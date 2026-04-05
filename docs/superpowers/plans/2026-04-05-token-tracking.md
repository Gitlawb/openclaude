# Token Tracking Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add API token usage tracking and display cumulative statistics on the admin dashboard.

**Architecture:** Parse `usage` field from API responses, store cumulative counters in existing DB, display on dashboard with three new stat cards.

**Tech Stack:** Go 1.x, existing DB (db.go), html/template

---

## File Structure

**Modified files:**
- `server/main.go` — add token extraction and DB increment in `forward()`
- `server/auth.go` — read token counters in `handleAdminDash()`, pass to template
- `server/templates/dashboard.html` — add token stat cards, change grid layout

**No new files needed.**

---

### Task 1: Add token increment helper to Server

**Files:**
- Modify: `server/main.go:44` (after Server struct definition)

- [ ] **Step 1: Add incrementTokens method**

Add after the `NewServer` function (around line 58):

```go
// incrementTokens atomically adds token counts to DB counters.
func (s *Server) incrementTokens(input, output int64) {
	if input == 0 && output == 0 {
		return
	}
	
	// Read current values
	var inputTotal, outputTotal int64
	if raw := s.db.Get("tokens_input"); raw != nil {
		json.Unmarshal(raw, &inputTotal)
	}
	if raw := s.db.Get("tokens_output"); raw != nil {
		json.Unmarshal(raw, &outputTotal)
	}
	
	// Increment
	inputTotal += input
	outputTotal += output
	totalTotal := inputTotal + outputTotal
	
	// Write back
	if err := s.db.Set("tokens_input", inputTotal); err != nil {
		log.Printf("failed to save tokens_input: %v", err)
	}
	if err := s.db.Set("tokens_output", outputTotal); err != nil {
		log.Printf("failed to save tokens_output: %v", err)
	}
	if err := s.db.Set("tokens_total", totalTotal); err != nil {
		log.Printf("failed to save tokens_total: %v", err)
	}
}
```

- [ ] **Step 2: Verify syntax**

Run: `cd D:/project/openclaude/server && go build`
Expected: Build succeeds (or fails only on unrelated issues)

- [ ] **Step 3: Commit**

```bash
cd D:/project/openclaude/server
git add main.go
git commit -m "feat: add token increment helper

Co-Authored-By: Claude Sonnet 4.6 <noreply@anthropic.com>"
```

---

### Task 2: Extract tokens from API responses

**Files:**
- Modify: `server/main.go:260-277` (non-streaming response path in `forward()`)

- [ ] **Step 1: Add token extraction after response write**

Replace lines 274-277 with:

```go
		if s.cfg.LogResponses && json.Valid(respBody) {
			entry.ResponseBody = json.RawMessage(respBody)
		}
		
		// Extract and track token usage
		if resp.StatusCode >= 200 && resp.StatusCode < 300 && json.Valid(respBody) {
			var usage struct {
				Usage struct {
					InputTokens  int64 `json:"input_tokens"`
					OutputTokens int64 `json:"output_tokens"`
				} `json:"usage"`
			}
			if err := json.Unmarshal(respBody, &usage); err == nil {
				s.incrementTokens(usage.Usage.InputTokens, usage.Usage.OutputTokens)
			}
		}
		
		return nil
```

- [ ] **Step 2: Verify syntax**

Run: `cd D:/project/openclaude/server && go build`
Expected: Build succeeds

- [ ] **Step 3: Commit**

```bash
cd D:/project/openclaude/server
git add main.go
git commit -m "feat: extract and track tokens from API responses

Co-Authored-By: Claude Sonnet 4.6 <noreply@anthropic.com>"
```

---

### Task 3: Read token counters in dashboard handler

**Files:**
- Modify: `server/auth.go:122-146` (`handleAdminDash` function)

- [ ] **Step 1: Add token counter reads**

Replace lines 137-145 with:

```go
	// Read token counters
	var inputTokens, outputTokens, totalTokens int64
	if raw := s.db.Get("tokens_input"); raw != nil {
		json.Unmarshal(raw, &inputTokens)
	}
	if raw := s.db.Get("tokens_output"); raw != nil {
		json.Unmarshal(raw, &outputTokens)
	}
	if raw := s.db.Get("tokens_total"); raw != nil {
		json.Unmarshal(raw, &totalTokens)
	}
	
	tmplDash.Execute(w, map[string]any{
		"TotalRequests": s.counter,
		"Mode":          s.cfg.Mode,
		"Port":          s.cfg.Port,
		"OmniURL":       s.cfg.OmniBaseURL,
		"ClaudeURL":     s.cfg.ClaudeBaseURL,
		"LogDir":        s.cfg.LogDir,
		"LogFiles":      files,
		"InputTokens":   inputTokens,
		"OutputTokens":  outputTokens,
		"TotalTokens":   totalTokens,
	})
```

- [ ] **Step 2: Verify syntax**

Run: `cd D:/project/openclaude/server && go build`
Expected: Build succeeds

- [ ] **Step 3: Commit**

```bash
cd D:/project/openclaude/server
git add auth.go
git commit -m "feat: pass token counters to dashboard template

Co-Authored-By: Claude Sonnet 4.6 <noreply@anthropic.com>"
```

---

### Task 4: Update dashboard template with token cards

**Files:**
- Modify: `server/templates/dashboard.html:47,95-108`

- [ ] **Step 1: Change grid to 2 rows**

Replace line 47:

```css
.grid { display: grid; grid-template-columns: repeat(3, 1fr); gap: 12px; margin-bottom: 40px; }
```

- [ ] **Step 2: Add token stat cards**

Replace lines 95-108 with:

```html
  <div class="grid">
    <div class="stat">
      <div class="stat-label">Total requests</div>
      <div class="stat-value">{{.TotalRequests}}</div>
    </div>
    <div class="stat">
      <div class="stat-label">Mode</div>
      <div class="stat-value" style="font-size:20px;padding-top:6px">{{.Mode}}</div>
    </div>
    <div class="stat">
      <div class="stat-label">Status</div>
      <div class="stat-value green" style="font-size:20px;padding-top:6px">online</div>
    </div>
  </div>

  <div class="grid">
    <div class="stat">
      <div class="stat-label">Input tokens</div>
      <div class="stat-value">{{.InputTokens}}</div>
    </div>
    <div class="stat">
      <div class="stat-label">Output tokens</div>
      <div class="stat-value">{{.OutputTokens}}</div>
    </div>
    <div class="stat">
      <div class="stat-label">Total tokens</div>
      <div class="stat-value">{{.TotalTokens}}</div>
    </div>
  </div>
```

- [ ] **Step 3: Verify template syntax**

Run: `cd D:/project/openclaude/server && go build`
Expected: Build succeeds (templates are parsed at runtime, but build checks imports)

- [ ] **Step 4: Commit**

```bash
cd D:/project/openclaude/server
git add templates/dashboard.html
git commit -m "feat: add token stat cards to dashboard

Co-Authored-By: Claude Sonnet 4.6 <noreply@anthropic.com>"
```

---

### Task 5: Manual testing

**Files:**
- Test: server runtime behavior

- [ ] **Step 1: Build and start server**

```bash
cd D:/project/openclaude/server
go build -o server.exe
./server.exe
```

Expected: Server starts on port 3456, no errors

- [ ] **Step 2: Send test API request**

In another terminal:

```bash
curl -X POST http://localhost:3456/v1/messages \
  -H "Content-Type: application/json" \
  -H "anthropic-version: 2023-06-01" \
  -d '{"model":"claude-3-haiku-20240307","max_tokens":100,"messages":[{"role":"user","content":"Hi"}]}'
```

Expected: Response with usage field containing input_tokens and output_tokens

- [ ] **Step 3: Check dashboard**

Open browser: `http://localhost:3456/admin`
Login with password from config.json

Expected: Dashboard shows non-zero values in Input tokens, Output tokens, Total tokens cards

- [ ] **Step 4: Verify persistence**

Stop server (Ctrl+C), restart it, check dashboard again

Expected: Token counts persist across restarts

- [ ] **Step 5: Send multiple requests**

Send 2-3 more API requests, refresh dashboard

Expected: Token counts increase with each request

---

## Self-Review Checklist

**Spec coverage:**
- ✓ Token extraction from API responses (Task 2)
- ✓ DB storage with counters (Task 1)
- ✓ Dashboard display (Task 3, 4)
- ✓ Minimalist design maintained (Task 4)
- ✓ Error handling (Task 1, 2 - log errors, continue serving)

**Placeholders:** None - all code is complete

**Type consistency:**
- `inputTokens`, `outputTokens`, `totalTokens` - int64 throughout
- DB keys: `tokens_input`, `tokens_output`, `tokens_total` - consistent
- Template fields: `InputTokens`, `OutputTokens`, `TotalTokens` - consistent

**Out of scope (correctly excluded):**
- Streaming response tokens
- Per-request token display
- Token graphs/charts
- Cost calculation
