"""One-off asset pipeline: derive every store/app icon from the waving duck.

Run:  uv run --with pillow python3 scripts/generate-app-assets.py   (from frontend/)

Source: assets/duck-wave-source.png — 2048x2048, flat cream background,
duck with dark-brown outline, small white Gemini watermark near the
bottom-right corner. The background is OPAQUE (checkerboard-style fake
transparency was already debunked for the avatar sheets — same here).

Note: the committed source, despite its .png extension, was actually saved
as a JPEG (PIL doesn't care — it sniffs real content, not the extension).
Step 0 below re-encodes it as a true, compressed PNG after watermark
cleanup so the committed asset is honest about its format and much
smaller. JPEG compression also blurs the duck's outline against the cream
background by a few pixels, which is why the flood-fill tolerance below is
looser than it would need to be for a lossless source.
"""
from pathlib import Path
from PIL import Image, ImageOps, ImageFilter

ASSETS = Path(__file__).resolve().parent.parent / "assets"
SRC = ASSETS / "duck-wave-source.png"
CREAM = (255, 248, 225)   # #FFF8E1 — app cream
DARK = (15, 23, 42)       # #0f172a — app dark

src_bytes_before = SRC.stat().st_size

src = Image.open(SRC).convert("RGBA")
W, H = src.size
px = src.load()

# --- Step 1: Erase the watermark: sample the true background color from a
# corner, then flat-fill the entire bottom-right 20% quadrant with it.
#
# The brief's original approach compared each pixel to pure white
# (255, 255, 255) within a tolerance, on the theory that the watermark is
# "near-white". Measured against the actual pixels, the sparkle is not
# white at all — it's a soft warm-cream highlight only ~2-10/255 brighter
# than the surrounding cream background (e.g. background (253,246,217) vs.
# sparkle core (255,249,227) — the blue channel alone differs by only 10,
# its distance to true white is ~28), and it fades out gradually rather
# than having a hard edge. Neither a near-white test nor a tolerance-based
# "deviation from background" test cleanly separates that soft gradient
# from ordinary JPEG background noise (checked tol 4-15 by hand: anything
# tight enough to leave no visible residual of the sparkle also starts
# flagging scattered noise pixels elsewhere in the quadrant). A full scan
# of the bottom-right 20% quadrant confirms the duck never reaches into
# it (max deviation from background outside the sparkle's own ~93x95px
# bounding box is 0 — every deviation >15 sits inside
# (1761,1760)-(1854,1855)), so it's safe to just flatten the whole
# quadrant to the sampled background color instead of trying to detect
# the sparkle pixel-by-pixel.
bg = px[40, 40][:3]
def near(c, t, tol):
    return all(abs(c[i] - t[i]) <= tol for i in range(3))
for y in range(int(H * 0.80), H):
    for x in range(int(W * 0.80), W):
        px[x, y] = (*bg, 255)

# --- Step 2 (brief calls this "step 0" — it must run before background
# removal, straight after watermark cleanup): re-encode the committed
# source as a true, compressed PNG now that
# the watermark is gone. This runs on a COPY of the cleaned full-color RGBA
# data, taken before background removal/palette work touches anything, so
# the committed file stays full color (no quantization artifacts leak into
# the icons generated below, which continue from the original `src`).
# A straight 256-color quantize of the JPEG-sourced pixels came out LARGER
# than the original (1.58MB) because JPEG block noise inflates the color
# count enough to defeat PNG's DEFLATE pass. A median filter first knocks
# out that noise (flat cartoon art has none of its own to lose — verified
# by eye at 1:1 on the face) so the palette pass actually pays off.
#
# Guarded by file size so the script stays safely re-runnable: SRC starts
# as a ~1.3MB mislabeled JPEG and this step brings it to ~300KB. Without
# the guard, running the script again would treat that already-quantized
# ~300KB PNG as fresh input and re-median-filter + re-quantize it, losing
# a little more fidelity each pass (observed: a second blind pass took it
# 309KB -> 205KB with visible extra softening). Skipping the step once the
# file is already compact makes every run after the first a no-op here.
REENCODE_THRESHOLD = 600_000  # bytes; comfortably between "compact" (~300KB) and "raw" (~1.3MB)
if src_bytes_before > REENCODE_THRESHOLD:
    denoised = src.copy().convert("RGB").filter(ImageFilter.MedianFilter(size=9))
    quantized = denoised.quantize(colors=64, method=Image.MEDIANCUT, dither=Image.Dither.NONE)
    quantized.save(SRC, optimize=True)
    src_bytes_after = SRC.stat().st_size
    print(f"source re-encoded: {src_bytes_before:,} -> {src_bytes_after:,} bytes "
          f"({src_bytes_after / src_bytes_before:.1%} of original)")
