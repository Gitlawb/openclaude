"""
lmstudio_provider.py
--------------------
Adds native LM Studio support to openclaude.
Lets Claude Code route requests to any locally-running model in LM Studio
(Llama 3, Mistral, Phi-3, Qwen, DeepSeek, Gemma, etc.)
without needing an API key.

LM Studio exposes an OpenAI-compatible API, so messages are forwarded
directly with minimal translation.

## Prerequisites

1. Download and install LM Studio from https://lmstudio.ai/
2. Open LM Studio and download a model (e.g., Llama 3.1 8B, Mistral 7B)
3. Start the local inference server:
   - Click the "Local Server" tab in LM Studio
   - Select your model from the dropdown
   - Click "Start Server"
   - The server runs on http://localhost:1234 by default

## Quick Start

### Option 1: Environment Variables

```bash
# Enable OpenAI-compatible provider
export CLAUDE_CODE_USE_OPENAI=1

# Point to LM Studio's local server
export OPENAI_BASE_URL=http://localhost:1234/v1

# Set the model name (must match a loaded model in LM Studio)
export OPENAI_MODEL=your-model-name

# No API key needed for local inference
# LM Studio does not require authentication

# Launch openclaude
openclaude
```

### Option 2: Using the Profile Launcher

```bash
# Bootstrap LM Studio as your provider
bun run profile:init -- --provider lmstudio

# Or launch directly with the LM Studio profile
bun run dev:lmstudio
```

## Usage (.env)

Create a `.env` file in your project root:

```env
# Enable OpenAI-compatible provider
CLAUDE_CODE_USE_OPENAI=1

# LM Studio local server endpoint
OPENAI_BASE_URL=http://localhost:1234/v1

# Model name as shown in LM Studio
OPENAI_MODEL=your-model-name

# Optional: Override for specific use
# BIG_MODEL=llama-3.1-70b
# SMALL_MODEL=phi-3-mini
```

## Configuration Options

### Environment Variables

| Variable | Required | Default | Description |
|----------|----------|---------|-------------|
| `CLAUDE_CODE_USE_OPENAI` | Yes | - | Set to `1` to enable OpenAI-compatible provider |
| `OPENAI_BASE_URL` | Yes | `http://localhost:1234/v1` | LM Studio server endpoint |
| `OPENAI_MODEL` | Yes | - | Model name (must match loaded model in LM Studio) |
| `OPENAI_API_KEY` | No | - | Not needed for local LM Studio inference |
| `LMSTUDIO_BASE_URL` | No | `http://localhost:1234` | Alternative env var for LM Studio URL |

### LM Studio Server Settings

In LM Studio's Local Server tab, you can configure:

- **Port**: Default is `1234`. Change if you run multiple instances.
- **CORS**: Enabled by default for local access.
- **Context Length**: Set based on your model's capabilities.
- **GPU Offload**: Adjust based on your VRAM.

## API Endpoints

LM Studio exposes standard OpenAI-compatible endpoints:

- `GET /v1/models` - List loaded models
- `POST /v1/chat/completions` - Chat completion (non-streaming)
- `POST /v1/chat/completions` with `stream: true` - Streaming chat

## Troubleshooting

### Server Not Responding

```bash
# Check if LM Studio server is running
curl http://localhost:1234/v1/models

# If connection refused, ensure:
# 1. LM Studio is running
# 2. Local Server is started (click "Start Server")
# 3. A model is loaded
```

### Model Not Found

If you get "model not found" errors:

1. Verify the model name in LM Studio matches `OPENAI_MODEL`
2. List available models:
   ```bash
   curl http://localhost:1234/v1/models | jq '.data[].id'
   ```
3. Use the exact model ID from the response

### Slow Performance

- Enable GPU offload in LM Studio settings
- Use smaller models for faster responses (7B-8B models)
- Ensure sufficient RAM/VRAM for your model size

### Connection Timeout

If requests timeout:

```bash
# Increase timeout (default is 120 seconds)
export OPENAI_TIMEOUT=300

# Or use a faster/smaller model
export OPENAI_MODEL=phi-3-mini
```

## Model Recommendations

| Use Case | Recommended Model | Size |
|----------|------------------|------|
| Fast coding | DeepSeek Coder 6.7B | 6.7B |
| Balanced | Llama 3.1 8B | 8B |
| Complex tasks | Llama 3.1 70B | 70B |
| Quick responses | Phi-3 Mini | 3.8B |
| Code generation | Mistral 7B | 7B |

## Integration with Smart Router

LM Studio works with openclaude's smart router for automatic provider selection:

```bash
# Enable smart routing with LM Studio as local option
export ROUTER_STRATEGY=latency  # or 'cost' or 'balanced'

# The router will prefer LM Studio for low-latency local inference
# when available, falling back to cloud providers as needed
```

## Advanced: Custom Server URL

If you run LM Studio on a different port or machine:

```bash
# Custom port
export OPENAI_BASE_URL=http://localhost:8080/v1

# Remote machine (ensure firewall allows access)
export OPENAI_BASE_URL=http://192.168.1.100:1234/v1
```

## Example Session

```bash
# 1. Start LM Studio and load a model
# 2. Set environment variables
export CLAUDE_CODE_USE_OPENAI=1
export OPENAI_BASE_URL=http://localhost:1234/v1
export OPENAI_MODEL=llama-3.1-8b-instruct

# 3. Verify connection
curl http://localhost:1234/v1/models

# 4. Launch openclaude
openclaude

# 5. Test with a simple query
# In openclaude: "Hello, can you help me write a Python function?"
```

## Notes

- LM Studio requires macOS (Apple Silicon) or Windows/Linux with sufficient GPU
- Model loading takes time; wait for "Model loaded" in LM Studio before connecting
- Context length depends on your model; check LM Studio for limits
- No API key is needed for local inference
- Performance depends on your hardware (GPU/CPU/RAM)

## See Also

- [Advanced Setup Guide](docs/advanced-setup.md)
- LM Studio Documentation: https://lmstudio.ai/docs
- OpenAI API Compatibility: https://platform.openai.com/docs/api-reference
"""

