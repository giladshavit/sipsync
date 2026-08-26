# /// script
# requires-python = ">=3.12"
# dependencies = ["pyjwt>=2.9", "cryptography>=43", "requests>=2.32"]
# ///
"""Push the App Store listing from docs/store/ios-app-store-listing.md into
App Store Connect, so the reviewed markdown is the single source of truth and
nobody retypes 4,000-character descriptions into a web form.

    uv run scripts/asc-push-metadata.py            # dry run: show what would change
    uv run scripts/asc-push-metadata.py --apply    # write it

Auth is an App Store Connect API key (Users and Access → Integrations),
role App Manager, via environment:

    ASC_KEY_ID=XXXXXXXXXX ASC_ISSUER_ID=<uuid> ASC_KEY_PATH=~/.appstoreconnect/AuthKey_XXXXXXXXXX.p8

The .p8 is a secret: keep it outside the repo, never commit it.

What it writes — everything the API exposes for a first submission:
  app info        subtitle (en-US + he), categories, age-rating declaration
  version 1.0     copyright; per locale: description, keywords, promotional
                  text, support/marketing URLs; the review contact + notes;
                  the build to ship
What it can't — these stay manual in the ASC UI:
  App Privacy questionnaire, pricing (Free), and the Submit button.
"""

from __future__ import annotations

import argparse
import os
import re
import sys
import time
from pathlib import Path
from typing import Any

import jwt
import requests

REPO = Path(__file__).resolve().parent.parent
LISTING = REPO / "docs/store/ios-app-store-listing.md"
API = "https://api.appstoreconnect.apple.com/v1"
ASC_APP_ID = "6805344669"
PLATFORM = "IOS"
VERSION = "1.0.0"
BUILD_NUMBER = os.environ.get("ASC_BUILD_NUMBER")  # e.g. "3"; latest processed if unset

# Categories — App Store Connect ids, not display names.
CATEGORIES = {
    "primaryCategory": "GAMES",
    "primarySubcategoryOne": "GAMES_CASUAL",
    "primarySubcategoryTwo": "GAMES_BOARD",
    "secondaryCategory": "ENTERTAINMENT",
}

# Age rating (docs/store/ios-app-store-listing.md, "Age Rating questionnaire").
# Attribute names are the API's. Anything the 2025 questionnaire added that
# this version of the API rejects is reported, not silently dropped — finish
# those rows in the UI.
AGE_RATING = {
    "alcoholTobaccoOrDrugUseOrReferences": "FREQUENT_OR_INTENSE",
    "gamblingSimulated": "INFREQUENT_OR_MILD",
    "contests": "NONE",
    "medicalOrTreatmentInformation": "NONE",
    "profanityOrCrudeHumor": "NONE",
    "sexualContentOrNudity": "NONE",
    "sexualContentGraphicAndNudity": "NONE",
    "horrorOrFearThemes": "NONE",
    "matureOrSuggestiveThemes": "NONE",
    "violenceCartoonOrFantasy": "NONE",
    "violenceRealistic": "NONE",
    "violenceRealisticProlongedGraphicOrSadistic": "NONE",
    "gambling": False,
    "unrestrictedWebAccess": False,
    "lootBox": False,
    # Added by the 2025 questionnaire — all required.
    "gunsOrOtherWeapons": "NONE",  # Russian Roulette is card flips, no weapon shown
    "healthOrWellnessTopics": False,
    "messagingAndChat": False,
    "parentalControls": False,
    # Custom questions and nicknames are seen only inside a private room by
    # people who know each other — not the public UGC guideline 1.2 targets.
    "userGeneratedContent": False,
    "advertising": False,  # true for v1.0; flip when ads ship
    # Apple means real verification (ID, card); our "I'm 18+" tap is a
    # self-declaration, which the review notes describe separately.
    "ageAssurance": False,
    "socialMedia": False,
}

REVIEW_CONTACT = {
    "contactFirstName": "Gilad",
    "contactLastName": "Shavit",
    "contactEmail": "giladshavit1@gmail.com",
    # Required by Apple, deliberately not in the repo — pass it in.
    "contactPhone": os.environ.get("ASC_CONTACT_PHONE", ""),
    "demoAccountRequired": False,
}


