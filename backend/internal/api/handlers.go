package api

import (
	"context"
	"encoding/json"
	"fmt"
	"log"
	"net/http"
	"os"
	"strings"
	"time"

	"github.com/go-chi/chi/v5"
	"github.com/google/uuid"
	"github.com/jackc/pgx/v5/pgxpool"
	"github.com/redis/go-redis/v9"
	"golang.org/x/crypto/bcrypt"

	"github.com/yourusername/anthropic-gateway/internal/auth"
	"github.com/yourusername/anthropic-gateway/internal/router"
)

type Handlers struct {
	db     *pgxpool.Pool
	rdb    *redis.Client
	auth   *auth.Service
	router *router.Router
}

func NewHandlers(db *pgxpool.Pool, rdb *redis.Client, authSvc *auth.Service) *Handlers {
	return &Handlers{db: db, rdb: rdb, auth: authSvc, router: router.New()}
}

func writeJSON(w http.ResponseWriter, code int, v interface{}) {
	w.Header().Set("Content-Type", "application/json")
	w.WriteHeader(code)
	json.NewEncoder(w).Encode(v)
}

func writeErr(w http.ResponseWriter, code int, msg string) {
	writeJSON(w, code, map[string]interface{}{
		"error": map[string]string{"type": "error", "message": msg},
	})
}

// ── POST /v1/messages ─────────────────────────────────────────────────────────

func (h *Handlers) Messages(w http.ResponseWriter, r *http.Request) {
	var req router.AnthropicRequest
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		writeErr(w, http.StatusBadRequest, "invalid request body")
		return
	}
	if req.Model == "" {
		req.Model = "claude-sonnet-4-6"
	}
	if req.MaxTokens == 0 {
		req.MaxTokens = 8192
	}

	if req.Stream {
		w.Header().Set("Content-Type", "text/event-stream")
		w.Header().Set("Cache-Control", "no-cache")
		w.Header().Set("Connection", "keep-alive")
		w.Header().Set("X-Accel-Buffering", "no")
	}

	// Log usage async
	orgUUID, _ := r.Context().Value(auth.CtxOrgUUID).(string)
	userUUID, _ := r.Context().Value(auth.CtxUserUUID).(string)
	keyID, _ := r.Context().Value(auth.CtxKeyID).(string)
	go h.logUsage(orgUUID, userUUID, keyID, req.Model)

	if err := h.router.Chat(r.Context(), &req, w); err != nil {
		if !req.Stream {
			writeErr(w, http.StatusBadGateway, fmt.Sprintf("backend error: %v", err))
		}
	}
}

func (h *Handlers) logUsage(orgUUID, userUUID, keyID, model string) {
	ctx, cancel := context.WithTimeout(context.Background(), 5*time.Second)
	defer cancel()
	h.db.Exec(ctx, `
		INSERT INTO usage_logs (org_uuid, user_uuid, api_key_id, model, provider)
		VALUES ($1, $2, NULLIF($3,'')::uuid, $4, 'custom')`,
		orgUUID, userUUID, keyID, model)
}

// ── GET /v1/models ────────────────────────────────────────────────────────────

func (h *Handlers) Models(w http.ResponseWriter, r *http.Request) {
	models, err := h.router.Models(r.Context())
	if err != nil {
		writeErr(w, http.StatusBadGateway, "could not fetch models")
		return
	}
	writeJSON(w, http.StatusOK, map[string]interface{}{
		"type": "list",
		"data": models,
	})
}

// ── Files ─────────────────────────────────────────────────────────────────────

func (h *Handlers) UploadFile(w http.ResponseWriter, r *http.Request) {
	writeJSON(w, http.StatusOK, map[string]interface{}{
		"id": "file_" + uuid.New().String(), "created_at": time.Now().Unix(),
	})
}

func (h *Handlers) ListFiles(w http.ResponseWriter, r *http.Request) {
	writeJSON(w, http.StatusOK, map[string]interface{}{"data": []interface{}{}})
}

func (h *Handlers) GetFileContent(w http.ResponseWriter, r *http.Request) {
	writeErr(w, http.StatusNotFound, "file not found")
}

// ── OAuth: GET /oauth/authorize ───────────────────────────────────────────────

