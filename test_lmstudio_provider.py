"""
test_lmstudio_provider.py
Run: pytest test_lmstudio_provider.py -v
"""

import pytest
from unittest.mock import AsyncMock, MagicMock, patch
from lmstudio_provider import (
    lmstudio_chat,
    lmstudio_chat_stream,
    list_lmstudio_models,
    check_lmstudio_running,
    _api_url,
)


def test_api_url_default():
    """Test API URL construction with default base URL."""
    import lmstudio_provider
    # Save original value
    original = lmstudio_provider.OPENAI_BASE_URL
    # Set to LM Studio default
    lmstudio_provider.OPENAI_BASE_URL = "http://localhost:1234/v1"
    try:
        url = _api_url("/models")
        assert url == "http://localhost:1234/v1/models"
    finally:
        # Restore original value
        lmstudio_provider.OPENAI_BASE_URL = original


def test_api_url_strips_trailing_slash():
    """Test API URL handles trailing slash in base URL."""
    import lmstudio_provider
    original = lmstudio_provider.OPENAI_BASE_URL
    lmstudio_provider.OPENAI_BASE_URL = "http://localhost:1234/v1/"
    try:
        url = _api_url("/models")
        assert url == "http://localhost:1234/v1/models"
    finally:
        lmstudio_provider.OPENAI_BASE_URL = original


def test_api_url_adds_v1_if_missing():
    """Test API URL adds /v1 if not present."""
    import lmstudio_provider
    original = lmstudio_provider.OPENAI_BASE_URL
    lmstudio_provider.OPENAI_BASE_URL = "http://localhost:1234"
    try:
        url = _api_url("/models")
        assert url == "http://localhost:1234/v1/models"
    finally:
        lmstudio_provider.OPENAI_BASE_URL = original


@pytest.mark.asyncio
async def test_lmstudio_running_true():
    """Test check_lmstudio_running returns True when server responds."""
    mock_response = MagicMock()
    mock_response.status_code = 200
    with patch("lmstudio_provider.httpx.AsyncClient") as MockClient:
        MockClient.return_value.__aenter__.return_value.get = AsyncMock(return_value=mock_response)
        result = await check_lmstudio_running()
    assert result is True


@pytest.mark.asyncio
async def test_lmstudio_running_false_on_exception():
    """Test check_lmstudio_running returns False on connection error."""
    with patch("lmstudio_provider.httpx.AsyncClient") as MockClient:
        MockClient.return_value.__aenter__.return_value.get = AsyncMock(side_effect=Exception("refused"))
        result = await check_lmstudio_running()
    assert result is False


@pytest.mark.asyncio
async def test_lmstudio_running_false_on_non_200():
    """Test check_lmstudio_running returns False on non-200 status."""
    mock_response = MagicMock()
    mock_response.status_code = 500
    with patch("lmstudio_provider.httpx.AsyncClient") as MockClient:
        MockClient.return_value.__aenter__.return_value.get = AsyncMock(return_value=mock_response)
        result = await check_lmstudio_running()
    assert result is False


@pytest.mark.asyncio
async def test_list_models_returns_names():
    """Test list_lmstudio_models returns model IDs."""
    mock_response = MagicMock()
    mock_response.status_code = 200
    mock_response.json.return_value = {
        "data": [
            {"id": "llama-3.1-8b-instruct"},
            {"id": "mistral-7b-instruct-v0.2"}
        ]
    }
    mock_response.raise_for_status = MagicMock()
    with patch("lmstudio_provider.httpx.AsyncClient") as MockClient:
        MockClient.return_value.__aenter__.return_value.get = AsyncMock(return_value=mock_response)
        models = await list_lmstudio_models()
    assert "llama-3.1-8b-instruct" in models
    assert "mistral-7b-instruct-v0.2" in models
    assert len(models) == 2


@pytest.mark.asyncio
async def test_list_models_empty_on_failure():
    """Test list_lmstudio_models returns empty list on error."""
    with patch("lmstudio_provider.httpx.AsyncClient") as MockClient:
        MockClient.return_value.__aenter__.return_value.get = AsyncMock(side_effect=Exception("down"))
        models = await list_lmstudio_models()
    assert models == []