else:
    print(f"source already compact ({src_bytes_before:,} bytes) — skipping re-encode")

# --- Step 3: Background removal by edge flood-fill (NOT global chroma-key: the
# duck's eye-whites must survive). BFS from the four corners over pixels
# within tolerance of the sampled background color; everything reached is
# made transparent.
from collections import deque
TOL = 40  # raised from 26: JPEG compression blurs a few px of background
          # fringe into the outline; 26 left a faint cream halo around the
          # duck, 40 clears it without eating into the outline or eye-whites.
visited = bytearray(W * H)
q = deque([(0, 0), (W - 1, 0), (0, H - 1), (W - 1, H - 1)])
while q:
    x, y = q.popleft()
    if x < 0 or y < 0 or x >= W or y >= H or visited[y * W + x]:
        continue
    visited[y * W + x] = 1
    c = px[x, y]
    if not near(c[:3], bg, TOL):
        continue
    px[x, y] = (0, 0, 0, 0)
    q.extend(((x + 1, y), (x - 1, y), (x, y + 1), (x, y - 1)))
duck = src  # RGBA, transparent background, watermark gone

# Tight bbox of the duck for centering
bbox = duck.getbbox()
duck_c = duck.crop(bbox)

def on_canvas(size, bg_rgba, duck_scale):
    """Duck centered on a square canvas at duck_scale of the canvas height."""
    canvas = Image.new("RGBA", (size, size), bg_rgba)
    target_h = int(size * duck_scale)
    ratio = target_h / duck_c.height
    d = duck_c.resize((int(duck_c.width * ratio), target_h), Image.LANCZOS)
    canvas.alpha_composite(d, ((size - d.width) // 2, (size - d.height) // 2))
    return canvas

# --- Step 4: Outputs
# Cleaned full-frame duck (opaque cream) for web/marketing reuse
on_canvas(1024, (*CREAM, 255), 0.86).convert("RGB").save(ASSETS / "duck-wave.png")
# iOS light icon: opaque, no alpha channel (Apple rejects transparency)
on_canvas(1024, (*CREAM, 255), 0.82).convert("RGB").save(ASSETS / "app-icon.png")
# iOS dark icon: dark bg (Apple composes its own rounding)
on_canvas(1024, (*DARK, 255), 0.82).convert("RGB").save(ASSETS / "app-icon-dark.png")
# iOS tinted icon: grayscale content on TRANSPARENT bg (per Apple spec)
tint = on_canvas(1024, (0, 0, 0, 0), 0.82)
gray = ImageOps.grayscale(tint)
tinted = Image.merge("RGBA", (*[gray] * 3, tint.split()[3]))
tinted.save(ASSETS / "app-icon-tinted.png")
# Android adaptive foreground: transparent, duck inside the 66% safe zone
on_canvas(1024, (0, 0, 0, 0), 0.60).save(ASSETS / "adaptive-icon.png")
# Android 13+ monochrome: solid-white silhouette from the alpha channel
mono_src = on_canvas(1024, (0, 0, 0, 0), 0.60)
alpha = mono_src.split()[3]
white = Image.new("RGBA", mono_src.size, (255, 255, 255, 0))
white.putalpha(alpha)
white.save(ASSETS / "adaptive-icon-monochrome.png")
# Splash: transparent duck, generous margins (plugin scales with `contain`)
on_canvas(1024, (0, 0, 0, 0), 0.55).save(ASSETS / "splash-icon.png")
print("done:", [p.name for p in sorted(ASSETS.glob('app-icon*'))])
