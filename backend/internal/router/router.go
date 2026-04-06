// LLM Router — translates Anthropic API format → OpenAI-compatible format
// and proxies to the configured backend (default: user's custom API).
package router

import (
	"bufio"
	"bytes"
	"context"
	"encoding/json"
	"fmt"
	"io"
	"net/http"
	"os"
	"strings"
	"time"
)

// ── Anthropic request types (what openclaude sends) ───────────────────────────

type AnthropicRequest struct {
	Model     string             `json:"model"`
	Messages  []AnthropicMessage `json:"messages"`
	MaxTokens int                `json:"max_tokens"`
	System    string             `json:"system,omitempty"`
	Stream    bool               `json:"stream"`
	Tools     []json.RawMessage  `json:"tools,omitempty"`
	Thinking  *ThinkingConfig    `json:"thinking,omitempty"`
}

type AnthropicMessage struct {
	Role    string      `json:"role"`
	Content interface{} `json:"content"` // string or []ContentBlock
}

type ContentBlock struct {
	Type   string          `json:"type"`
	Text   string          `json:"text,omitempty"`
	Source *ImageSource    `json:"source,omitempty"`
	ID     string          `json:"id,omitempty"`
	Name   string          `json:"name,omitempty"`
	Input  json.RawMessage `json:"input,omitempty"`
}

type ImageSource struct {
	Type      string `json:"type"`
	MediaType string `json:"media_type,omitempty"`
	Data      string `json:"data,omitempty"`
	URL       string `json:"url,omitempty"`
}

type ThinkingConfig struct {
	Type         string `json:"type"`
	BudgetTokens int    `json:"budget_tokens,omitempty"`
}

// ── OpenAI request types (what the backend expects) ──────────────────────────

type OpenAIRequest struct {
	Model       string          `json:"model"`
	Messages    []OpenAIMessage `json:"messages"`
	MaxTokens   int             `json:"max_tokens,omitempty"`
	Stream      bool            `json:"stream"`
	Temperature float64         `json:"temperature,omitempty"`
	Tools       []json.RawMessage `json:"tools,omitempty"`
}

type OpenAIMessage struct {
	Role    string      `json:"role"`
	Content interface{} `json:"content"` // string or []OpenAIContentPart
}

type OpenAIContentPart struct {
	Type     string          `json:"type"`
	Text     string          `json:"text,omitempty"`
	ImageURL *OpenAIImageURL `json:"image_url,omitempty"`
}

type OpenAIImageURL struct {
	URL string `json:"url"`
}

// ── Model mapping: Anthropic model IDs → backend model IDs ──────────────────

var modelMap = map[string]string{
	// Map Anthropic model names to user's API model names
	"claude-opus-4-6":           "kiro/claude-sonnet-4.5", // best available
	"claude-sonnet-4-6":         "kiro/claude-sonnet-4.5",
	"claude-haiku-4-5-20251001": "kiro/claude-haiku-4.5",
	"claude-haiku-4-5":          "kiro/claude-haiku-4.5",
	"claude-3-5-sonnet-20241022": "kiro/claude-sonnet-4.5",
	"claude-3-5-haiku-20241022":  "kiro/claude-haiku-4.5",
	// Pass-through for direct model IDs
	"kiro/claude-sonnet-4.5": "kiro/claude-sonnet-4.5",
	"kiro/claude-haiku-4.5":  "kiro/claude-haiku-4.5",
	"kr/claude-sonnet-4.5":   "kr/claude-sonnet-4.5",
	"kr/claude-haiku-4.5":    "kr/claude-haiku-4.5",
	"qwen/qwen3-coder-plus":  "qwen/qwen3-coder-plus",
	"qwen/qwen3-coder-flash": "qwen/qwen3-coder-flash",
	"qw/coder-model":         "qw/coder-model",
}

func resolveModel(requested string) string {
	if mapped, ok := modelMap[requested]; ok {
		return mapped
	}
	// Default fallback
	return "kiro/claude-sonnet-4.5"
}

// ── Router ────────────────────────────────────────────────────────────────────

type Router struct {
	backendURL string
	httpClient *http.Client
}

func New() *Router {
	backendURL := os.Getenv("BACKEND_API_URL")
	if backendURL == "" {
		backendURL = "https://kingston-meat-sodium-totally.trycloudflare.com/v1"
	}
	return &Router{
		backendURL: strings.TrimRight(backendURL, "/"),
		httpClient: &http.Client{Timeout: 10 * time.Minute},
	}
}

