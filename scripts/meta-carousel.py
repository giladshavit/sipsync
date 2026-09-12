# /// script
# requires-python = ">=3.12"
# dependencies = ["pillow>=10", "numpy>=2"]
# ///
"""Meta / Instagram carousel cards for the Quickle ad test (option 1).

    uv run scripts/meta-carousel.py

Writes 1080x1080 (1:1) PNGs to docs/marketing/carousel/option-1-games-taste/
- Meta renders carousel cards square in most placements - plus the whole
screens (status bar off, native 1290x2646) to docs/marketing/screens/ for
placements that fit a full phone screen. Card 1 is the brand card; the
games card re-lays all 15 catalog tiles as a grid; the room card is the
lobby retouched to three players and four uncut game tiles; the 21,
roulette and sacrifice cards are recomposed - every meaningful element of
the screen, individually shrunk to fit the square - and the auction and
bomb cards stay plain windows. No captions, no phone frame, nothing that
reads as an ad, and nothing on any card hints at alcohol.
"""

from __future__ import annotations

from pathlib import Path

import numpy as np
from PIL import Image, ImageDraw, ImageFilter, ImageFont

REPO = Path(__file__).resolve().parent.parent
SHOTS = REPO / "docs/store/screenshots/iphone/en-US"
FLOW_SHOTS = REPO / "docs/marketing/carousel/option-2-game-flow/shots"  # catalog tiles + extra players
ASSETS = REPO / "frontend/assets"
OUT = REPO / "docs/marketing/carousel/option-1-games-taste"
OUT_FULL = REPO / "docs/marketing/screens"  # the same captures whole (status bar off), native size
STATUS_BAR_PX = 150  # of a 1290x2796 capture: the clock, signal and battery

W = 1080
CREAM = (0xFF, 0xF8, 0xE1)
INK = (0x0A, 0x0A, 0x0F)
AMBER = (0xF5, 0x9E, 0x0B)

FREDOKA = REPO / "docs/marketing/fonts/Fredoka-Variable.ttf"  # the brand's display face (OFL)
ARIAL_BOLD = "/System/Library/Fonts/Supplemental/Arial Bold.ttf"  # matches the app's in-UI sans
SFNS = "/System/Library/Fonts/SFNS.ttf"  # the system face the app itself renders with


def fredoka(size: int, weight: int = 700) -> ImageFont.FreeTypeFont:
    f = ImageFont.truetype(str(FREDOKA), size)
    f.set_variation_by_axes([weight, 100])  # the file's axes: wght, wdth
    return f


def sf(size: int, bold: bool = True) -> ImageFont.FreeTypeFont:
    try:
        f = ImageFont.truetype(SFNS, size)
        f.set_variation_by_name("Bold" if bold else "Semibold")
        return f
    except OSError:
        return ImageFont.truetype(ARIAL_BOLD, size)


RAW_W = 1290
WINDOW_H = 1290  # capture rows a 1:1 card shows at full width


def fpaste(im: Image.Image, piece: Image.Image, pos: tuple[int, int], scale: float = 1.0, feather: int = 10) -> int:
    """Paste a capture element with softly feathered edges so its local
    background melts into the card's recreated one. Returns the height."""
    if scale != 1.0:
        piece = piece.resize((round(piece.width * scale), round(piece.height * scale)), Image.LANCZOS)
    mask = Image.new("L", piece.size, 0)
    ImageDraw.Draw(mask).rounded_rectangle(
        (feather, feather, piece.width - feather, piece.height - feather), feather, fill=255)
    im.paste(piece, pos, mask.filter(ImageFilter.GaussianBlur(feather / 2)))
    return piece.height


def centered(im: Image.Image, piece_w: int) -> int:
    return (W - piece_w) // 2


