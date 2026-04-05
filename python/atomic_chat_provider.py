"""
atomic_chat_provider.py
-----------------------
Adds native Atomic Chat support to openlawb.
Lets Claude Code route requests to any locally-running model via
Atomic Chat (Apple Silicon only) at 127.0.0.1:1337.

Atomic Chat exposes an OpenAI-compatible API, so messages are forwarded
directly without translation.

Usage (.env):
    PREFERRED_PROVIDER=atomic-chat
    ATOMIC_CHAT_BASE_URL=http://127.0.0.1:1337
"""

import httpx
import json
import logging
import os
from typing import AsyncIterator

logger = logging.getLogger(__name__)
ATOMIC_CHAT_BASE_URL = os.getenv("ATOMIC_CHAT_BASE_URL", "http://127.0.0.1:1337")


def _api_url(path: str) -> str:
    return f"{ATOMIC_CHAT_BASE_URL}/v1{path}"


async def check_atomic_chat_running() -> bool:
    try:
        async with httpx.AsyncClient(timeout=3.0) as client:
            resp = await client.get(_api_url("/models"))
            return resp.status_code == 200
    except Exception:
        return False


async def list_atomic_chat_models() -> list[str]:
    try:
        async with httpx.AsyncClient(timeout=5.0) as client:
            resp = await client.get(_api_url("/models"))
            resp.raise_for_status()
            data = resp.json()
            return [m["id"] for m in data.get("data", [])]
    except Exception as e:
        logger.warning(f"Could not list Atomic Chat models: {e}")
        return []


async def atomic_chat(
    model: str,
    messages: list[dict],
    system: str | None = None,
    max_tokens: int = 4096,
    temperature: float = 1.0,
) -> dict:
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
        "id": data.get("id", "msg_atomic_chat"),
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


async def atomic_chat_stream(
    model: str,
    messages: list[dict],
    system: str | None = None,
    max_tokens: int = 4096,
    temperature: float = 1.0,
) -> AsyncIterator[str]:
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
    yield f'data: {json.dumps({"type": "message_start", "message": {"id": "msg_atomic_chat_stream", "type": "message", "role": "assistant", "content": [], "model": model, "stop_reason": None, "usage": {"input_tokens": 0, "output_tokens": 0}}})}\n\n'
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
