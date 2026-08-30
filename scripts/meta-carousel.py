# /// script
# requires-python = ">=3.12"
# dependencies = ["pillow>=10"]
# ///
"""Meta / Instagram carousel cards for the Quickle ad test.

    uv run scripts/meta-carousel.py

Writes 1080x1350 (4:5) PNGs to docs/marketing/carousel/, plus the whole
screens (status bar off, native 1290x2646) to docs/marketing/screens/ for
placements that fit a full phone screen. Card 1 is the brand
card (duck, one line, the URL). Every other card is a full-bleed window onto
one real screenshot from docs/store/screenshots/iphone/en-US - no phone
frame, no captions, nothing that reads as an ad. A capture is 1290x2796 and
4:5 shows 1612 of those rows at full width, so each screen names the row its
window starts on; the status bar and the back button always fall outside it.
Nothing on any card hints at alcohol.
"""

from __future__ import annotations

from pathlib import Path

from PIL import Image, ImageDraw, ImageFilter, ImageFont

REPO = Path(__file__).resolve().parent.parent
SHOTS = REPO / "docs/store/screenshots/iphone/en-US"
ASSETS = REPO / "frontend/assets"
OUT = REPO / "docs/marketing/carousel"
OUT_FULL = REPO / "docs/marketing/screens"  # the same captures whole (status bar off), native size
STATUS_BAR_PX = 150  # of a 1290x2796 capture: the clock, signal and battery

W, H = 1080, 1350
CREAM = (0xFF, 0xF8, 0xE1)
INK = (0x0A, 0x0A, 0x0F)
AMBER = (0xF5, 0x9E, 0x0B)

FREDOKA = REPO / "docs/marketing/fonts/Fredoka-Variable.ttf"  # the brand's display face (OFL)


def fredoka(size: int, weight: int = 700) -> ImageFont.FreeTypeFont:
    f = ImageFont.truetype(str(FREDOKA), size)
    f.set_variation_by_axes([weight, 100])  # the file's axes: wght, wdth
    return f

RAW_W = 1290
WINDOW_H = round(H * RAW_W / W)  # 1612 capture rows fill a 4:5 card

# (capture, first row of the window). The order is the story the swipe
# tells: what's in it -> how a room works -> the games themselves.
SCREENS = [
    ("02-games.png", 560),  # "Games" + filters + two full rows of tiles
    ("01-room.png", 830),  # tonight's games, the host, the code, share invite
    ("04-auction.png", 375),  # highest bid, the +1/+10 buttons, custom bid
    ("05-twenty-one.png", 860),  # the counter ring and the +1/+2/+3 buttons
    ("06-roulette.png", 895),  # points, the six cards, skip
    ("03-sacrifice.png", 395),  # the ring, "1 chaser to go", the I'M IN button
    ("07-flying-bomb.png", 250),  # the timer ring, the pill and the bomb
]


# Captures whose window still contains the back button (x 52-191, y 233-371).
# The screen backgrounds are symmetric about the centre, so the mirror image
# of the same spot on the right is the correct background to put over it.
ERASE_BACK_BUTTON = {"07-flying-bomb.png"}


def erase_back_button(im: Image.Image) -> Image.Image:
    x0, y0, x1, y1, feather = 20, 201, 223, 403, 10  # the button plus a margin of plain background
    mirror = im.crop((RAW_W - x1, y0, RAW_W - x0, y1)).transpose(Image.Transpose.FLIP_LEFT_RIGHT)
    mask = Image.new("L", mirror.size, 0)
    ImageDraw.Draw(mask).rectangle((feather, feather, mirror.width - feather, mirror.height - feather), fill=255)
    im.paste(mirror, (x0, y0), mask.filter(ImageFilter.GaussianBlur(feather / 2)))
    return im


def screen_card(name: str, top: int) -> Image.Image:
    src = Image.open(SHOTS / name).convert("RGB")
    if name in ERASE_BACK_BUTTON:
        src = erase_back_button(src)
    window = src.crop((0, top, RAW_W, top + WINDOW_H))
    return window.resize((W, H), Image.LANCZOS)


def brand_card() -> Image.Image:
    """Duck, one line, the URL as an ink-framed amber bar. Nothing else."""
    im = Image.new("RGB", (W, H), CREAM)
    d = ImageDraw.Draw(im)

    duck = Image.open(ASSETS / "duck-wave.png").convert("RGB").resize((620, 620), Image.LANCZOS)
    im.paste(duck, ((W - 620) // 2, 130))  # flat render on the same cream - no keying needed

    d.text((W / 2, 820), "Fast & Fun", font=fredoka(96), fill=INK, anchor="mm")
    d.text((W / 2, 924), "Mini-games", font=fredoka(96), fill=INK, anchor="mm")

    bw, bh = 760, 136
    bx0, by0 = (W - bw) // 2, 1020
    bx1, by1 = bx0 + bw, by0 + bh
    d.rounded_rectangle((bx0 + 14, by0 + 14, bx1 + 14, by1 + 14), 24, fill=INK)
    d.rounded_rectangle((bx0, by0, bx1, by1), 24, fill=AMBER, outline=INK, width=6)
    d.text(((bx0 + bx1) / 2, (by0 + by1) / 2), "quicklegame.com", font=fredoka(64), fill=INK, anchor="mm")
    return im


def full_screen(name: str) -> Image.Image:
    src = Image.open(SHOTS / name).convert("RGB")
    if name in ERASE_BACK_BUTTON:
        src = erase_back_button(src)
    return src.crop((0, STATUS_BAR_PX, RAW_W, src.height))


def main() -> None:
    for folder in (OUT, OUT_FULL):
        folder.mkdir(parents=True, exist_ok=True)
        for stale in folder.glob("*.png"):
            stale.unlink()
    for i, (n, _) in enumerate(SCREENS, start=2):
        path = OUT_FULL / f"{i:02d}-{Path(n).stem[3:]}.png"
        full_screen(n).save(path, optimize=True)
        print(path.relative_to(REPO))
    cards = [("01-brand", brand_card())] + [
        (f"{i:02d}-{Path(n).stem[3:]}", screen_card(n, top)) for i, (n, top) in enumerate(SCREENS, start=2)
    ]
    for slug, im in cards:
        path = OUT / f"{slug}.png"
        im.save(path, optimize=True)
        print(path.relative_to(REPO))


if __name__ == "__main__":
    main()
