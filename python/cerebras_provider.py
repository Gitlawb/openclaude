"""
cerebras_provider.py
--------------------
Cerebras Inference support for openclaude.

Cerebras offers the world's fastest AI inference (up to 3000 tokens/sec)
via an OpenAI-compatible API. Free tier: 1M tokens/day, 64K TPM.

Free models:
    gpt-oss-120b   — 3000 tps,  $0.35/$0.75 per M tokens (dev tier)
    llama3.1-8b    — 2200 tps,  $0.10/$0.10 per M tokens (dev tier)
    qwen-3-235b-a22b-instruct-2507 — 1400 tps (preview)

Usage (.env):
    CEREBRAS_API_KEY=<your key from cloud.cerebras.ai>
    OPENAI_BASE_URL=https://api.cerebras.ai/v1
    OPENAI_MODEL=gpt-oss-120b
    CLAUDE_CODE_USE_OPENAI=1
"""

import logging
import os
from typing import AsyncIterator

logger = logging.getLogger(__name__)

CEREBRAS_BASE_URL = "https://api.cerebras.ai/v1"
CEREBRAS_API_KEY_ENV = "CEREBRAS_API_KEY"


def get_cerebras_api_key() -> str | None:
    return os.getenv(CEREBRAS_API_KEY_ENV)


def is_cerebras_configured() -> bool:
    return bool(get_cerebras_api_key())


def get_cerebras_client():
    """Return a Cerebras SDK client, or raise if SDK not installed."""
    try:
        from cerebras.cloud.sdk import Cerebras
    except ImportError as e:
        raise RuntimeError(
            "cerebras-cloud-sdk not installed. Run: pip install cerebras-cloud-sdk"
        ) from e

    api_key = get_cerebras_api_key()
    if not api_key:
        raise RuntimeError(
            f"CEREBRAS_API_KEY not set. Get a free key at https://cloud.cerebras.ai"
        )

    return Cerebras(api_key=api_key)


async def check_cerebras_running() -> bool:
    """Health-check: verify the API key and endpoint are reachable."""
    try:
        import httpx
        api_key = get_cerebras_api_key()
        if not api_key:
            return False
        async with httpx.AsyncClient(timeout=5.0) as client:
            resp = await client.get(
                f"{CEREBRAS_BASE_URL}/models",
                headers={"Authorization": f"Bearer {api_key}"},
            )
            return resp.status_code == 200
    except Exception:
        return False


async def list_cerebras_models() -> list[str]:
    """Return available model IDs from the Cerebras API."""
    try:
        import httpx
        api_key = get_cerebras_api_key()
        if not api_key:
            return []
        async with httpx.AsyncClient(timeout=5.0) as client:
            resp = await client.get(
                f"{CEREBRAS_BASE_URL}/models",
                headers={"Authorization": f"Bearer {api_key}"},
            )
            resp.raise_for_status()
            data = resp.json()
            return [m["id"] for m in data.get("data", [])]
    except Exception as e:
        logger.warning(f"Could not list Cerebras models: {e}")
        return []


async def cerebras_chat_stream(
    messages: list[dict],
    model: str = "gpt-oss-120b",
    max_tokens: int = 8192,
) -> AsyncIterator[str]:
    """
    Stream a chat completion from Cerebras using the native SDK.
    Yields text chunks as they arrive.
    """
    client = get_cerebras_client()

    stream = client.chat.completions.create(
        model=model,
        messages=messages,
        max_completion_tokens=max_tokens,
        stream=True,
    )

    for chunk in stream:
        delta = chunk.choices[0].delta
        if delta and delta.content:
            yield delta.content


async def cerebras_chat(
    messages: list[dict],
    model: str = "gpt-oss-120b",
    max_tokens: int = 8192,
) -> str:
    """Non-streaming chat completion. Returns full response text."""
    client = get_cerebras_client()

    response = client.chat.completions.create(
        model=model,
        messages=messages,
        max_completion_tokens=max_tokens,
        stream=False,
    )

    return response.choices[0].message.content or ""
