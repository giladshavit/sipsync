"""Up Next (`next_game_id`) must be one authoritative room fact, not a value
each WebSocket connection recomputes for itself.

Regression coverage for the podium divergence investigated in
.superpowers/sdd/podium-bug-investigation.md: every screen transition closes
and reopens both clients' sockets, the two handshakes land at different
instants (so the first one saw `count_active_players() == 1`), and each one
reshuffled the deck and then peeked its own private draw — admin and guest
ended up staring at two different "Up Next" cards, neither of which was
necessarily the game the next round actually dealt.

Strategy mirrors test_room_gc.py / test_min_players_sync.py: patch
module-level `redis` in room_service (and fsm) plus the deck singleton's own
client with a shared fakeredis, stub the fire-and-forget background tasks,
and capture broadcasts into a list. `random.shuffle` is replaced inside
deck.py's namespace with a deterministic rotation so "two independent
reshuffles produce two different draws" is a fact of the test rather than a
1-in-N coin flip.
"""
import json
import types

import fakeredis
import pytest

import app.engine.deck as deck_module
import app.engine.fsm as fsm_module
import app.engine.room_service as rs_module
from app.engine.deck import Deck
from app.engine.deck import deck as deck_singleton
from app.engine.eligibility import min_players_for
from app.engine.fsm import RoomState

CODE = "NEXTCD"
ADMIN = "admin-uuid"
GUEST = "guest-uuid"
NEXT_GAME_KEY = f"room:{CODE}:next_game"

# Deliberately mixes floors: dilemma and black_box need 2 players, so a
# handshake that momentarily sees only 1 active player resolves a *different*
# effective list — which is exactly what used to wipe and reshuffle the deck
# twice on every screen transition.
CATALOG = [
    "reflex",
    "tap_race",
    "human_timer",
    "roulette",
    "coin_flip",
    "strong_point",
    "twenty_one",
    "dilemma",
    "black_box",
]

_svc = rs_module.room_service


@pytest.fixture(autouse=True)
def patch_redis_and_broadcast(monkeypatch):
    r = fakeredis.FakeAsyncRedis(decode_responses=True)
    monkeypatch.setattr(rs_module, "redis", r)
    monkeypatch.setattr(fsm_module, "redis", r)
    monkeypatch.setattr(deck_singleton, "_redis", r)
    monkeypatch.setattr(_svc, "_connections", {})

    # Fire-and-forget background tasks that would otherwise outlive the
    # test's event loop (60s grace timer, infinite pub/sub listener, admin
    # migration timer).
    async def _noop_pubsub(code: str) -> None:
        pass

    async def _noop_timeout(code: str, player_id: str, disconnected_at: int) -> None:
        pass

    monkeypatch.setattr(_svc, "_pubsub_listener", _noop_pubsub)
    monkeypatch.setattr(_svc, "_disconnect_grace_timeout", _noop_timeout)
    monkeypatch.setattr(_svc, "_admin_migration_timeout", _noop_timeout)

    captured: list[dict] = []

    async def _mock_broadcast(code: str, message: dict) -> None:
        captured.append(message)

    monkeypatch.setattr(_svc, "broadcast", _mock_broadcast)
    return r, captured


@pytest.fixture(autouse=True)
def deterministic_shuffle(monkeypatch):
    """Every shuffle rotates the list one position further than the last, so
    two reshuffles of the same catalogue can never coincidentally agree on
    which card sits at the deck's pop end."""
    state = {"n": 0}

    def _rotating_shuffle(seq: list) -> None:
        state["n"] += 1
        if seq:
            k = state["n"] % len(seq)
            seq[:] = seq[k:] + seq[:k]

    monkeypatch.setattr(
        deck_module, "random", types.SimpleNamespace(shuffle=_rotating_shuffle)
    )
    return state


class _FakeWebSocket:
    def __init__(self) -> None:
        self.sent: list[dict] = []

    async def send_text(self, text: str) -> None:
        self.sent.append(json.loads(text))

    @property
    def next_game_ids(self) -> list[str | None]:
        return [m["next_game_id"] for m in self.sent if m["type"] == "ROOM_STATE"]


async def _handshake(player_id: str) -> _FakeWebSocket:
    ws = _FakeWebSocket()
    await _svc.handle_handshake(CODE, ws, {
        "player_id": player_id,
        "display_name": player_id,
        "local_ts": 0,
    })
    return ws


