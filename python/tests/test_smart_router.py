"""
test_smart_router.py
--------------------
Tests for the SmartRouter.
Run: pytest python/tests/test_smart_router.py -v
"""

from pathlib import Path
import sys

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

import pytest
import asyncio
from unittest.mock import AsyncMock, MagicMock, patch
from smart_router import SmartRouter, Provider


# ── Fixtures ──────────────────────────────────────────────────────────────────


@pytest.fixture(autouse=True)
def fake_api_key(monkeypatch):
    monkeypatch.setenv("FAKE_KEY", "test-key")


def make_provider(name, healthy=True, configured=True,
                  latency=100.0, cost=0.002, errors=0, requests=0):
    p = Provider(
        name=name,
        ping_url=f"https://{name}.example.com/health",
        api_key_env="FAKE_KEY",
        cost_per_1k_tokens=cost,
        big_model=f"{name}-big",
        small_model=f"{name}-small",
    )
    p.healthy = healthy
    p.avg_latency_ms = latency
    p.error_count = errors
    p.request_count = requests
    if not configured:
        p.api_key_env = ""  # makes is_configured False for non-local providers
    return p


def make_router(providers=None, strategy="balanced"):
    r = SmartRouter(providers=providers, strategy=strategy)
    r._initialized = True
    return r


# ── Provider.score() ──────────────────────────────────────────────────────────

def test_score_unhealthy_is_inf():
    p = make_provider("openai", healthy=False)
    assert p.score() == float("inf")


def test_score_unconfigured_is_inf():
    p = make_provider("openai", configured=False)
    assert p.score() == float("inf")


def test_score_latency_strategy_prefers_faster():
    fast = make_provider("fast", latency=50.0, cost=0.01)
    slow = make_provider("slow", latency=500.0, cost=0.001)
    assert fast.score("latency") < slow.score("latency")


def test_score_cost_strategy_prefers_cheaper():
    cheap = make_provider("cheap", latency=500.0, cost=0.0001)
    expensive = make_provider("expensive", latency=50.0, cost=0.05)
    assert cheap.score("cost") < expensive.score("cost")


def test_score_balanced_strategy_uses_both():
    p = make_provider("test", latency=200.0, cost=0.002)
    s = p.score("balanced")
    assert s > 0


def test_score_error_rate_penalty():
    clean = make_provider("clean", errors=0, requests=10)
    dirty = make_provider("dirty", errors=8, requests=10)
    assert clean.score() < dirty.score()


# ── SmartRouter.is_large_request() ───────────────────────────────────────────

def test_is_large_request_short():
    r = make_router()
    msgs = [{"role": "user", "content": "Hello!"}]
    assert r.is_large_request(msgs) is False


def test_is_large_request_long():
    r = make_router()
    msgs = [{"role": "user", "content": "x" * 3000}]
    assert r.is_large_request(msgs) is True


# ── SmartRouter.select_provider() ────────────────────────────────────────────

def test_select_provider_picks_best_score():
    p1 = make_provider("slow", latency=800.0)
    p2 = make_provider("fast", latency=50.0)
    r = make_router(providers=[p1, p2], strategy="latency")
    selected = r.select_provider()
    assert selected.name == "fast"


def test_select_provider_skips_unhealthy():
    p1 = make_provider("bad", healthy=False)
    p2 = make_provider("good", healthy=True)
    r = make_router(providers=[p1, p2])
    selected = r.select_provider()
    assert selected.name == "good"


def test_select_provider_returns_none_when_all_down():
    p1 = make_provider("a", healthy=False)
    p2 = make_provider("b", healthy=False)
    r = make_router(providers=[p1, p2])
    assert r.select_provider() is None


# ── SmartRouter.get_model_for_provider() ─────────────────────────────────────

def test_get_model_large_request():
    p = make_provider("openai")
    r = make_router()
    model = r.get_model_for_provider(p, "claude-sonnet")
    assert model == "openai-big"


def test_get_model_large_message_overrides_claude_label():
    p = make_provider("openai")
    r = make_router()
    model = r.get_model_for_provider(p, "claude-haiku", is_large_request=True)
    assert model == "openai-big"


def test_get_model_small_request():
    p = make_provider("openai")
    r = make_router()
    model = r.get_model_for_provider(p, "claude-haiku")
    assert model == "openai-small"


# ── SmartRouter.route() ───────────────────────────────────────────────────────

@pytest.mark.asyncio
async def test_route_returns_best_provider():
    p1 = make_provider("expensive", cost=0.05, latency=50.0)
    p2 = make_provider("cheap", cost=0.0005, latency=200.0)
    r = make_router(providers=[p1, p2], strategy="cost")
    result = await r.route([{"role": "user", "content": "Hi"}], "claude-haiku")
    assert result["provider"] == "cheap"


@pytest.mark.asyncio
async def test_route_uses_big_model_for_large_message_bodies():
    p = make_provider("openai")
    r = make_router(providers=[p])
    result = await r.route([
        {"role": "user", "content": "x" * 3001},
    ], "claude-haiku")
    assert result["model"] == "openai-big"


@pytest.mark.asyncio
async def test_route_raises_when_no_providers():
    p = make_provider("a", healthy=False)
    r = make_router(providers=[p])
    with pytest.raises(RuntimeError, match="no providers available"):
        await r.route([{"role": "user", "content": "Hi"}])


@pytest.mark.asyncio
async def test_route_excludes_providers():
    p1 = make_provider("openai", latency=50.0)
    p2 = make_provider("gemini", latency=200.0)
    r = make_router(providers=[p1, p2], strategy="latency")
    result = await r.route(
        [{"role": "user", "content": "Hi"}],
        exclude_providers=["openai"]
    )
    assert result["provider"] == "gemini"


# ── SmartRouter.record_result() ──────────────────────────────────────────────

@pytest.mark.asyncio
async def test_record_result_updates_latency():
    p = make_provider("openai", latency=200.0)
    r = make_router(providers=[p])
    await r.record_result("openai", success=True, duration_ms=100.0)
    assert p.avg_latency_ms < 200.0  # should decrease toward 100


@pytest.mark.asyncio
async def test_record_result_increments_requests():
    p = make_provider("openai")
    r = make_router(providers=[p])
    await r.record_result("openai", success=True, duration_ms=100.0)
    assert p.request_count == 1


@pytest.mark.asyncio
async def test_record_result_increments_errors():
    p = make_provider("openai")
    r = make_router(providers=[p])
    await r.record_result("openai", success=False, duration_ms=0)
    assert p.error_count == 1


# ── SmartRouter.status() ─────────────────────────────────────────────────────

def test_status_returns_all_providers():
    p1 = make_provider("openai")
    p2 = make_provider("gemini")
    r = make_router(providers=[p1, p2])
    status = r.status()
    assert len(status) == 2
    names = [s["provider"] for s in status]
    assert "openai" in names
    assert "gemini" in names


def test_status_contains_required_fields():
    p = make_provider("openai")
    r = make_router(providers=[p])
    status = r.status()[0]
    for field in ["provider", "healthy", "latency_ms",
                  "cost_per_1k", "requests", "errors", "score"]:
        assert field in status