// Chat sends a request and writes the Anthropic-format response to w.
// If req.Stream == true, writes SSE events. Otherwise writes JSON.
func (r *Router) Chat(ctx context.Context, req *AnthropicRequest, w http.ResponseWriter) error {
	oaiReq := convertToOpenAI(req)

	body, err := json.Marshal(oaiReq)
	if err != nil {
		return fmt.Errorf("marshal: %w", err)
	}

	httpReq, err := http.NewRequestWithContext(ctx, http.MethodPost,
		r.backendURL+"/chat/completions", bytes.NewReader(body))
	if err != nil {
		return fmt.Errorf("build request: %w", err)
	}
	httpReq.Header.Set("Content-Type", "application/json")
	// Pass backend API key if configured
	if key := os.Getenv("BACKEND_API_KEY"); key != "" {
		httpReq.Header.Set("Authorization", "Bearer "+key)
	}

	resp, err := r.httpClient.Do(httpReq)
	if err != nil {
		return fmt.Errorf("backend request: %w", err)
	}
	defer resp.Body.Close()

	if resp.StatusCode != http.StatusOK {
		body, _ := io.ReadAll(resp.Body)
		return fmt.Errorf("backend error %d: %s", resp.StatusCode, string(body))
	}

	if req.Stream {
		return r.streamResponse(ctx, resp.Body, req.Model, w)
	}
	return r.jsonResponse(resp.Body, req.Model, w)
}

// ── Anthropic → OpenAI conversion ────────────────────────────────────────────

func convertToOpenAI(req *AnthropicRequest) *OpenAIRequest {
	messages := make([]OpenAIMessage, 0, len(req.Messages)+1)

	// Inject system message
	if req.System != "" {
		messages = append(messages, OpenAIMessage{Role: "system", Content: req.System})
	}

	for _, m := range req.Messages {
		messages = append(messages, convertMessage(m))
	}

	return &OpenAIRequest{
		Model:     resolveModel(req.Model),
		Messages:  messages,
		MaxTokens: req.MaxTokens,
		Stream:    req.Stream,
	}
}

func convertMessage(m AnthropicMessage) OpenAIMessage {
	switch v := m.Content.(type) {
	case string:
		return OpenAIMessage{Role: m.Role, Content: v}
	case []interface{}:
		parts := make([]OpenAIContentPart, 0)
		for _, raw := range v {
			block, ok := raw.(map[string]interface{})
			if !ok {
				continue
			}
			switch block["type"] {
			case "text":
				parts = append(parts, OpenAIContentPart{
					Type: "text",
					Text: fmt.Sprint(block["text"]),
				})
			case "image":
				if src, ok := block["source"].(map[string]interface{}); ok {
					imgURL := OpenAIContentPart{Type: "image_url"}
					if src["type"] == "base64" {
						imgURL.ImageURL = &OpenAIImageURL{
							URL: fmt.Sprintf("data:%s;base64,%s", src["media_type"], src["data"]),
						}
					} else if src["type"] == "url" {
						imgURL.ImageURL = &OpenAIImageURL{URL: fmt.Sprint(src["url"])}
					}
					parts = append(parts, imgURL)
				}
			}
		}
		return OpenAIMessage{Role: m.Role, Content: parts}
	default:
		return OpenAIMessage{Role: m.Role, Content: fmt.Sprint(m.Content)}
	}
}

// ── Streaming response (SSE) ──────────────────────────────────────────────────

type openAIStreamChunk struct {
	ID      string `json:"id"`
	Choices []struct {
		Delta struct {
			Content string `json:"content"`
			Role    string `json:"role"`
		} `json:"delta"`
		FinishReason *string `json:"finish_reason"`
	} `json:"choices"`
	Usage *struct {
		PromptTokens     int `json:"prompt_tokens"`
		CompletionTokens int `json:"completion_tokens"`
	} `json:"usage"`
}