func (h *Handlers) OAuthAuthorize(w http.ResponseWriter, r *http.Request) {
	// Redirect to frontend login page, preserving all OAuth params
	frontendBase := os.Getenv("FRONTEND_URL")
	if frontendBase == "" {
		frontendBase = "http://localhost:3000"
	}
	http.Redirect(w, r, frontendBase+"/login?"+r.URL.RawQuery, http.StatusFound)
}

func (h *Handlers) OAuthCallback(w http.ResponseWriter, r *http.Request) {
	// Frontend handles this
	http.Redirect(w, r, os.Getenv("FRONTEND_URL")+"/dashboard", http.StatusFound)
}

// ── OAuth: POST /v1/oauth/token ───────────────────────────────────────────────

type tokenRequest struct {
	GrantType    string `json:"grant_type"`
	Code         string `json:"code"`
	RefreshToken string `json:"refresh_token"`
	ClientID     string `json:"client_id"`
	CodeVerifier string `json:"code_verifier"`
	Email        string `json:"email"`
	Password     string `json:"password"`
	ExpiresIn    int    `json:"expires_in"`
}

func (h *Handlers) OAuthToken(w http.ResponseWriter, r *http.Request) {
	var req tokenRequest
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		// Try form values
		r.ParseForm()
		req.GrantType = r.FormValue("grant_type")
		req.Code = r.FormValue("code")
		req.RefreshToken = r.FormValue("refresh_token")
		req.Email = r.FormValue("email")
		req.Password = r.FormValue("password")
	}

	switch req.GrantType {
	case "authorization_code":
		h.handleAuthCode(w, r, req)
	case "refresh_token":
		h.handleRefreshToken(w, r, req)
	case "password": // for direct email/password login
		h.handlePassword(w, r, req)
	default:
		writeErr(w, http.StatusBadRequest, "unsupported grant_type")
	}
}

func (h *Handlers) handleAuthCode(w http.ResponseWriter, r *http.Request, req tokenRequest) {
	// In a real impl, validate the auth code from a temp store
	// For now, return error asking to use password grant
	writeErr(w, http.StatusBadRequest, "authorization_code grant requires browser flow")
}

func (h *Handlers) handlePassword(w http.ResponseWriter, r *http.Request, req tokenRequest) {
	if req.Email == "" || req.Password == "" {
		writeErr(w, http.StatusBadRequest, "email and password required")
		return
	}

	var userUUID, orgUUID, passwordHash string
	err := h.db.QueryRow(r.Context(), `
		SELECT u.uuid, u.org_uuid, u.password_hash
		FROM users u WHERE u.email = $1`, req.Email,
	).Scan(&userUUID, &orgUUID, &passwordHash)
	if err != nil {
		writeErr(w, http.StatusUnauthorized, "invalid credentials")
		return
	}

	if err := bcrypt.CompareHashAndPassword([]byte(passwordHash), []byte(req.Password)); err != nil {
		writeErr(w, http.StatusUnauthorized, "invalid credentials")
		return
	}

	h.issueTokens(w, r.Context(), userUUID, orgUUID, req.Email,
		[]string{"user:profile", "user:inference", "user:sessions:claude_code"})
}

func (h *Handlers) handleRefreshToken(w http.ResponseWriter, r *http.Request, req tokenRequest) {
	sess, err := h.auth.GetSessionByRefreshToken(r.Context(), req.RefreshToken)
	if err != nil {
		writeErr(w, http.StatusUnauthorized, "invalid or expired refresh token")
		return
	}
	h.issueTokens(w, r.Context(), sess.UserUUID, sess.OrgUUID, sess.Email, sess.Scopes)
}