import httpx
import json
import logging
import os
from typing import AsyncIterator

logger = logging.getLogger(__name__)

# Default LM Studio server URL
LMSTUDIO_BASE_URL = os.getenv("LMSTUDIO_BASE_URL", "http://localhost:1234")
OPENAI_BASE_URL = os.getenv("OPENAI_BASE_URL", f"{LMSTUDIO_BASE_URL}/v1")


def _api_url(path: str) -> str:
    """Construct full API URL from path."""
    base = OPENAI_BASE_URL.rstrip("/")
    if not base.endswith("/v1"):
        base = f"{base}/v1"
    return f"{base}{path}"


async def check_lmstudio_running() -> bool:
    """Check if LM Studio server is running and responsive."""
    try:
        async with httpx.AsyncClient(timeout=3.0) as client:
            resp = await client.get(_api_url("/models"))
            return resp.status_code == 200
    except Exception:
        return False


async def list_lmstudio_models() -> list[str]:
    """List all models currently loaded in LM Studio."""
    try:
        async with httpx.AsyncClient(timeout=5.0) as client:
            resp = await client.get(_api_url("/models"))
            resp.raise_for_status()
            data = resp.json()
            return [m["id"] for m in data.get("data", [])]
    except Exception as e:
        logger.warning(f"Could not list LM Studio models: {e}")
        return []


