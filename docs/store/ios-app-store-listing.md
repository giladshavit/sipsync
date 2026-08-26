# Quickle — App Store listing (iOS)

Everything that gets pasted into App Store Connect for v1.0, in one place.
Character limits are Apple's; the counts next to each field are of the text
below it. Hebrew is the second locale (spec §3.2).

App Store Connect app: https://appstoreconnect.apple.com/apps/6805344669
Bundle ID `com.quicklegame.app` · SKU `quickle` · ASC App ID `6805344669`

---

## App Information

| Field | Value |
|---|---|
| Name | **Quickle** |
| Subtitle (30) | `Party games. One phone each.` (28) |
| Primary category | Games |
| Secondary category | Entertainment |
| Game subcategories | Party, Casual |
| Content rights | Does not contain, show, or access third-party content |
| Age rating | see below |

### Age Rating questionnaire

Answer honestly — an inaccurate rating is grounds for removal (spec §3.1).

| Question | Answer | Why |
|---|---|---|
| Alcohol, Tobacco, or Drug Use or References | **Frequent/Intense** | The whole game is about who drinks a chaser |
| Contests | None | No real-world prizes |
| Gambling (simulated) | **Infrequent/Mild** | Russian Roulette / Auction / Liar's Coin use bet-like framing with no stakes and no currency |
| Mature/Suggestive Themes | None | |
| Profanity or Crude Humor | None | |
| Violence (any) | None | "Russian Roulette" is a card-flip game; no depiction of violence |
| Horror/Fear Themes | None | |
| Medical/Treatment Information | None | |
| Unrestricted Web Access | No | The app has no browser |
| Gambling with real money | No | |
| Loot boxes | No | |
| Parental controls / kids category | No | |

