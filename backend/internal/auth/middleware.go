package auth

import (
	"context"
	"encoding/json"
	"net/http"
	"strings"
)

func writeError(w http.ResponseWriter, code int, msg string) {
	w.Header().Set("Content-Type", "application/json")
	w.WriteHeader(code)
	json.NewEncoder(w).Encode(map[string]interface{}{
		"error": map[string]string{"type": "authentication_error", "message": msg},
	})
}

// AuthMiddleware accepts sk-ant-... API keys via x-api-key or Authorization header.
func (s *Service) AuthMiddleware(next http.Handler) http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		rawKey := ExtractAPIKey(r)
		if rawKey == "" {
			writeError(w, http.StatusUnauthorized, "Missing API key. Set x-api-key header.")
			return
		}
		sess, keyID, err := s.ValidateAPIKeyFromDB(r.Context(), rawKey)
		if err != nil {
			writeError(w, http.StatusUnauthorized, "Invalid API key.")
			return
		}
		ctx := context.WithValue(r.Context(), CtxUserUUID, sess.UserUUID)
		ctx = context.WithValue(ctx, CtxOrgUUID, sess.OrgUUID)
		ctx = context.WithValue(ctx, CtxEmail, sess.Email)
		ctx = context.WithValue(ctx, CtxKeyID, keyID)
		next.ServeHTTP(w, r.WithContext(ctx))
	})
}

// BearerMiddleware accepts OAuth JWT access tokens (Bearer ...).
func (s *Service) BearerMiddleware(next http.Handler) http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		token := ExtractBearerToken(r)
		if token == "" || strings.HasPrefix(token, "sk-ant-") {
			writeError(w, http.StatusUnauthorized, "Missing Bearer token.")
			return
		}
		claims, err := s.ValidateAccessToken(token)
		if err != nil {
			writeError(w, http.StatusUnauthorized, "Invalid or expired token.")
			return
		}
		ctx := context.WithValue(r.Context(), CtxUserUUID, claims.UserUUID)
		ctx = context.WithValue(ctx, CtxOrgUUID, claims.OrgUUID)
		ctx = context.WithValue(ctx, CtxEmail, claims.Email)
		next.ServeHTTP(w, r.WithContext(ctx))
	})
}