# ── Listing file ────────────────────────────────────────────────────────────


def _section(md: str, heading: str) -> str:
    """Text of a `## heading` section up to the next `## `."""
    m = re.search(rf"^## {re.escape(heading)}.*?$(.*?)(?=^## |\Z)", md, re.S | re.M)
    if not m:
        sys.exit(f"listing: section '## {heading}' not found")
    return m.group(1)


def _block(section: str, heading: str) -> str:
    """The fenced code block directly under a `### heading` in a section."""
    m = re.search(rf"^### {re.escape(heading)}.*?\n```\n(.*?)\n```", section, re.S | re.M)
    if not m:
        sys.exit(f"listing: block '### {heading}' not found")
    return m.group(1).strip()


def _table_value(section: str, field: str) -> str:
    """Value cell of a `| field | \\`value\\` |` table row."""
    m = re.search(rf"^\| {re.escape(field)}[^|]*\| `([^`]+)`", section, re.M)
    if not m:
        sys.exit(f"listing: table row '{field}' not found")
    return m.group(1)


def load_listing() -> dict[str, Any]:
    md = LISTING.read_text(encoding="utf-8")
    info = _section(md, "App Information")
    en = _section(md, "Version 1.0 — English (U.S.)")
    he = _section(md, "Version 1.0 — Hebrew")
    return {
        "copyright": _table_value(en, "Copyright"),
        "supportUrl": _table_value(en, "Support URL"),
        "marketingUrl": _table_value(en, "Marketing URL"),
        "privacyPolicyUrl": _table_value(_section(md, "App Privacy"), "Privacy policy URL")
        if "| Privacy policy URL" in md
        else "https://www.quicklegame.com/privacy",
        "reviewNotes": _block(en, "Notes for the reviewer"),
        "locales": {
            "en-US": {
                "subtitle": _table_value(info, "Subtitle"),
                "promotionalText": _block(en, "Promotional text"),
                "description": _block(en, "Description"),
                "keywords": _block(en, "Keywords"),
            },
            "he": {
                "subtitle": _table_value(he, "Subtitle"),
                "promotionalText": _block(he, "Promotional text"),
                "description": _block(he, "Description"),
                "keywords": _table_value(he, "Keywords"),
            },
        },
    }


LIMITS = {"subtitle": 30, "promotionalText": 170, "description": 4000, "keywords": 100}


def check_limits(listing: dict[str, Any]) -> None:
    bad = [
        f"{loc}/{field}: {len(text)} > {LIMITS[field]}"
        for loc, fields in listing["locales"].items()
        for field, text in fields.items()
        if len(text) > LIMITS[field]
    ]
    if bad:
        sys.exit("over Apple's limits:\n  " + "\n  ".join(bad))


# ── API client ──────────────────────────────────────────────────────────────


class ASC:
    def __init__(self, key_id: str, issuer_id: str, key_path: Path, apply: bool) -> None:
        self._key_id, self._issuer_id = key_id, issuer_id
        self._key = key_path.read_text()
        self._apply = apply
        self._s = requests.Session()

    def _token(self) -> str:
        now = int(time.time())
        return jwt.encode(
            {"iss": self._issuer_id, "iat": now, "exp": now + 600, "aud": "appstoreconnect-v1"},
            self._key,
            algorithm="ES256",
            headers={"kid": self._key_id, "typ": "JWT"},
        )

    def _call(self, method: str, path: str, **kw: Any) -> dict[str, Any]:
        url = path if path.startswith("http") else f"{API}{path}"
        r = self._s.request(method, url, headers={"Authorization": f"Bearer {self._token()}"}, **kw)
        if r.status_code >= 400:
            sys.exit(f"{method} {path} -> {r.status_code}\n{r.text[:2000]}")
        return r.json() if r.text else {}

    def get(self, path: str, **params: Any) -> dict[str, Any]:
        return self._call("GET", path, params=params)

    def write(self, method: str, path: str, body: dict[str, Any], label: str) -> dict[str, Any]:
        attrs = body.get("data", {}).get("attributes", {})
        summary = ", ".join(
            f"{k}={str(v)[:40]!r}{'…' if len(str(v)) > 40 else ''}" for k, v in attrs.items()
        )
        print(f"  {'WRITE' if self._apply else 'would'} {method} {label}: {summary or body['data'].get('relationships', '')}")
        if not self._apply:
            return {}
        return self._call(method, path, json=body)


