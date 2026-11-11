# Marriage Score Card

A real-time multiplayer score tracker for the **Marriage** card game, played with 3 or 4 players using the house rules (Bandh, Hath and Joker, with double rounds). Track scores across devices with live sync — no accounts, no sign-ups, just play.

---

## Features

- **Live sync** — all devices on the same session see scores update in real time
- **Session-based** — create a room, share the session code, and join from any device
- **Setup** — choose 3 or 4 players with the Game mode toggle and set the names
- **Round entry** — pick the Bandh closer, enter Hath (max 15) and Joker points, with a live preview and double-round banner
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
│   ├── invite.js           # Session code and invite link helpers
│   └── index.js            # React entry point
├── server/
│   ├── sessions.mjs        # Session store, undo history and JSON persistence
│   └── net.mjs             # LAN address detection
├── server.mjs              # HTTP and WebSocket game server
└── package.json
```

## License

MIT