Expected result: **18+** (Apple's tier above 17+ since the 2025 questionnaire).
Do not try to argue it down — the first-launch 18+ consent screen already commits
the app to that audience.

---

## Pricing and Availability

Free · all territories · no pre-order.

---

## App Privacy

The app has no accounts and no analytics SDK on native. What leaves the device:

- a random UUID generated on first launch (identifies the player within a room)
- the nickname the player types in
- transient game state (taps, votes, scores) while a room is live

All of it lives in the backend's Redis only for the life of a room and is
deleted when the room ends (Room Garbage Collection). Nothing is linked to a
real identity, nothing is used for advertising or tracking.

| Data type | Collected? | Purpose | Linked to user | Tracking |
|---|---|---|---|---|
| Identifiers → User ID | Yes | App Functionality | No | No |
| User Content → Other User Content (nickname) | Yes | App Functionality | No | No |
| Everything else (contacts, location, health, purchases, browsing, diagnostics…) | No | | | |

Then: **"Do you or your third-party partners use data for tracking?" → No.**

Privacy policy URL: `https://www.quicklegame.com/privacy`

> Double-check before submitting: the privacy page must describe exactly the
> two rows above. If it mentions analytics, that applies to the website only —
> say so explicitly on the page.

---

## Version 1.0 — English (U.S.)

### Promotional text (170)

```
15 fast mini-games for a night with friends. Everyone plays on their own phone — no board, no cards, nothing to set up. Works with any drink.
```
(141)

### Description (4000)

```
Quickle is a party game for a table full of friends and a phone in every hand.

One person opens a room and shares a six-letter code. Everyone else joins from their own phone — no download for guests, no account, no sign-up. Then the room plays a round, and the person who lost it drinks a chaser. Any drink counts: beer, wine, water, soda, whatever's in your glass.

FIFTEEN MINI-GAMES, EACH ONE OVER IN A MINUTE

• Green Light — tap the instant it flips green. Slowest drinks.
• Tap Race — most taps in ten seconds wins.
• Human Timer — count ten seconds in your head. Farthest off drinks.
• Russian Roulette — flip cards, dodge the poison.
• Liar's Coin — heads or tails, and the flipper is allowed to lie.
• Closest Average — pick a number nearest the room's average.
• The Sacrifice — volunteer to drink before the clock runs out, or everyone does.
• Prisoner's Dilemma — help your partner or betray them, in secret.
• Go with the Flow — vote with the crowd and you're safe.
• Against the Flow — guess what the minority wants.
• Strong Point — hit the zone the instant it appears.
• Flying Bomb — swipe it to someone else before it goes off.
• 21 — push the counter up. Don't be the one who lands on 21.
• Auction — bid points and chasers to run the table.
• Black Box — pick a card, then convince the room what's inside.

The room shuffles through the games you picked and never repeats one until it has played them all, so a long night stays fresh.

BUILT FOR THE TABLE, NOT THE SCREEN

• Reflex games are judged on the server, so a slow connection can't win for you.
• The drinking moment is a six-second window everyone sees at once. No skipping it.
• Every round ends on a podium, so the running score is always on the table.
• A short animated tutorial plays before each game, so nobody has to explain the rules.
• Went to the bathroom? Rejoin with the same code and your seat is still there.

FOR ADULTS

Quickle is intended for players of legal drinking age. If you drink, drink responsibly, and never drink and drive. It plays exactly the same with a glass of water.

Guests can also play from any browser at quicklegame.com — the host is the only one who needs the app.
```
(2,184)

### Keywords (100)

```
party game,drinking game,friends,group,multiplayer,mini games,bar,pregame,night out,social,reflex
```
(97)

| Field | Value |
|---|---|
| Support URL | `https://www.quicklegame.com` |
| Marketing URL | `https://www.quicklegame.com` |
| Copyright | `2026 Gilad Shavit` |
| Version | `1.0.0` |

### App Review Information

| Field | Value |
|---|---|
| Sign-in required | **No** — there are no accounts |
| Contact first name / last name | Gilad / Shavit |
| Phone | *(fill in)* |
| Email | giladshavit1@gmail.com |

### Notes for the reviewer

This is the part that decides the review. Plain, specific, no marketing.

```
Quickle is a multiplayer party game played by a group of people in the same room, each on their own phone. The losing player of each round drinks a "chaser" — any beverage. The app does not sell, serve, or promote alcohol, does not encourage drinking quantities, and states on first launch that it plays the same with any drink. It is rated 18+ and shows an age-confirmation screen before anything else.

HOW TO TEST WITH ONE DEVICE

1. Launch the app, confirm you are 18+, enter any nickname.
2. Tap "Games" and open any game (for example "Green Light").
3. Tap the robot icon at the top of the rules page. This starts a practice round against computer players, so the whole flow — tutorial, round, drinking window, podium — can be seen with a single device.

HOW TO TEST A REAL ROOM WITH A SECOND PLAYER

1. On the device, tap "Create Room". A six-letter code appears.
2. In any web browser (desktop is fine), open https://www.quicklegame.com/room/<CODE> and enter a nickname. The browser joins the same room as a second player.
3. On the device, tap "Start Game".

There are no accounts, no purchases, no ads, and no user-generated content visible to strangers — rooms are private to whoever has the code and are deleted from the server when they end.

If anything is unclear, please contact giladshavit1@gmail.com and I will respond the same day.
```

---

## Version 1.0 — Hebrew

Name stays **Quickle** (Latin) in both locales.

| Field | Value |
|---|---|
| Subtitle (30) | `משחקי מסיבה. טלפון לכל אחד.` (27) |
| Keywords (100) | `משחק שתייה,משחק מסיבה,חברים,קבוצה,ערב,בר,צייסר,משחקים,מיני משחקים,רב משתתפים` (76) |

### Promotional text (170)

```
15 מיני-משחקים מהירים לערב עם חברים. כל אחד משחק מהטלפון שלו — בלי לוח, בלי קלפים, בלי לסדר כלום. עובד עם כל משקה.
```
(114)

### Description (4000)

```
Quickle הוא משחק מסיבה לשולחן מלא חברים וטלפון בכל יד.

אחד פותח חדר ומשתף קוד של שש אותיות. כל השאר מצטרפים מהטלפון שלהם — בלי הורדה לאורחים, בלי חשבון, בלי הרשמה. החדר משחק סבב, ומי שהפסיד שותה צ'ייסר. כל משקה נחשב: בירה, יין, מים, סודה, מה שיש בכוס.

חמישה-עשר מיני-משחקים, כל אחד נגמר תוך דקה

• אור ירוק — לחץ ברגע שזה מתחלף לירוק. האיטי שותה.
• מרוץ לחיצות — הכי הרבה לחיצות בעשר שניות מנצח.
• טיימר אנושי — ספור עשר שניות בראש. הכי רחוק שותה.
• רולטה רוסית — הפוך קלפים, תתחמק מהרעל.
• מטבע השקרן — עץ או פלי, ומי שמטיל מותר לו לשקר.
• הכי קרוב לממוצע — בחר מספר הכי קרוב לממוצע של החדר.
• הקורבן — התנדב לשתות לפני שהשעון נגמר, או שכולם שותים.
• דילמת האסיר — עזור לשותף שלך או בגוד בו, בסתר.
• לזרום עם הרוב — הצבע עם הקהל ואתה בטוח.
• נגד הזרם — נחש מה המיעוט רוצה.
• נקודה חזקה — פגע באזור ברגע שהוא מופיע.
• פצצה מעופפת — העבר אותה למישהו אחר לפני שהיא מתפוצצת.
• 21 — דחוף את המונה למעלה. אל תהיה זה שנוחת על 21.
• מכירה פומבית — הצע נקודות וצ'ייסרים כדי לשלוט בשולחן.
• קופסה שחורה — בחר קלף, ואז שכנע את החדר מה יש בפנים.

החדר מערבב את המשחקים שבחרתם ולא חוזר על אחד עד שכולם שוחקו, כך שערב ארוך נשאר טרי.

בנוי לשולחן, לא למסך

• משחקי רפלקס נשפטים בשרת, כך שחיבור איטי לא יכול לנצח בשבילך.
• רגע השתייה הוא חלון של שש שניות שכולם רואים בו-זמנית. אין דילוג.
• כל סבב מסתיים בפודיום, כך שהניקוד תמיד על השולחן.
• הדרכה מונפשת קצרה לפני כל משחק, כדי שאף אחד לא יצטרך להסביר חוקים.
• הלכת לשירותים? הצטרף מחדש עם אותו קוד והמקום שלך עדיין שם.

למבוגרים

Quickle מיועד לשחקנים בגיל שתייה חוקי. אם אתם שותים, שתו באחריות, ולעולם אל תשתו ותנהגו. המשחק עובד בדיוק אותו דבר עם כוס מים.

אורחים יכולים לשחק גם מכל דפדפן ב-quicklegame.com — רק המארח צריך את האפליקציה.
```
(1,675)

---

## Screenshots — still to produce (spec §3.2)

- 6.9″ class, 1320×2868, up to 10; target 5–6. One size set is enough.
- Designed frames (device + short caption), not raw captures. Content must
  match the 18+ rating — glasses fine, no excess.
- Suggested sequence: (1) lobby with a room code and four avatars, (2) a
  reflex game mid-round, (3) the six-second drinking window, (4) the podium,
  (5) the games catalog, (6) a tutorial frame.
- Optional 15–30s App Preview, cut from the beta demo video (spec §2.3).