def data(type_: str, attributes: dict[str, Any], id_: str | None = None, **rels: Any) -> dict[str, Any]:
    d: dict[str, Any] = {"type": type_, "attributes": attributes}
    if id_:
        d["id"] = id_
    if rels:
        d["relationships"] = {k: {"data": v} for k, v in rels.items()}
    return {"data": d}


# ── Steps ───────────────────────────────────────────────────────────────────


def push_app_info(asc: ASC, listing: dict[str, Any]) -> None:
    print("App info")
    # Content Rights lives on the app itself, not the app info, and Submit
    # refuses to proceed while it's unanswered. All art, copy and code is
    # first-party.
    asc.write("PATCH", f"/apps/{ASC_APP_ID}",
              data("apps", {"contentRightsDeclaration": "DOES_NOT_USE_THIRD_PARTY_CONTENT"}, ASC_APP_ID),
              "content rights")
    infos = asc.get(f"/apps/{ASC_APP_ID}/appInfos")["data"]
    # The editable one is whichever isn't already live.
    info = next((i for i in infos if i["attributes"].get("appStoreState") != "READY_FOR_SALE"), infos[0])
    info_id = info["id"]

    asc.write(
        "PATCH", f"/appInfos/{info_id}",
        data("appInfos", {}, info_id, **{k: {"type": "appCategories", "id": v} for k, v in CATEGORIES.items()}),
        "categories",
    )

    existing = {l["attributes"]["locale"]: l for l in asc.get(f"/appInfos/{info_id}/appInfoLocalizations")["data"]}
    # The store name is per-locale too; a new locale needs it and we keep it
    # identical everywhere (Latin "Quickle Party Game" in Hebrew as well).
    store_name = existing["en-US"]["attributes"]["name"]
    for locale, fields in listing["locales"].items():
        attrs = {"subtitle": fields["subtitle"], "privacyPolicyUrl": listing["privacyPolicyUrl"]}
        if locale in existing:
            asc.write("PATCH", f"/appInfoLocalizations/{existing[locale]['id']}",
                      data("appInfoLocalizations", attrs, existing[locale]["id"]), f"app info [{locale}]")
        else:
            asc.write("POST", "/appInfoLocalizations",
                      data("appInfoLocalizations", {"locale": locale, "name": store_name, **attrs},
                           appInfo={"type": "appInfos", "id": info_id}),
                      f"app info [{locale}] (new locale)")

    rating = asc.get(f"/appInfos/{info_id}/ageRatingDeclaration")["data"]
    asc.write("PATCH", f"/ageRatingDeclarations/{rating['id']}",
              data("ageRatingDeclarations", AGE_RATING, rating["id"]), "age rating")


