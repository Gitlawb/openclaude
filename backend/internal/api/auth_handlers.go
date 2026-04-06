package api

import (
	"encoding/json"
	"log"
	"net/http"
	"strings"
	"time"

	"github.com/google/uuid"
	"github.com/yourusername/anthropic-gateway/internal/auth"
	"golang.org/x/crypto/bcrypt"
)

// ── POST /auth/register ───────────────────────────────────────────────────────

type registerRequest struct {
	Email       string `json:"email"`
	Password    string `json:"password"`
	DisplayName string `json:"display_name"`
}

func (h *Handlers) Register(w http.ResponseWriter, r *http.Request) {
	var req registerRequest
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		writeErr(w, http.StatusBadRequest, "invalid request body")
		return
	}

	req.Email = strings.TrimSpace(strings.ToLower(req.Email))
	if req.Email == "" || len(req.Password) < 8 {
		writeErr(w, http.StatusBadRequest, "email required and password must be at least 8 characters")
		return
	}

	// Check if email exists
	var exists bool
	h.db.QueryRow(r.Context(), "SELECT EXISTS(SELECT 1 FROM users WHERE email=$1)", req.Email).Scan(&exists)
	if exists {
		writeErr(w, http.StatusConflict, "email already registered")
		return
	}

	hash, err := bcrypt.GenerateFromPassword([]byte(req.Password), bcrypt.DefaultCost)
	if err != nil {
		writeErr(w, http.StatusInternalServerError, "failed to hash password")
		return
	}

	// Create org + user in a transaction
	tx, err := h.db.Begin(r.Context())
	if err != nil {
		writeErr(w, http.StatusInternalServerError, "db error")
		return
	}
	defer tx.Rollback(r.Context())

	orgUUID := uuid.New().String()
	userUUID := uuid.New().String()

	_, err = tx.Exec(r.Context(), `
		INSERT INTO organizations (uuid, name, org_type, billing_type, rate_limit_tier)
		VALUES ($1, $2, 'claude_pro', 'subscription', 'free')`,
		orgUUID, req.Email)
	if err != nil {
		writeErr(w, http.StatusInternalServerError, "failed to create organization")
		return
	}

	_, err = tx.Exec(r.Context(), `
		INSERT INTO users (uuid, org_uuid, email, password_hash, display_name, email_verified)
		VALUES ($1, $2, $3, $4, $5, true)`,
		userUUID, orgUUID, req.Email, string(hash), req.DisplayName)
	if err != nil {
		writeErr(w, http.StatusInternalServerError, "failed to create user")
		return
	}

	// Create free subscription
	_, err = tx.Exec(r.Context(), `
		INSERT INTO subscriptions (org_uuid, plan, monthly_token_limit, rpm_limit, price_usd_cents)
		VALUES ($1, 'free', 100000, 10, 0)`, orgUUID)
	if err != nil {
		writeErr(w, http.StatusInternalServerError, "failed to create subscription")
		return
	}

	if err := tx.Commit(r.Context()); err != nil {
		writeErr(w, http.StatusInternalServerError, "transaction failed")
		return
	}

	// Issue tokens immediately
	h.issueTokens(w, r.Context(), userUUID, orgUUID, req.Email,
		[]string{"user:profile", "user:inference", "user:sessions:claude_code"})
}

// ── GET /api/dashboard/stats ──────────────────────────────────────────────────

func (h *Handlers) DashboardStats(w http.ResponseWriter, r *http.Request) {
	orgUUID, _ := r.Context().Value(auth.CtxOrgUUID).(string)
	log.Printf("[DEBUG DashboardStats] orgUUID from context: '%s'", orgUUID)

	// Monthly totals
	var inputTokens, outputTokens int64
	var requestCount int
	h.db.QueryRow(r.Context(), `
		SELECT COALESCE(SUM(input_tokens),0), COALESCE(SUM(output_tokens),0), COUNT(*)
		FROM usage_logs
		WHERE org_uuid=$1 AND created_at >= date_trunc('month', now())`,
		orgUUID,
	).Scan(&inputTokens, &outputTokens, &requestCount)

	// Daily breakdown for chart (last 30 days)
	rows, err := h.db.Query(r.Context(), `
		SELECT
			date_trunc('day', created_at)::date AS day,
			SUM(input_tokens) AS input,
			SUM(output_tokens) AS output,
			COUNT(*) AS requests
		FROM usage_logs
		WHERE org_uuid=$1 AND created_at >= now() - INTERVAL '30 days'
		GROUP BY day ORDER BY day`,
		orgUUID)
	if err != nil {
		writeErr(w, http.StatusInternalServerError, "query failed")
		return
	}
	defer rows.Close()

	type DayData struct {
		Day      string `json:"day"`
		Input    int64  `json:"input"`
		Output   int64  `json:"output"`
		Requests int    `json:"requests"`
	}
	var daily []DayData
	for rows.Next() {
		var d DayData
		rows.Scan(&d.Day, &d.Input, &d.Output, &d.Requests)
		daily = append(daily, d)
	}
	if daily == nil {
		daily = []DayData{}
	}

	// Subscription info
	var plan, status string
	var monthlyLimit int64
	var rpm int
	var periodEnd time.Time
	h.db.QueryRow(r.Context(), `
		SELECT plan, status, monthly_token_limit, rpm_limit, current_period_end
		FROM subscriptions WHERE org_uuid=$1 ORDER BY created_at DESC LIMIT 1`,
		orgUUID,
	).Scan(&plan, &status, &monthlyLimit, &rpm, &periodEnd)

	writeJSON(w, http.StatusOK, map[string]interface{}{
		"month": map[string]interface{}{
			"input_tokens":  inputTokens,
			"output_tokens": outputTokens,
			"total_tokens":  inputTokens + outputTokens,
			"requests":      requestCount,
		},
		"daily": daily,
		"subscription": map[string]interface{}{
			"plan":                plan,
			"status":              status,
			"monthly_token_limit": monthlyLimit,
			"rpm_limit":           rpm,
			"period_end":          periodEnd,
			"percent_used":        percentUsed(inputTokens+outputTokens, monthlyLimit),
		},
	})
}