async def _settled_room(
    r, state: str = RoomState.PODIUM, catalog: list[str] | None = None
) -> None:
    """A two-player room that has finished settling: both players joined (so
    the eligibility sync has run at its final headcount) and the deck and Up
    Next card are whatever those joins left behind."""
    catalog = catalog if catalog is not None else CATALOG
    await r.hset(f"room:{CODE}", mapping={"state": state, "admin_id": ADMIN})
    await r.rpush(f"room:{CODE}:admin_game_ids", *catalog)
    ws_admin = await _handshake(ADMIN)
    ws_guest = await _handshake(GUEST)
    await _svc.handle_disconnect(CODE, ADMIN, ws_admin)
    await _svc.handle_disconnect(CODE, GUEST, ws_guest)
    await _handshake(ADMIN)
    await _handshake(GUEST)


def _connections(player_id: str) -> object:
    return _svc._connections[CODE][player_id]


# ---------------------------------------------------------------------------
# Bug A — one room, one Up Next
# ---------------------------------------------------------------------------


async def test_next_game_identical_across_staggered_reconnects(patch_redis_and_broadcast):
    """The real podium transition: both sockets close, then both reopen in a
    stagger, so the first handshake back lands while the other player still
    reads as gone. Up Next must be the same value before, for both clients
    after — and must be the game the next round actually deals."""
    r, _ = patch_redis_and_broadcast
    await _settled_room(r)
    before = await r.get(NEXT_GAME_KEY)
    assert before is not None

    await _svc.handle_disconnect(CODE, ADMIN, _connections(ADMIN))
    await _svc.handle_disconnect(CODE, GUEST, _connections(GUEST))
    ws_guest = await _handshake(GUEST)
    ws_admin = await _handshake(ADMIN)

    assert ws_guest.next_game_ids[-1] == before
    assert ws_admin.next_game_ids[-1] == before
    # ...and the card was honest: this is what actually gets dealt.
    assert await deck_singleton.pop_next_game(CODE) == before


async def test_room_state_reads_the_stored_next_game_key(patch_redis_and_broadcast):
    """ROOM_STATE must echo the room's stored card, not re-derive one per
    connection off whatever the deck happens to look like at that instant."""
    r, _ = patch_redis_and_broadcast
    await _settled_room(r)
    # Any catalogue entry that isn't what a fresh peek would return, so this
    # can only pass by actually reading the stored key.
    peeked = await deck_singleton.peek_next_game(CODE)
    sentinel = next(g for g in CATALOG if g != peeked)
    await r.set(NEXT_GAME_KEY, sentinel)

    await _svc.handle_disconnect(CODE, GUEST, _connections(GUEST))
    ws_guest = await _handshake(GUEST)

    assert ws_guest.next_game_ids[-1] == sentinel


async def test_reconnect_does_not_reshuffle_the_deck(patch_redis_and_broadcast):
    """A returning player_id is not a genuine join — it must not re-run the
    eligibility sync, and so must not wipe and reshuffle the deck (which is
    what destroyed the play-once-per-cycle smart shuffle, ~8 reshuffles a
    round)."""
    r, _ = patch_redis_and_broadcast
    await _settled_room(r)
    deck_before = await r.lrange(f"room:{CODE}:deck", 0, -1)

    # Both sockets are down mid-transition, so the first one back is the
    # room's only "active" player — the window that used to re-resolve the
    # eligible list at a headcount of 1 and reinitialize the deck from it.
    await _svc.handle_disconnect(CODE, ADMIN, _connections(ADMIN))
    await _svc.handle_disconnect(CODE, GUEST, _connections(GUEST))
    await _handshake(ADMIN)
    await _handshake(GUEST)

    assert await r.lrange(f"room:{CODE}:deck", 0, -1) == deck_before


async def test_next_game_never_names_a_game_below_the_room_floor(patch_redis_and_broadcast):
    """A 2-player room must never advertise a game that needs more than 2 —
    including across the reconnect stagger that used to momentarily resolve
    the room's eligible list at a headcount of 1, which pruned exactly the
    two games *designed* for a pair (dilemma, black_box) and left the
    crowd games behind.

    `majority` / `minority` / `sacrifice` are named explicitly because they
    are the floors this fix adds (see eligibility.MIN_PLAYERS): a 1-1 vote
    is a coin flip and a 2-0 vote has no losing side, so they were the games
    the broken card kept offering a 2-player room."""
    r, _ = patch_redis_and_broadcast
    crowd_games = ["majority", "minority", "sacrifice", "closest_average", "flying_bomb"]
    await _settled_room(r, catalog=crowd_games + ["reflex", "coin_flip"])

    await _svc.handle_disconnect(CODE, ADMIN, _connections(ADMIN))
    await _svc.handle_disconnect(CODE, GUEST, _connections(GUEST))
    ws_guest = await _handshake(GUEST)
    ws_admin = await _handshake(ADMIN)

    for ws in (ws_guest, ws_admin):
        for gid in ws.next_game_ids:
            assert gid is not None
            assert gid not in crowd_games, gid
            assert min_players_for(gid) <= 2, gid


