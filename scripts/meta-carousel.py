# /// script
# requires-python = ">=3.12"
# dependencies = ["pillow>=10"]
# ///
"""Meta / Instagram carousel cards for the Quickle ad test.

    uv run scripts/meta-carousel.py

Writes 1080x1080 (1:1) PNGs to docs/marketing/carousel/ - Meta renders
carousel cards square in most placements, so anything but 1:1 gets cropped -
plus the whole screens (status bar off, native 1290x2646) to
docs/marketing/screens/ for placements that fit a full phone screen. Card 1
is the brand card (duck, one line, the URL). Every other card is a
full-bleed window onto one real screenshot from
docs/store/screenshots/iphone/en-US - no phone frame, no captions, nothing
that reads as an ad. A capture is 1290x2796 and 1:1 shows 1290 of those rows
at full width, so each screen names the row its window starts on; the status
bar and the back button always fall outside it or get erased. Nothing on any
card hints at alcohol.
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

W, H = 1080, 1080
CREAM = (0xFF, 0xF8, 0xE1)
INK = (0x0A, 0x0A, 0x0F)
AMBER = (0xF5, 0x9E, 0x0B)

FREDOKA = REPO / "docs/marketing/fonts/Fredoka-Variable.ttf"  # the brand's display face (OFL)
ARIAL_BOLD = "/System/Library/Fonts/Supplemental/Arial Bold.ttf"  # matches the app's in-UI sans


def fredoka(size: int, weight: int = 700) -> ImageFont.FreeTypeFont:
    f = ImageFont.truetype(str(FREDOKA), size)
    f.set_variation_by_axes([weight, 100])  # the file's axes: wght, wdth
    return f

RAW_W = 1290
WINDOW_H = round(H * RAW_W / W)  # 1290 capture rows fill a 1:1 card

# (capture, first row of the window). The order is the story the swipe
# tells: what's in it -> how a room works -> the games themselves.
SCREENS = [
    ("02-games.png", 920),  # two full rows of tiles, the third row peeking below
    ("01-room.png", 520),  # "Waiting for friends...", tonight's games, the host
    ("04-auction.png", 300),  # highest bid (David), the +1/+10 buttons, custom bid peeking
    ("05-twenty-one.png", 830),  # the counter ring, "YOUR TURN"
    ("06-roulette.png", 935),  # points and the six cards
    ("03-sacrifice.png", 888),  # "1 CHASER TO GO", the I'M IN button
    ("07-flying-bomb.png", 580),  # the holding pill and the bomb
]


# The back button sits at x 52-191, y 233-371. The screen backgrounds are
# symmetric about the centre, so the mirror image of the same spot on the
# right is the correct background to put over it.
def erase_back_button(im: Image.Image, y0: int = 201, y1: int = 403) -> Image.Image:
    x0, x1, feather = 20, 223, 10  # the button plus a margin of plain background
    mirror = im.crop((RAW_W - x1, y0, RAW_W - x0, y1)).transpose(Image.Transpose.FLIP_LEFT_RIGHT)
    mask = Image.new("L", mirror.size, 0)
    ImageDraw.Draw(mask).rectangle((feather, feather, mirror.width - feather, mirror.height - feather), fill=255)
    im.paste(mirror, (x0, y0), mask.filter(ImageFilter.GaussianBlur(feather / 2)))
    return im


def rename_wren(im: Image.Image) -> Image.Image:
    """The auction capture's highest bidder is a dev-room bot, "Wren (Bot)".
    Clear the avatar+name row, then redraw it as "David", re-centred - the
    shorter name would otherwise sit off-axis in the card."""
    avatar = im.crop((444, 768, 568, 872))
    d = ImageDraw.Draw(im)
    for y in range(762, 880):  # row-by-row: the card background is a soft gradient
        d.line((336, y, 954, y), fill=im.getpixel((300, y)))
    font = ImageFont.truetype(ARIAL_BOLD, 48)
    group_w = 124 + 6 + d.textlength("David", font=font)
    x0 = round(645 - group_w / 2)
    im.paste(avatar, (x0, 768))
    d.text((x0 + 130, 820), "David", font=font, fill=(255, 255, 255), anchor="lm")
    return im


def screen_card(name: str, top: int) -> Image.Image:
    src = Image.open(SHOTS / name).convert("RGB")
    if name == "04-auction.png":
        # The band starts above the window's top row (300) so the mask's
        # feathered top edge fades outside the frame; the rows where the
        # mirror would garble the progress bar (~278-295) are also cropped away.
        erase_back_button(src, y0=250)
        rename_wren(src)
    window = src.crop((0, top, RAW_W, top + WINDOW_H))
    return window.resize((W, H), Image.LANCZOS)


def brand_card() -> Image.Image:
    """Duck, one line, the URL as an ink-framed amber bar. Nothing else."""
    im = Image.new("RGB", (W, H), CREAM)
    d = ImageDraw.Draw(im)

    duck = Image.open(ASSETS / "duck-wave.png").convert("RGB").resize((470, 470), Image.LANCZOS)
    im.paste(duck, ((W - 470) // 2, 80))  # flat render on the same cream - no keying needed

    d.text((W / 2, 646), "Fast & Fun", font=fredoka(88), fill=INK, anchor="mm")
    d.text((W / 2, 742), "Mini-games", font=fredoka(88), fill=INK, anchor="mm")

    bw, bh = 720, 128
    bx0, by0 = (W - bw) // 2, 850
    bx1, by1 = bx0 + bw, by0 + bh
    d.rounded_rectangle((bx0 + 14, by0 + 14, bx1 + 14, by1 + 14), 24, fill=INK)
    d.rounded_rectangle((bx0, by0, bx1, by1), 24, fill=AMBER, outline=INK, width=6)
    d.text(((bx0 + bx1) / 2, (by0 + by1) / 2), "quicklegame.com", font=fredoka(60), fill=INK, anchor="mm")
    return im


def full_screen(name: str) -> Image.Image:
    src = Image.open(SHOTS / name).convert("RGB")
    if name == "07-flying-bomb.png":  # the only full screen whose button sits on plain background
        erase_back_button(src)
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
