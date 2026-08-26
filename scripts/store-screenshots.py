# /// script
# requires-python = ">=3.12"
# dependencies = ["pillow>=10"]
# ///
"""Compose App Store screenshots from raw device captures.

    uv run scripts/store-screenshots.py <capture-dir>

Reads the captures named in FRAMES from <capture-dir>, writes designed
1320x2868 frames (Apple's 6.9" class — the one size set that now covers every
iPhone slot) to docs/store/screenshots/ios/en-US/.

Design: the app's own ink background with its accent glow bleeding from the
top (the same device language as the tutorial screens), an amber eyebrow and
a big chalk headline, then the capture in a rounded, rimmed frame that runs
off the bottom edge — the standard store composition, and it hides nothing
that matters: every capture's content sits in its upper 85%.
"""

from __future__ import annotations

import sys
from pathlib import Path

from PIL import Image, ImageDraw, ImageFilter, ImageFont

REPO = Path(__file__).resolve().parent.parent
OUT = REPO / "docs/store/screenshots/ios/en-US"

W, H = 1320, 2868

# frontend/constants/design.ts
INK = (0x0A, 0x0A, 0x0F)
RIM = (0x25, 0x25, 0x38)
CHALK = (0xF0, 0xF0, 0xE8)
AMBER = (0xF5, 0x9E, 0x0B)

# (capture file, eyebrow, headline). Order is the store order.
FRAMES = [
    ("IMG_0184.PNG", "ONE PHONE EACH", "Open a room.\nFriends join\nwith a code."),
    ("IMG_0192.PNG", "15 MINI-GAMES", "Pick tonight's\ngames."),
    ("IMG_0188.PNG", "THE SACRIFICE", "Volunteer first —\nor everyone\ndrinks."),
    ("IMG_0189.PNG", "AUCTION", "Bid chasers.\nRun the table."),
    ("IMG_0186.PNG", "21", "Don't be the one\nwho hits 21."),
    ("IMG_0185.PNG", "RUSSIAN ROULETTE", "Flip cards.\nDodge the poison."),
    ("IMG_0190.PNG", "FLYING BOMB", "Swipe it away\nbefore it blows."),
]

FONT_BLACK = "/System/Library/Fonts/Supplemental/Arial Black.ttf"
FONT_BOLD = "/System/Library/Fonts/Supplemental/Arial Bold.ttf"

MARGIN = 96
EYEBROW_TOP = 200
HEADLINE_SIZE = 118
HEADLINE_LEADING = 1.08
PHONE_WIDTH = 1120
PHONE_RADIUS = 96  # iPhone 15 corner radius at this scale
# Every frame anchors the phone at the same y — below the tallest headline the
# set uses (three lines) — so the carousel doesn't bob up and down as the
# viewer swipes between a two-line caption and a three-line one.
HEADLINE_MAX_LINES = 3
PHONE_TOP = EYEBROW_TOP + 76 + HEADLINE_MAX_LINES * round(HEADLINE_SIZE * HEADLINE_LEADING) + 72


def font(path: str, size: int) -> ImageFont.FreeTypeFont:
    return ImageFont.truetype(path, size)


def background() -> Image.Image:
    """Ink with a soft amber glow bleeding from above the top edge."""
    bg = Image.new("RGB", (W, H), INK)
    glow = Image.new("RGB", (W, H), INK)
    d = ImageDraw.Draw(glow)
    r = 900
    d.ellipse((W // 2 - r, -r - 250, W // 2 + r, r - 250), fill=(0x3A, 0x2A, 0x0E))
    glow = glow.filter(ImageFilter.GaussianBlur(220))
    return Image.blend(bg, glow, 1.0)


def rounded_phone(capture: Image.Image) -> Image.Image:
    """The capture scaled to PHONE_WIDTH, rounded, with a 3px rim — RGBA."""
    scale = PHONE_WIDTH / capture.width
    im = capture.convert("RGB").resize((PHONE_WIDTH, round(capture.height * scale)), Image.LANCZOS)
    mask = Image.new("L", im.size, 0)
    ImageDraw.Draw(mask).rounded_rectangle((0, 0, im.width - 1, im.height - 1), PHONE_RADIUS, fill=255)
    out = Image.new("RGBA", im.size, (0, 0, 0, 0))
    out.paste(im, (0, 0), mask)
    ImageDraw.Draw(out).rounded_rectangle(
        (1, 1, im.width - 2, im.height - 2), PHONE_RADIUS, outline=RIM + (255,), width=3
    )
    return out


def shadow_for(phone: Image.Image) -> Image.Image:
    pad = 120
    sh = Image.new("RGBA", (phone.width + pad * 2, phone.height + pad * 2), (0, 0, 0, 0))
    ImageDraw.Draw(sh).rounded_rectangle(
        (pad, pad + 30, pad + phone.width, pad + phone.height + 30), PHONE_RADIUS, fill=(0, 0, 0, 170)
    )
    return sh.filter(ImageFilter.GaussianBlur(48))


def compose(capture_path: Path, eyebrow: str, headline: str) -> Image.Image:
    canvas = background()
    d = ImageDraw.Draw(canvas)

    # Eyebrow — the app's typography.label: bold, tracked, uppercase.
    eb_font = font(FONT_BOLD, 40)
    x = MARGIN
    for ch in eyebrow:
        d.text((x, EYEBROW_TOP), ch, font=eb_font, fill=AMBER)
        x += d.textlength(ch, font=eb_font) + 9  # letter-spacing

    # Headline — typography.title weight. Shrinks until every line fits.
    size = HEADLINE_SIZE
    lines = headline.split("\n")
    while True:
        hl_font = font(FONT_BLACK, size)
        if max(d.textlength(l, font=hl_font) for l in lines) <= W - 2 * MARGIN or size <= 72:
            break
        size -= 4
    y = EYEBROW_TOP + 40 + 36
    for line in lines:
        d.text((MARGIN - 4, y), line, font=hl_font, fill=CHALK)
        y += round(size * HEADLINE_LEADING)

    # Phone, bleeding off the bottom.
    phone = rounded_phone(Image.open(capture_path))
    px = (W - phone.width) // 2
    py = PHONE_TOP
    sh = shadow_for(phone)
    canvas.paste(sh, (px - 120, py - 120), sh)
    canvas.paste(phone, (px, py), phone)
    return canvas


def main() -> None:
    if len(sys.argv) != 2:
        sys.exit(__doc__.strip().split("\n")[2].strip())
    src = Path(sys.argv[1]).expanduser()
    OUT.mkdir(parents=True, exist_ok=True)
    for i, (name, eyebrow, headline) in enumerate(FRAMES, 1):
        path = src / name
        if not path.is_file():
            sys.exit(f"missing capture: {path}")
        out = OUT / f"{i:02d}-{eyebrow.lower().replace(' ', '-')}.png"
        compose(path, eyebrow, headline).save(out, optimize=True)
        print(f"{out.relative_to(REPO)}  {W}x{H}  {out.stat().st_size // 1024} KB")


if __name__ == "__main__":
    main()
