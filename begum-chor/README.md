# Begam Chor Score Card

A real-time multiplayer score tracker for the card game **Begam Chor** (also known as *Black Lady* or *Hearts*). Track scores across devices with live sync — no accounts, no sign-ups, just play.

---

## Features

- **Live sync** — all devices on the same session see scores update in real time
- **Session-based** — create a room, share the 4-digit code, and join from any device
- **Cumulative chart** — watch the score graph grow round by round
- **Edit rounds** — made a mistake? Edit any previous round
- **Validation** — enforces Kaali Begam (queen of spades) rules and score totals
- **No cloud dependency** — runs entirely on your local network via WebSocket

## How It Works

| Step | What happens |
|------|-------------|
| 1 | One player starts a **session** from their laptop |
| 2 | Other players **join** using the session code on their phones |
| 3 | Enter round scores from any device |
| 4 | All devices update instantly |

## Scoring Rules

- Each round, players enter their **share** of the 25 points. Shares must total exactly **25**, and at least one share must be **12 or more** (the Kaali Begam holder).
- Each player's entered share can also receive a separate adjustment through two checkboxes:

  | No Hath | Commit No Hath | Adjustment |
  |---------|----------------|------------|
  | No | No | 0 |
  | Yes | No | -5 |
  | Yes | Yes | -15 |
  | No | Yes | +25 |

- The round score is the entered share plus the checkbox adjustment. The share total remains 25 regardless of adjustments.
- Lowest cumulative score leads. The history table and chart show adjusted round scores.

## Tech Stack

| Layer | Technology |
|-------|-----------|
| Frontend | React 19 + Chart.js |
| Backend | Node.js + WebSocket (`ws`) |
| Real-time | WebSocket (no Firebase) |
| Storage | In-memory (volatile) |

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

Your laptop's IP is displayed in the terminal. Open `http://<YOUR_IP>:3000` (dev) or `http://<YOUR_IP>:3001` (prod) on any device on the same network.

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
| `npm test` | Run tests |

## Project Structure

```
begam-chor/
├── public/          # Static assets
├── src/
│   ├── App.js       # Main game component
│   ├── App.css      # Styling
│   └── index.js     # React entry point
├── server.mjs       # WebSocket game server
└── package.json
```

## License

MIT
