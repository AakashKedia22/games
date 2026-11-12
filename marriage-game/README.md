# Marriage Score Card

A real-time multiplayer score tracker for the **Marriage** card game, played with 3 or 4 players using the house rules (Bandh, Hath and Joker, with double rounds). Track scores across devices with live sync — no accounts, no sign-ups, just play.

---

## Features

- **Live sync** — all devices on the same session see scores update in real time
- **Session-based** — create a room, share the session code, and join from any device
- **Setup** — choose 3 or 4 players with the Game mode toggle and set the names
- **Round entry** — pick the Bandh closer, enter Hath (max 15) and Joker points, with a live preview and double-round banner
- **Card entry (v4a)** — set the opened joker card, tap in each player's 30 cards, and the app works out Hath and Joker points (best grouping, joker bonuses, pure triples), with a breakdown
- **Photo entry**: photograph a player's cards, check the detected cards, and the hand is scored. Recognition runs offline on the laptop. Cards cut off by the photo edge are ignored and counted, tilted and small cards are found, and cards that were dropped (over the copy limit or past 30) are listed
- **Pack (v4c)** — tick Packed for a player who packed: they pay exactly 10 Hath to the closer whatever is typed, keep their Joker points, and cannot close the Bandh
- **Doublets route (v4c)** — with 4 players, 8 doublets commit and 10 close; with 3 players, 9 and 11. A doublet is two identical natural cards; printed jokers never pair, and three copies are a doublet plus a spare
- **Free runs when not committed (v4c)** — pure runs of 4–5 and pure triples leave no Hath; runs of 3 are still charged
- **Round history** — nets and running totals for every round, with an edit and delete button per row
- **Cumulative chart** — watch the score graph grow round by round
- **Finish game & past games** — "Finish game" archives the current game and starts a fresh one with the same players. Past games are listed newest first with an all-time leaderboard; finishing and deleting are undoable
- **Player stats** — per player: total, Bandh count, Hath and Joker points, best and worst round, and doubles triggered
- **Export & share** — download the game as CSV (also for past games), share the standings via the share sheet, or send them on WhatsApp
- **Faster entry** — −/+ buttons beside every Hath and Joker box, Enter moves to the next box, and Hath moves on automatically once the number is complete
- **Shared undo** — the undo history lives on the server, so every device can undo the last change
- **Saved sessions** — sessions are written to `data/sessions.json` and survive server restarts
- **Invite link and QR** — share the link or scan the QR code to join directly
- **No cloud dependency** — runs entirely on your local network via WebSocket

## How It Works

| Step | What happens |
|------|-------------|
| 1 | One player starts a **session** from their laptop |
| 2 | Other players **join** using the session code on their phones |
| 3 | Enter round scores from any device |
| 4 | All devices update instantly |

After creating a session, share the generated invite link or let other players scan its QR code. Opening the link joins that session directly. Anyone in the session can share the same invite.

## Scoring Rules

Each round, every player has a **Bandh** checkbox and two point inputs, **Hath** and **Joker**. A game is played with **3 or 4 players**, chosen in setup.

1. **Bandh:** exactly one player closes the round. Tick their Bandh box.
2. **Hath:** each other player's Hath is at most **15**. The closer collects the sum of the others' Hath, and each other player loses their own Hath. The closer's own Hath is ignored.
   Example: P1 closes, P2 = 0, P3 = 2, P4 = 12 → P1 **+14**, P2 **0**, P3 **−2**, P4 **−12**.
