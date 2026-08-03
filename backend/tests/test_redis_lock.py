import asyncio

import fakeredis
import pytest

from app.redis_lock import RedisLock, RedisLockError


@pytest.fixture
def fake_redis():
    return fakeredis.FakeAsyncRedis(decode_responses=True)


@pytest.mark.asyncio
async def test_two_concurrent_holders_never_overlap(fake_redis):
    in_critical_section = 0
    max_observed_overlap = 0
    completed = 0

    async def worker():
        nonlocal in_critical_section, max_observed_overlap, completed
        async with RedisLock(fake_redis, "lock:room:TEST", timeout_seconds=5):
            in_critical_section += 1
            max_observed_overlap = max(max_observed_overlap, in_critical_section)
            await asyncio.sleep(0.05)
            in_critical_section -= 1
            completed += 1

    await asyncio.gather(*(worker() for _ in range(5)))

    assert max_observed_overlap == 1
    assert completed == 5


@pytest.mark.asyncio
async def test_lock_is_released_after_use(fake_redis):
    async with RedisLock(fake_redis, "lock:room:TEST", timeout_seconds=5):
        pass

    assert await fake_redis.get("lock:room:TEST") is None


@pytest.mark.asyncio
async def test_release_does_not_delete_a_lock_it_no_longer_owns(fake_redis):
    lock = RedisLock(fake_redis, "lock:room:TEST", timeout_seconds=5)
    await lock.acquire()

    # Simulate the lock's TTL expiring and someone else acquiring it before
    # our (delayed) release() call runs.
    await fake_redis.set("lock:room:TEST", "someone-elses-token")

    await lock.release()

    assert await fake_redis.get("lock:room:TEST") == "someone-elses-token"


@pytest.mark.asyncio
async def test_release_is_a_no_op_if_never_acquired(fake_redis):
    lock = RedisLock(fake_redis, "lock:room:TEST", timeout_seconds=5)
    await lock.release()  # must not raise


@pytest.mark.asyncio
async def test_blocking_timeout_raises_instead_of_hanging_forever(fake_redis):
    holder = RedisLock(fake_redis, "lock:room:TEST", timeout_seconds=5)
    await holder.acquire()

    contender = RedisLock(
        fake_redis, "lock:room:TEST", timeout_seconds=5, blocking_timeout_seconds=0.2
    )
    with pytest.raises(RedisLockError):
        await contender.acquire()

    await holder.release()


@pytest.mark.asyncio
async def test_a_crashed_holders_lock_expires_and_becomes_acquirable(fake_redis):
    # timeout_seconds is the lock's own Redis TTL, not a Python-side timer —
    # simulate a crashed holder by setting the key with a near-zero TTL
    # directly instead of waiting out a real timeout in the test.
    await fake_redis.set("lock:room:TEST", "dead-holders-token", px=10)
    await asyncio.sleep(0.05)

    contender = RedisLock(
        fake_redis, "lock:room:TEST", timeout_seconds=5, blocking_timeout_seconds=1
    )
    async with contender:
        assert await fake_redis.get("lock:room:TEST") is not None