func (r *Router) streamResponse(ctx context.Context, body io.Reader, model string, w http.ResponseWriter) error {
	msgID := "msg_" + generateID()

	// Write Anthropic SSE: message_start
	writeSSE(w, "message_start", map[string]interface{}{
		"type": "message_start",
		"message": map[string]interface{}{
			"id":    msgID,
			"type":  "message",
			"role":  "assistant",
			"model": model,
			"content": []interface{}{},
			"stop_reason": nil,
			"usage": map[string]int{"input_tokens": 0, "output_tokens": 0},
		},
	})

	// content_block_start
	writeSSE(w, "content_block_start", map[string]interface{}{
		"type":  "content_block_start",
		"index": 0,
		"content_block": map[string]string{"type": "text", "text": ""},
	})

	writeSSE(w, "ping", map[string]string{"type": "ping"})

	var outputTokens int
	scanner := bufio.NewScanner(body)

	for scanner.Scan() {
		line := scanner.Text()
		if !strings.HasPrefix(line, "data: ") {
			continue
		}
		data := strings.TrimPrefix(line, "data: ")
		if data == "[DONE]" {
			break
		}

		var chunk openAIStreamChunk
		if err := json.Unmarshal([]byte(data), &chunk); err != nil {
			continue
		}

		for _, choice := range chunk.Choices {
			if choice.Delta.Content != "" {
				outputTokens++
				writeSSE(w, "content_block_delta", map[string]interface{}{
					"type":  "content_block_delta",
					"index": 0,
					"delta": map[string]string{
						"type": "text_delta",
						"text": choice.Delta.Content,
					},
				})
			}
		}

		if chunk.Usage != nil {
			outputTokens = chunk.Usage.CompletionTokens
		}

		if flusher, ok := w.(http.Flusher); ok {
			flusher.Flush()
		}
	}

	// content_block_stop
	writeSSE(w, "content_block_stop", map[string]interface{}{
		"type": "content_block_stop", "index": 0,
	})

	// message_delta (stop reason + usage)
	writeSSE(w, "message_delta", map[string]interface{}{
		"type":  "message_delta",
		"delta": map[string]string{"stop_reason": "end_turn", "stop_sequence": ""},
		"usage": map[string]int{"output_tokens": outputTokens},
	})

	// message_stop
	writeSSE(w, "message_stop", map[string]string{"type": "message_stop"})

	return scanner.Err()
}

// ── Non-streaming response ────────────────────────────────────────────────────

type openAIResponse struct {
	ID      string `json:"id"`
	Choices []struct {
		Message struct {
			Role    string `json:"role"`
			Content string `json:"content"`
		} `json:"message"`
		FinishReason string `json:"finish_reason"`
	} `json:"choices"`
	Usage struct {
		PromptTokens     int `json:"prompt_tokens"`
		CompletionTokens int `json:"completion_tokens"`
	} `json:"usage"`
}

func (r *Router) jsonResponse(body io.Reader, model string, w http.ResponseWriter) error {
	var oai openAIResponse
	if err := json.NewDecoder(body).Decode(&oai); err != nil {
		return fmt.Errorf("decode response: %w", err)
	}

	content := ""
	stopReason := "end_turn"
	if len(oai.Choices) > 0 {
		content = oai.Choices[0].Message.Content
		if oai.Choices[0].FinishReason == "length" {
			stopReason = "max_tokens"
		}
	}

	anthropicResp := map[string]interface{}{
		"id":    "msg_" + generateID(),
		"type":  "message",
		"role":  "assistant",
		"model": model,
		"content": []map[string]string{
			{"type": "text", "text": content},
		},
		"stop_reason":   stopReason,
		"stop_sequence": nil,
		"usage": map[string]int{
			"input_tokens":  oai.Usage.PromptTokens,
			"output_tokens": oai.Usage.CompletionTokens,
		},
	}

	w.Header().Set("Content-Type", "application/json")
	return json.NewEncoder(w).Encode(anthropicResp)
}

// ── Helpers ───────────────────────────────────────────────────────────────────

func writeSSE(w http.ResponseWriter, event string, data interface{}) {
	b, _ := json.Marshal(data)
	fmt.Fprintf(w, "event: %s\ndata: %s\n\n", event, string(b))
}

func generateID() string {
	return fmt.Sprintf("%d", time.Now().UnixNano())
}

// Models returns the list of models in Anthropic format.
func (r *Router) Models(ctx context.Context) ([]map[string]interface{}, error) {
	req, _ := http.NewRequestWithContext(ctx, http.MethodGet, r.backendURL+"/models", nil)
	if key := os.Getenv("BACKEND_API_KEY"); key != "" {
		req.Header.Set("Authorization", "Bearer "+key)
	}

	resp, err := r.httpClient.Do(req)
	if err != nil {
		return nil, err
	}
	defer resp.Body.Close()

	var result struct {
		Data []struct {
			ID      string `json:"id"`
			Created int64  `json:"created"`
		} `json:"data"`
	}
	if err := json.NewDecoder(resp.Body).Decode(&result); err != nil {
		return nil, err
	}

	models := make([]map[string]interface{}, 0, len(result.Data))
	for _, m := range result.Data {
		models = append(models, map[string]interface{}{
			"type":         "model",
			"id":           m.ID,
			"display_name": m.ID,
			"created_at":   time.Unix(m.Created, 0).UTC().Format(time.RFC3339),
		})
	}
	return models, nil
}
