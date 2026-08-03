# backend/tests/test_pubsub_listener_logging.py
"""Regression test for Council Audit Report Silent Failures #1: an
unexpected exception inside _pubsub_listener must be logged, not silently
swallowed, and the room must remain resubscribable afterward (the listener
removes itself from self._subscriptions in its `finally`, so the next
HANDSHAKE on this worker spawns a fresh one)."""
import logging

import fakeredis
import pytest

import app.engine.room_service as rs_module

CODE = "LOGTEST"
_svc = rs_module.room_service


@pytest.fixture(autouse=True)
def patch_redis(monkeypatch):
    r = fakeredis.FakeAsyncRedis(decode_responses=True)
    monkeypatch.setattr(rs_module, "redis", r)
    monkeypatch.setattr(_svc, "_connections", {})
    monkeypatch.setattr(_svc, "_subscriptions", set())
    return r


@pytest.mark.asyncio
async def test_unexpected_pubsub_error_is_logged_not_swallowed(patch_redis, caplog, monkeypatch):
    class _ExplodingPubSub:
        async def subscribe(self, channel):
            pass

        async def get_message(self, **kwargs):
            raise RuntimeError("boom")

        async def unsubscribe(self, channel):
            pass

        async def aclose(self):
            pass

    class _ExplodingRedis:
        def pubsub(self):
            return _ExplodingPubSub()

    monkeypatch_redis = _ExplodingRedis()

    monkeypatch.setattr(rs_module, "redis", monkeypatch_redis)
    _svc._subscriptions.add(CODE)
    with caplog.at_level(logging.ERROR, logger="app.engine.room_service"):
        await _svc._pubsub_listener(CODE)

    assert CODE not in _svc._subscriptions
    assert any(
        "Unexpected error in pubsub listener" in record.message
        for record in caplog.records
    )
