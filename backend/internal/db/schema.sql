-- ============================================================
-- Anthropic API Gateway — PostgreSQL Schema
-- ============================================================

CREATE EXTENSION IF NOT EXISTS "uuid-ossp";
CREATE EXTENSION IF NOT EXISTS "pgcrypto";

-- ============================================================
-- Organizations (like Anthropic's org concept)
-- ============================================================
CREATE TABLE organizations (
    uuid            UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    name            TEXT NOT NULL,
    -- Matches Anthropic's organization_type values
    org_type        TEXT NOT NULL DEFAULT 'claude_pro'
                    CHECK (org_type IN ('claude_pro','claude_max','claude_team','claude_enterprise','api')),
    billing_type    TEXT NOT NULL DEFAULT 'subscription'
                    CHECK (billing_type IN ('subscription','usage_based')),
    rate_limit_tier TEXT NOT NULL DEFAULT 'default'
                    CHECK (rate_limit_tier IN ('free','default','pro','max','team','enterprise')),
    has_extra_usage BOOLEAN NOT NULL DEFAULT false,
    created_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at      TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- ============================================================
-- Users
-- ============================================================
CREATE TABLE users (
    uuid             UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    org_uuid         UUID NOT NULL REFERENCES organizations(uuid) ON DELETE CASCADE,
    email            TEXT NOT NULL UNIQUE,
    password_hash    TEXT,                    -- null if OAuth-only
    display_name     TEXT,
    org_role         TEXT NOT NULL DEFAULT 'member'
                     CHECK (org_role IN ('owner','admin','member','viewer')),
    workspace_role   TEXT NOT NULL DEFAULT 'member'
                     CHECK (workspace_role IN ('admin','member','viewer')),
    email_verified   BOOLEAN NOT NULL DEFAULT false,
    created_at       TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at       TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX idx_users_email ON users(email);
CREATE INDEX idx_users_org ON users(org_uuid);

-- ============================================================
-- OAuth Sessions (access + refresh tokens)
-- ============================================================
CREATE TABLE oauth_sessions (
    id              UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    user_uuid       UUID NOT NULL REFERENCES users(uuid) ON DELETE CASCADE,
    access_token    TEXT NOT NULL UNIQUE,
    refresh_token   TEXT NOT NULL UNIQUE,
    scopes          TEXT[] NOT NULL DEFAULT '{}',
    expires_at      TIMESTAMPTZ NOT NULL,
    created_at      TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX idx_oauth_access  ON oauth_sessions(access_token);
CREATE INDEX idx_oauth_refresh ON oauth_sessions(refresh_token);

-- ============================================================
-- API Keys (sk-ant-api03-... format)
-- ============================================================
CREATE TABLE api_keys (
    id          UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    user_uuid   UUID NOT NULL REFERENCES users(uuid) ON DELETE CASCADE,
    org_uuid    UUID NOT NULL REFERENCES organizations(uuid) ON DELETE CASCADE,
    name        TEXT NOT NULL DEFAULT 'Default',
    key_prefix  TEXT NOT NULL,               -- first 12 chars for display
    key_hash    TEXT NOT NULL UNIQUE,        -- sha256(raw_key)
    raw_key     TEXT,                        -- only stored briefly on creation, then nulled
    is_active   BOOLEAN NOT NULL DEFAULT true,
    last_used   TIMESTAMPTZ,
    created_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX idx_api_keys_hash     ON api_keys(key_hash);
CREATE INDEX idx_api_keys_user     ON api_keys(user_uuid);
CREATE INDEX idx_api_keys_org      ON api_keys(org_uuid);

-- ============================================================
-- Subscriptions
-- ============================================================
CREATE TABLE subscriptions (
    id                  UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    org_uuid            UUID NOT NULL REFERENCES organizations(uuid) ON DELETE CASCADE,
    plan                TEXT NOT NULL CHECK (plan IN ('free','pro','max','team','enterprise')),
    status              TEXT NOT NULL DEFAULT 'active'
                        CHECK (status IN ('active','cancelled','past_due','trialing')),
    -- Token limits per month
    monthly_token_limit BIGINT NOT NULL DEFAULT 100000,
    -- Requests per minute
    rpm_limit           INTEGER NOT NULL DEFAULT 10,
    price_usd_cents     INTEGER NOT NULL DEFAULT 0,
    current_period_start TIMESTAMPTZ NOT NULL DEFAULT now(),
    current_period_end   TIMESTAMPTZ NOT NULL DEFAULT (now() + INTERVAL '1 month'),
    created_at          TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX idx_subscriptions_org ON subscriptions(org_uuid);

-- ============================================================
-- Usage Logs (per API call)
-- ============================================================
CREATE TABLE usage_logs (
    id              BIGSERIAL PRIMARY KEY,
    org_uuid        UUID NOT NULL REFERENCES organizations(uuid),
    user_uuid       UUID REFERENCES users(uuid),
    api_key_id      UUID REFERENCES api_keys(id),
    model           TEXT NOT NULL,
    input_tokens    INTEGER NOT NULL DEFAULT 0,
    output_tokens   INTEGER NOT NULL DEFAULT 0,
    -- Provider that actually served the request
    provider        TEXT NOT NULL DEFAULT 'anthropic'
                    CHECK (provider IN ('anthropic','openai','ollama','gemini','bedrock','vertex')),
    duration_ms     INTEGER,
    status_code     INTEGER,
    error           TEXT,
    created_at      TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX idx_usage_org      ON usage_logs(org_uuid, created_at DESC);
CREATE INDEX idx_usage_user     ON usage_logs(user_uuid, created_at DESC);
CREATE INDEX idx_usage_api_key  ON usage_logs(api_key_id);

-- ============================================================
-- Monthly Usage Aggregates (for fast dashboard queries)
-- ============================================================
CREATE TABLE usage_monthly (
    org_uuid        UUID NOT NULL REFERENCES organizations(uuid),
    year_month      TEXT NOT NULL,          -- '2026-04'
    input_tokens    BIGINT NOT NULL DEFAULT 0,
    output_tokens   BIGINT NOT NULL DEFAULT 0,
    request_count   INTEGER NOT NULL DEFAULT 0,
    PRIMARY KEY (org_uuid, year_month)
);

-- ============================================================
-- Rate Limit Tracking (rolling window, backed by Redis in prod)
-- ============================================================
CREATE TABLE rate_limit_config (
    tier            TEXT PRIMARY KEY,
    rpm             INTEGER NOT NULL,   -- requests per minute
    tpm             INTEGER NOT NULL,   -- tokens per minute
    monthly_tokens  BIGINT NOT NULL
);

INSERT INTO rate_limit_config VALUES
    ('free',       10,    40000,   100000),
    ('default',    60,    100000,  5000000),
    ('pro',        100,   200000,  20000000),
    ('max',        200,   500000,  100000000),
    ('team',       500,   1000000, 500000000),
    ('enterprise', 2000,  5000000, 9999999999);

-- ============================================================
-- Models available in the gateway
-- ============================================================
CREATE TABLE models (
    id              TEXT PRIMARY KEY,           -- 'claude-sonnet-4-6'
    display_name    TEXT NOT NULL,
    provider        TEXT NOT NULL,
    context_window  INTEGER NOT NULL DEFAULT 200000,
    max_output      INTEGER NOT NULL DEFAULT 8192,
    input_price     NUMERIC(10,6) NOT NULL DEFAULT 0, -- USD per 1M tokens
    output_price    NUMERIC(10,6) NOT NULL DEFAULT 0,
    is_active       BOOLEAN NOT NULL DEFAULT true,
    created_at      TIMESTAMPTZ NOT NULL DEFAULT now()
);

INSERT INTO models VALUES
    ('claude-opus-4-6',    'Claude Opus 4.6',    'anthropic', 200000, 32000, 15.0,  75.0,  true, now()),
    ('claude-sonnet-4-6',  'Claude Sonnet 4.6',  'anthropic', 200000, 16000, 3.0,   15.0,  true, now()),
    ('claude-haiku-4-5',   'Claude Haiku 4.5',   'anthropic', 200000, 8192,  0.8,   4.0,   true, now()),
    ('gpt-4o',             'GPT-4o',             'openai',    128000, 16384, 2.5,   10.0,  true, now()),
    ('gpt-4o-mini',        'GPT-4o Mini',        'openai',    128000, 16384, 0.15,  0.6,   true, now()),
    ('llama3.2:3b',        'Llama 3.2 3B',       'ollama',    8192,   4096,  0.0,   0.0,   true, now()),
    ('qwen2.5-coder:7b',   'Qwen2.5 Coder 7B',  'ollama',    32768,  8192,  0.0,   0.0,   true, now());

-- ============================================================
-- Helper: update updated_at automatically
-- ============================================================
CREATE OR REPLACE FUNCTION set_updated_at()
RETURNS TRIGGER AS $$
BEGIN NEW.updated_at = now(); RETURN NEW; END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER trg_users_updated_at
    BEFORE UPDATE ON users
    FOR EACH ROW EXECUTE FUNCTION set_updated_at();

CREATE TRIGGER trg_orgs_updated_at
    BEFORE UPDATE ON organizations
    FOR EACH ROW EXECUTE FUNCTION set_updated_at();

-- ============================================================
-- Seed: default free plan config
-- ============================================================
INSERT INTO organizations (uuid, name, org_type, billing_type, rate_limit_tier)
VALUES ('00000000-0000-0000-0000-000000000001', 'System', 'claude_pro', 'subscription', 'pro');