3. **Joker:** no limit. Each player scores the sum, over every other player, of (own joker − other's joker).
   Example: jokers 2, 5, 10, 25 → P1 **−34**, P2 **−22**, P3 **−2**, P4 **+58**.
4. **Round total** = Hath + Joker, shown in one table.
5. **Double round:** if in the previous round any player's entered Joker points were **20 or more** (20 counts; 19 does not double), every player's round total in the next round is **×2**. Only the immediately previous round counts, and a doubled round can trigger the next double.

Round totals always add up to 0. The highest total leads. Tied players share a rank. Changing a round recalculates every later round, because each round is stored as raw entries.

Player stats show Hath and Joker points including the ×2 of double rounds, so Hath + Joker always equals Total.

## House rules

The card scoring follows these house rules:

- **Decks:** 3 decks with printed jokers.
- **Commit:** 5 pure sequences (runs of 3–5; A-2-3 and Q-K-A are allowed, no wrap-around), or 3 identical cards.
- **Doublets:** with 4 players, 8 doublets commit and 10 close; with 3 players, 9 and 11. A doublet is two identical natural cards (same rank and suit). Three copies are one doublet plus one spare. Printed jokers never pair, and no joker may stand in to complete a doublet; a pair of a card that is a joker this round (e.g. 8♦ 8♦ with 7♦ opened) does count, and keeps its Joker points. Once a player has the commit doublets (8 with 4 players, 9 with 3), Hath is 0 and the other cards are ignored; only reaching commit + 2 doublets makes the hand closed (who can be the Bandh closer). On this route only the joker-card points count (pure-triple points are not added).
- **Route choice:** the sequences route and the doublets route are both checked. The closed one wins; otherwise the higher Joker − Hath, then the lower Hath, then sequences. Within a route, the grouping with the highest Joker − Hath is chosen the same way.
- **Joker combos:** a combo is a pair or three of one joker card, or all four of the opened rank. A combo is broken when one of its cards is played as itself in a group (e.g. 6♦ 6♦ with one 6♦ in a run, or one 6♦ in a set). Using a joker as a wild card never breaks it. Pure triples and doublets made of all the copies of one card do not break it. The opened run (R−2..R+2) counts wherever its cards are, and never breaks a combo. A broken card scores its single value; the other copies still pool for the pair or three bonus. The app lists the broken combos under the hand.
- **Not committed:** pure runs of 4–5 (one suit, no wild cards; a joker card may be used as itself; A-2-3-4 and J-Q-K-A count, no wrap) and pure triples are free of Hath. Runs of 3 are still charged. A run of 6 frees only 5 of its cards.
- **Pack:** a packed player always pays exactly 10 Hath to the closer, whatever is typed in the box. Their Joker points count in full. They cannot be the Bandh closer. In a double round the pack payment is ×2 like any other Hath.
- **Joker cards:** for the opened card R♦, the joker cards are all four R, R±1 and R±2 of ♦ (wrapping), plus the printed jokers.
- **Bandh:** the 30-card search, used for rounds saved before commit cards (see below): all 30 cards in runs (jokers allowed), pure triples (no jokers), or mixed-suit sets of 3–4 (jokers allowed).
- **Hath:** the leftover card value (2–10 at face value, J Q K A = 10, jokers excluded) ÷ 10, rounded half up, max 15.
- **Joker points table:** opened card 4; same-colour rank, neighbours and printed joker 2; other-colour rank 0; pair +2; three = 14 (10 for 0-value); all four ranks = 14; R−2..R+2 run = 25; pure triples 1/2/3/4/5 = 2/6/14/20/25. Each card counts in one bonus only, and the best split counts.

### Committed cards

Each player enters their cards in two lists: **1 · Committed** (the cards shown for the commit) and **2 · Bandh** (or all cards, while Committed is not ticked).

1. **Committed tick.** It can be ticked only when the commit cards form exactly one of:
   - **Sequences:** exactly 5 pure sequences that use every commit card. A run is 3–5 cards of one suit (A-2-3 and Q-K-A count; runs never wrap). A pure triple is 3 identical cards. No wild cards; a joker card may be used as itself; a printed joker can never be used. A run of 6 or more may be split.
   - **Doublets:** exactly 8 doublets (4 players) or 9 (3 players) and no other cards.
2. **Locked.** While ticked, the commit cards are read-only. Unticking unlocks them, and no card moves.
3. **Bandh cards** are the other 30 − N cards. On the sequences route, Hath is the best grouping of the Bandh cards only, with the usual rounding and cap; closed means every Bandh card is grouped. On the doublets route, Hath is 0; closed means at least 2 doublets among the Bandh cards.
4. **Joker points** come from all 30 cards, with the joker combo rules above. Locked groups count as natural use. Bandh doublets never break a combo.
5. **Not committed.** Without the tick, all 30 cards are scored with the not-committed rule only, even if they hold 5 sequences. The app then shows a hint.
6. **Bandh closer.** The closer must tick Committed. Closed or not, a closer who has not ticked is not accepted; a Bandh that is not closed only gets a warning.
7. **Old rounds.** Rounds saved before commit cards keep their stored Hath and Joker values. The app shows the old 30-card score as a note.
8. **Photos.** Each list has its own photo button. The copy limits (3 of each card, 2 of the opened card) count both lists together. The commit list holds at most 25 cards (and no more than 30 minus the other cards); the Bandh or all-cards list holds 30 minus the commit cards.

**Data.** A round entry stores `committed` (true or false) whenever cards were entered. `commitCards` is stored only for committed players, and `cards` holds the Bandh cards (or all cards when not committed). Rounds saved before this change have `cards` only, and open un-ticked on Edit with their 30 cards in the All cards list. The CSV has a `Committed` column listing the players who ticked it.

## Tech Stack

| Layer | Technology |
|-------|-----------|
| Frontend | React 19 + Chart.js |
| Backend | Node.js + WebSocket (`ws`) |
| Real-time | WebSocket (no Firebase) |
| Storage | JSON file on the server (`data/sessions.json`, override with `DATA_FILE`) |

## Getting Started

### Prerequisites

- Node.js 18+
- npm

### Install

```bash
npm install
```

### Development (two terminals)

```bash
# Terminal 1 — React dev server
npm start

# Terminal 2 — Game server
npm run server
```

The app opens at `http://localhost:3000`. The WebSocket server runs on port **3001**.

### Production (single command)

```bash
npm run prod
```

This builds the React app and starts a single server that serves both the frontend and the WebSocket backend on port **3001**.

### Access from other devices

The server prints its local and detected network URLs in the terminal. In production, open the network URL on another device on the same Wi-Fi/LAN. In development, open `http://<YOUR_IP>:3000`; the app on that device also needs to reach port **3001** for live sync and network discovery.

The session invite contains the current network IP and a session code, so players can join without typing the code. If your computer has multiple network interfaces, the app also lists alternate detected addresses. Allow the app through the macOS firewall if prompted on the first connection. Network addresses must be reachable from the other device (for example, both devices need to be on the same LAN).

Sessions are saved to `data/sessions.json` after every change and loaded when the server starts, so they survive a restart. Set the `DATA_FILE` environment variable to store them somewhere else. Each session code looks like `MG-1234`.

```
Your IP example: 192.168.1.42
Phone URL:       http://192.168.1.42:3000
```

## Card recognition (photo)

Photos are read by two small models that run on this computer (no cloud service):
a detector finds each card's corner index (rank and suit), and a classifier reads it.
Overlapping cards and fans work because the index is what is read, not the whole card.

1. **Install** (once, needs internet): `npm run vision:setup`, then for training also `npm run vision:setup-train`. Needs `uv` (https://docs.astral.sh/uv/). It downloads Python 3.12 into `vision/.venv`.
2. **Capture your deck** (once, about 5 minutes; this greatly improves accuracy):
   - On a plain dark cloth or towel (not the rug), lay all 13 spades apart, A to K, in rows of 5, 5, 3. Photograph from above.
   - Repeat for hearts, diamonds and clubs, then one photo of the jokers.
   - AirDrop the photos to the Mac (HEIC is fine).
   - Run `npm run vision:capture -- --deck main S=~/Downloads/IMG_1.HEIC H=… D=… C=… JK=…`.
   - Open `vision/datasets/deck/main/check.jpg` and make sure every label is right.
   - If the house decks have different designs, capture each one with its own `--deck` name.
3. **Optional:** photograph your empty rug or table 3–5 times and put the photos in `vision/datasets/backgrounds/`.
4. **Train**: `npm run vision:train`. It uses the Mac GPU (MPS). Expect one to two hours on an M3 (a rough estimate: making the synthetic photos is the slow part, and the whole run has not been timed). It writes `vision/models/{corners.onnx, cards.onnx, labels.json, geometry.json, metrics.json}`. Restart the server afterwards.
5. **Check it on real photos**:
   - Put truth files in `data/vision/eval/` (format: `{"photo": "/path/IMG.HEIC", "cards": ["3H", "3H", "JK", …]}`).
   - Run `npm run vision:evaluate -- data/vision/eval/IMG_4641.truth.json data/vision/eval/IMG_4638.truth.json`.
   - Look at the overlays in `data/vision/eval/out/`.
6. **Taking a good photo**:
   - any background is fine;
   - overlap and fan cards as usual, but keep every card's corner index (rank and suit) visible;
   - fill the frame and avoid glare.
   - Cards marked "Check" were hard to read or may be counted twice. Look at them before using the cards.
7. **Improving it**: keep "Keep these photos" ticked. Confirmed crops go to `data/vision/samples/`. `npm run vision:train -- --skip-detector` retrains just the classifier, which is quicker.
8. **Tests**: `npm run vision:test`.
9. **Licences**: torchvision (BSD-3), timm (Apache-2.0), and the ImageNet weights for MobileNetV3 (BSD) and EfficientNet (Apache). No Kaggle data and no AGPL code. System fonts are used only to draw local training images.

## Scripts

| Command | Description |
|---------|-------------|
| `npm start` | React dev server on `:3000` |
| `npm run server` | WebSocket game server on `:3001` |
| `npm run build` | Production build to `build/` |
| `npm run prod` | Build + serve everything on `:3001` |
| `npm test` | Run frontend tests |
| `npm run test:server` | Run server tests (network addresses and sessions) |
| `npm run test:all` | Run frontend and server tests |

## Project Structure

```
marriage_game/
├── public/                 # Static assets
├── src/
│   ├── App.js              # Main game component
│   ├── App.css             # Styling
│   ├── scoring.js          # Round scoring, totals, standings and validation
│   ├── stats.js            # Player stats, game summaries and all-time leaderboard
│   ├── export.js           # CSV export, share text and WhatsApp link helpers
│   ├── entry.js            # Stepper and Hath auto-advance helpers
│   ├── stats.test.js, export.test.js, entry.test.js  # Tests for the modules above
│   ├── cards.js            # Card codes, values and validation (rules engine)
│   ├── jokers.js           # Joker cards for the opened card and Joker points
│   ├── hand.js             # Best grouping of a hand: Hath and Joker points
│   ├── handEntry.js        # Card entry helpers and cached hand scoring
│   ├── CardPicker.js       # Card picker and hand breakdown UI
│   ├── recognition.js      # Photo recognition client helpers
│   ├── PhotoReview.js      # Photo check screen
│   ├── cards.test.js, jokers.test.js, hand.test.js, handEntry.test.js  # Tests for the card modules
│   ├── invite.js           # Session code and invite link helpers
│   └── index.js            # React entry point
├── vision/                 # Card recognition: OpenCV card detection, ONNX classifier, training
├── server/
│   ├── sessions.mjs        # Session store, undo history and JSON persistence
│   ├── vision.mjs          # Photo upload and the Python recognition worker
│   └── net.mjs             # LAN address detection
├── server.mjs              # HTTP and WebSocket game server
└── package.json
```

## License

MIT
