package api

import (
	"context"
	"encoding/json"
	"fmt"
	"net/http"
	"time"

	"github.com/redis/go-redis/v9"
	"github.com/yourusername/anthropic-gateway/internal/auth"
)

// RateLimiter implements sliding window rate limiting via Redis.
type RateLimiter struct {
	rdb *redis.Client
}

func NewRateLimiter(rdb *redis.Client) *RateLimiter {
	return &RateLimiter{rdb: rdb}
}

// tierLimits returns RPM and TPM for a given tier.
var tierLimits = map[string][2]int{
	"free":       {10, 40_000},
	"default":    {60, 100_000},
	"pro":        {100, 200_000},
	"max":        {200, 500_000},
	"team":       {500, 1_000_000},
	"enterprise": {2000, 5_000_000},
}

// Allow checks if this org is within its rate limits.
// key: "rl:{orgUUID}:rpm" or "rl:{orgUUID}:tpm"
func (rl *RateLimiter) Allow(ctx context.Context, orgUUID, tier string, tokens int) (bool, int, error) {
	limits, ok := tierLimits[tier]
	if !ok {
		limits = tierLimits["free"]
	}
	rpm, tpm := limits[0], limits[1]

	now := time.Now()
	windowKey := fmt.Sprintf("rl:%s:rpm:%d", orgUUID, now.Unix()/60)
	tokenKey := fmt.Sprintf("rl:%s:tpm:%d", orgUUID, now.Unix()/60)

	pipe := rl.rdb.Pipeline()
	rpmCmd := pipe.Incr(ctx, windowKey)
	pipe.Expire(ctx, windowKey, 2*time.Minute)
	tpmCmd := pipe.IncrBy(ctx, tokenKey, int64(tokens))
	pipe.Expire(ctx, tokenKey, 2*time.Minute)
	if _, err := pipe.Exec(ctx); err != nil {
		// Redis failure → allow the request (fail open)
		return true, 0, nil
	}

	currentRPM := int(rpmCmd.Val())
	currentTPM := int(tpmCmd.Val())

	if currentRPM > rpm {
		return false, rpm - currentRPM, fmt.Errorf("rate limit: %d rpm exceeded", rpm)
	}
	if tokens > 0 && currentTPM > tpm {
		return false, 0, fmt.Errorf("rate limit: %d tpm exceeded", tpm)
	}

	return true, rpm - currentRPM, nil
}

// RateLimitMiddleware injects rate limit checking into the request chain.
func (h *Handlers) RateLimitMiddleware(next http.Handler) http.Handler {
	rl := NewRateLimiter(h.rdb)
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		orgUUID, _ := r.Context().Value(auth.CtxOrgUUID).(string)
		if orgUUID == "" {
			next.ServeHTTP(w, r)
			return
		}

		// Look up this org's rate limit tier
		var tier string
		h.db.QueryRow(r.Context(),
			"SELECT rate_limit_tier FROM organizations WHERE uuid=$1", orgUUID,
		).Scan(&tier)
		if tier == "" {
			tier = "free"
		}

		ok, remaining, err := rl.Allow(r.Context(), orgUUID, tier, 0)
		if !ok {
			w.Header().Set("Content-Type", "application/json")
			w.Header().Set("X-RateLimit-Limit", fmt.Sprintf("%d", tierLimits[tier][0]))
			w.Header().Set("X-RateLimit-Remaining", "0")
			w.Header().Set("Retry-After", "60")
			w.WriteHeader(http.StatusTooManyRequests)
			json.NewEncoder(w).Encode(map[string]interface{}{
				"error": map[string]interface{}{
					"type":    "rate_limit_error",
					"message": err.Error(),
				},
			})
			return
		}

		w.Header().Set("X-RateLimit-Limit", fmt.Sprintf("%d", tierLimits[tier][0]))
		w.Header().Set("X-RateLimit-Remaining", fmt.Sprintf("%d", remaining))
		next.ServeHTTP(w, r)
	})
}