func (h *Handlers) issueTokens(w http.ResponseWriter, ctx context.Context, userUUID, orgUUID, email string, scopes []string) {
	accessTTL := 1 * time.Hour
	refreshTTL := 30 * 24 * time.Hour

	accessToken, err := h.auth.GenerateAccessToken(userUUID, orgUUID, email, scopes, accessTTL)
	if err != nil {
		writeErr(w, http.StatusInternalServerError, "token generation failed")
		return
	}

	refreshToken, err := h.auth.GenerateRefreshToken()
	if err != nil {
		writeErr(w, http.StatusInternalServerError, "token generation failed")
		return
	}

	h.auth.StoreRefreshToken(ctx, refreshToken, auth.Session{
		UserUUID: userUUID, OrgUUID: orgUUID, Email: email, Scopes: scopes,
	}, refreshTTL)

	writeJSON(w, http.StatusOK, map[string]interface{}{
		"access_token":  accessToken,
		"refresh_token": refreshToken,
		"token_type":    "Bearer",
		"expires_in":    int(accessTTL.Seconds()),
		"scope":         strings.Join(scopes, " "),
		"account": map[string]string{
			"uuid":         userUUID,
			"emailAddress": email,
			"organizationUuid": orgUUID,
		},
	})
}

// ── GET /api/oauth/profile ────────────────────────────────────────────────────

func (h *Handlers) OAuthProfile(w http.ResponseWriter, r *http.Request) {
	userUUID, _ := r.Context().Value(auth.CtxUserUUID).(string)
	orgUUID, _ := r.Context().Value(auth.CtxOrgUUID).(string)
	email, _ := r.Context().Value(auth.CtxEmail).(string)

	var orgType, rateLimitTier, billingType string
	var hasExtraUsage bool
	var orgName, displayName string
	h.db.QueryRow(r.Context(), `
		SELECT o.org_type, o.rate_limit_tier, o.billing_type, o.has_extra_usage, o.name, u.display_name
		FROM organizations o JOIN users u ON u.org_uuid = o.uuid
		WHERE u.uuid = $1`, userUUID,
	).Scan(&orgType, &rateLimitTier, &billingType, &hasExtraUsage, &orgName, &displayName)

	writeJSON(w, http.StatusOK, map[string]interface{}{
		"account": map[string]interface{}{
			"uuid":         userUUID,
			"email":        email,
			"display_name": displayName,
			"created_at":   time.Now().Format(time.RFC3339),
		},
		"organization": map[string]interface{}{
			"uuid":                    orgUUID,
			"name":                    orgName,
			"organization_type":       orgType,
			"rate_limit_tier":         rateLimitTier,
			"billing_type":            billingType,
			"has_extra_usage_enabled": hasExtraUsage,
			"subscription_created_at": time.Now().Format(time.RFC3339),
		},
	})
}

// ── GET /api/oauth/claude_cli/roles ──────────────────────────────────────────

func (h *Handlers) OAuthRoles(w http.ResponseWriter, r *http.Request) {
	userUUID, _ := r.Context().Value(auth.CtxUserUUID).(string)
	var orgRole, workspaceRole, orgName string
	h.db.QueryRow(r.Context(), `
		SELECT u.org_role, u.workspace_role, o.name
		FROM users u JOIN organizations o ON o.uuid = u.org_uuid
		WHERE u.uuid = $1`, userUUID,
	).Scan(&orgRole, &workspaceRole, &orgName)

	writeJSON(w, http.StatusOK, map[string]interface{}{
		"organization_role": orgRole,
		"workspace_role":    workspaceRole,
		"organization_name": orgName,
	})
}

// ── POST /api/claude_cli/api_key ──────────────────────────────────────────────

func (h *Handlers) CreateAPIKey(w http.ResponseWriter, r *http.Request) {
	userUUID, _ := r.Context().Value(auth.CtxUserUUID).(string)
	orgUUID, _ := r.Context().Value(auth.CtxOrgUUID).(string)

	rawKey, prefix, keyHash, err := auth.GenerateAPIKey()
	if err != nil {
		writeErr(w, http.StatusInternalServerError, "key generation failed")
		return
	}

	_, err = h.db.Exec(r.Context(), `
		INSERT INTO api_keys (user_uuid, org_uuid, name, key_prefix, key_hash)
		VALUES ($1, $2, 'Claude CLI', $3, $4)`,
		userUUID, orgUUID, prefix, keyHash)
	if err != nil {
		writeErr(w, http.StatusInternalServerError, "could not store key")
		return
	}

	writeJSON(w, http.StatusOK, map[string]string{"raw_key": rawKey})
}

// ── GET /api/claude_cli_profile ───────────────────────────────────────────────

func (h *Handlers) CLIProfile(w http.ResponseWriter, r *http.Request) {
	h.OAuthProfile(w, r)
}