def push_version(asc: ASC, listing: dict[str, Any]) -> str:
    print(f"Version {VERSION}")
    versions = asc.get(f"/apps/{ASC_APP_ID}/appStoreVersions", **{"filter[platform]": PLATFORM})["data"]
    version = next((v for v in versions if v["attributes"]["versionString"] == VERSION), None)
    attrs = {"copyright": listing["copyright"]}
    if version is None:
        # App creation makes a placeholder "1.0"; the App Store version string
        # has to match the build's CFBundleShortVersionString (app.json
        # `version`), so rename the editable one rather than leaving two.
        version = next((v for v in versions if v["attributes"]["appStoreState"] == "PREPARE_FOR_SUBMISSION"), None)
        if version is None:
            sys.exit(f"no App Store version {VERSION} and nothing editable to rename — check ASC")
        attrs["versionString"] = VERSION
    vid = version["id"]
    print(f"  {version['attributes']['versionString']} — {version['attributes']['appStoreState']}")

    asc.write("PATCH", f"/appStoreVersions/{vid}", data("appStoreVersions", attrs, vid), "version string + copyright")

    existing = {l["attributes"]["locale"]: l for l in asc.get(f"/appStoreVersions/{vid}/appStoreVersionLocalizations")["data"]}
    for locale, fields in listing["locales"].items():
        attrs = {
            "description": fields["description"],
            "keywords": fields["keywords"],
            "promotionalText": fields["promotionalText"],
            "supportUrl": listing["supportUrl"],
            "marketingUrl": listing["marketingUrl"],
        }
        if locale in existing:
            asc.write("PATCH", f"/appStoreVersionLocalizations/{existing[locale]['id']}",
                      data("appStoreVersionLocalizations", attrs, existing[locale]["id"]), f"version [{locale}]")
        else:
            asc.write("POST", "/appStoreVersionLocalizations",
                      data("appStoreVersionLocalizations", {"locale": locale, **attrs},
                           appStoreVersion={"type": "appStoreVersions", "id": vid}),
                      f"version [{locale}] (new locale)")

    detail = asc.get(f"/appStoreVersions/{vid}/appStoreReviewDetail").get("data")
    attrs = {**REVIEW_CONTACT, "notes": listing["reviewNotes"]}
    if not attrs["contactPhone"]:
        # Apple won't create the review record without a phone (in +CC form).
        print("  SKIP review contact + notes — set ASC_CONTACT_PHONE='+972…' and re-run")
        return vid
    if detail:
        asc.write("PATCH", f"/appStoreReviewDetails/{detail['id']}",
                  data("appStoreReviewDetails", attrs, detail["id"]), "review contact + notes")
    else:
        asc.write("POST", "/appStoreReviewDetails",
                  data("appStoreReviewDetails", attrs, appStoreVersion={"type": "appStoreVersions", "id": vid}),
                  "review contact + notes (new)")
    return vid


def attach_build(asc: ASC, vid: str) -> None:
    print("Build")
    params = {"filter[app]": ASC_APP_ID, "filter[preReleaseVersion.version]": VERSION,
              "filter[processingState]": "VALID", "sort": "-uploadedDate", "limit": 5}
    if BUILD_NUMBER:
        params["filter[version]"] = BUILD_NUMBER
    builds = asc.get("/builds", **params)["data"]
    if not builds:
        print("  no processed build found yet — attach it in the UI once Apple finishes processing")
        return
    build = builds[0]
    print(f"  using build {build['attributes']['version']} uploaded {build['attributes']['uploadedDate'][:16]}")
    asc.write("PATCH", f"/appStoreVersions/{vid}/relationships/build",
              {"data": {"type": "builds", "id": build["id"]}}, "attach build")


# ── Main ────────────────────────────────────────────────────────────────────


def main() -> None:
    ap = argparse.ArgumentParser(description=__doc__.split("\n\n")[0])
    ap.add_argument("--apply", action="store_true", help="write to App Store Connect (default: dry run)")
    args = ap.parse_args()

    try:
        key_id, issuer_id, key_path = os.environ["ASC_KEY_ID"], os.environ["ASC_ISSUER_ID"], Path(os.environ["ASC_KEY_PATH"]).expanduser()
    except KeyError as e:
        sys.exit(f"missing {e.args[0]} — see the docstring for the three ASC_* variables")
    if not key_path.is_file():
        sys.exit(f"no key file at {key_path}")

    listing = load_listing()
    check_limits(listing)
    for loc, fields in listing["locales"].items():
        print(f"[{loc}] " + "  ".join(f"{k}={len(v)}/{LIMITS[k]}" for k, v in fields.items()))
    print(f"mode: {'APPLY' if args.apply else 'dry run'}\n")

    asc = ASC(key_id, issuer_id, key_path, args.apply)
    app = asc.get(f"/apps/{ASC_APP_ID}")["data"]["attributes"]
    print(f"App: {app['name']} ({app['bundleId']})\n")

    push_app_info(asc, listing)
    vid = push_version(asc, listing)
    attach_build(asc, vid)

    print("\nStill manual in the ASC UI: App Privacy questionnaire, Pricing (Free), screenshots, Submit.")


if __name__ == "__main__":
    main()
