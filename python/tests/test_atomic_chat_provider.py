"""
test_atomic_chat_provider.py
Run: pytest python/tests/test_atomic_chat_provider.py -v
"""

from pathlib import Path
import sys

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

import pytest
from unittest.mock import AsyncMock, MagicMock, patch
from atomic_chat_provider import (
    atomic_chat,
    list_atomic_chat_models,
    check_atomic_chat_running,
)


@pytest.mark.asyncio
async def test_atomic_chat_running_true():
    mock_response = MagicMock()
    mock_response.status_code = 200
    with patch("atomic_chat_provider.httpx.AsyncClient") as MockClient:
        MockClient.return_value.__aenter__.return_value.get = AsyncMock(return_value=mock_response)
        result = await check_atomic_chat_running()
    assert result is True


@pytest.mark.asyncio
async def test_atomic_chat_running_false_on_exception():
    with patch("atomic_chat_provider.httpx.AsyncClient") as MockClient:
        MockClient.return_value.__aenter__.return_value.get = AsyncMock(side_effect=Exception("refused"))
        result = await check_atomic_chat_running()
    assert result is False


@pytest.mark.asyncio
async def test_list_models_returns_ids():
    mock_response = MagicMock()
    mock_response.status_code = 200
    mock_response.json.return_value = {
        "data": [{"id": "llama-3.1-8b"}, {"id": "mistral-7b"}],
    }
    mock_response.raise_for_status = MagicMock()
    with patch("atomic_chat_provider.httpx.AsyncClient") as MockClient:
        MockClient.return_value.__aenter__.return_value.get = AsyncMock(return_value=mock_response)
        models = await list_atomic_chat_models()
    assert "llama-3.1-8b" in models
    assert "mistral-7b" in models


@pytest.mark.asyncio
async def test_list_models_empty_on_failure():
    with patch("atomic_chat_provider.httpx.AsyncClient") as MockClient:
        MockClient.return_value.__aenter__.return_value.get = AsyncMock(side_effect=Exception("down"))
        models = await list_atomic_chat_models()
    assert models == []


@pytest.mark.asyncio
async def test_atomic_chat_returns_anthropic_format():
    mock_response = MagicMock()
    mock_response.raise_for_status = MagicMock()
    mock_response.json.return_value = {
        "id": "chatcmpl-abc123",
        "choices": [{"message": {"content": "42 is the answer."}}],
        "usage": {"prompt_tokens": 10, "completion_tokens": 8},
    }
    with patch("atomic_chat_provider.httpx.AsyncClient") as MockClient:
        MockClient.return_value.__aenter__.return_value.post = AsyncMock(return_value=mock_response)
        result = await atomic_chat(
            model="llama-3.1-8b",
            messages=[{"role": "user", "content": "What is 6*7?"}],
        )
    assert result["type"] == "message"
    assert result["role"] == "assistant"
    assert "42" in result["content"][0]["text"]
    assert result["usage"]["input_tokens"] == 10
    assert result["usage"]["output_tokens"] == 8


@pytest.mark.asyncio
async def test_atomic_chat_prepends_system():
    captured = {}

    async def mock_post(url, json=None, **kwargs):
        captured.update(json or {})
        m = MagicMock()
        m.raise_for_status = MagicMock()
        m.json.return_value = {
            "id": "chatcmpl-xyz",
            "choices": [{"message": {"content": "ok"}}],
            "usage": {"prompt_tokens": 1, "completion_tokens": 1},
        }
        return m

    with patch("atomic_chat_provider.httpx.AsyncClient") as MockClient:
        MockClient.return_value.__aenter__.return_value.post = mock_post
        await atomic_chat(
            model="llama-3.1-8b",
            messages=[{"role": "user", "content": "Hi"}],
            system="Be helpful.",
        )
    assert captured["messages"][0]["role"] == "system"
    assert "helpful" in captured["messages"][0]["content"]


@pytest.mark.asyncio
async def test_atomic_chat_sends_correct_payload():
    captured = {}

    async def mock_post(url, json=None, **kwargs):
        captured.update(json or {})
        m = MagicMock()
        m.raise_for_status = MagicMock()
        m.json.return_value = {
            "id": "chatcmpl-xyz",
            "choices": [{"message": {"content": "ok"}}],
            "usage": {"prompt_tokens": 1, "completion_tokens": 1},
        }
        return m

    with patch("atomic_chat_provider.httpx.AsyncClient") as MockClient:
        MockClient.return_value.__aenter__.return_value.post = mock_post
        await atomic_chat(
            model="test-model",
            messages=[{"role": "user", "content": "Test"}],
            max_tokens=2048,
            temperature=0.5,
        )
    assert captured["model"] == "test-model"
    assert captured["max_tokens"] == 2048
    assert captured["temperature"] == 0.5
    assert captured["stream"] is False
