# /// script
# requires-python = ">=3.12"
# dependencies = ["pillow>=10"]
# ///
"""Option 2 - "game flow" Meta carousel: a walkthrough of one Quickle night.

    uv run scripts/meta-carousel-flow.py

Writes 1080x1080 cards to docs/marketing/carousel/option-2-game-flow/ from
the captures in .../option-2-game-flow/shots/ (1179x2556). Unlike option 1
(clean screens, no words), every card here carries a short caption - the
carousel reads as a story: create -> pick a game -> win -> losers drink ->
podium. The join screen was cut as too technical. The round and drinks
cards are recomposed on a uniform background (the screen's own green /
the brand cream) rather than cropped whole; the podium is retouched into
a representative 10 / 7 / 5 with a bronze third place. Captions never
mention alcohol; the drinking is only ever shown through the app's own UI.
"""

from __future__ import annotations

from pathlib import Path

from PIL import Image, ImageDraw, ImageFont

REPO = Path(__file__).resolve().parent.parent
SRC = REPO / "docs/marketing/carousel/option-2-game-flow/shots"
OUT = REPO / "docs/marketing/carousel/option-2-game-flow"
BRAND_CARD = REPO / "docs/marketing/carousel/option-1-games-taste/01-brand.png"

W = 1080
RAW_W = 1179  # these captures are 1179x2556
CREAM = (0xFF, 0xF8, 0xE1)
INK = (0x0A, 0x0A, 0x0F)
BRONZE = (205, 127, 50)

FREDOKA = REPO / "docs/marketing/fonts/Fredoka-Variable.ttf"
SFNS = "/System/Library/Fonts/SFNS.ttf"  # the system face the app itself renders with
ARIAL_BOLD = "/System/Library/Fonts/Supplemental/Arial Bold.ttf"


def fredoka(size: int, weight: int = 600) -> ImageFont.FreeTypeFont:
    f = ImageFont.truetype(str(FREDOKA), size)
    f.set_variation_by_axes([weight, 100])
    return f


def sf_bold(size: int) -> ImageFont.FreeTypeFont:
    """San Francisco bold - matches the capture's own digits. Arial as a
    fallback if the variable axes ever change."""
    try:
        f = ImageFont.truetype(SFNS, size)
        f.set_variation_by_name("Bold")
        return f
    except OSError:
        return ImageFont.truetype(ARIAL_BOLD, size)


def card(caption: str, strip_h: int, text_size: int, src: Image.Image, top: int) -> Image.Image:
    """A cream caption strip over a full-bleed window of the capture."""
    slot_h = W - strip_h
    crop_h = round(RAW_W * slot_h / W)
    window = src.crop((0, top, RAW_W, top + crop_h)).resize((W, slot_h), Image.LANCZOS)
    im = Image.new("RGB", (W, W), CREAM)
    ImageDraw.Draw(im).multiline_text((W / 2, strip_h / 2 + 4), caption, font=fredoka(text_size),
                                      fill=INK, anchor="mm", align="center", spacing=14)
    im.paste(window, (0, strip_h))
    return im


def col_runs(im: Image.Image, box: tuple[int, int, int, int], dark: int = 90, gap: int = 9) -> list[list[int]]:
    """Clusters of columns holding dark pixels inside box (x0,y0,x1,y1)."""
    g = im.convert("L").crop(box)
    px = g.load()
    out: list[list[int]] = []
    for x in range(g.width):
        if any(px[x, y] < dark for y in range(g.height)):
            ax = x + box[0]
            if out and ax - out[-1][1] <= gap:
                out[-1][1] = ax
            else:
                out.append([ax, ax])
    return out


# ---------------------------------------------------------------- games grid

# Catalog tile geometry (measured off the two captures: 4px ink borders).
TOP_ROWS = [(594, 1107), (1137, 1650), (1680, 2193)]  # rows 1-3 in 03-games-top
BOT_ROWS = [(1326, 1839), (1869, 2382)]  # rows 4-5 in 04-games-bottom
COLS = [(60, 393), (423, 756), (786, 1119)]


def fix_prisoners_label(tile: Image.Image) -> None:
    """The app wraps the tile label as "PRISONER' / S DILEMMA", breaking
    mid-word. Recompose the app's own rendered glyphs: move the stray S up
    to the end of line one and re-centre both lines - no foreign font."""
    # the two text line bands inside the label box (x limits skip the borders)
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
    line1 = col_runs(tile, (12, t1, 321, b1 + 1))
    line2 = col_runs(tile, (12, t2, 321, b2 + 1))
    part1 = tile.crop((line1[0][0] - 1, t1 - 2, line1[-1][1] + 2, b1 + 3))
    s = tile.crop((line2[0][0] - 1, t2 - 2, line2[0][1] + 2, b2 + 3))
    rest = tile.crop((line2[1][0] - 1, t2 - 2, line2[-1][1] + 2, b2 + 3))
    ImageDraw.Draw(tile).rectangle((5, 326, 328, 508), fill=tile.getpixel((14, 420)))
    w1 = part1.width + 2 + s.width
    x1 = round(166 - w1 / 2)
    tile.paste(part1, (x1, t1 - 2))
    tile.paste(s, (x1 + part1.width + 2, t1 - 2 + (part1.height - s.height)))
    tile.paste(rest, (round(166 - rest.width / 2), t2 - 2))


