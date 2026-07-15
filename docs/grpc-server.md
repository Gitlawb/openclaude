# Headless gRPC Server

OpenClaude can be run as a headless gRPC service, allowing you to integrate
its agentic capabilities (tools, bash, file editing) into other applications,
CI/CD pipelines, or custom user interfaces. The server uses bidirectional
streaming to send real-time text chunks, tool calls, and request permissions
for sensitive commands.

## 1. Start the gRPC server

Start the core engine as a gRPC service on `localhost:50051`:

```bash
npm run dev:grpc
```

### Configuration

| Variable | Default | Description |
|-----------|-------------|------------------------------------------------|
| `GRPC_PORT` | `50051` | Port the gRPC server listens on |
| `GRPC_HOST` | `localhost` | Bind address. Use `0.0.0.0` to expose on all interfaces (not recommended without authentication) |

## 2. Run the test CLI client

A lightweight CLI client is provided that communicates exclusively over gRPC.
It acts just like the main interactive CLI, rendering colors, streaming
tokens, and prompting you for tool permissions (y/n) via the gRPC
`action_required` event.

In a separate terminal, run:

```bash
npm run dev:grpc:cli
```

> **Note:** The gRPC definitions are located in `src/proto/openclaude.proto`.
> You can use this file to generate clients in Python, Go, Rust, or any other
> language.
