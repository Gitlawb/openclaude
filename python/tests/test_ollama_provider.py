"""
test_ollama_provider.py
Run: pytest python/tests/test_ollama_provider.py -v
"""

import pytest
from unittest.mock import AsyncMock, MagicMock, patch
from ollama_provider import (
    normalize_ollama_model,
    anthropic_to_ollama_messages,
    ollama_chat,
    list_ollama_models,
    check_ollama_running,
)


def test_normalize_strips_prefix():
    assert normalize_ollama_model("ollama/llama3:8b") == "llama3:8b"


def test_normalize_no_prefix():
    assert normalize_ollama_model("codellama:34b") == "codellama:34b"


def test_normalize_empty():
    assert normalize_ollama_model("") == ""


def test_converts_string_content():
    messages = [{"role": "user", "content": "Hello!"}]
    result = anthropic_to_ollama_messages(messages)
    assert result == [{"role": "user", "content": "Hello!"}]


def test_converts_text_block_list():
    messages = [{"role": "user", "content": [{"type": "text", "text": "What is Python?"}]}]
    result = anthropic_to_ollama_messages(messages)
    assert result[0]["content"] == "What is Python?"


def test_converts_image_block_to_placeholder():
    messages = [{"role": "user", "content": [{"type": "image", "source": {}}, {"type": "text", "text": "Describe this"}]}]
    result = anthropic_to_ollama_messages(messages)
    assert "[image]" in result[0]["content"]
    assert "Describe this" in result[0]["content"]


def test_converts_base64_image_block_to_ollama_images():
    messages = [{
        "role": "user",
        "content": [
            {
                "type": "image",
                "source": {
                    "type": "base64",
                    "media_type": "image/png",
                    "data": "YWJjMTIz",
                },
            },
            {"type": "text", "text": "Describe this"},
        ],
    }]
    result = anthropic_to_ollama_messages(messages)
    assert result[0]["images"] == ["YWJjMTIz"]
    assert "Describe this" in result[0]["content"]

def test_converts_multi_turn():
    messages = [
        {"role": "user", "content": "Hi"},
        {"role": "assistant", "content": "Hello!"},
        {"role": "user", "content": "How are you?"},
    ]
    result = anthropic_to_ollama_messages(messages)
    assert len(result) == 3
    assert result[1]["role"] == "assistant"


@pytest.mark.asyncio
async def test_ollama_running_true():
    mock_response = MagicMock()
    mock_response.status_code = 200
    with patch("ollama_provider.httpx.AsyncClient") as MockClient:
        MockClient.return_value.__aenter__.return_value.get = AsyncMock(return_value=mock_response)
        result = await check_ollama_running()
    assert result is True


@pytest.mark.asyncio
async def test_ollama_running_false_on_exception():
    with patch("ollama_provider.httpx.AsyncClient") as MockClient:
        MockClient.return_value.__aenter__.return_value.get = AsyncMock(side_effect=Exception("refused"))
        result = await check_ollama_running()
    assert result is False


@pytest.mark.asyncio
async def test_list_models_returns_names():
    mock_response = MagicMock()
    mock_response.status_code = 200
    mock_response.json.return_value = {"models": [{"name": "llama3:8b"}, {"name": "codellama:34b"}]}
    mock_response.raise_for_status = MagicMock()
    with patch("ollama_provider.httpx.AsyncClient") as MockClient:
        MockClient.return_value.__aenter__.return_value.get = AsyncMock(return_value=mock_response)
        models = await list_ollama_models()
    assert "llama3:8b" in models


@pytest.mark.asyncio
async def test_ollama_chat_returns_anthropic_format():
    mock_response = MagicMock()
    mock_response.raise_for_status = MagicMock()
    mock_response.json.return_value = {
        "message": {"content": "42 is the answer."},
        "created_at": "2026-01-01T00:00:00Z",
        "prompt_eval_count": 10,
        "eval_count": 8,
    }
    with patch("ollama_provider.httpx.AsyncClient") as MockClient:
        MockClient.return_value.__aenter__.return_value.post = AsyncMock(return_value=mock_response)
        result = await ollama_chat(
            model="llama3:8b",
            messages=[{"role": "user", "content": "What is 6*7?"}]
        )
    assert result["type"] == "message"
    assert result["role"] == "assistant"
    assert "42" in result["content"][0]["text"]


@pytest.mark.asyncio
async def test_ollama_chat_prepends_system():
    captured = {}

    async def mock_post(url, json=None, **kwargs):
        captured.update(json or {})
        m = MagicMock()
        m.raise_for_status = MagicMock()
        m.json.return_value = {
            "message": {"content": "ok"},
            "created_at": "",
            "prompt_eval_count": 1,
            "eval_count": 1
        }
        return m
    with patch("ollama_provider.httpx.AsyncClient") as MockClient:
        MockClient.return_value.__aenter__.return_value.post = mock_post
        await ollama_chat(
            model="llama3:8b",
            messages=[{"role": "user", "content": "Hi"}],
            system="Be helpful.",
        )
    assert captured["messages"][0]["role"] == "system"
    assert "helpful" in captured["messages"][0]["content"]


@pytest.mark.asyncio
async def test_ollama_chat_includes_base64_images_in_payload():
    captured = {}

    async def mock_post(url, json=None, **kwargs):
        captured.update(json or {})
        m = MagicMock()
        m.raise_for_status = MagicMock()
        m.json.return_value = {
            "message": {"content": "ok"},
            "created_at": "",
            "prompt_eval_count": 1,
            "eval_count": 1,
        }
        return m

    with patch("ollama_provider.httpx.AsyncClient") as MockClient:
        MockClient.return_value.__aenter__.return_value.post = mock_post
        await ollama_chat(
            model="llama3:8b",
            messages=[{
                "role": "user",
                "content": [
                    {
                        "type": "image",
                        "source": {
                            "type": "base64",
                            "media_type": "image/jpeg",
                            "data": "ZHVtbXk=",
                        },
                    },
                    {"type": "text", "text": "What is in this image?"},
                ],
            }],
        )

    assert captured["messages"][0]["images"] == ["ZHVtbXk="]
    assert "What is in this image?" in captured["messages"][0]["content"]
