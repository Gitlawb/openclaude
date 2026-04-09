# Multi-stage Bun build for OpenClaude Bot Gateway
# 24/7 production deployment

FROM oven/bun:1.3-alpine AS base
WORKDIR /app

# Install dependencies
COPY package.json bun.lockb* ./
RUN bun install --frozen-lockfile --production

# Copy source
COPY . .

# Build
RUN bun run build

# Production image
FROM oven/bun:1.3-alpine AS runtime
WORKDIR /app

RUN addgroup -g 1001 -S openclaude && \
    adduser -S openclaude -u 1001

COPY --from=base /app/dist /app/dist
COPY --from=base /app/node_modules /app/node_modules
COPY --from=base /app/package.json /app/package.json

# Data volume for persistence
VOLUME /home/openclaude/.openclaude

USER openclaude

ENV NODE_ENV=production
EXPOSE 3000

HEALTHCHECK --interval=30s --timeout=5s --start-period=10s --retries=3 \
  CMD wget -qO- http://localhost:3000/healthz || exit 1

CMD ["bun", "run", "dist/cli.mjs", "bots", "gateway"]