def cpaste(im: Image.Image, src: Image.Image, center: tuple[int, int], radius: int,
           dest_center: tuple[int, int], scale: float, feather: int = 25) -> None:
    """Circular feathered paste - for round elements with halos, whose
    rectangular crop corners would read as a shadow box."""
    cx, cy = center
    piece = src.crop((cx - radius, cy - radius, cx + radius, cy + radius))
    size = round(2 * radius * scale)
    piece = piece.resize((size, size), Image.LANCZOS)
    mask = Image.new("L", (size, size), 0)
    ImageDraw.Draw(mask).ellipse((feather, feather, size - feather, size - feather), fill=255)
    im.paste(piece, (dest_center[0] - size // 2, dest_center[1] - size // 2),
             mask.filter(ImageFilter.GaussianBlur(feather / 2)))


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


# ------------------------------------------------------------- brand card

def brand_card() -> Image.Image:
    """Duck, one line, the URL as an ink-framed amber bar. Nothing else."""
    im = Image.new("RGB", (W, W), CREAM)
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


# ------------------------------------------------------------- games grid
# Tile geometry of the option-2 catalog captures (1179 wide) - kept in
# sync with scripts/meta-carousel-flow.py.

TILE_TOP_ROWS = [(594, 1107), (1137, 1650), (1680, 2193)]
TILE_BOT_ROWS = [(1326, 1839), (1869, 2382)]
TILE_COLS = [(60, 393), (423, 756), (786, 1119)]


def fix_prisoners_label(tile: Image.Image) -> None:
    """The app wraps the tile label as "PRISONER' / S DILEMMA". Recompose
    the app's own glyphs: the stray S joins line one, both lines re-centre."""
    g = tile.convert("L")
    px = g.load()
    bands: list[list[int]] = []
    for y in range(330, 505):
        if sum(1 for x in range(12, 321) if px[x, y] < 90) >= 3:
            if bands and y - bands[-1][1] <= 6:
                bands[-1][1] = y
            else:
                bands.append([y, y])
    (t1, b1), (t2, b2) = bands[0], bands[1]

    def clusters(top: int, bot: int) -> list[list[int]]:
        out: list[list[int]] = []
        for x in range(12, 321):
            if any(px[x, y] < 90 for y in range(top, bot + 1)):
                if out and x - out[-1][1] <= 9:
                    out[-1][1] = x
                else:
                    out.append([x, x])
        return out

    line1, line2 = clusters(t1, b1), clusters(t2, b2)
    part1 = tile.crop((line1[0][0] - 1, t1 - 2, line1[-1][1] + 2, b1 + 3))
    s = tile.crop((line2[0][0] - 1, t2 - 2, line2[0][1] + 2, b2 + 3))
    rest = tile.crop((line2[1][0] - 1, t2 - 2, line2[-1][1] + 2, b2 + 3))
    ImageDraw.Draw(tile).rectangle((5, 326, 328, 508), fill=tile.getpixel((14, 420)))
    w1 = part1.width + 2 + s.width
    x1 = round(166 - w1 / 2)
    tile.paste(part1, (x1, t1 - 2))
    tile.paste(s, (x1 + part1.width + 2, t1 - 2 + (part1.height - s.height)))
    tile.paste(rest, (round(166 - rest.width / 2), t2 - 2))


def games_card() -> Image.Image:
    """All 15 catalog tiles as a 5x3 grid on cream, full square. The
    bottom row is shuffled so no tile sits under a same-coloured one."""
    a = Image.open(FLOW_SHOTS / "03-games-top.png").convert("RGB")
    b = Image.open(FLOW_SHOTS / "04-games-bottom.png").convert("RGB")
    tiles = [a.crop((x0, y0, x1, y1)) for (y0, y1) in TILE_TOP_ROWS for (x0, x1) in TILE_COLS]
    tiles += [b.crop((x0, y0, x1, y1)) for (y0, y1) in TILE_BOT_ROWS for (x0, x1) in TILE_COLS]
    fix_prisoners_label(tiles[7])
    order = list(range(10)) + [11, 14, 13, 10, 12]

    tw = 190
    th = round(tw * 513 / 333)
    gap_x, gap_y = 20, 24
    pad_x = (W - 5 * tw - 4 * gap_x) // 2
    pad_y = (W - 3 * th - 2 * gap_y) // 2
    im = Image.new("RGB", (W, W), CREAM)
    for i, idx in enumerate(order):
        r, c = divmod(i, 5)
        im.paste(tiles[idx].resize((tw, th), Image.LANCZOS), (pad_x + c * (tw + gap_x), pad_y + r * (th + gap_y)))
    return im


# -------------------------------------------------------------- room card

def room_card() -> Image.Image:
    """The lobby, retouched: "4 GAMES TONIGHT" with four uncut re-centred
    tiles (the fifth was clipped by the screen edge), the two truncated
    tile labels wrapped to two lines, and jordan + Jack joining the host
    (their blocks come from the option-2 lobby capture - same cream)."""
    src = Image.open(SHOTS / "01-room.png").convert("RGB")
    d = ImageDraw.Draw(src)

    # 7 -> 4 in "7 GAMES TONIGHT"
    digit = src.crop((66, 904, 102, 936))
    color = min(((digit.getpixel((x, y)), x, y) for x in range(digit.width) for y in range(digit.height)),
                key=lambda t: sum(t[0]))[0]
    d.rectangle((66, 900, 102, 940), fill=CREAM)
    d.text((84, 920), "4", font=sf(36), fill=color, anchor="mm")

    # drop the clipped fifth tile, re-centre the four whole ones
    band = src.crop((80, 985, 1050, 1240))
    d.rectangle((60, 985, 1290, 1275), fill=CREAM)
    src.paste(band, (161, 985))

    # two-line labels for the two the app truncated (after the +81 shift)
    label_color = (0x0A, 0x0A, 0x0F)
    for cx, lines in ((601 + 91 + 81, ("Human", "Timer")), ((857 + 1039) // 2 + 81, ("Russian", "Roulette"))):
        d.rectangle((cx - 115, 1196, cx + 115, 1240), fill=CREAM)
        f = sf(33)
        d.text((cx, 1214), lines[0], font=f, fill=label_color, anchor="mm")
        d.text((cx, 1256), lines[1], font=f, fill=label_color, anchor="mm")

    # jordan and Jack join the host, and the host block itself becomes
    # campaign 2's "Gil" (same pig, pencil and HOST label, shorter name)
    lobby2 = Image.open(FLOW_SHOTS / "01-lobby.png").convert("RGB")
    k = RAW_W / 1179
    d.rectangle((420, 1395, 870, 1815), fill=CREAM)
    gil = lobby2.crop((197, 1315, 439, 1650))
    gil = gil.resize((round(gil.width * k), round(gil.height * k)), Image.LANCZOS)
    src.paste(gil, (645 - gil.width // 2, 1436))
    for (x0, x1), px in (((473, 706), 180), ((749, 982), 838)):
        block = lobby2.crop((x0, 1320, x1, 1620))
        block = block.resize((round(block.width * k), round(block.height * k)), Image.LANCZOS)
        src.paste(block, (px, 1445))

    window = src.crop((0, 520, RAW_W, 520 + WINDOW_H))
    return window.resize((W, W), Image.LANCZOS)


# ----------------------------------------------------------- auction card

def rename_wren(im: Image.Image) -> Image.Image:
    """The auction capture's highest bidder is a dev-room bot, "Wren (Bot)".
    Clear the avatar+name row, then redraw it as "David", re-centred."""
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


def auction_card() -> Image.Image:
    src = Image.open(SHOTS / "04-auction.png").convert("RGB")
    # The band starts above the window's top row (300) so the mask's
    # feathered top edge fades outside the frame; the rows where the
    # mirror would garble the progress bar (~278-295) are also cropped away.
    erase_back_button(src, y0=250)
    rename_wren(src)
    # Erase the custom-bid panel poking into the window: the glow band
    # just above its border (row 1440) is one flat colour full-width.
    ImageDraw.Draw(src).rectangle((0, 1441, RAW_W, 1620), fill=src.getpixel((645, 1440)))
    return src.crop((0, 300, RAW_W, 300 + WINDOW_H)).resize((W, W), Image.LANCZOS)


# ------------------------------------------------- recomposed game cards

def twenty_one_card() -> Image.Image:
    """Radial purple like the screen's own, with every element of the 21
    round shrunk to fit: turn header, counter ring, the +1/+2/+3 buttons."""
    src = Image.open(SHOTS / "05-twenty-one.png").convert("RGB")
    yy, xx = np.mgrid[0:W, 0:W].astype(float)
    dist = np.clip(np.sqrt((xx - 540) ** 2 + ((yy - 430) * 1.15) ** 2) / 950, 0, 1)[..., None]
    inner, outer = np.array((42, 27, 50)), np.array((26, 12, 29))
    im = Image.fromarray((inner * (1 - dist) + outer * dist).astype(np.uint8))
    header = src.crop((370, 255, 905, 705))
    fpaste(im, header, (centered(im, round(535 * 0.8)), 28), scale=0.8)
    # the ring gets a wide circular mask - a rectangular crop's corners
    # read as a shadow box. The YOUR TURN caption below the ring is erased
    # first so the bigger radius (which buys a long soft feather) can
    # sweep over where it stood.
    de = ImageDraw.Draw(src)
    for x in range(460, 830):
        de.line((x, 1836, x, 1930), fill=src.getpixel((x, 1826)))
    cpaste(im, src, (645, 1421), 500, (540, 600), scale=0.40, feather=42)
    buttons = src.crop((35, 2205, 1255, 2560))
    fpaste(im, buttons, (centered(im, round(1220 * 0.78)), 782), scale=0.78)
    return im


def roulette_card() -> Image.Image:
    """Flat brown like the screen's own: turn queue, points, all six
    cards, and the skip choice - the whole round at a glance."""
    src = Image.open(SHOTS / "06-roulette.png").convert("RGB")
    im = Image.new("RGB", (W, W), (34, 30, 26))
    avatars = src.crop((340, 320, 950, 640))
    fpaste(im, avatars, (centered(im, round(610 * 0.8)), 22), scale=0.8)
    points = src.crop((470, 940, 820, 1030))
    fpaste(im, points, (centered(im, round(350 * 0.9)), 300), scale=0.9)
    cards = src.crop((55, 1080, 1235, 2215))
    fpaste(im, cards, (centered(im, round(1180 * 0.46)), 400), scale=0.46)
    # the capture's SKIP (-5) is in its greyed mid-round state; rebuild it
    # enabled - amber, ink border - stamping the original icon+text glyphs
    btn_src = src.crop((285, 2359, 1010, 2513))
    glyphs = btn_src.convert("L").point(lambda v: 255 if v > 90 else 0)
    btn = Image.new("RGB", btn_src.size, (34, 30, 26))
    bd = ImageDraw.Draw(btn)
    bd.rounded_rectangle((3, 3, btn.width - 4, btn.height - 4), 26, fill=AMBER, outline=INK, width=5)
    btn.paste(Image.new("RGB", btn.size, INK), (0, 0), glyphs)
    btn = btn.resize((round(btn.width * 0.72), round(btn.height * 0.72)), Image.LANCZOS)
    im.paste(btn, (centered(im, btn.width), 950))
    return im


def sf_heavy(size: int) -> ImageFont.FreeTypeFont:
    try:
        f = ImageFont.truetype(SFNS, size)
        f.set_variation_by_name("Heavy")
        return f
    except OSError:
        return sf(size)


def sacrifice_card() -> Image.Image:
    """Flat cream like the screen's own: the timer ring, the chaser count
    (raised to 2), the I'M IN button and the WHO'S IN row."""
    src = Image.open(SHOTS / "03-sacrifice.png").convert("RGB")
    d = ImageDraw.Draw(src)

    # 1 -> 2 chasers, and the label grows an S to match
    label_color = min(((src.getpixel((x, y))) for x in range(470, 820) for y in range(1390, 1425)),
                      key=sum)
    d.rectangle((520, 1050, 770, 1335), fill=(255, 248, 225))
    d.text((645, 1194), "2", font=sf_heavy(320), fill=INK, anchor="mm")
    d.rectangle((380, 1378, 910, 1437), fill=(255, 248, 225))
    font = sf(34)
    text, tracking = "CHASERS TO GO", 7
    widths = [d.textlength(c, font=font) for c in text]
    x = 645 - (sum(widths) + tracking * (len(text) - 1)) / 2
    for c, cw in zip(text, widths):
        d.text((x, 1407), c, font=font, fill=label_color, anchor="lm")
        x += cw + tracking

    im = Image.new("RGB", (W, W), (255, 248, 225))
    ring = src.crop((495, 395, 800, 700))
    fpaste(im, ring, (centered(im, round(305 * 0.65)), 25), scale=0.65)
    one = src.crop((370, 1050, 915, 1440))
    fpaste(im, one, (centered(im, round(545 * 0.68)), 243), scale=0.68)
    # circular mask for I'M IN - its glow halo would band at a rect crop's sides
    cpaste(im, src, (652, 1775), 290, (540, 681), scale=0.56, feather=30)
    whos = src.crop((60, 2160, 1230, 2430))
    fpaste(im, whos, (centered(im, round(1170 * 0.8)), 850), scale=0.8)
    return im


def bomb_card() -> Image.Image:
    src = Image.open(SHOTS / "07-flying-bomb.png").convert("RGB")
    return src.crop((0, 580, RAW_W, 580 + WINDOW_H)).resize((W, W), Image.LANCZOS)


FULL_SCREENS = ["02-games.png", "01-room.png", "04-auction.png", "05-twenty-one.png",
                "06-roulette.png", "03-sacrifice.png", "07-flying-bomb.png"]


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
    for i, n in enumerate(FULL_SCREENS, start=2):
        path = OUT_FULL / f"{i:02d}-{Path(n).stem[3:]}.png"
        full_screen(n).save(path, optimize=True)
        print(path.relative_to(REPO))
    cards = [("01-brand", brand_card()), ("02-games", games_card()), ("03-room", room_card()),
             ("04-auction", auction_card()), ("05-twenty-one", twenty_one_card()),
             ("06-roulette", roulette_card()), ("07-sacrifice", sacrifice_card()),
             ("08-flying-bomb", bomb_card())]
    for slug, im in cards:
        path = OUT / f"{slug}.png"
        im.save(path, optimize=True)
        print(path.relative_to(REPO))


if __name__ == "__main__":
    main()