func percentUsed(used, limit int64) float64 {
	if limit == 0 {
		return 0
	}
	p := float64(used) / float64(limit) * 100
	if p > 100 {
		return 100
	}
	return p
}

// ── GET /api/dashboard/keys ───────────────────────────────────────────────────

func (h *Handlers) DashboardKeys(w http.ResponseWriter, r *http.Request) {
	orgUUID, _ := r.Context().Value(auth.CtxOrgUUID).(string)
	rows, err := h.db.Query(r.Context(), `
		SELECT id, name, key_prefix, last_used, created_at
		FROM api_keys WHERE org_uuid=$1 AND is_active=true ORDER BY created_at DESC`,
		orgUUID)
	if err != nil {
		writeErr(w, http.StatusInternalServerError, "query failed")
		return
	}
	defer rows.Close()

	type Key struct {
		ID        string  `json:"id"`
		Name      string  `json:"name"`
		KeyPrefix string  `json:"key_prefix"`
		LastUsed  *string `json:"last_used"`
		CreatedAt string  `json:"created_at"`
	}
	var keys []Key
	for rows.Next() {
		var k Key
		var lastUsed *time.Time
		var createdAt time.Time
		rows.Scan(&k.ID, &k.Name, &k.KeyPrefix, &lastUsed, &createdAt)
		k.CreatedAt = createdAt.Format(time.RFC3339)
		if lastUsed != nil {
			s := lastUsed.Format(time.RFC3339)
			k.LastUsed = &s
		}
		keys = append(keys, k)
	}
	if keys == nil {
		keys = []Key{}
	}
	writeJSON(w, http.StatusOK, keys)
}

// ── DELETE /api/dashboard/keys/{keyId} ───────────────────────────────────────

func (h *Handlers) DeleteKey(w http.ResponseWriter, r *http.Request) {
	orgUUID, _ := r.Context().Value(auth.CtxOrgUUID).(string)
	// keyId from URL param handled in router
	keyID := r.URL.Query().Get("id")
	h.db.Exec(r.Context(),
		"UPDATE api_keys SET is_active=false WHERE id=$1 AND org_uuid=$2",
		keyID, orgUUID)
	writeJSON(w, http.StatusOK, map[string]string{"status": "deleted"})
}

// ── GET/PATCH /api/settings ───────────────────────────────────────────────────

func (h *Handlers) GetSettings(w http.ResponseWriter, r *http.Request) {
	userUUID, _ := r.Context().Value(auth.CtxUserUUID).(string)
	orgUUID, _ := r.Context().Value(auth.CtxOrgUUID).(string)

	var email, displayName, orgType, rateLimitTier, billingType, plan string
	var hasExtraUsage bool
	h.db.QueryRow(r.Context(), `
		SELECT u.email, u.display_name, o.org_type, o.rate_limit_tier, o.billing_type, o.has_extra_usage,
		       COALESCE(s.plan, 'free')
		FROM users u
		JOIN organizations o ON o.uuid = u.org_uuid
		LEFT JOIN subscriptions s ON s.org_uuid = o.uuid
		WHERE u.uuid=$1`,
		userUUID,
	).Scan(&email, &displayName, &orgType, &rateLimitTier, &billingType, &hasExtraUsage, &plan)

	writeJSON(w, http.StatusOK, map[string]interface{}{
		"account": map[string]interface{}{
			"uuid":         userUUID,
			"email":        email,
			"display_name": displayName,
		},
		"organization": map[string]interface{}{
			"uuid":             orgUUID,
			"org_type":         orgType,
			"rate_limit_tier":  rateLimitTier,
			"billing_type":     billingType,
			"has_extra_usage":  hasExtraUsage,
			"plan":             plan,
		},
	})
}

func (h *Handlers) UpdateSettings(w http.ResponseWriter, r *http.Request) {
	userUUID, _ := r.Context().Value(auth.CtxUserUUID).(string)
	var req struct {
		DisplayName string `json:"display_name"`
	}
	json.NewDecoder(r.Body).Decode(&req)
	h.db.Exec(r.Context(),
		"UPDATE users SET display_name=$1 WHERE uuid=$2",
		req.DisplayName, userUUID)
	writeJSON(w, http.StatusOK, map[string]string{"status": "ok"})
}