// ── GET /api/claude_cli/bootstrap ────────────────────────────────────────────

func (h *Handlers) Bootstrap(w http.ResponseWriter, r *http.Request) {
	writeJSON(w, http.StatusOK, map[string]interface{}{
		"flags":    map[string]interface{}{},
		"limits":   map[string]interface{}{},
		"features": map[string]bool{"mcp": true, "streaming": true},
	})
}

// ── Organization stubs ────────────────────────────────────────────────────────

func (h *Handlers) AdminRequest(w http.ResponseWriter, r *http.Request) {
	writeJSON(w, http.StatusOK, map[string]string{"status": "ok"})
}

func (h *Handlers) AdminRequestMe(w http.ResponseWriter, r *http.Request) {
	writeJSON(w, http.StatusOK, map[string]interface{}{"data": nil})
}

func (h *Handlers) AdminRequestEligibility(w http.ResponseWriter, r *http.Request) {
	writeJSON(w, http.StatusOK, map[string]bool{"eligible": false})
}

func (h *Handlers) ReferralEligibility(w http.ResponseWriter, r *http.Request) {
	writeJSON(w, http.StatusOK, map[string]bool{"eligible": false})
}

func (h *Handlers) ReferralRedeem(w http.ResponseWriter, r *http.Request) {
	writeJSON(w, http.StatusOK, map[string]string{"status": "ok"})
}

func (h *Handlers) OverageGrant(w http.ResponseWriter, r *http.Request) {
	_ = chi.URLParam(r, "orgId")
	writeJSON(w, http.StatusOK, map[string]string{"status": "ok"})
}

// ── Middleware ────────────────────────────────────────────────────────────────

func (h *Handlers) AuthMiddleware(next http.Handler) http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		apiKey := r.Header.Get("x-api-key")
		if apiKey == "" {
			if authHeader := r.Header.Get("Authorization"); strings.HasPrefix(authHeader, "Bearer ") {
				apiKey = strings.TrimPrefix(authHeader, "Bearer ")
			}
		}

		if apiKey == "" {
			writeErr(w, http.StatusUnauthorized, "missing api key")
			return
		}

		keyHash := h.auth.HashKey(apiKey)
		var keyID, userUUID, orgUUID string
		err := h.db.QueryRow(r.Context(), `
			SELECT id, user_uuid, org_uuid FROM api_keys
			WHERE key_hash = $1 AND is_active = true`, keyHash,
		).Scan(&keyID, &userUUID, &orgUUID)
		if err != nil {
			writeErr(w, http.StatusUnauthorized, "invalid api key")
			return
		}

		// Update last_used
		go h.db.Exec(context.Background(), `UPDATE api_keys SET last_used = NOW() WHERE id = $1`, keyID)

		ctx := context.WithValue(r.Context(), auth.CtxKeyID, keyID)
		ctx = context.WithValue(ctx, auth.CtxUserUUID, userUUID)
		ctx = context.WithValue(ctx, auth.CtxOrgUUID, orgUUID)
		next.ServeHTTP(w, r.WithContext(ctx))
	})
}

func (h *Handlers) BearerMiddleware(next http.Handler) http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		authHeader := r.Header.Get("Authorization")
		if !strings.HasPrefix(authHeader, "Bearer ") {
			writeErr(w, http.StatusUnauthorized, "missing bearer token")
			return
		}

		token := strings.TrimPrefix(authHeader, "Bearer ")
		claims, err := h.auth.ValidateAccessToken(token)
		if err != nil {
			writeErr(w, http.StatusUnauthorized, "invalid or expired token")
			return
		}

		log.Printf("[DEBUG BearerMiddleware] JWT Claims: UserUUID=%s, OrgUUID=%s, Email=%s", claims.UserUUID, claims.OrgUUID, claims.Email)

		ctx := context.WithValue(r.Context(), auth.CtxUserUUID, claims.UserUUID)
		ctx = context.WithValue(ctx, auth.CtxOrgUUID, claims.OrgUUID)
		ctx = context.WithValue(ctx, auth.CtxEmail, claims.Email)
		next.ServeHTTP(w, r.WithContext(ctx))
	})
}
