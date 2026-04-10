# Multi-stage Bun build for OpenClaude Bot Gateway
# 24/7 production deployment
#
# Build:  docker build -f docker/Dockerfile -t openclaude-bots .
# Run:    docker run -d --name openclaude-bots \
#           -v openclaude-data:/home/openclaude/.openclaude \
#           -p 3000:3000 \
#           -e TELEGRAM_BOT_TOKEN=xxx \
#           -e DISCORD_BOT_TOKEN=xxx \
#           openclaude-bots
# Compose: docker compose -f docker/docker-compose.yml up -d

# ─── Build stage ─────────────────────────────────────────────────────────────
FROM oven/bun:1.3-alpine AS base
WORKDIR /app

COPY package.json bun.lock ./
RUN bun install --frozen-lockfile

COPY . .
RUN bun run build

# ─── Production stage ────────────────────────────────────────────────────────
FROM oven/bun:1.3-alpine AS runtime

LABEL org.opencontainers.image.title="OpenClaude Bot Gateway"
LABEL org.opencontainers.image.description="24/7 Discord + Telegram bot gateway for OpenClaude"
LABEL org.opencontainers.image.source="https://github.com/Gitlawb/openclaude"
LABEL org.opencontainers.image.licenses="MIT"

WORKDIR /app

# Non-root user
RUN addgroup -g 1001 -S openclaude && \
    adduser -S openclaude -u 1001 -G openclaude

# Only copy what's needed for runtime
COPY --from=base /app/dist/cli.mjs ./dist/cli.mjs
COPY --from=base /app/node_modules ./node_modules
COPY --from=base /app/package.json ./package.json

# Data volume for channel persistence
VOLUME /home/openclaude/.openclaude

USER openclaude

ENV NODE_ENV=production
EXPOSE 3000

# Healthcheck — hits /healthz and validates JSON response
HEALTHCHECK --interval=30s --timeout=5s --start-period=15s --retries=3 \
  CMD wget --spider -q http://localhost:3000/healthz || exit 1

CMD ["bun", "run", "dist/cli.mjs", "bots", "gateway"]
