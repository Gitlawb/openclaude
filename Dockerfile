# ---- build stage ----
FROM node:22-slim AS build

# Install Bun
RUN npm install -g bun@1.3.11

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

# Install git — many CLI tool operations depend on it
RUN apt-get update && apt-get install -y --no-install-recommends git \
    && rm -rf /var/lib/apt/lists/*

# Run as non-root user
RUN groupadd --gid 1000 appuser && useradd --uid 1000 --gid appuser --shell /bin/bash --create-home appuser
USER appuser
WORKDIR /home/appuser
ENV HOME=/home/appuser

ENTRYPOINT ["node", "/app/dist/cli.mjs"]
