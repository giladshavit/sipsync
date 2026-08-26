# /// script
# requires-python = ">=3.12"
# dependencies = ["pillow>=10"]
# ///
"""Turn raw iPhone captures into App Store screenshots.

    uv run scripts/store-screenshots.py <capture-dir>

Reads the captures named in FRAMES from <capture-dir> and writes them, in
store order, to docs/store/screenshots/iphone/en-US/ at 1290x2796 — one of the
sizes App Store Connect's required "iPhone 6.9-inch Display" slot accepts.

No frames, no captions: the decision was that the real screens sell the app
better than marketing chrome would. The captures come off a 6.1" phone at
1179x2556, whose aspect ratio (0.4613) is within 0.03% of 1290x2796's, so this
is a clean 9.4% Lanczos upscale with no crop and no letterboxing.

Upload: App Store Connect → iOS App 1.0.0 → Previews and Screenshots → the
**6.9" Display** tab (the 6.5" tab wants 1284x2778 and will reject these).
"""

from __future__ import annotations

import sys
from pathlib import Path

from PIL import Image

REPO = Path(__file__).resolve().parent.parent
OUT = REPO / "docs/store/screenshots/iphone/en-US"

# App Store Connect, iPhone 6.9" Display slot — portrait.
W, H = 1290, 2796

# (capture file, slug). Order is the store order: the room, the catalog, then
# four games that look nothing alike, and the bomb.
FRAMES = [
    ("IMG_0184.PNG", "room"),
    ("IMG_0192.PNG", "games"),
    ("IMG_0194.PNG", "sacrifice"),
    ("IMG_0189.PNG", "auction"),
    ("IMG_0193.PNG", "twenty-one"),
    ("IMG_0195.PNG", "roulette"),
    ("IMG_0190.PNG", "flying-bomb"),
]

# Reject a capture whose aspect ratio would need cropping to fit.
MAX_ASPECT_DRIFT = 0.005


def fit(capture: Image.Image) -> Image.Image:
    drift = abs(capture.width / capture.height - W / H)
    if drift > MAX_ASPECT_DRIFT:
        sys.exit(
            f"capture is {capture.width}x{capture.height} — aspect differs from {W}x{H} by "
            f"{drift:.3f}; it would need cropping, which this script deliberately doesn't do"
        )
    return capture.convert("RGB").resize((W, H), Image.LANCZOS)


def main() -> None:
    if len(sys.argv) != 2:
        sys.exit(__doc__.strip().split("\n")[2].strip())
    src = Path(sys.argv[1]).expanduser()
    OUT.mkdir(parents=True, exist_ok=True)
    for stale in OUT.glob("*.png"):
        stale.unlink()
    for i, (name, slug) in enumerate(FRAMES, 1):
        path = src / name
        if not path.is_file():
            sys.exit(f"missing capture: {path}")
        out = OUT / f"{i:02d}-{slug}.png"
        fit(Image.open(path)).save(out, optimize=True)
        print(f"{out.relative_to(REPO)}  {W}x{H}  {out.stat().st_size // 1024} KB")


if __name__ == "__main__":
    main()
