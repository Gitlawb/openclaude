"""
ollama_provider.py
------------------
Adds native Ollama support to openclaude.
Lets Claude Code route requests to any locally-running Ollama model
(llama3, mistral, codellama, phi3, qwen2, deepseek-coder, etc.)
without needing an API key.

Usage (.env):
    PREFERRED_PROVIDER=ollama
    OLLAMA_BASE_URL=http://localhost:11434
    BIG_MODEL=codellama:34b
    SMALL_MODEL=llama3:8b
"""

import httpx
import logging
import os
from typing import AsyncIterator

logger = logging.getLogger(__name__)
OLLAMA_BASE_URL = os.getenv("OLLAMA_BASE_URL", "http://localhost:11434")


async def check_ollama_running() -> bool:
    try:
        async with httpx.AsyncClient(timeout=3.0) as client:
            resp = await client.get(f"{OLLAMA_BASE_URL}/api/tags")
            return resp.status_code == 200
    except Exception:
        return False


async def list_ollama_models() -> list[str]:
    try:
        async with httpx.AsyncClient(timeout=5.0) as client:
            resp = await client.get(f"{OLLAMA_BASE_URL}/api/tags")
            resp.raise_for_status()
            data = resp.json()
            return [m["name"] for m in data.get("models", [])]
    except Exception as e:
        logger.warning(f"Could not list Ollama models: {e}")
        return []


def normalize_ollama_model(model_name: str) -> str:
    if model_name.startswith("ollama/"):
        return model_name[len("ollama/"):]
    return model_name


def _extract_ollama_image_data(block: dict) -> str | None:
    source = block.get("source")
    if not isinstance(source, dict):
        return None
    if source.get("type") != "base64":
        return None
    data = source.get("data")
    if isinstance(data, str) and data:
        return data
    return None


def anthropic_to_ollama_messages(messages: list[dict]) -> list[dict]:
    ollama_messages = []
    for msg in messages:
        role = msg.get("role", "user")
        content = msg.get("content", "")
        if isinstance(content, str):
            ollama_messages.append({"role": role, "content": content})
        elif isinstance(content, list):
            text_parts = []
            image_parts = []
            for block in content:
                if isinstance(block, dict):
                    if block.get("type") == "text":
                        text_parts.append(block.get("text", ""))
                    elif block.get("type") == "image":
                        image_data = _extract_ollama_image_data(block)
                        if image_data:
                            image_parts.append(image_data)
                        else:
                            text_parts.append("[image]")
                elif isinstance(block, str):
                    text_parts.append(block)
            ollama_message = {"role": role, "content": "\n".join(text_parts)}
            if image_parts:
                ollama_message["images"] = image_parts
            ollama_messages.append(ollama_message)
    return ollama_messages


async def ollama_chat(
    model: str,
    messages: list[dict],
    system: str | None = None,
    max_tokens: int = 4096,
    temperature: float = 1.0,
) -> dict:
    model = normalize_ollama_model(model)
    ollama_messages = anthropic_to_ollama_messages(messages)
    if system:
        ollama_messages.insert(0, {"role": "system", "content": system})
    payload = {
        "model": model,
        "messages": ollama_messages,
        "stream": False,
        "options": {"num_predict": max_tokens, "temperature": temperature},
    }
    async with httpx.AsyncClient(timeout=120.0) as client:
        resp = await client.post(f"{OLLAMA_BASE_URL}/api/chat", json=payload)
        resp.raise_for_status()
        data = resp.json()
    assistant_text = data.get("message", {}).get("content", "")
    return {
        "id": f"msg_ollama_{data.get('created_at', 'unknown')}",
        "type": "message",
        "role": "assistant",
        "content": [{"type": "text", "text": assistant_text}],
        "model": model,
        "stop_reason": "end_turn",
        "stop_sequence": None,
        "usage": {
            "input_tokens": data.get("prompt_eval_count", 0),
            "output_tokens": data.get("eval_count", 0),
        },
    }


async def ollama_chat_stream(
    model: str,
    messages: list[dict],
    system: str | None = None,
    max_tokens: int = 4096,
    temperature: float = 1.0,
) -> AsyncIterator[str]:
    import json
    model = normalize_ollama_model(model)
    ollama_messages = anthropic_to_ollama_messages(messages)
    if system:
        ollama_messages.insert(0, {"role": "system", "content": system})
    payload = {
        "model": model,
        "messages": ollama_messages,
        "stream": True,
        "options": {"num_predict": max_tokens, "temperature": temperature},
    }
    yield "event: message_start\n"
    yield f'data: {json.dumps({"type": "message_start", "message": {"id": "msg_ollama_stream", "type": "message", "role": "assistant", "content": [], "model": model, "stop_reason": None, "usage": {"input_tokens": 0, "output_tokens": 0}}})}\n\n'
    yield "event: content_block_start\n"
    yield f'data: {json.dumps({"type": "content_block_start", "index": 0, "content_block": {"type": "text", "text": ""}})}\n\n'
    async with httpx.AsyncClient(timeout=120.0) as client:
        async with client.stream("POST", f"{OLLAMA_BASE_URL}/api/chat", json=payload) as resp:
            resp.raise_for_status()
            async for line in resp.aiter_lines():
                if not line:
                    continue
                try:
                    chunk = json.loads(line)
                    delta_text = chunk.get("message", {}).get("content", "")
                    if delta_text:
                        yield "event: content_block_delta\n"
                        yield f'data: {json.dumps({"type": "content_block_delta", "index": 0, "delta": {"type": "text_delta", "text": delta_text}})}\n\n'
                    if chunk.get("done"):
                        yield "event: content_block_stop\n"
                        yield f'data: {json.dumps({"type": "content_block_stop", "index": 0})}\n\n'
                        yield "event: message_delta\n"
                        yield f'data: {json.dumps({"type": "message_delta", "delta": {"stop_reason": "end_turn", "stop_sequence": None}, "usage": {"output_tokens": chunk.get("eval_count", 0)}})}\n\n'
                        yield "event: message_stop\n"
                        yield f'data: {json.dumps({"type": "message_stop"})}\n\n'
                        break
                except json.JSONDecodeError:
                    continue
