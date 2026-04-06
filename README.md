# Anthropic API Gateway

Self-hosted Go API gateway that replicates api.anthropic.com functionality and proxies requests to your custom OpenAI-compatible API.

## Features

- 🔐 Full authentication system (registration, login, OAuth, JWT)
- 💳 Subscription tiers (Free/Pro/Max/Team/Enterprise)
- 📊 Usage dashboard with recharts visualization
- 🚦 Redis-based rate limiting (sliding window)
- 🔑 API key management (`sk-ant-api03-...` format)
- 📡 SSE streaming support
- 🔄 Anthropic ↔ OpenAI format translation
- 🎨 Modern Next.js 15 frontend with Tailwind CSS

## Architecture

```
┌─────────────┐      ┌─────────────┐      ┌──────────────┐
│   Nginx     │─────▶│  Backend    │─────▶│ Your Custom  │
│   :80       │      │  Go :8080   │      │ API Endpoint │
└─────────────┘      └─────────────┘      └──────────────┘
       │                    │
       │                    ├─────▶ PostgreSQL
       │                    └─────▶ Redis
       │
       └─────────────▶ Frontend (Next.js :3000)
```

## Quick Start

### Prerequisites

- Docker & Docker Compose
- Node.js 18+ (for local development)
- Go 1.22+ (for local development)

### 1. Clone and Configure

```bash
git clone <repo>
cd gateway
cp .env.example .env
```

Edit `.env`:

```env
DATABASE_URL=postgres://postgres:postgres@postgres:5432/gateway
REDIS_ADDR=redis:6379
JWT_SECRET=your-secret-key-change-in-production
BACKEND_API_URL=https://kingston-meat-sodium-totally.trycloudflare.com/v1
PORT=8080
```

### 2. Start Services

```bash
docker-compose up -d
```

Services will be available at:
- Gateway: http://localhost
- Backend API: http://localhost:8080
- Frontend: http://localhost:3000
- PostgreSQL: localhost:5432
- Redis: localhost:6379

### 3. Initialize Database

```bash
docker-compose exec postgres psql -U postgres -d gateway -f /docker-entrypoint-initdb.d/schema.sql
```

### 4. Register & Get API Key

1. Visit http://localhost
2. Click "Get Started" → Register
3. Login to dashboard
4. Create API key
5. Copy your `sk-ant-api03-...` key

### 5. Use with openclaude CLI

```bash
npm install -g @gitlawb/openclaude

export ANTHROPIC_BASE_URL=http://localhost
export ANTHROPIC_API_KEY=sk-ant-api03-your-key

openclaude
```

## API Endpoints

### Core LLM API
- `POST /v1/messages` - Chat completions (SSE streaming)
- `GET /v1/models` - List available models

### Authentication
- `POST /auth/register` - Register new user
- `POST /v1/oauth/token` - Login (grant_type: password)
- `GET /api/oauth/profile` - Get user profile (Bearer token)

### Dashboard
- `GET /api/dashboard/stats` - Usage statistics
- `GET /api/dashboard/keys` - List API keys
- `DELETE /api/dashboard/keys` - Revoke API key

### Settings
- `GET /api/settings` - Get user settings
- `PATCH /api/settings` - Update user settings

## Rate Limits

| Tier | RPM | TPM |
|------|-----|-----|
| Free | 10 | 10,000 |
| Pro | 100 | 100,000 |
| Max | 200 | 200,000 |
| Team | 500 | 500,000 |
| Enterprise | 2000 | 2,000,000 |

## Model Mapping

Anthropic model names are automatically translated to your API's model names:

| Anthropic | Your API |
|-----------|----------|
| claude-opus-4-6 | kiro/claude-sonnet-4.5 |
| claude-sonnet-4-6 | kiro/claude-sonnet-4.5 |
| claude-haiku-4-5 | kiro/claude-haiku-4.5 |
| gpt-4 | qwen/qwen3-coder-plus |
| gpt-3.5-turbo | qwen/qwen3-coder-flash |

## Development

### Backend

```bash
cd backend
go mod download
go run cmd/server/main.go
```

### Frontend

```bash
cd frontend
npm install
npm run dev
```

### Database Migrations

Schema is in `backend/internal/db/schema.sql`. Apply manually:

```bash
psql -U postgres -d gateway -f backend/internal/db/schema.sql
```

## Project Structure

```
gateway/
├── backend/
│   ├── cmd/server/main.go          # Entry point
│   ├── internal/
│   │   ├── api/
│   │   │   ├── handlers.go         # Core API handlers
│   │   │   ├── auth_handlers.go    # Auth & dashboard
│   │   │   └── ratelimit.go        # Redis rate limiter
│   │   ├── auth/
│   │   │   ├── service.go          # JWT & API keys
│   │   │   └── middleware.go       # Auth middleware
│   │   ├── router/
│   │   │   └── router.go           # Format translation
│   │   └── db/
│   │       └── schema.sql          # PostgreSQL schema
│   └── go.mod
├── frontend/
│   ├── app/
│   │   ├── page.tsx                # Landing page
│   │   ├── login/page.tsx          # Login
│   │   ├── register/page.tsx       # Registration
│   │   ├── dashboard/page.tsx      # Dashboard with charts
│   │   └── settings/               # Settings pages
│   │       ├── layout.tsx
│   │       ├── page.tsx            # General
│   │       ├── account/page.tsx
│   │       ├── privacy/page.tsx
│   │       ├── billing/page.tsx
│   │       ├── usage/page.tsx
│   │       ├── capabilities/page.tsx
│   │       ├── connectors/page.tsx
│   │       ├── claude-code/page.tsx
│   │       └── claude-chrome/page.tsx
│   └── package.json
├── docker-compose.yml
├── nginx.conf
└── README.md
```

## Security

- Passwords hashed with bcrypt (cost 10)
- API keys hashed with SHA256
- JWT tokens with configurable secret
- Rate limiting per API key
- CORS configured for production

## License

MIT