async def test_stored_next_game_is_refreshed_when_a_round_is_dealt(patch_redis_and_broadcast):
    """Dealing the queued game must advance the stored card, not leave the
    game that was just dealt showing as Up Next."""
    r, _ = patch_redis_and_broadcast
    await _settled_room(r)
    advertised = await r.get(NEXT_GAME_KEY)

    assert await _svc._trigger_next_game_tutorial(CODE) is True

    assert await r.hget(f"room:{CODE}", "active_game") == advertised
    assert await r.get(NEXT_GAME_KEY) != advertised

    ws = await _handshake(GUEST)
    assert ws.next_game_ids[-1] == await r.get(NEXT_GAME_KEY)


async def test_skip_game_advances_the_stored_card_for_everyone(patch_redis_and_broadcast):
    """SKIP_GAME burns the queued game; the broadcast and the stored key must
    agree, so a client that reconnects right afterwards sees the same thing."""
    r, captured = patch_redis_and_broadcast
    await _settled_room(r)
    before = await r.get(NEXT_GAME_KEY)

    await _svc.handle_skip_game(CODE, ADMIN)

    updates = [m for m in captured if m["type"] == "NEXT_GAME_UPDATED"]
    assert updates, "SKIP_GAME must broadcast the new Up Next"
    assert updates[-1]["next_game_id"] != before
    assert updates[-1]["next_game_id"] == await r.get(NEXT_GAME_KEY)


async def test_set_games_refreshes_the_stored_card(patch_redis_and_broadcast):
    """An admin's explicit lineup edit reshuffles the deck — the stored Up
    Next has to follow it, or every client keeps showing a card drawn from a
    deck that no longer exists."""
    r, captured = patch_redis_and_broadcast
    await _settled_room(r)

    await _svc.handle_set_games(CODE, ADMIN, ["reflex", "coin_flip"])

    stored = await r.get(NEXT_GAME_KEY)
    assert stored in ("reflex", "coin_flip")
    updates = [m for m in captured if m["type"] == "NEXT_GAME_UPDATED"]
    assert updates and updates[-1]["next_game_id"] == stored


async def test_stored_card_reshuffles_rather_than_going_blank_at_cycle_end(
    patch_redis_and_broadcast,
):
    """The last card of a cycle must still be followed by a real Up Next —
    the deck is replenished once, under the room lock, at the moment the
    queue genuinely changes, instead of once per connection."""
    r, _ = patch_redis_and_broadcast
    await _settled_room(r, catalog=["reflex", "coin_flip"])

    for _ in range(4):
        assert await _svc._trigger_next_game_tutorial(CODE) is True
        assert await r.get(NEXT_GAME_KEY) is not None
        await r.hset(f"room:{CODE}", "state", RoomState.PODIUM)


# ---------------------------------------------------------------------------
# Bug A3 — peek is a pure read
# ---------------------------------------------------------------------------


@pytest.fixture
def fake_redis():
    return fakeredis.FakeAsyncRedis(decode_responses=True)


async def test_peek_never_mutates(fake_redis):
    """peek_next_game used to RPUSH a whole extra catalogue every time nothing
    in the deck was eligible — an unbounded Redis list on a room whose entire
    selection sits above its headcount (4 → 6 → 8 → 10 → 12 ...)."""
    d = Deck(redis_client=fake_redis)
    await d.initialize("PEEKRM", ["dilemma", "black_box"])  # both need 2 players
    await fake_redis.hset(
        "room:PEEKRM:players", mapping={"solo": json.dumps({"connected": True})}
    )
    length_before = await fake_redis.llen("room:PEEKRM:deck")

    for _ in range(5):
        assert await d.peek_next_game("PEEKRM") is None
        assert await fake_redis.llen("room:PEEKRM:deck") == length_before


async def test_peek_matches_the_next_pop_across_a_reconnect(patch_redis_and_broadcast):
    """The property the whole feature rests on: what the podium advertises is
    what the next round deals — with a reconnect handshake in between."""
    r, _ = patch_redis_and_broadcast
    await _settled_room(r)
    advertised = await r.get(NEXT_GAME_KEY)

    await _svc.handle_disconnect(CODE, ADMIN, _connections(ADMIN))
    await _handshake(ADMIN)

    assert await deck_singleton.pop_next_game(CODE) == advertised


# ---------------------------------------------------------------------------
# Bug A, second edge — a headcount change that leaves the effective list alone
# ---------------------------------------------------------------------------

# Every entry needs 3 players, so a 2-player room can deal none of them and
# resolve_effective_games has nothing to prune down to — it hands back the
# admin's list unchanged via `fallback`.
CROWD_ONLY = ["majority", "sacrifice"]


