# ---- build stage ----
FROM node:22-slim AS build

# Install Bun
RUN npm install -g bun@1.3.12

WORKDIR /app

# Copy dependency manifests first for better layer caching
COPY package.json bun.lock ./

# Install all dependencies (including devDependencies for build)
RUN bun install --frozen-lockfile

# Copy source code
COPY src/ src/
COPY scripts/ scripts/
COPY bin/ bin/
COPY tsconfig.json ./

# Build the CLI bundle
RUN bun run build

# Prune devDependencies
RUN rm -rf node_modules && bun install --frozen-lockfile --production

# ---- runtime stage ----
FROM node:22-slim

WORKDIR /app

# Copy only what's needed to run
COPY --from=build /app/dist/cli.mjs dist/cli.mjs
COPY --from=build /app/bin/ bin/
COPY --from=build /app/node_modules/ node_modules/
COPY --from=build /app/package.json package.json
COPY README.md ./
COPY scripts/docker-entrypoint.sh scripts/docker-entrypoint.sh
COPY scripts/release/openrag-mcp-bridge.cjs scripts/release/openrag-mcp-bridge.cjs
COPY scripts/release/camofox-mcp-bridge.cjs scripts/release/camofox-mcp-bridge.cjs
COPY scripts/release/camofox-control.mjs scripts/release/camofox-control.mjs
COPY scripts/release/hindsight-mcp-bridge.cjs scripts/release/hindsight-mcp-bridge.cjs
COPY scripts/release/hindsight-control.mjs scripts/release/hindsight-control.mjs
COPY scripts/release/test-hindsight-mcp-bridge.cjs scripts/release/test-hindsight-mcp-bridge.cjs

# Install git and ripgrep - many CLI tool operations depend on them
RUN apt-get update && apt-get install -y --no-install-recommends \
      ca-certificates \
      curl \
      git \
      gosu \
      ripgrep \
      python3 \
      python3-pip \
      python3-venv \
    && rm -rf /var/lib/apt/lists/*

RUN curl -LsSf https://astral.sh/uv/install.sh | sh \
    && ln -sf /root/.local/bin/uv /usr/local/bin/uv \
    && ln -sf /root/.local/bin/uvx /usr/local/bin/uvx

RUN chmod +x scripts/docker-entrypoint.sh \
    && mkdir -p /home/node/.openclaude \
    && chown -R node:node /home/node/.openclaude

EXPOSE 8642 8080

ENTRYPOINT ["/app/scripts/docker-entrypoint.sh"]
