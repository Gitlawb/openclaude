package auth

import (
	"context"
	"crypto/rand"
	"crypto/sha256"
	"encoding/base64"
	"encoding/hex"
	"fmt"
	"log"
	"net/http"
	"strings"
	"time"

	"github.com/golang-jwt/jwt/v5"
	"github.com/google/uuid"
	"github.com/jackc/pgx/v5/pgxpool"
	"github.com/redis/go-redis/v9"
)

type Service struct {
	db        *pgxpool.Pool
	rdb       *redis.Client
	jwtSecret []byte
}

func NewService(db *pgxpool.Pool, rdb *redis.Client, jwtSecret string) *Service {
	return &Service{db: db, rdb: rdb, jwtSecret: []byte(jwtSecret)}
}

// ── JWT ───────────────────────────────────────────────────────────────────────

type Claims struct {
	UserUUID string `json:"user_uuid"`
	OrgUUID  string `json:"org_uuid"`
	Email    string `json:"email"`
	Scopes   string `json:"scopes"`
	jwt.RegisteredClaims
}

func (s *Service) GenerateAccessToken(userUUID, orgUUID, email string, scopes []string, ttl time.Duration) (string, error) {
	claims := Claims{
		UserUUID: userUUID,
		OrgUUID:  orgUUID,
		Email:    email,
		Scopes:   strings.Join(scopes, " "),
		RegisteredClaims: jwt.RegisteredClaims{
			ExpiresAt: jwt.NewNumericDate(time.Now().Add(ttl)),
			IssuedAt:  jwt.NewNumericDate(time.Now()),
			ID:        uuid.New().String(),
		},
	}
	token := jwt.NewWithClaims(jwt.SigningMethodHS256, claims)
	return token.SignedString(s.jwtSecret)
}

func (s *Service) GenerateRefreshToken() (string, error) {
	b := make([]byte, 32)
	if _, err := rand.Read(b); err != nil {
		return "", err
	}
	return base64.URLEncoding.EncodeToString(b), nil
}

func (s *Service) ValidateAccessToken(tokenStr string) (*Claims, error) {
	token, err := jwt.ParseWithClaims(tokenStr, &Claims{}, func(t *jwt.Token) (interface{}, error) {
		if _, ok := t.Method.(*jwt.SigningMethodHMAC); !ok {
			return nil, fmt.Errorf("unexpected signing method")
		}
		return s.jwtSecret, nil
	})
	if err != nil {
		return nil, err
	}
	if claims, ok := token.Claims.(*Claims); ok && token.Valid {
		log.Printf("[DEBUG ValidateAccessToken] UserUUID=%s, OrgUUID=%s, Email=%s", claims.UserUUID, claims.OrgUUID, claims.Email)
		return claims, nil
	}
	return nil, fmt.Errorf("invalid token")
}

// ── API Keys ──────────────────────────────────────────────────────────────────

// GenerateAPIKey creates a key in the format: sk-ant-api03-{random}
func GenerateAPIKey() (rawKey, prefix, keyHash string, err error) {
	b := make([]byte, 40)
	if _, err = rand.Read(b); err != nil {
		return
	}
	encoded := base64.URLEncoding.EncodeToString(b)
	encoded = strings.NewReplacer("+", "A", "/", "B", "=", "").Replace(encoded)
	rawKey = "sk-ant-api03-" + encoded
	prefix = rawKey[:25] + "..."
	h := sha256.Sum256([]byte(rawKey))
	keyHash = hex.EncodeToString(h[:])
	return
}

// HashAPIKey returns the sha256 hash of a raw key for DB lookup.
func HashAPIKey(rawKey string) string {
	h := sha256.Sum256([]byte(rawKey))
	return hex.EncodeToString(h[:])
}

// HashKey is a method wrapper for HashAPIKey
func (s *Service) HashKey(rawKey string) string {
	return HashAPIKey(rawKey)
}

// ── Session store (refresh tokens in DB) ──────────────────────────────────────

type Session struct {
	UserUUID string
	OrgUUID  string
	Email    string
	Scopes   []string
}

func (s *Service) StoreRefreshToken(ctx context.Context, refreshToken string, sess Session, ttl time.Duration) error {
	_, err := s.db.Exec(ctx, `
		INSERT INTO oauth_sessions (user_uuid, access_token, refresh_token, scopes, expires_at)
		VALUES ($1, $2, $3, $4, $5)
		ON CONFLICT DO NOTHING`,
		sess.UserUUID,
		"bearer-"+uuid.New().String(), // placeholder access token
		refreshToken,
		sess.Scopes,
		time.Now().Add(ttl),
	)
	return err
}

func (s *Service) GetSessionByRefreshToken(ctx context.Context, refreshToken string) (*Session, error) {
	var sess Session
	var scopes []string
	err := s.db.QueryRow(ctx, `
		SELECT u.uuid, u.org_uuid, u.email, os.scopes
		FROM oauth_sessions os
		JOIN users u ON u.uuid = os.user_uuid
		WHERE os.refresh_token = $1 AND os.expires_at > now()`,
		refreshToken,
	).Scan(&sess.UserUUID, &sess.OrgUUID, &sess.Email, &scopes)
	if err != nil {
		return nil, fmt.Errorf("refresh token not found or expired")
	}
	sess.Scopes = scopes
	return &sess, nil
}

// ── Middleware helpers ────────────────────────────────────────────────────────

type contextKey string

const (
	CtxUserUUID contextKey = "user_uuid"
	CtxOrgUUID  contextKey = "org_uuid"
	CtxEmail    contextKey = "email"
	CtxKeyID    contextKey = "key_id"
)

// ValidateAPIKeyFromDB checks the key hash in the database and returns the session.
func (s *Service) ValidateAPIKeyFromDB(ctx context.Context, rawKey string) (*Session, string, error) {
	hash := HashAPIKey(rawKey)
	var sess Session
	var keyID string
	err := s.db.QueryRow(ctx, `
		SELECT k.id, u.uuid, u.org_uuid, u.email
		FROM api_keys k
		JOIN users u ON u.uuid = k.user_uuid
		WHERE k.key_hash = $1 AND k.is_active = true`,
		hash,
	).Scan(&keyID, &sess.UserUUID, &sess.OrgUUID, &sess.Email)
	if err != nil {
		return nil, "", fmt.Errorf("invalid api key")
	}
	// Update last_used async
	go func() {
		s.db.Exec(context.Background(),
			"UPDATE api_keys SET last_used = now() WHERE id = $1", keyID)
	}()
	return &sess, keyID, nil
}

// ExtractBearerToken extracts "Bearer <token>" from Authorization header.
func ExtractBearerToken(r *http.Request) string {
	h := r.Header.Get("Authorization")
	if strings.HasPrefix(h, "Bearer ") {
		return strings.TrimPrefix(h, "Bearer ")
	}
	return ""
}

// ExtractAPIKey extracts from x-api-key header or Authorization: Bearer sk-ant-...
func ExtractAPIKey(r *http.Request) string {
	if k := r.Header.Get("X-Api-Key"); k != "" {
		return k
	}
	bearer := ExtractBearerToken(r)
	if strings.HasPrefix(bearer, "sk-ant-") {
		return bearer
	}
	return ""
}