def games_grid(strip_h: int) -> Image.Image:
    """All 15 catalog tiles, re-laid as a 5x3 grid on cream. The bottom
    row is shuffled so no tile sits under a same-coloured one."""
    a = Image.open(SRC / "03-games-top.png").convert("RGB")
    b = Image.open(SRC / "04-games-bottom.png").convert("RGB")
    tiles = [a.crop((x0, y0, x1, y1)) for (y0, y1) in TOP_ROWS for (x0, x1) in COLS]
    tiles += [b.crop((x0, y0, x1, y1)) for (y0, y1) in BOT_ROWS for (x0, x1) in COLS]
    fix_prisoners_label(tiles[7])
    # rows 1-2 keep catalog order; row 3 reordered: flying-bomb, black-box,
    # auction, strong-point, 21 - no green under green, no blue under blue
    order = list(range(10)) + [11, 14, 13, 10, 12]

    slot_h = W - strip_h
    tw = 190
    th = round(tw * 513 / 333)
    gap_x, gap_y = 20, 18
    pad_x = (W - 5 * tw - 4 * gap_x) // 2
    pad_y = (slot_h - 3 * th - 2 * gap_y) // 2
    grid = Image.new("RGB", (W, slot_h), CREAM)
    for i, idx in enumerate(order):
        r, c = divmod(i, 5)
        grid.paste(tiles[idx].resize((tw, th), Image.LANCZOS), (pad_x + c * (tw + gap_x), pad_y + r * (th + gap_y)))
    return grid


# ---------------------------------------------------------------- round card

# White name bands of the round list (measured): rows 2-6, all "(Bot)"s.
ROW_BANDS = [(1209, 1251), (1353, 1389), (1494, 1528), (1635, 1669), (1776, 1810), (1916, 1951)]
RENAMES = [((1345, 1402), 1371, "Emma"), ((1486, 1540), 1511, "Ava"),
           ((1627, 1681), 1652, "Rob"), ((1768, 1822), 1793, "Sam"),
           ((1908, 1963), 1933, "David")]


def bg_extend(im: Image.Image, x0: int, x1: int, y0: int, y1: int, sample_dy: int = 12) -> None:
    """Fill a strip column by column from the pixel just above it - the
    faint WIN watermark crossing the panel survives, a flat fill would not."""
    d = ImageDraw.Draw(im)
    for x in range(x0, x1):
        d.line((x, y0, x, y1), fill=im.getpixel((x, y0 - sample_dy)))


def rename_bots(im: Image.Image) -> None:
    d = ImageDraw.Draw(im)
    font = ImageFont.truetype(ARIAL_BOLD, 47)
    for (y0, y1), cy, name in RENAMES:
        bg_extend(im, 285, 600, y0, y1)
        d.text((300, cy), name, font=font, fill=(255, 255, 255), anchor="lm")


def lowercase_seconds(im: Image.Image) -> None:
    """The times read "1.14S"; the app's tracked caps make the S read as a
    unit shout. Shrink each row's final S to 72% (bottom-aligned) so it
    reads as a lowercase s - the glyph itself stays the app's own."""
    for y0, y1 in ROW_BANDS:
        g = im.crop((1000, y0, 1140, y1 + 1)).convert("L")
        px = g.load()
        cols = []
        for x in range(g.width):
            if any(px[x, y] > 200 for y in range(g.height)):
                ax = x + 1000
                if cols and ax - cols[-1][1] <= 7:
                    cols[-1][1] = ax
                else:
                    cols.append([ax, ax])
        sx0, sx1 = cols[-1]
        ys = [y for y in range(y0, y1 + 1)
              if any(im.getpixel((x, y))[0] > 200 for x in range(sx0, sx1 + 1))]
        sy0, sy1 = ys[0], ys[-1]
        glyph = im.crop((sx0 - 1, sy0 - 1, sx1 + 2, sy1 + 2))
        bg_extend(im, sx0 - 1, sx1 + 2, sy0 - 1, sy1 + 2)
        small = glyph.resize((round(glyph.width * 0.72), round(glyph.height * 0.72)), Image.LANCZOS)
        im.paste(small, (sx0 - 1, sy1 + 2 - small.height))


