# /// script
# requires-python = ">=3.12"
# dependencies = ["google-auth>=2.30", "requests>=2.32", "pyjwt>=2.9", "cryptography>=43"]
# ///
"""Push the Google Play store listing from the docs into the Play Console.

    uv run scripts/play-push-listing.py            # dry run
    uv run scripts/play-push-listing.py --apply    # write and commit the edit

Text comes from docs/store/ios-app-store-listing.md (full descriptions, shared
with iOS so the stores say the same thing) and docs/store/play-store-listing.md
(the 80-char short descriptions). Graphics come from docs/store/play/, produced
by scripts/play-assets.py.

Auth: the play-publisher service account key, PLAY_SERVICE_ACCOUNT_KEY
(default ~/.appstoreconnect/play-service-account.json). Never in the repo.

Writes: store listing (title, short + full description) for en-US and he-IL;
icon, feature graphic and phone screenshots on en-US (Play falls back to the
default language's images for locales without their own); contact email and
website. What stays manual: category, the App content questionnaires, and
anything under Store settings.
"""

from __future__ import annotations

import argparse
import importlib.util
import os
import re
import sys
import time
from pathlib import Path

import requests
from google.auth.transport.requests import Request
from google.oauth2 import service_account

REPO = Path(__file__).resolve().parent.parent
PLAY_DOC = REPO / "docs/store/play-store-listing.md"
GRAPHICS = REPO / "docs/store/play"
PACKAGE = "com.quicklegame.app"
API = f"https://androidpublisher.googleapis.com/androidpublisher/v3/applications/{PACKAGE}"
UPLOAD = f"https://androidpublisher.googleapis.com/upload/androidpublisher/v3/applications/{PACKAGE}"

TITLE = "Quickle Party Game"
CONTACT = {"contactEmail": "giladshavit1@gmail.com", "contactWebsite": "https://www.quicklegame.com"}
# iOS listing locale -> Play locale
LOCALES = {"en-US": "en-US", "he": "he-IL"}
LIMITS = {"title": 30, "shortDescription": 80, "fullDescription": 4000}


def ios_listing() -> dict:
    """Reuse the iOS tool's markdown parser for the shared full descriptions
    (importing it needs its deps too, hence pyjwt/cryptography above)."""
    spec = importlib.util.spec_from_file_location("asc", REPO / "scripts/asc-push-metadata.py")
    mod = importlib.util.module_from_spec(spec)
    assert spec.loader
    spec.loader.exec_module(mod)
    return mod.load_listing()


def short_descriptions() -> dict[str, str]:
    md = PLAY_DOC.read_text(encoding="utf-8")
    rows = re.findall(r"^\| Short description \(80\) \| `([^`]+)`", md, re.M)
    if len(rows) != 2:
        sys.exit("play doc: expected two 'Short description (80)' rows (English, then Hebrew)")
    return {"en-US": rows[0], "he": rows[1]}


def build_listings() -> dict[str, dict[str, str]]:
    ios = ios_listing()
    shorts = short_descriptions()
    out = {}
    for src, play in LOCALES.items():
        out[play] = {
            "language": play,
            "title": TITLE,
            "shortDescription": shorts[src],
            "fullDescription": ios["locales"][src]["description"],
        }
    bad = [f"{loc}/{k}: {len(v)} > {LIMITS[k]}" for loc, l in out.items() for k, v in l.items() if k in LIMITS and len(v) > LIMITS[k]]
    if bad:
        sys.exit("over Google's limits:\n  " + "\n  ".join(bad))
    return out


class Play:
    def __init__(self, key_path: Path, apply: bool) -> None:
        creds = service_account.Credentials.from_service_account_file(
            str(key_path), scopes=["https://www.googleapis.com/auth/androidpublisher"]
        )
        creds.refresh(Request())
        self._h = {"Authorization": f"Bearer {creds.token}"}
        self._apply = apply
        self.edit: str | None = None

    def _call(self, method: str, url: str, **kw) -> dict:
        headers = {**self._h, **kw.pop("headers", {})}
        # Play's image upload endpoint throws the occasional bare 500 on a
        # perfectly good file; a retry has always been enough.
        for attempt in range(4):
            data = kw.get("data")
            if data is not None and hasattr(data, "seek"):
                data.seek(0)
            r = requests.request(method, url, headers=headers, **kw)
            if r.status_code < 500:
                break
            time.sleep(2 * (attempt + 1))
        if r.status_code >= 400:
            sys.exit(f"{method} {url.replace(API, '')} -> {r.status_code}\n{r.text[:1500]}")
        return r.json() if r.text else {}

    def open_edit(self) -> None:
        self.edit = self._call("POST", f"{API}/edits", json={})["id"]

    def write(self, method: str, path: str, label: str, **kw) -> dict:
        print(f"  {'WRITE' if self._apply else 'would'} {label}")
        if not self._apply:
            return {}
        return self._call(method, f"{API}/edits/{self.edit}{path}", **kw)

    def upload_image(self, language: str, image_type: str, file: Path) -> None:
        print(f"  {'WRITE' if self._apply else 'would'} upload {image_type} [{language}]: {file.name}")
        if not self._apply:
            return
        with file.open("rb") as f:
            self._call(
                "POST",
                f"{UPLOAD}/edits/{self.edit}/listings/{language}/{image_type}?uploadType=media",
                headers={"Content-Type": "image/png"},
                data=f,
            )

    def finish(self) -> None:
        if self._apply:
            self._call("POST", f"{API}/edits/{self.edit}:commit")
            print("\nedit committed")
        else:
            self._call("DELETE", f"{API}/edits/{self.edit}")
            print("\ndry run - edit discarded")


def main() -> None:
    ap = argparse.ArgumentParser()
    ap.add_argument("--apply", action="store_true")
    args = ap.parse_args()
    key = Path(os.environ.get("PLAY_SERVICE_ACCOUNT_KEY", "~/.appstoreconnect/play-service-account.json")).expanduser()
    if not key.is_file():
        sys.exit(f"no service account key at {key}")

    listings = build_listings()
    for loc, l in listings.items():
        print(f"[{loc}] " + "  ".join(f"{k}={len(v)}/{LIMITS[k]}" for k, v in l.items() if k in LIMITS))
    print(f"mode: {'APPLY' if args.apply else 'dry run'}\n")

    play = Play(key, args.apply)
    play.open_edit()

    print("Details")
    play.write("PATCH", "/details", f"contact: {CONTACT['contactEmail']}, {CONTACT['contactWebsite']}",
               json={"defaultLanguage": "en-US", **CONTACT})

    print("Listings")
    for loc, l in listings.items():
        play.write("PUT", f"/listings/{loc}", f"listing [{loc}]: {l['shortDescription'][:50]!r}…", json=l)

    print("Graphics [en-US]")
    for image_type in ("icon", "featureGraphic", "phoneScreenshots"):
        play.write("DELETE", f"/listings/en-US/{image_type}", f"clear {image_type}")
    play.upload_image("en-US", "icon", GRAPHICS / "icon-512.png")
    play.upload_image("en-US", "featureGraphic", GRAPHICS / "feature-graphic.png")
    for shot in sorted((GRAPHICS / "screenshots").glob("*.png")):
        play.upload_image("en-US", "phoneScreenshots", shot)

    play.finish()


if __name__ == "__main__":
    main()