@pytest.mark.asyncio
async def test_lmstudio_chat_returns_anthropic_format():
    """Test lmstudio_chat returns Anthropic-compatible response."""
    mock_response = MagicMock()
    mock_response.raise_for_status = MagicMock()
    mock_response.json.return_value = {
        "id": "chatcmpl-123",
        "choices": [{
            "message": {"content": "42 is the answer."},
            "finish_reason": "stop"
        }],
        "usage": {
            "prompt_tokens": 10,
            "completion_tokens": 8
        }
    }
    with patch("lmstudio_provider.httpx.AsyncClient") as MockClient:
        MockClient.return_value.__aenter__.return_value.post = AsyncMock(return_value=mock_response)
        result = await lmstudio_chat(
            model="llama-3.1-8b-instruct",
            messages=[{"role": "user", "content": "What is 6*7?"}]
        )
    assert result["type"] == "message"
    assert result["role"] == "assistant"
    assert result["model"] == "llama-3.1-8b-instruct"
    assert "42" in result["content"][0]["text"]
    assert result["usage"]["input_tokens"] == 10
    assert result["usage"]["output_tokens"] == 8


@pytest.mark.asyncio
async def test_lmstudio_chat_prepends_system():
    """Test lmstudio_chat prepends system message to messages."""
    captured = {}
    async def mock_post(url, json=None, **kwargs):
        captured.update(json or {})
        m = MagicMock()
        m.raise_for_status = MagicMock()
        m.json.return_value = {
            "id": "chatcmpl-123",
            "choices": [{
                "message": {"content": "ok"},
                "finish_reason": "stop"
            }],
            "usage": {"prompt_tokens": 1, "completion_tokens": 1}
        }
        return m
    with patch("lmstudio_provider.httpx.AsyncClient") as MockClient:
        MockClient.return_value.__aenter__.return_value.post = mock_post
        await lmstudio_chat(
            model="llama-3.1-8b-instruct",
            messages=[{"role": "user", "content": "Hi"}],
            system="Be helpful."
        )
    assert captured["messages"][0]["role"] == "system"
    assert "helpful" in captured["messages"][0]["content"]


@pytest.mark.asyncio
async def test_lmstudio_chat_includes_parameters():
    """Test lmstudio_chat includes max_tokens and temperature in payload."""
    captured = {}
    async def mock_post(url, json=None, **kwargs):
        captured.update(json or {})
        m = MagicMock()
        m.raise_for_status = MagicMock()
        m.json.return_value = {
            "id": "chatcmpl-123",
            "choices": [{
                "message": {"content": "ok"},
                "finish_reason": "stop"
            }],
            "usage": {"prompt_tokens": 1, "completion_tokens": 1}
        }
        return m
    with patch("lmstudio_provider.httpx.AsyncClient") as MockClient:
        MockClient.return_value.__aenter__.return_value.post = mock_post
        await lmstudio_chat(
            model="llama-3.1-8b-instruct",
            messages=[{"role": "user", "content": "Hi"}],
            max_tokens=2048,
            temperature=0.7
        )
    assert captured["max_tokens"] == 2048
    assert captured["temperature"] == 0.7
    assert captured["stream"] is False


@pytest.mark.asyncio
async def test_lmstudio_chat_default_id():
    """Test lmstudio_chat uses default ID if not provided."""
    mock_response = MagicMock()
    mock_response.raise_for_status = MagicMock()
    mock_response.json.return_value = {
        "choices": [{
            "message": {"content": "ok"},
            "finish_reason": "stop"
        }],
        "usage": {"prompt_tokens": 1, "completion_tokens": 1}
    }
    with patch("lmstudio_provider.httpx.AsyncClient") as MockClient:
        MockClient.return_value.__aenter__.return_value.post = AsyncMock(return_value=mock_response)
        result = await lmstudio_chat(
            model="test-model",
            messages=[{"role": "user", "content": "Hi"}]
        )
    assert result["id"] == "msg_lmstudio"


# Note: Streaming tests are omitted for simplicity, similar to ollama_provider tests.
# The lmstudio_chat_stream function follows the same pattern as ollama_chat_stream
# and is tested implicitly through integration tests.