async def lmstudio_chat(
    model: str,
    messages: list[dict],
    system: str | None = None,
    max_tokens: int = 4096,
    temperature: float = 1.0,
) -> dict:
    """
    Send a chat completion request to LM Studio.

    Args:
        model: Model name (must match a loaded model in LM Studio)
        messages: List of message dicts with 'role' and 'content'
        system: Optional system prompt
        max_tokens: Maximum tokens to generate
        temperature: Sampling temperature (0.0-2.0)

    Returns:
        Anthropic-compatible response dict
    """
    chat_messages = list(messages)
    if system:
        chat_messages.insert(0, {"role": "system", "content": system})

    payload = {
        "model": model,
        "messages": chat_messages,
        "max_tokens": max_tokens,
        "temperature": temperature,
        "stream": False,
    }

    async with httpx.AsyncClient(timeout=120.0) as client:
        resp = await client.post(_api_url("/chat/completions"), json=payload)
        resp.raise_for_status()
        data = resp.json()

    choice = data.get("choices", [{}])[0]
    assistant_text = choice.get("message", {}).get("content", "")
    usage = data.get("usage", {})

    return {
        "id": data.get("id", "msg_lmstudio"),
        "type": "message",
        "role": "assistant",
        "content": [{"type": "text", "text": assistant_text}],
        "model": model,
        "stop_reason": "end_turn",
        "stop_sequence": None,
        "usage": {
            "input_tokens": usage.get("prompt_tokens", 0),
            "output_tokens": usage.get("completion_tokens", 0),
        },
    }


async def lmstudio_chat_stream(
    model: str,
    messages: list[dict],
    system: str | None = None,
    max_tokens: int = 4096,
    temperature: float = 1.0,
) -> AsyncIterator[str]:
    """
    Stream a chat completion request from LM Studio.

    Args:
        model: Model name (must match a loaded model in LM Studio)
        messages: List of message dicts with 'role' and 'content'
        system: Optional system prompt
        max_tokens: Maximum tokens to generate
        temperature: Sampling temperature (0.0-2.0)

    Yields:
        Anthropic-compatible SSE event strings
    """
    chat_messages = list(messages)
    if system:
        chat_messages.insert(0, {"role": "system", "content": system})

    payload = {
        "model": model,
        "messages": chat_messages,
        "max_tokens": max_tokens,
        "temperature": temperature,
        "stream": True,
    }

    yield "event: message_start\n"
    yield f'data: {json.dumps({"type": "message_start", "message": {"id": "msg_lmstudio_stream", "type": "message", "role": "assistant", "content": [], "model": model, "stop_reason": None, "usage": {"input_tokens": 0, "output_tokens": 0}}})}\n\n'
    yield "event: content_block_start\n"
    yield f'data: {json.dumps({"type": "content_block_start", "index": 0, "content_block": {"type": "text", "text": ""}})}\n\n'

    async with httpx.AsyncClient(timeout=120.0) as client:
        async with client.stream("POST", _api_url("/chat/completions"), json=payload) as resp:
            resp.raise_for_status()
            async for line in resp.aiter_lines():
                if not line or not line.startswith("data: "):
                    continue
                raw = line[len("data: "):]
                if raw.strip() == "[DONE]":
                    break
                try:
                    chunk = json.loads(raw)
                    delta = chunk.get("choices", [{}])[0].get("delta", {})
                    delta_text = delta.get("content", "")
                    if delta_text:
                        yield "event: content_block_delta\n"
                        yield f'data: {json.dumps({"type": "content_block_delta", "index": 0, "delta": {"type": "text_delta", "text": delta_text}})}\n\n'

                    finish_reason = chunk.get("choices", [{}])[0].get("finish_reason")
                    if finish_reason:
                        usage = chunk.get("usage", {})
                        yield "event: content_block_stop\n"
                        yield f'data: {json.dumps({"type": "content_block_stop", "index": 0})}\n\n'
                        yield "event: message_delta\n"
                        yield f'data: {json.dumps({"type": "message_delta", "delta": {"stop_reason": "end_turn", "stop_sequence": None}, "usage": {"output_tokens": usage.get("completion_tokens", 0)}})}\n\n'
                        yield "event: message_stop\n"
                        yield f'data: {json.dumps({"type": "message_stop"})}\n\n'
                        break
                except json.JSONDecodeError:
                    continue