def round_card() -> Image.Image:
    """Uniform green, the caption in ink, the big "you WIN", and the round
    list panel - six full rows, rounded corners, padding below."""
    src = Image.open(SRC / "05-round-win.png").convert("RGB")
    rename_bots(src)
    lowercase_seconds(src)
    # centre the THIS ROUND header over the panel (the app left-aligns it)
    label = src.crop((124, 1103, 404, 1131))
    bg_extend(src, 124, 404, 1103, 1131)
    src.paste(label, (round((83 + 1094) / 2 - label.width / 2), 1103))
    im = Image.new("RGB", (W, W), src.getpixel((1050, 940)))
    d = ImageDraw.Draw(im)
    d.text((W / 2, 70), "See the results after each round", font=fredoka(48), fill=INK, anchor="mm")
    win = src.crop((330, 355, 890, 700))
    win = win.resize((round(win.width * 0.78), round(win.height * 0.78)), Image.LANCZOS)
    im.paste(win, ((W - win.width) // 2, 120))
    panel = src.crop((83, 1075, 1094, 2020))  # sliced in the clean gap under row six
    scale = 0.64
    panel = panel.resize((round(panel.width * scale), round(panel.height * scale)), Image.LANCZOS)
    mask = Image.new("L", panel.size, 0)
    ImageDraw.Draw(mask).rounded_rectangle((0, 0, panel.width - 1, panel.height - 1), 16, fill=255)
    im.paste(panel, ((W - panel.width) // 2, 425), mask)
    return im


# --------------------------------------------------------------- drinks card

def drinks_card() -> Image.Image:
    """Brand cream, the caption, and only the relevant pieces of the Stats
    popup: the THIS ROUND / TOTAL toggle and the two drinker rows - no
    modal frame, no Stats title, no first toggle, no button."""
    src = Image.open(SRC / "07-drinks.png").convert("RGB")
    im = Image.new("RGB", (W, W), CREAM)
    d = ImageDraw.Draw(im)
    d.text((W / 2, 70), "Losers pay the price", font=fredoka(50), fill=INK, anchor="mm")
    pieces = [(183, 1096, 1000, 1192), (183, 1226, 1000, 1382), (183, 1400, 1000, 1556)]
    y = 290
    for x0, y0, x1, y1 in pieces:
        p = src.crop((x0, y0, x1, y1))
        im.paste(p, ((W - p.width) // 2, y))
        y += p.height + 55
    return im


# --------------------------------------------------------------- podium card

def retouch_podium(im: Image.Image) -> None:
    """Make the podium representative: winner name without the trailing
    dot, 7 points for second, 5 for third, third's column in bronze."""
    d = ImageDraw.Draw(im)
    cream = im.getpixel((589, 1965))

    # "Gil ." -> "Gil", re-centred over the winner column
    gil = im.crop((543, 1175, 603, 1220))
    d.rectangle((530, 1173, 650, 1222), fill=cream)
    im.paste(gil, (round(589 - gil.width / 2), 1175))

    # side scores: clear the "-10"s (the names' descenders end above 1362),
    # write 7 and 5 in the system face
    font = sf_bold(50)
    for cx, score in ((248, "7"), (939, "5")):
        d.rectangle((cx - 75, 1362, cx + 75, 1418), fill=cream)
        d.text((cx, 1388), score, font=font, fill=INK, anchor="mm")

    # third place's column turns bronze: replace its grey fill wherever it
    # appears in the column's box - borders and edges survive untouched
    grey = im.getpixel((960, 1600))
    px = im.load()
    for y in range(1440, 1850):
        for x in range(755, 1140):
            c = px[x, y]
            if abs(c[0] - grey[0]) + abs(c[1] - grey[1]) + abs(c[2] - grey[2]) < 15:
                px[x, y] = BRONZE

    # ...and sits lower than silver: the column top is cut back first,
    # then the label block follows it down - this order, or the cut
    # erases the relocated label
    drop = 98
    borders = col_runs(im, (750, 1600, 1160, 1700), dark=80)
    bx0, bx1 = borders[0][0], borders[-1][1]
    d.rectangle((bx0, 1438, bx1, 1442 + drop), fill=cream)
    d.rectangle((bx0, 1442 + drop, bx1, 1447 + drop), fill=INK)
    block = im.crop((845, 1135, 1035, 1425))
    d.rectangle((845, 1135, 1035, 1425), fill=cream)
    im.paste(block, (845, 1135 + drop))


def main() -> None:
    for stale in OUT.glob("0*.png"):
        stale.unlink()

    Image.open(BRAND_CARD).save(OUT / "01-cover.png", optimize=True)

    lobby = Image.open(SRC / "01-lobby.png").convert("RGB")
    card("Create & share a room link", 130, 50, lobby, 1190).save(OUT / "02-create.png", optimize=True)

    grid_im = Image.new("RGB", (W, W), CREAM)
    ImageDraw.Draw(grid_im).text((W / 2, 69), "Pick any game you like", font=fredoka(50), fill=INK, anchor="mm")
    grid_im.paste(games_grid(130), (0, 130))
    grid_im.save(OUT / "03-games.png", optimize=True)

    round_card().save(OUT / "04-round.png", optimize=True)
    drinks_card().save(OUT / "05-drinks.png", optimize=True)

    podium = Image.open(SRC / "06-podium.png").convert("RGB")
    # blank the EDIT GAMES / END NIGHT row - flat cream background there
    ImageDraw.Draw(podium).rectangle((0, 2005, RAW_W, 2245), fill=podium.getpixel((589, 1965)))
    retouch_podium(podium)
    card("The night's podium\nOn to the next round!", 170, 44, podium, 907).save(OUT / "06-podium.png", optimize=True)

    for p in sorted(OUT.glob("0*.png")):
        print(p.relative_to(REPO))


if __name__ == "__main__":
    main()
