# Quickle — Google Play listing

Everything for the Play Console, in one place. The copy is the iOS listing's
([ios-app-store-listing.md](ios-app-store-listing.md)) — same words, Google's
limits. Graphics come from `uv run scripts/play-assets.py` → `docs/store/play/`.

Package `com.quicklegame.app` · Free · Game

---

## Main store listing

| Field | Value |
|---|---|
| App name (30) | `Quickle Party Game` (18) — or `Quickle` if the Console accepts it; Play has no name exclusivity |
| Short description (80) | `Fast, light mini-games for a night out. One phone each. Any drink.` (66) |
| Full description (4000) | the English description from the iOS listing, verbatim (991) |
| App icon | `docs/store/play/icon-512.png` — 512×512 |
| Feature graphic | `docs/store/play/feature-graphic.png` — 1024×500 |
| Phone screenshots (2–8) | `docs/store/play/screenshots/01…07.png` — 1080×1920, in that order |
| Tablet screenshots | none — phones only |
| Video | none |

### Hebrew (he-IL)

| Field | Value |
|---|---|
| App name | `Quickle Party Game` (Latin, unchanged) |
| Short description (80) | `מיני-משחקים מהירים וקלילים לערב עם חברים. טלפון לכל אחד. כל משקה.` (65) |
| Full description | the Hebrew description from the iOS listing, verbatim (796) |

## Store settings

| Field | Value |
|---|---|
| App category | Game → **Board** — the Console offered no Casual; Board is where social tabletop games live, Strategy would file it next to chess |
| Tags | Party, Multiplayer |
| Contact email | giladshavit1@gmail.com (public) |
| Contact website | https://www.quicklegame.com |
| External marketing | on |

---

## App content — the questionnaires (Console UI only, no API)

Go through **Policy → App content** top to bottom. Answers, with the reasoning
where it isn't obvious. Same facts as the iOS questionnaires, so the two stores
never contradict each other.

### Privacy policy
`https://www.quicklegame.com/privacy`

### Ads
**No, my app does not contain ads.** True for this release; when ads ship,
this declaration and the Data safety form change in the same release.

### App access
**All functionality is available without special access.** No login exists.

### Content rating (IARC questionnaire)

| Question | Answer |
|---|---|
| Category | **Game** |
| Violence — any | No |
| Sexuality / nudity | No |
| Language (profanity) | No |
| Alcohol — Reference | **Yes** — glass icons, "chaser", "drinks" on most screens |
| Alcohol — Use | **Yes** — the app tells the losing player to drink ("I'M IN", "chaser to go"). No on-screen characters drink, but this is use by any honest reading; a reviewer would spot "No" in a minute |
| Alcohol — Encourages / Glamorizes | **No** — Google's own definition: characters *gain advantage or succeed* after drinking, or real-brand advertising. Here drinking is the loser's penalty, never a reward, and there are no brands |
| Illegal drugs, tobacco | No |
| Simulated gambling | **No** — Auction / Roulette / Liar's Coin have no casino mechanics, no currency, no odds-based payout |
| Real-money gambling | No |
| Horror / fear | No |
| Crude humour | No |
| Users can interact or exchange content | **Yes** — nicknames and custom questions are shown to the other players in a private room |
| Shares user's location | No |
| Digital purchases | No |
| Unrestricted internet | No |

Expected rating: **18+ / PEGI 18 / ESRB Mature** on the alcohol answer. Do
not soften it — it matches Apple's 18+.

### Target audience and content
- Age groups: **18 and over** only.
- "Could the app unintentionally appeal to children?" → **No** (cartoon duck
  is the icon, but the store listing, rating and first-launch gate all say
  adults; answer honestly and let Google decide).
- Not a news app. No COVID-19 features. Not a government app. No financial
  features. Not a health app.

### Data safety

"Does your app collect or share any of the required user data types?" → **Yes**.

| Data type | Collected | Shared | Purpose | Required / optional | Ephemeral |
|---|---|---|---|---|---|
| Personal info → **Name** (the nickname) | Yes | No | App functionality | Required | Yes — held only while a room is live |
| Device or other IDs → **Device or other IDs** (random UUID) | Yes | No | App functionality | Required | No — persists on the device |
| App activity → **Other user-generated content** (custom questions) | Yes | No | App functionality | Optional | Yes |
| Everything else | No | | | | |

- Data encrypted in transit: **Yes** (HTTPS / WSS).
- Data deletion request mechanism: **No** — there are no accounts; room data
  is deleted automatically when the room ends, and the device ID lives only on
  the device (clearing app storage removes it). Say exactly that in the
  free-text field if one is offered.
- Independent security review: No.
- Advertising ID: **No** — the app does not use the advertising ID.

---

## Release path

1. **Internal testing** track first — up to 100 testers by email, live in
   minutes, no review. The first AAB upload here is manual (Play insists on
   it); every one after that is `eas submit --platform android`.
2. If the developer account was created after 13 Nov 2023, production
   access needs a **closed test with ≥ 12 opted-in testers for 14 consecutive
   days** first. Check the app's dashboard the moment the app exists — this
   decides the Android timeline.
3. Production: promote the tested release; Google's review is typically
   hours to a few days for a new app.