async def test_headcount_drop_clears_a_now_undealable_up_next(patch_redis_and_broadcast):
    """resolve_effective_games returns the admin's unfiltered list when *every*
    selection is above the floor, so a 4-player crowd-game room dropping to 2
    leaves the effective list identical — and the "no actual change" early
    return that fact triggers skipped the Up Next refresh entirely. The podium
    kept advertising a 3-player game to a 2-player room (issue #129's exact
    symptom) and the admin's Next button became a silent no-op."""
    r, _ = patch_redis_and_broadcast
    await r.hset(f"room:{CODE}", mapping={"state": RoomState.PODIUM, "admin_id": ADMIN})
    await r.rpush(f"room:{CODE}:admin_game_ids", *CROWD_ONLY)
    for pid in (ADMIN, GUEST, "p3", "p4"):
        await _handshake(pid)
    assert await r.get(NEXT_GAME_KEY) in CROWD_ONLY

    for pid in ("p3", "p4"):
        await r.hdel(f"room:{CODE}:players", pid)
        await _svc._finalize_departure(CODE, pid)

    # Nothing in the catalogue is playable at 2, so the honest card is no card.
    assert await r.get(NEXT_GAME_KEY) is None
    # ...and the promise matches what the room would actually deal.
    assert await deck_singleton.pop_next_game(CODE) is None


async def test_headcount_drop_broadcasts_the_cleared_up_next(patch_redis_and_broadcast):
    """Clients sitting on the podium hold whatever card their last ROOM_STATE
    gave them; clearing it server-side without telling them leaves the stale
    game on screen until the next transition."""
    r, captured = patch_redis_and_broadcast
    await r.hset(f"room:{CODE}", mapping={"state": RoomState.PODIUM, "admin_id": ADMIN})
    await r.rpush(f"room:{CODE}:admin_game_ids", *CROWD_ONLY)
    for pid in (ADMIN, GUEST, "p3", "p4"):
        await _handshake(pid)
    captured.clear()

    for pid in ("p3", "p4"):
        await r.hdel(f"room:{CODE}:players", pid)
        await _svc._finalize_departure(CODE, pid)

    updates = [m for m in captured if m["type"] == "NEXT_GAME_UPDATED"]
    assert updates and updates[-1]["next_game_id"] is None


async def test_unchanged_up_next_does_not_spam_a_broadcast(patch_redis_and_broadcast):
    """The refresh now runs on every sync, so it must stay quiet when it
    recomputes the same card — a join that changes nothing shouldn't push a
    redundant NEXT_GAME_UPDATED to everyone."""
    r, captured = patch_redis_and_broadcast
    await _settled_room(r)
    before = await r.get(NEXT_GAME_KEY)
    captured.clear()

    await _svc._sync_eligible_games(CODE, 2)

    assert await r.get(NEXT_GAME_KEY) == before
    assert [m for m in captured if m["type"] == "NEXT_GAME_UPDATED"] == []


async def test_refresh_next_game_keeps_the_key_expiring(patch_redis_and_broadcast):
    """Room Garbage Collection: a grace timer firing after the last socket
    closed rewrites Up Next, and a plain SET drops the key's TTL — leaving one
    orphan key per abandoned room behind after Redis reclaims the rest."""
    r, _ = patch_redis_and_broadcast
    await _settled_room(r)
    await _svc._apply_empty_room_ttl(CODE)

    async with _svc._room_lock(CODE):
        await _svc._refresh_next_game(CODE)

    assert 0 < await r.ttl(NEXT_GAME_KEY) <= 60


# ---------------------------------------------------------------------------
# Dealing a game is one atomic queue advance
# ---------------------------------------------------------------------------


async def test_second_next_round_tap_does_not_burn_a_card(patch_redis_and_broadcast):
    """The admin's Next button has no debounce, and the room lock serializes
    two taps rather than letting them interleave — so the second one popped a
    card, overwrote active_game and advanced Up Next *before* the
    TUTORIAL->TUTORIAL transition raised and it gave up. Everyone then watched
    the first game's tutorial while a second game was silently burned out of
    the shuffle bag."""
    r, _ = patch_redis_and_broadcast
    await _settled_room(r)

    assert await _svc._trigger_next_game_tutorial(CODE) is True
    dealt = await r.hget(f"room:{CODE}", "active_game")
    queued = await r.get(NEXT_GAME_KEY)
    deck_after_first = await r.lrange(f"room:{CODE}:deck", 0, -1)

    assert await _svc._trigger_next_game_tutorial(CODE) is False
    assert await r.hget(f"room:{CODE}", "active_game") == dealt
    assert await r.get(NEXT_GAME_KEY) == queued
    assert await r.lrange(f"room:{CODE}:deck", 0, -1) == deck_after_first
