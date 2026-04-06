package main

import (
	"context"
	"log"
	"net/http"
	"os"
	"os/signal"
	"syscall"
	"time"

	"github.com/go-chi/chi/v5"
	"github.com/go-chi/chi/v5/middleware"
	"github.com/go-chi/cors"
	"github.com/jackc/pgx/v5/pgxpool"
	"github.com/joho/godotenv"
	"github.com/redis/go-redis/v9"

	"github.com/yourusername/anthropic-gateway/internal/api"
	"github.com/yourusername/anthropic-gateway/internal/auth"
)

func main() {
	_ = godotenv.Load()

	// Database
	db, err := pgxpool.New(context.Background(), getenv("DATABASE_URL", "postgres://postgres:postgres@localhost:5432/gateway"))
	if err != nil {
		log.Fatalf("db connect: %v", err)
	}
	defer db.Close()

	// Redis
	rdb := redis.NewClient(&redis.Options{
		Addr: getenv("REDIS_ADDR", "localhost:6379"),
	})
	defer rdb.Close()

	// Auth service
	authSvc := auth.NewService(db, rdb, getenv("JWT_SECRET", "change-me-in-production"))

	// Handlers
	h := api.NewHandlers(db, rdb, authSvc)

	// Router
	r := chi.NewRouter()
	r.Use(middleware.Logger)
	r.Use(middleware.Recoverer)
	r.Use(middleware.RequestID)
	r.Use(cors.Handler(cors.Options{
		AllowedOrigins:   []string{"*"},
		AllowedMethods:   []string{"GET", "POST", "PUT", "DELETE", "OPTIONS"},
		AllowedHeaders:   []string{"Accept", "Authorization", "Content-Type", "X-Api-Key", "Anthropic-Version", "Anthropic-Beta"},
		AllowCredentials: true,
	}))

	// ── Core LLM API ──────────────────────────────────────────
	r.With(h.AuthMiddleware).Post("/v1/messages", h.Messages)
	r.With(h.AuthMiddleware).Get("/v1/models", h.Models)

	// ── Files API ─────────────────────────────────────────────
	r.With(h.AuthMiddleware).Post("/v1/files", h.UploadFile)
	r.With(h.AuthMiddleware).Get("/v1/files", h.ListFiles)
	r.With(h.AuthMiddleware).Get("/v1/files/{fileId}/content", h.GetFileContent)

	// ── OAuth / Auth ──────────────────────────────────────────
	r.Post("/auth/register", h.Register)
	r.Get("/oauth/authorize", h.OAuthAuthorize)
	r.Post("/v1/oauth/token", h.OAuthToken)
	r.Get("/oauth/code/callback", h.OAuthCallback)

	// ── Profile / Bootstrap ───────────────────────────────────
	r.With(h.BearerMiddleware).Get("/api/oauth/profile", h.OAuthProfile)
	r.With(h.BearerMiddleware).Get("/api/oauth/claude_cli/roles", h.OAuthRoles)
	r.With(h.BearerMiddleware).Post("/api/claude_cli/api_key", h.CreateAPIKey)
	r.With(h.AuthMiddleware).Get("/api/claude_cli_profile", h.CLIProfile)
	r.With(h.BearerMiddleware).Get("/api/claude_cli/bootstrap", h.Bootstrap)

	// ── Dashboard ─────────────────────────────────────────────
	r.With(h.BearerMiddleware).Get("/api/dashboard/stats", h.DashboardStats)
	r.With(h.BearerMiddleware).Get("/api/dashboard/keys", h.DashboardKeys)
	r.With(h.BearerMiddleware).Delete("/api/dashboard/keys", h.DeleteKey)

	// ── Settings ──────────────────────────────────────────────
	r.With(h.BearerMiddleware).Get("/api/settings", h.GetSettings)
	r.With(h.BearerMiddleware).Patch("/api/settings", h.UpdateSettings)

	// ── Organization ──────────────────────────────────────────
	r.With(h.BearerMiddleware).Post("/api/oauth/organizations/{orgId}/admin_requests", h.AdminRequest)
	r.With(h.BearerMiddleware).Get("/api/oauth/organizations/{orgId}/admin_requests/me", h.AdminRequestMe)
	r.With(h.BearerMiddleware).Get("/api/oauth/organizations/{orgId}/admin_requests/eligibility", h.AdminRequestEligibility)
	r.With(h.BearerMiddleware).Get("/api/oauth/organizations/{orgId}/referral/eligibility", h.ReferralEligibility)
	r.With(h.BearerMiddleware).Post("/api/oauth/organizations/{orgId}/referral/redemptions", h.ReferralRedeem)
	r.With(h.BearerMiddleware).Post("/api/oauth/organizations/{orgId}/overage_credit_grant", h.OverageGrant)

	// ── Health ────────────────────────────────────────────────
	r.Get("/health", func(w http.ResponseWriter, r *http.Request) {
		w.WriteHeader(http.StatusOK)
		w.Write([]byte(`{"status":"ok"}`))
	})

	srv := &http.Server{
		Addr:         ":" + getenv("PORT", "8080"),
		Handler:      r,
		ReadTimeout:  30 * time.Second,
		WriteTimeout: 10 * time.Minute, // long for SSE streaming
		IdleTimeout:  120 * time.Second,
	}

	go func() {
		log.Printf("Gateway listening on %s", srv.Addr)
		if err := srv.ListenAndServe(); err != http.ErrServerClosed {
			log.Fatalf("server: %v", err)
		}
	}()

	quit := make(chan os.Signal, 1)
	signal.Notify(quit, syscall.SIGINT, syscall.SIGTERM)
	<-quit

	ctx, cancel := context.WithTimeout(context.Background(), 10*time.Second)
	defer cancel()
	srv.Shutdown(ctx)
	log.Println("Server stopped")
}

func getenv(key, fallback string) string {
	if v := os.Getenv(key); v != "" {
		return v
	}
	return fallback
}
