import random

# 42 hand-picked kawaii sticker-style avatars (animals + everyday objects),
# generated externally and sliced into individual PNGs under
# frontend/assets/avatars/{id}.png. This file is the source of truth for
# assignment; the frontend mirrors these ids at frontend/constants/avatars.ts
# to map each id to its actual image asset.
AVATAR_POOL: list[str] = [
    "avocado", "balloon", "bear", "bee", "book", "camera", "cat", "chick",
    "cookie", "cucumber", "deer", "donut", "duck", "fox", "frog", "gift_box",
    "hamster", "hedgehog", "ice_cream_cone", "koala", "lemon", "lion",
    "mitten", "monkey", "moon", "mushroom", "octopus", "owl", "panda",
    "penguin", "pig", "rabbit", "rainbow", "raindrop", "sloth", "sock",
    "strawberry", "sun", "tiger", "turtle", "unicorn", "whale",
]


def pick_avatar(used: set[str]) -> str:
    """Pick a random avatar id not already in use in the room.

    Falls back to the full pool (allowing a rare duplicate) if every avatar
    is somehow already taken — the pool comfortably covers any realistic
    party-room headcount, so this only guards against a pathological edge
    case rather than something expected to fire in practice.
    """
    available = [a for a in AVATAR_POOL if a not in used]
    return random.choice(available) if available else random.choice(AVATAR_POOL)
