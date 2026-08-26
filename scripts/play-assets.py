# /// script
# requires-python = ">=3.12"
# dependencies = ["pillow>=10"]
# ///
"""Google Play store graphics, derived from what the iOS listing already has.

    uv run scripts/play-assets.py

Writes to docs/store/play/:
  icon-512.png            512x512 store icon (Play wants its own upload,
                          separate from the in-app icon)
  feature-graphic.png     1024x500 — the banner at the top of the listing
  screenshots/NN-*.png    the iOS captures re-padded to 9:16 (1080x1920)

Why the screenshots need work: Play rejects any screenshot whose long side is
more than twice its short side, and modern iPhone captures are 2.17:1. Rather
than crop the status bar off, each capture is scaled to 1920 tall and centred
on the app's ink background — the screen is untouched, it just gets a narrow
frame either side.
"""

from __future__ import annotations

from pathlib import Path

from PIL import Image, ImageDraw, ImageFilter, ImageFont

REPO = Path(__file__).resolve().parent.parent
ASSETS = REPO / "frontend/assets"
IOS_SHOTS = REPO / "docs/store/screenshots/iphone/en-US"
OUT = REPO / "docs/store/play"

INK = (0x0A, 0x0A, 0x0F)
CHALK = (0xF0, 0xF0, 0xE8)
AMBER = (0xF5, 0x9E, 0x0B)
RIM = (0x25, 0x25, 0x38)

FONT_BLACK = "/System/Library/Fonts/Supplemental/Arial Black.ttf"
FONT_BOLD = "/System/Library/Fonts/Supplemental/Arial Bold.ttf"


def glow(size: tuple[int, int], centre: tuple[int, int], radius: int) -> Image.Image:
    im = Image.new("RGB", size, INK)
    d = ImageDraw.Draw(im)
    cx, cy = centre
    d.ellipse((cx - radius, cy - radius, cx + radius, cy + radius), fill=(0x3A, 0x2A, 0x0E))
    return im.filter(ImageFilter.GaussianBlur(radius // 3))


def icon() -> None:
    Image.open(ASSETS / "app-icon.png").convert("RGB").resize((512, 512), Image.LANCZOS).save(
        OUT / "icon-512.png", optimize=True
    )


def feature_graphic() -> None:
    """Duck on the left, wordmark and subtitle on the right, 1024x500."""
    W, H = 1024, 500
    im = glow((W, H), (240, 250), 420)
    # The duck source is a flat RGB render on the app's cream; the adaptive
    # icon carries the same duck with real alpha.
    duck = Image.open(ASSETS / "adaptive-icon.png").convert("RGBA")
    # Adaptive icons keep their subject inside the middle ~66% safe zone.
    box = duck.getbbox()
    duck = duck.crop(box) if box else duck
    duck.thumbnail((400, 400), Image.LANCZOS)
    im.paste(duck, (60, (H - duck.height) // 2), duck)

    d = ImageDraw.Draw(im)
    x = 480
    d.text((x, 150), "Quickle", font=ImageFont.truetype(FONT_BLACK, 104), fill=CHALK)
    sub = ImageFont.truetype(FONT_BOLD, 30)
    cx = x + 6
    for ch in "FAST, LIGHT MINI-GAMES":
        d.text((cx, 292), ch, font=sub, fill=AMBER)
        cx += d.textlength(ch, font=sub) + 4
    d.text((x + 6, 350), "One phone each. Any drink.", font=ImageFont.truetype(FONT_BOLD, 30), fill=(0xA8, 0xA8, 0xB4))
    im.save(OUT / "feature-graphic.png", optimize=True)


def screenshots() -> None:
    W, H = 1080, 1920
    out = OUT / "screenshots"
    out.mkdir(parents=True, exist_ok=True)
    for stale in out.glob("*.png"):
        stale.unlink()
    for src in sorted(IOS_SHOTS.glob("*.png")):
        shot = Image.open(src).convert("RGB")
        scale = H / shot.height
        shot = shot.resize((round(shot.width * scale), H), Image.LANCZOS)
        canvas = Image.new("RGB", (W, H), INK)
        x = (W - shot.width) // 2
        # Rounded corners so the narrow ink margin reads as a deliberate
        # frame rather than a letterboxing accident.
        mask = Image.new("L", shot.size, 0)
        ImageDraw.Draw(mask).rounded_rectangle((0, 0, shot.width - 1, shot.height - 1), 28, fill=255)
        canvas.paste(shot, (x, 0), mask)
        ImageDraw.Draw(canvas).rounded_rectangle((x, 0, x + shot.width - 1, H - 1), 28, outline=RIM, width=2)
        canvas.save(out / src.name, optimize=True)
        print(f"  {src.name}  {W}x{H}")


def main() -> None:
    OUT.mkdir(parents=True, exist_ok=True)
    icon()
    print("icon-512.png  512x512")
    feature_graphic()
    print("feature-graphic.png  1024x500")
    screenshots()


if __name__ == "__main__":
    main()
