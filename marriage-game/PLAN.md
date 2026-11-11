# Implementation plan: Marriage Score Card

**What this plan is.** It is a step-by-step build plan for `/Users/shreyaagarwal/aakashk_personal/projects/marriage_game`, modeled on `/Users/shreyaagarwal/aakashk_personal/projects/begum-chor`. I read every source file in the reference. Nothing was written to disk. I ran the scoring formulas and the property-test generator in memory with `node -e`: all 7 worked examples produced the numbers below, and the generator checked 275 random rounds with 0 rounds that failed to sum to zero. The executor should do the phases in order and copy every code block exactly.

## Facts about the reference that shape this plan

- **Stack:** Create React App (`react-scripts` 5.0.1), React 19, chart.js with react-chartjs-2 (line chart of cumulative scores), `qrcode.react` (invite QR code), and `ws` for the WebSocket server. Frontend tests use Jest through `react-scripts test`. Server tests use `node:test` via `npm run test:server`.
- **Server (`server.mjs`):** one HTTP server on `PORT || 3001`. It serves `/health` and `/api/info` (LAN addresses from `server/net.mjs`), serves files from `build/`, and falls back to `index.html`. On the same port it runs a WebSocket server with the messages `create_session`, `join_session` and `update_scores`, and broadcasts `session_update`. Session codes look like `BC-1234`. Sessions live only in memory.
- **Client (`src/App.js`):** one file holding an `InviteCard` component and `App`. It reconnects after 2 s, auto-joins from `?session=` in the URL or a code saved in localStorage, sends the full state on every change, and has a fixed default player list. Sections: header (code, connection dot, New Game), invite card, round entry form, standings chips, Chart.js line chart, history table with an Edit button per row.
- **Styling:** `App.css` uses green and paper CSS variables, card sections, and media queries at 700px and 380px.
- **`src/App.test.js`** actually tests `scoring.js`. The new app names that file `src/scoring.test.js`.
- **The reference does not have** undo, delete, a setup screen, money totals or disk persistence. This plan adds all of them.
- **Build warning:** `CI=true npm run build` fails on any ESLint warning. All code below avoids warnings.

## Decisions the plan fixes (no open questions)

1. **Session codes** are `MG-` plus 4 digits. The localStorage key is `marriage_session`.
2. **Persistence:**
   - The server writes every session to `data/sessions.json`, or to the path in the `DATA_FILE` env var. It writes to a temp file and then renames it, so the write is atomic.
   - It saves after every create, update and undo, and loads the file at startup. Sessions now survive a server restart.
   - The client still stores only the session code in localStorage.
3. **Undo** lives on the server, so every device shares it. Each `update_game` pushes a snapshot `{players, settings, rounds}` onto `session.undo`, keeping at most 20. The `undo` message pops the latest snapshot and broadcasts it. Every state message includes `canUndo`.
4. **WebSocket protocol:**
   - Client to server: `create_session`, `join_session {sessionId}`, `update_game {sessionId, players, settings, rounds}`, `undo {sessionId}`.
   - Server to client: `session_created`, `session_joined` and `session_update`, each carrying `{sessionId?, players, settings, rounds, canUndo}`.
   - `error` (session not found) sends the client back to the lobby.
   - `update_rejected {message}` reports a bad update or "nothing to undo" without leaving the session.
5. **Data shapes:**
   - Round: `{ winner: string, entries: [{ player: string, maal: number, status: 'seen'|'unseen'|'dublee'|'out' }] }`.
   - Settings: `{ seenPenalty: 3, unseenPenalty: 10, enableDublee: true, dubleeWinnerPenalty: 5, pointValue: 0, currency: '₹' }`.
6. **Scoring conventions:**
   - **Unseen and "out" players hold no maal.** Their maal counts as 0 in their own score and in T, whatever was typed. This is the standard Nepali rule: you cannot claim maal without seeing.
   - **"Out" players** (sitting out a round) are left out of N and T and score 0 for that round.
   - **N** is the number of players who are not out. **T** is the sum of maal over those players.
   - **Non-winner score:** `maal*N - T - penalty`. The penalty is `unseenPenalty` if the player is unseen. Otherwise (seen or dublee) it is `seenPenalty`, or `dubleeWinnerPenalty` when the winner's status is dublee and dublee is enabled.
   - **Winner score:** `maal_w*N - T + sum(all penalties)`.
   - **Dublee non-winners** pay like seen players.
   - **If dublee is disabled** but a stored round contains `dublee`, it is scored as seen.
   - **Validity:** the winner must be seen or dublee (not unseen, not out). At least 2 players must play. Maal must be a whole number from 0 to 999. A blank maal box means 0.
   - **Invariant:** the scores in a round always add up to 0.
7. **Players** can be edited only while there are 0 rounds: 2 to 10 players, unique (ignoring case), at most 20 characters each. Settings can change at any time and apply to all past rounds, because nets are recalculated from the raw inputs. The UI shows a note saying this.
8. **Ranking:** the highest total leads. Ties share a rank (1, 1, 3), and tied players keep player-list order.
9. **Money:** when `pointValue > 0`, money is shown as sign + currency + amount with 2 decimals, rounded to the cent (for example `+₹20.50`, `-₹12.50`, `₹0.00`).
10. **History table:** there is no "Start" row. The chart starts with a "Start" point at 0.
11. **Default players:** `['Aakash', 'Shreya', 'Aryan', 'Paa', 'Maa']`, the same as the reference.
12. **Git:** do not run `git init` and do not commit. The user did not ask for it.

---

## Phase 1: Scaffold by copying game-agnostic files

- [ ] 1.1 Create the directories and copy the files that need no changes or only small ones:

```bash
mkdir -p /Users/shreyaagarwal/aakashk_personal/projects/marriage_game/server /Users/shreyaagarwal/aakashk_personal/projects/marriage_game/src /Users/shreyaagarwal/aakashk_personal/projects/marriage_game/public
cp /Users/shreyaagarwal/aakashk_personal/projects/begum-chor/.gitignore /Users/shreyaagarwal/aakashk_personal/projects/begum-chor/package-lock.json /Users/shreyaagarwal/aakashk_personal/projects/marriage_game/
cp /Users/shreyaagarwal/aakashk_personal/projects/begum-chor/server/net.mjs /Users/shreyaagarwal/aakashk_personal/projects/begum-chor/server/net.test.mjs /Users/shreyaagarwal/aakashk_personal/projects/marriage_game/server/
cp /Users/shreyaagarwal/aakashk_personal/projects/begum-chor/src/index.js /Users/shreyaagarwal/aakashk_personal/projects/begum-chor/src/index.css /Users/shreyaagarwal/aakashk_personal/projects/begum-chor/src/setupTests.js /Users/shreyaagarwal/aakashk_personal/projects/begum-chor/src/reportWebVitals.js /Users/shreyaagarwal/aakashk_personal/projects/begum-chor/src/invite.js /Users/shreyaagarwal/aakashk_personal/projects/begum-chor/src/invite.test.js /Users/shreyaagarwal/aakashk_personal/projects/begum-chor/src/App.css /Users/shreyaagarwal/aakashk_personal/projects/marriage_game/src/
cp /Users/shreyaagarwal/aakashk_personal/projects/begum-chor/public/favicon.ico /Users/shreyaagarwal/aakashk_personal/projects/begum-chor/public/logo192.png /Users/shreyaagarwal/aakashk_personal/projects/begum-chor/public/logo512.png /Users/shreyaagarwal/aakashk_personal/projects/begum-chor/public/robots.txt /Users/shreyaagarwal/aakashk_personal/projects/begum-chor/public/index.html /Users/shreyaagarwal/aakashk_personal/projects/marriage_game/public/
```

  Do NOT copy `src/App.js`, `src/App.test.js`, `src/scoring.js`, `src/logo.svg`, `server.mjs`, `README.md`, `public/manifest.json`, `node_modules` or `build`.

- [ ] 1.2 These files stay exactly as copied: `server/net.mjs`, `server/net.test.mjs`, `src/index.js`, `src/index.css`, `src/setupTests.js`, `src/reportWebVitals.js`, `public/favicon.ico`, `public/logo192.png`, `public/logo512.png`, `public/robots.txt`.

- [ ] 1.3 Change the session-code prefix (macOS `sed` needs `-i ''`):

```bash
sed -i '' 's/BC-/MG-/g' /Users/shreyaagarwal/aakashk_personal/projects/marriage_game/src/invite.js
sed -i '' -e 's/BC-/MG-/g' -e 's/bc-/mg-/g' -e 's/begam\.local/marriage.local/g' /Users/shreyaagarwal/aakashk_personal/projects/marriage_game/src/invite.test.js
grep -c 'BC-\|bc-\|begam' /Users/shreyaagarwal/aakashk_personal/projects/marriage_game/src/invite.js /Users/shreyaagarwal/aakashk_personal/projects/marriage_game/src/invite.test.js
```

  The `grep` must print `:0` for both files. `invite.js` now contains `/^MG-\d{4}$/`.

- [ ] 1.4 Update `public/index.html`:

```bash
sed -i '' -e 's/Begam Chor Score Card/Marriage Score Card/' -e 's/A live multiplayer Begam Chor score tracker\./A live multiplayer score tracker for the Marriage card game./' /Users/shreyaagarwal/aakashk_personal/projects/marriage_game/public/index.html
grep -n 'Marriage' /Users/shreyaagarwal/aakashk_personal/projects/marriage_game/public/index.html
```

  The `grep` must show 2 lines.

- [ ] 1.5 Make `.gitignore` ignore saved game data:

```bash
printf '\n# saved game sessions\n/data\n' >> /Users/shreyaagarwal/aakashk_personal/projects/marriage_game/.gitignore
```

- [ ] 1.6 Write `public/manifest.json`:

```json
{
  "short_name": "Marriage Score",
  "name": "Marriage Score Card",
  "icons": [
    { "src": "favicon.ico", "sizes": "64x64 32x32 24x24 16x16", "type": "image/x-icon" },
    { "src": "logo192.png", "type": "image/png", "sizes": "192x192" },
    { "src": "logo512.png", "type": "image/png", "sizes": "512x512" }
  ],
  "start_url": ".",
  "display": "standalone",
  "theme_color": "#176b55",
  "background_color": "#f5f7f2"
}
```

- [ ] 1.7 Write `package.json`. It is the reference file with a new `name` and one extra script. The lockfile was copied for reproducible versions, and `npm install` will update its name field.

```json
{
  "name": "marriage-score-card",
  "version": "0.1.0",
  "private": true,
  "dependencies": {
    "@testing-library/dom": "^10.4.1",
    "@testing-library/jest-dom": "^6.8.0",
    "@testing-library/react": "^16.3.0",
    "@testing-library/user-event": "^13.5.0",
    "chart.js": "^4.5.1",
    "qrcode.react": "^4.2.0",
    "react": "^19.1.1",
    "react-chartjs-2": "^5.3.0",
    "react-dom": "^19.1.1",
    "react-scripts": "5.0.1",
    "web-vitals": "^2.1.4",
    "ws": "^8.21.1"
  },
  "scripts": {
    "start": "react-scripts start",
    "build": "react-scripts build",
    "server": "node server.mjs",
    "test:server": "node --test server/*.test.mjs",
    "test": "react-scripts test",
    "test:all": "CI=true react-scripts test && node --test server/*.test.mjs",
    "eject": "react-scripts eject",
    "prod": "npm run build && node server.mjs"
  },
  "eslintConfig": {
    "extends": ["react-app", "react-app/jest"]
  },
  "browserslist": {
    "production": [">0.2%", "not dead", "not op_mini all"],
    "development": ["last 1 chrome version", "last 1 firefox version", "last 1 safari version"]
  }
}
```

- [ ] 1.8 Install dependencies:

```bash
cd /Users/shreyaagarwal/aakashk_personal/projects/marriage_game && npm install
```

---

## Phase 2: Scoring module (most important)

### Worked examples (verified numerically; each becomes a unit test)

Default settings: seen pays 3, unseen pays 10, dublee winner charges 5.

| # | Round | N | T | Results | Sum |
|---|---|---|---|---|---|
| 1 | Players A–D, winner A. A seen maal 10, B seen 5, C seen 0, D unseen (typed 7, ignored, counts as 0) | 4 | 15 | B = 5·4−15−3 = **2**. C = 0−15−3 = **−18**. D = 0−15−10 = **−25**. Winner bonus = 3+3+10 = 16. A = 40−15+16 = **41** | 0 |
| 2 | Players A–C, all seen, winner A. A maal 3, B 12, C 6 | 3 | 21 | B = 36−21−3 = **12**. C = 18−21−3 = **−6**. Bonus 6. A = 9−21+6 = **−6** (the winner can lose points) | 0 |
| 3 | Players A–E, winner A is dublee. A dublee 8, B seen 4, C dublee 6, D unseen, E unseen | 5 | 18 | Seen and dublee players pay 5. B = 20−18−5 = **−3**. C = 30−18−5 = **7**. D = E = −18−10 = **−28**. Bonus 5+5+10+10 = 30. A = 40−18+30 = **52** | 0 |
| 3b | Same round with `enableDublee: false` (dublee scored as seen, pays 3) | 5 | 18 | A **48**, B **−1**, C **9**, D **−28**, E **−28** | 0 |
| 4 | Settings seen 2, unseen 8. Players A–F, F out, winner C. A seen 9, B unseen, C seen 0, D seen 3, E seen 0 | 5 | 12 | A = 45−12−2 = **31**. B = −12−8 = **−20**. D = 15−12−2 = **1**. E = −12−2 = **−14**. Bonus 2+8+2+2 = 14. C = 0−12+14 = **2**. F = **0** | 0 |
| 5 | Players A–D, winner B. A seen 2, B seen 0, C seen 2, D seen 0 | 4 | 4 | A **1**, C **1**, D **−7**, B = 0−4+9 = **5** | 0 |
| 6 | Example 1 with seen 2, unseen 8 | 4 | 15 | A **37**, B **3**, C **−17**, D **−23** | 0 |
| 7 | Two players, A seen maal 0 wins, B unseen | 2 | 0 | A **10**, B **−10** | 0 |

**Running totals over example 1 then example 5:**
- After round 1: `{A:41, B:2, C:-18, D:-25}`
- After round 2: `{A:42, B:7, C:-17, D:-32}`

**Money at 0.5 per point:** 41 points is `+₹20.50`, −25 points is `-₹12.50`.

- [ ] 2.1 Write `src/scoring.js` exactly:

```js
export const STATUSES = ['seen', 'unseen', 'dublee', 'out'];
export const MIN_PLAYERS = 2;
export const MAX_PLAYERS = 10;
export const MAX_NAME_LENGTH = 20;
export const MAX_MAAL = 999;
export const MAX_PENALTY = 100;
export const MAX_POINT_VALUE = 10000;

// Keep in sync with DEFAULT_SETTINGS in server/sessions.mjs
export const DEFAULT_SETTINGS = Object.freeze({
  seenPenalty: 3,
  unseenPenalty: 10,
  enableDublee: true,
  dubleeWinnerPenalty: 5,
  pointValue: 0,
  currency: '₹'
});

function isBlank(value) {
  return value === '' || value === null || value === undefined;
}

function toNumber(value, fallback) {
  if (isBlank(value)) return fallback;
  const number = Number(value);
  return Number.isFinite(number) ? number : fallback;
}

function isWholeNumberInRange(value, min, max) {
  if (isBlank(value)) return false;
  const number = Number(value);
  return Number.isInteger(number) && number >= min && number <= max;
}

export function normalizeSettings(settings) {
  const source = settings || {};
  return {
    seenPenalty: toNumber(source.seenPenalty, DEFAULT_SETTINGS.seenPenalty),
    unseenPenalty: toNumber(source.unseenPenalty, DEFAULT_SETTINGS.unseenPenalty),
    enableDublee: typeof source.enableDublee === 'boolean' ? source.enableDublee : DEFAULT_SETTINGS.enableDublee,
    dubleeWinnerPenalty: toNumber(source.dubleeWinnerPenalty, DEFAULT_SETTINGS.dubleeWinnerPenalty),
    pointValue: toNumber(source.pointValue, DEFAULT_SETTINGS.pointValue),
    currency: typeof source.currency === 'string' ? source.currency : DEFAULT_SETTINGS.currency
  };
}

// Only players who have seen (or played dublee) can collect maal.
export function canHoldMaal(status) {
  return status === 'seen' || status === 'dublee';
}

export function effectiveMaal(entry) {
  if (!entry || !canHoldMaal(entry.status)) return 0;
  return Number(entry.maal) || 0;
}

export function validateRound(players, round, settings) {
  const s = normalizeSettings(settings);
  if (!round || !Array.isArray(round.entries)) return 'Round data is missing.';
  const entries = players.map(player => round.entries.find(entry => entry.player === player));
  if (entries.some(entry => !entry)) return 'Every player needs an entry for this round.';
  if (entries.some(entry => !STATUSES.includes(entry.status))) {
    return 'Choose seen, unseen, dublee or out for every player.';
  }
  if (!s.enableDublee && entries.some(entry => entry.status === 'dublee')) {
    return 'Dublee is turned off in settings. Mark those players as seen instead.';
  }
  const playing = entries.filter(entry => entry.status !== 'out');
  if (playing.length < MIN_PLAYERS) return 'At least 2 players must play the round.';
  for (const entry of playing) {
    if (!canHoldMaal(entry.status)) continue;
    const value = isBlank(entry.maal) ? 0 : Number(entry.maal);
    if (!Number.isInteger(value) || value < 0 || value > MAX_MAAL) {
      return `Maal for ${entry.player} must be a whole number between 0 and ${MAX_MAAL}.`;
    }
  }
  if (!round.winner) return 'Pick the winner of the round.';
  const winnerEntry = playing.find(entry => entry.player === round.winner);
  if (!winnerEntry) return 'The winner must be one of the players in this round.';
  if (!canHoldMaal(winnerEntry.status)) return 'The winner must have seen (or played dublee).';
  return null;
}

// net_i = maal_i * N - T - penalty_i for every non-winner
// net_w = maal_w * N - T + sum(penalties)
// N = players not sitting out, T = total maal of those players (unseen count as 0).
export function computeRound(round, settings) {
  const s = normalizeSettings(settings);
  const entries = round && Array.isArray(round.entries) ? round.entries : [];
  const playing = entries.filter(entry => entry.status !== 'out');
  const playerCount = playing.length;
  const maal = {};
  playing.forEach(entry => { maal[entry.player] = effectiveMaal(entry); });
  const totalMaal = playing.reduce((sum, entry) => sum + maal[entry.player], 0);

  const nets = {};
  const penalties = {};
  entries.forEach(entry => {
    nets[entry.player] = 0;
    penalties[entry.player] = 0;
  });

  const winnerEntry = playing.find(entry => entry.player === (round && round.winner));
  if (!winnerEntry || !canHoldMaal(winnerEntry.status)) {
    return { nets, penalties, totalMaal, playerCount, winnerBonus: 0, valid: false };
  }

  const winnerIsDublee = s.enableDublee && winnerEntry.status === 'dublee';
  const seenPays = winnerIsDublee ? s.dubleeWinnerPenalty : s.seenPenalty;
  let winnerBonus = 0;
  playing.forEach(entry => {
    if (entry.player === winnerEntry.player) return;
    const penalty = entry.status === 'unseen' ? s.unseenPenalty : seenPays;
    penalties[entry.player] = penalty;
    winnerBonus += penalty;
    nets[entry.player] = maal[entry.player] * playerCount - totalMaal - penalty;
  });
  nets[winnerEntry.player] = maal[winnerEntry.player] * playerCount - totalMaal + winnerBonus;

  return { nets, penalties, totalMaal, playerCount, winnerBonus, valid: true };
}

export function computeRunningTotals(rounds, players, settings) {
  const running = {};
  players.forEach(player => { running[player] = 0; });
  return (rounds || []).map(round => {
    const { nets } = computeRound(round, settings);
    players.forEach(player => { running[player] += nets[player] || 0; });
    return { ...running };
  });
}

export function computeTotals(rounds, players, settings) {
  const running = computeRunningTotals(rounds, players, settings);
  if (running.length) return running[running.length - 1];
  return players.reduce((totals, player) => {
    totals[player] = 0;
    return totals;
  }, {});
}

export function computeStandings(totals, players) {
  const rows = players.map((player, index) => ({ player, total: (totals && totals[player]) || 0, index }));
  rows.sort((a, b) => b.total - a.total || a.index - b.index);
  return rows.map(row => ({
    player: row.player,
    total: row.total,
    rank: rows.filter(other => other.total > row.total).length + 1
  }));
}

export function formatPoints(points) {
  const value = Number(points) || 0;
  return value > 0 ? `+${value}` : String(value);
}

export function formatMoney(points, settings) {
  const s = normalizeSettings(settings);
  const cents = Math.round((Number(points) || 0) * s.pointValue * 100);
  const amount = (Math.abs(cents) / 100).toFixed(2);
  const sign = cents > 0 ? '+' : cents < 0 ? '-' : '';
  return `${sign}${s.currency}${amount}`;
}

export function validateSetup(players, settings) {
  const names = (players || []).map(name => String(isBlank(name) ? '' : name).trim());
  if (names.length < MIN_PLAYERS || names.length > MAX_PLAYERS) {
    return `Add between ${MIN_PLAYERS} and ${MAX_PLAYERS} players.`;
  }
  if (names.some(name => !name)) return 'Every player needs a name.';
  if (names.some(name => name.length > MAX_NAME_LENGTH)) {
    return `Player names must be ${MAX_NAME_LENGTH} characters or fewer.`;
  }
  const lower = names.map(name => name.toLowerCase());
  if (new Set(lower).size !== lower.length) return 'Player names must be unique.';

  const s = settings || {};
  const penaltyKeys = ['seenPenalty', 'unseenPenalty', 'dubleeWinnerPenalty'];
  if (penaltyKeys.some(key => !isWholeNumberInRange(s[key], 0, MAX_PENALTY))) {
    return `Penalties must be whole numbers between 0 and ${MAX_PENALTY}.`;
  }
  const pointValue = isBlank(s.pointValue) ? NaN : Number(s.pointValue);
  if (!Number.isFinite(pointValue) || pointValue < 0 || pointValue > MAX_POINT_VALUE) {
    return `Point value must be a number between 0 and ${MAX_POINT_VALUE}.`;
  }
  if (typeof s.currency !== 'string' || s.currency.length > 3) {
    return 'Currency symbol must be 3 characters or fewer.';
  }
  return null;
}
```

- [ ] 2.2 Write `src/scoring.test.js` exactly:

```js
import {
  DEFAULT_SETTINGS,
  canHoldMaal,
  computeRound,
  computeRunningTotals,
  computeStandings,
  computeTotals,
  effectiveMaal,
  formatMoney,
  formatPoints,
  normalizeSettings,
  validateRound,
  validateSetup
} from './scoring';

const entry = (player, maal, status = 'seen') => ({ player, maal, status });
const sumNets = nets => Object.values(nets).reduce((sum, value) => sum + value, 0);

// Example 1: 4 players, A wins, D unseen (typed maal 7 is ignored).
const ROUND_1 = { winner: 'A', entries: [entry('A', 10), entry('B', 5), entry('C', 0), entry('D', 7, 'unseen')] };
// Example 2: 3 players all seen, the winner ends negative.
const ROUND_2 = { winner: 'A', entries: [entry('A', 3), entry('B', 12), entry('C', 6)] };
// Example 3: dublee winner, seen/dublee players pay 5.
const ROUND_3 = {
  winner: 'A',
  entries: [entry('A', 8, 'dublee'), entry('B', 4), entry('C', 6, 'dublee'), entry('D', 0, 'unseen'), entry('E', 0, 'unseen')]
};
// Example 4: custom penalties and one player sitting out.
const ROUND_4 = {
  winner: 'C',
  entries: [entry('A', 9), entry('B', 0, 'unseen'), entry('C', 0), entry('D', 3), entry('E', 0), entry('F', 0, 'out')]
};
const CUSTOM = { seenPenalty: 2, unseenPenalty: 8 };
// Example 5: second round used for running totals.
const ROUND_5 = { winner: 'B', entries: [entry('A', 2), entry('B', 0), entry('C', 2), entry('D', 0)] };
const ABCD = ['A', 'B', 'C', 'D'];

function makeRandom(seed) {
  let state = seed;
  return () => {
    state = (state * 1664525 + 1013904223) % 4294967296;
    return state / 4294967296;
  };
}

describe('settings', () => {
  test('falls back to defaults', () => {
    expect(normalizeSettings(null)).toEqual({ ...DEFAULT_SETTINGS });
    expect(normalizeSettings({ seenPenalty: 'abc', currency: 5 })).toEqual({ ...DEFAULT_SETTINGS });
  });

  test('coerces string inputs', () => {
    expect(normalizeSettings({ seenPenalty: '4', pointValue: '0.25', enableDublee: false })).toEqual({
      seenPenalty: 4, unseenPenalty: 10, enableDublee: false, dubleeWinnerPenalty: 5, pointValue: 0.25, currency: '₹'
    });
  });
});

describe('maal', () => {
  test('only seen and dublee players hold maal', () => {
    expect(canHoldMaal('seen')).toBe(true);
    expect(canHoldMaal('dublee')).toBe(true);
    expect(canHoldMaal('unseen')).toBe(false);
    expect(canHoldMaal('out')).toBe(false);
    expect(effectiveMaal(entry('A', '12'))).toBe(12);
    expect(effectiveMaal(entry('A', 4, 'dublee'))).toBe(4);
    expect(effectiveMaal(entry('A', 7, 'unseen'))).toBe(0);
    expect(effectiveMaal(entry('A', 9, 'out'))).toBe(0);
    expect(effectiveMaal(entry('A', ''))).toBe(0);
  });
});

describe('computeRound worked examples', () => {
  test('example 1: seen and unseen penalties go to the winner', () => {
    const result = computeRound(ROUND_1, DEFAULT_SETTINGS);
    expect(result.nets).toEqual({ A: 41, B: 2, C: -18, D: -25 });
    expect(result.totalMaal).toBe(15);
    expect(result.playerCount).toBe(4);
    expect(result.penalties).toEqual({ A: 0, B: 3, C: 3, D: 10 });
    expect(result.winnerBonus).toBe(16);
    expect(result.valid).toBe(true);
  });

  test('unseen maal is ignored', () => {
    const zeroed = { ...ROUND_1, entries: ROUND_1.entries.map(item => (item.player === 'D' ? entry('D', 0, 'unseen') : item)) };
    expect(computeRound(zeroed, DEFAULT_SETTINGS).nets).toEqual(computeRound(ROUND_1, DEFAULT_SETTINGS).nets);
  });

  test('example 2: the winner can finish negative', () => {
    const result = computeRound(ROUND_2, DEFAULT_SETTINGS);
    expect(result.nets).toEqual({ A: -6, B: 12, C: -6 });
    expect(result.totalMaal).toBe(21);
    expect(result.winnerBonus).toBe(6);
  });

  test('example 3: dublee winner charges seen and dublee players the dublee penalty', () => {
    const result = computeRound(ROUND_3, DEFAULT_SETTINGS);
    expect(result.nets).toEqual({ A: 52, B: -3, C: 7, D: -28, E: -28 });
    expect(result.totalMaal).toBe(18);
    expect(result.penalties).toEqual({ A: 0, B: 5, C: 5, D: 10, E: 10 });
    expect(result.winnerBonus).toBe(30);
  });

  test('example 3b: dublee is scored as seen when dublee is disabled', () => {
    expect(computeRound(ROUND_3, { enableDublee: false }).nets).toEqual({ A: 48, B: -1, C: 9, D: -28, E: -28 });
  });

  test('example 4: custom penalties and a player sitting out', () => {
    const result = computeRound(ROUND_4, CUSTOM);
    expect(result.nets).toEqual({ A: 31, B: -20, C: 2, D: 1, E: -14, F: 0 });
    expect(result.totalMaal).toBe(12);
    expect(result.playerCount).toBe(5);
    expect(result.winnerBonus).toBe(14);
  });

  test('two-player round', () => {
    expect(computeRound({ winner: 'A', entries: [entry('A', 0), entry('B', 0, 'unseen')] }, DEFAULT_SETTINGS).nets)
      .toEqual({ A: 10, B: -10 });
  });

  test('returns zero nets when the winner is invalid', () => {
    const unseenWinner = computeRound({ ...ROUND_1, winner: 'D' }, DEFAULT_SETTINGS);
    expect(unseenWinner.valid).toBe(false);
    expect(unseenWinner.nets).toEqual({ A: 0, B: 0, C: 0, D: 0 });
    expect(computeRound({ ...ROUND_1, winner: 'Z' }, DEFAULT_SETTINGS).valid).toBe(false);
  });
});

describe('zero-sum invariant', () => {
  test('every worked example sums to zero', () => {
    expect(sumNets(computeRound(ROUND_1, DEFAULT_SETTINGS).nets)).toBe(0);
    expect(sumNets(computeRound(ROUND_2, DEFAULT_SETTINGS).nets)).toBe(0);
    expect(sumNets(computeRound(ROUND_3, DEFAULT_SETTINGS).nets)).toBe(0);
    expect(sumNets(computeRound(ROUND_3, { enableDublee: false }).nets)).toBe(0);
    expect(sumNets(computeRound(ROUND_4, CUSTOM).nets)).toBe(0);
    expect(sumNets(computeRound(ROUND_5, DEFAULT_SETTINGS).nets)).toBe(0);
  });

  test('randomly generated valid rounds always sum to zero', () => {
    const random = makeRandom(42);
    const pool = ['seen', 'seen', 'seen', 'unseen', 'dublee', 'out'];
    let checked = 0;
    for (let i = 0; i < 300; i += 1) {
      const count = 2 + Math.floor(random() * 6);
      const entries = Array.from({ length: count }, (_, k) => {
        const status = pool[Math.floor(random() * pool.length)];
        return entry(`P${k}`, Math.floor(random() * 40), status);
      });
      const candidates = entries.filter(item => canHoldMaal(item.status));
      const playingCount = entries.filter(item => item.status !== 'out').length;
      if (!candidates.length || playingCount < 2) continue;
      const winner = candidates[Math.floor(random() * candidates.length)].player;
      const settings = {
        seenPenalty: Math.floor(random() * 6),
        unseenPenalty: Math.floor(random() * 15),
        dubleeWinnerPenalty: Math.floor(random() * 8),
        enableDublee: true
      };
      const round = { winner, entries };
      expect(validateRound(entries.map(item => item.player), round, settings)).toBeNull();
      const result = computeRound(round, settings);
      expect(result.valid).toBe(true);
      expect(sumNets(result.nets)).toBe(0);
      checked += 1;
    }
    expect(checked).toBeGreaterThan(100);
  });
});

describe('validateRound', () => {
  test('accepts valid rounds, blank maal and junk unseen maal', () => {
    expect(validateRound(ABCD, ROUND_1, DEFAULT_SETTINGS)).toBeNull();
    const blank = { ...ROUND_1, entries: ROUND_1.entries.map(item => (item.player === 'B' ? entry('B', '') : item)) };
    expect(validateRound(ABCD, blank, DEFAULT_SETTINGS)).toBeNull();
    const junk = { ...ROUND_1, entries: ROUND_1.entries.map(item => (item.player === 'D' ? entry('D', 'abc', 'unseen') : item)) };
    expect(validateRound(ABCD, junk, DEFAULT_SETTINGS)).toBeNull();
  });

  test('rejects structural problems', () => {
    expect(validateRound(ABCD, { winner: 'A', entries: ROUND_1.entries.slice(0, 3) }, DEFAULT_SETTINGS)).toMatch(/every player/i);
    const badStatus = { ...ROUND_1, entries: ROUND_1.entries.map(item => (item.player === 'B' ? entry('B', 5, 'maybe') : item)) };
    expect(validateRound(ABCD, badStatus, DEFAULT_SETTINGS)).toMatch(/choose seen/i);
    expect(validateRound(['A', 'B', 'C', 'D', 'E'], ROUND_3, { enableDublee: false })).toMatch(/dublee is turned off/i);
    expect(validateRound(['A', 'B'], { winner: 'A', entries: [entry('A', 3), entry('B', 0, 'out')] }, DEFAULT_SETTINGS))
      .toMatch(/at least 2/i);
  });

  test.each([[-1], [2.5], [1000]])('rejects maal %s', maal => {
    const round = { ...ROUND_1, entries: ROUND_1.entries.map(item => (item.player === 'B' ? entry('B', maal) : item)) };
    expect(validateRound(ABCD, round, DEFAULT_SETTINGS)).toMatch(/whole number between 0 and 999/i);
  });

  test('requires a seen winner who is playing', () => {
    expect(validateRound(ABCD, { ...ROUND_1, winner: '' }, DEFAULT_SETTINGS)).toMatch(/pick the winner/i);
    expect(validateRound(['A', 'B', 'C', 'D', 'E', 'F'], { ...ROUND_4, winner: 'F' }, CUSTOM)).toMatch(/one of the players/i);
    expect(validateRound(ABCD, { ...ROUND_1, winner: 'D' }, DEFAULT_SETTINGS)).toMatch(/winner must have seen/i);
  });
});

describe('totals and standings', () => {
  test('running totals and totals across rounds', () => {
    expect(computeRunningTotals([ROUND_1, ROUND_5], ABCD, DEFAULT_SETTINGS)).toEqual([
      { A: 41, B: 2, C: -18, D: -25 },
      { A: 42, B: 7, C: -17, D: -32 }
    ]);
    expect(computeRunningTotals([], ABCD, DEFAULT_SETTINGS)).toEqual([]);
    expect(computeTotals([ROUND_1, ROUND_5], [...ABCD, 'E'], DEFAULT_SETTINGS)).toEqual({ A: 42, B: 7, C: -17, D: -32, E: 0 });
    expect(computeTotals([], ABCD, DEFAULT_SETTINGS)).toEqual({ A: 0, B: 0, C: 0, D: 0 });
  });

  test('settings changes recalculate history', () => {
    expect(computeTotals([ROUND_1], ABCD, CUSTOM)).toEqual({ A: 37, B: 3, C: -17, D: -23 });
  });

  test('standings rank highest first and share tied ranks', () => {
    expect(computeStandings({ A: 42, B: 7, C: -17, D: -32 }, ['D', 'C', 'B', 'A'])).toEqual([
      { player: 'A', total: 42, rank: 1 },
      { player: 'B', total: 7, rank: 2 },
      { player: 'C', total: -17, rank: 3 },
      { player: 'D', total: -32, rank: 4 }
    ]);
    expect(computeStandings({ A: 5, B: 5, C: -10 }, ['A', 'B', 'C'])).toEqual([
      { player: 'A', total: 5, rank: 1 },
      { player: 'B', total: 5, rank: 1 },
      { player: 'C', total: -10, rank: 3 }
    ]);
    expect(computeStandings({}, ['A'])).toEqual([{ player: 'A', total: 0, rank: 1 }]);
  });
});

describe('formatting', () => {
  test('points', () => {
    expect(formatPoints(41)).toBe('+41');
    expect(formatPoints(0)).toBe('0');
    expect(formatPoints(-25)).toBe('-25');
  });

  test('money', () => {
    expect(formatMoney(41, { pointValue: 0.5 })).toBe('+₹20.50');
    expect(formatMoney(-25, { pointValue: 0.5 })).toBe('-₹12.50');
    expect(formatMoney(0, { pointValue: 0.5 })).toBe('₹0.00');
    expect(formatMoney(3, { pointValue: 0.1, currency: '$' })).toBe('+$0.30');
  });
});

describe('validateSetup', () => {
  const ok = { ...DEFAULT_SETTINGS };
  test('accepts a valid setup', () => {
    expect(validateSetup(['A', 'B'], ok)).toBeNull();
    expect(validateSetup(['A', 'B'], { ...ok, pointValue: '0.25', seenPenalty: '4' })).toBeNull();
  });

  test('rejects bad players', () => {
    expect(validateSetup(['A'], ok)).toMatch(/between 2 and 10/i);
    expect(validateSetup(Array.from({ length: 11 }, (_, i) => `P${i}`), ok)).toMatch(/between 2 and 10/i);
    expect(validateSetup(['A', ' '], ok)).toMatch(/needs a name/i);
    expect(validateSetup(['A', 'x'.repeat(21)], ok)).toMatch(/20 characters/i);
    expect(validateSetup(['Ram', 'ram'], ok)).toMatch(/unique/i);
  });

  test.each([['-1'], ['2.5'], [''], ['101']])('rejects penalty %s', value => {
    expect(validateSetup(['A', 'B'], { ...ok, seenPenalty: value })).toMatch(/penalties/i);
  });

  test('rejects bad money settings', () => {
    expect(validateSetup(['A', 'B'], { ...ok, pointValue: '-1' })).toMatch(/point value/i);
    expect(validateSetup(['A', 'B'], { ...ok, pointValue: 'abc' })).toMatch(/point value/i);
    expect(validateSetup(['A', 'B'], { ...ok, currency: 'RUPEE' })).toMatch(/currency/i);
  });
});
```

- [ ] 2.3 Run `cd /Users/shreyaagarwal/aakashk_personal/projects/marriage_game && CI=true npx react-scripts test --watchAll=false`. The scoring and invite suites must all pass before going on.

---

## Phase 3: Server session store (new, testable) and `server.mjs` (copy, then modify)

- [ ] 3.1 Write `server/sessions.mjs`:

```js
import fs from 'node:fs';
import path from 'node:path';

export const DEFAULT_PLAYERS = ['Aakash', 'Shreya', 'Aryan', 'Paa', 'Maa'];
// Keep in sync with DEFAULT_SETTINGS in src/scoring.js
export const DEFAULT_SETTINGS = {
  seenPenalty: 3,
  unseenPenalty: 10,
  enableDublee: true,
  dubleeWinnerPenalty: 5,
  pointValue: 0,
  currency: '₹'
};
export const MAX_UNDO = 20;
const CODE_PATTERN = /^MG-\d{4}$/;

const clone = value => JSON.parse(JSON.stringify(value));

export function isValidGameState(state) {
  return Boolean(state) &&
    Array.isArray(state.players) && state.players.length >= 2 && state.players.length <= 10 &&
    state.players.every(player => typeof player === 'string' && player.trim() !== '' && player.length <= 20) &&
    Boolean(state.settings) && typeof state.settings === 'object' && !Array.isArray(state.settings) &&
    Array.isArray(state.rounds) && state.rounds.length <= 500 &&
    state.rounds.every(round => round && typeof round.winner === 'string' && Array.isArray(round.entries));
}

export function generateCode(sessions, random = Math.random) {
  let code;
  do {
    code = `MG-${Math.floor(1000 + random() * 9000)}`;
  } while (sessions[code]);
  return code;
}

export function createSession() {
  return {
    players: [...DEFAULT_PLAYERS],
    settings: { ...DEFAULT_SETTINGS },
    rounds: [],
    undo: [],
    updatedAt: Date.now(),
    clients: []
  };
}

export function snapshot(session) {
  return clone({ players: session.players, settings: session.settings, rounds: session.rounds });
}

export function publicState(session) {
  return {
    players: session.players,
    settings: session.settings,
    rounds: session.rounds,
    canUndo: session.undo.length > 0
  };
}

export function applyUpdate(session, state) {
  if (!isValidGameState(state)) return false;
  session.undo.push(snapshot(session));
  if (session.undo.length > MAX_UNDO) session.undo.shift();
  const next = clone({ players: state.players, settings: state.settings, rounds: state.rounds });
  session.players = next.players;
  session.settings = next.settings;
  session.rounds = next.rounds;
  session.updatedAt = Date.now();
  return true;
}

export function applyUndo(session) {
  if (!session.undo.length) return false;
  const previous = session.undo.pop();
  session.players = previous.players;
  session.settings = previous.settings;
  session.rounds = previous.rounds;
  session.updatedAt = Date.now();
  return true;
}

export function serializeSessions(sessions) {
  const output = {};
  for (const [code, session] of Object.entries(sessions)) {
    output[code] = {
      players: session.players,
      settings: session.settings,
      rounds: session.rounds,
      undo: session.undo,
      updatedAt: session.updatedAt
    };
  }
  return output;
}

export function saveSessions(filePath, sessions) {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  const tempPath = `${filePath}.tmp`;
  fs.writeFileSync(tempPath, JSON.stringify(serializeSessions(sessions), null, 2));
  fs.renameSync(tempPath, filePath);
}

export function loadSessions(filePath) {
  let raw;
  try {
    raw = JSON.parse(fs.readFileSync(filePath, 'utf8'));
  } catch {
    return {};
  }
  const sessions = {};
  if (!raw || typeof raw !== 'object') return sessions;
  for (const [code, stored] of Object.entries(raw)) {
    if (!CODE_PATTERN.test(code) || !isValidGameState(stored)) continue;
    sessions[code] = {
      players: stored.players,
      settings: stored.settings,
      rounds: stored.rounds,
      undo: Array.isArray(stored.undo) ? stored.undo.filter(isValidGameState).slice(-MAX_UNDO) : [],
      updatedAt: Number(stored.updatedAt) || Date.now(),
      clients: []
    };
  }
  return sessions;
}
```

- [ ] 3.2 Write `server/sessions.test.mjs`:

```js
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {
  MAX_UNDO, applyUndo, applyUpdate, createSession, generateCode,
  isValidGameState, loadSessions, publicState, saveSessions
} from './sessions.mjs';

const SETTINGS = { seenPenalty: 3, unseenPenalty: 10, enableDublee: true, dubleeWinnerPenalty: 5, pointValue: 0, currency: '₹' };
const ROUND = { winner: 'A', entries: [{ player: 'A', maal: 10, status: 'seen' }, { player: 'B', maal: 0, status: 'unseen' }] };
const state = rounds => ({ players: ['A', 'B'], settings: SETTINGS, rounds });

test('creates a session with defaults and nothing to undo', () => {
  const session = createSession();
  const view = publicState(session);
  assert.equal(view.players.length, 5);
  assert.equal(view.settings.seenPenalty, 3);
  assert.deepEqual(view.rounds, []);
  assert.equal(view.canUndo, false);
});

test('generateCode skips codes already in use', () => {
  const values = [0, 0.5];
  const code = generateCode({ 'MG-1000': {} }, () => values.shift());
  assert.equal(code, 'MG-5500');
});

test('applyUpdate stores state and applyUndo restores the previous state', () => {
  const session = createSession();
  assert.equal(applyUpdate(session, state([ROUND])), true);
  assert.deepEqual(session.rounds, [ROUND]);
  assert.equal(publicState(session).canUndo, true);
  assert.equal(applyUpdate(session, state([ROUND, ROUND])), true);
  assert.equal(applyUndo(session), true);
  assert.deepEqual(session.rounds, [ROUND]);
  assert.equal(applyUndo(session), true);
  assert.deepEqual(session.rounds, []);
  assert.equal(session.players.length, 5);
  assert.equal(applyUndo(session), false);
});

test('rejects invalid state without recording undo', () => {
  const session = createSession();
  assert.equal(applyUpdate(session, { players: ['A'], settings: {}, rounds: [] }), false);
  assert.equal(applyUpdate(session, { players: ['A', 'B'], settings: {}, rounds: 'x' }), false);
  assert.equal(applyUpdate(session, { players: ['A', 'B'], settings: {}, rounds: [{ entries: [] }] }), false);
  assert.equal(session.undo.length, 0);
  assert.equal(isValidGameState(state([ROUND])), true);
});

test('caps undo history', () => {
  const session = createSession();
  for (let i = 0; i < MAX_UNDO + 5; i += 1) applyUpdate(session, state([ROUND]));
  assert.equal(session.undo.length, MAX_UNDO);
});

test('saves and loads sessions without clients', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'marriage-'));
  try {
    const file = path.join(dir, 'nested', 'sessions.json');
    const session = createSession();
    session.clients.push({ fake: true });
    applyUpdate(session, state([ROUND]));
    saveSessions(file, { 'MG-1234': session });
    const raw = JSON.parse(fs.readFileSync(file, 'utf8'));
    assert.equal('clients' in raw['MG-1234'], false);
    const loaded = loadSessions(file);
    assert.deepEqual(loaded['MG-1234'].rounds, [ROUND]);
    assert.deepEqual(loaded['MG-1234'].clients, []);
    assert.equal(publicState(loaded['MG-1234']).canUndo, true);

    fs.writeFileSync(file, JSON.stringify({ 'XX-1': state([]), 'MG-1111': { players: 'bad' } }));
    assert.deepEqual(loadSessions(file), {});
    assert.deepEqual(loadSessions(path.join(dir, 'missing.json')), {});
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});
```

- [ ] 3.3 Write `server.mjs`. The HTTP handling is the reference's, unchanged except for the fallback text. The WebSocket part is rewritten.

```js
import http from 'http';
import { WebSocketServer } from 'ws';
import fs from 'fs';
import os from 'os';
import path from 'path';
import { fileURLToPath } from 'url';
import { pickLanAddresses } from './server/net.mjs';
import {
  applyUndo, applyUpdate, createSession, generateCode, loadSessions, publicState, saveSessions
} from './server/sessions.mjs';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const PORT = process.env.PORT || 3001;
const DATA_FILE = process.env.DATA_FILE || path.join(__dirname, 'data', 'sessions.json');
const sessions = loadSessions(DATA_FILE);

function persist() {
  try {
    saveSessions(DATA_FILE, sessions);
  } catch (error) {
    console.error('Could not save sessions:', error.message);
  }
}

function send(ws, payload) {
  if (ws.readyState === 1) ws.send(JSON.stringify(payload));
}

function broadcast(session) {
  const message = { type: 'session_update', ...publicState(session) };
  session.clients.forEach(client => send(client, message));
}

function detach(ws) {
  if (ws.sessionId && sessions[ws.sessionId]) {
    sessions[ws.sessionId].clients = sessions[ws.sessionId].clients.filter(client => client !== ws);
  }
  ws.sessionId = null;
}

const wss = new WebSocketServer({ noServer: true });

const server = http.createServer((req, res) => {
  // COPY lines 16-67 of begum-chor/server.mjs VERBATIM here (CORS headers, OPTIONS,
  // /health, /api/info, static build serving, SPA fallback), changing ONLY the final
  // fallback text to: 'Marriage Server (build not found, run npm run build)'
});

server.on('upgrade', (request, socket, head) => {
  wss.handleUpgrade(request, socket, head, (ws) => {
    wss.emit('connection', ws, request);
  });
});

wss.on('connection', (ws) => {
  ws.sessionId = null;

  ws.on('message', (data) => {
    let msg;
    try {
      msg = JSON.parse(data);
    } catch (error) {
      console.error('Invalid message:', error);
      return;
    }

    switch (msg.type) {
      case 'create_session': {
        detach(ws);
        const code = generateCode(sessions);
        const session = createSession();
        sessions[code] = session;
        ws.sessionId = code;
        session.clients.push(ws);
        persist();
        send(ws, { type: 'session_created', sessionId: code, ...publicState(session) });
        break;
      }
      case 'join_session': {
        const code = String(msg.sessionId || '').trim().toUpperCase();
        const session = sessions[code];
        if (!session) {
          send(ws, { type: 'error', message: 'Session not found. Check the code and try again.' });
          return;
        }
        detach(ws);
        ws.sessionId = code;
        session.clients.push(ws);
        send(ws, { type: 'session_joined', sessionId: code, ...publicState(session) });
        break;
      }
      case 'update_game': {
        const session = sessions[msg.sessionId];
        if (!session) {
          send(ws, { type: 'error', message: 'Session not found. Check the code and try again.' });
          return;
        }
        if (!applyUpdate(session, msg)) {
          send(ws, { type: 'update_rejected', message: 'The server rejected that change. Refresh and try again.' });
          return;
        }
        persist();
        broadcast(session);
        break;
      }
      case 'undo': {
        const session = sessions[msg.sessionId];
        if (!session) {
          send(ws, { type: 'error', message: 'Session not found. Check the code and try again.' });
          return;
        }
        if (!applyUndo(session)) {
          send(ws, { type: 'update_rejected', message: 'Nothing to undo.' });
          return;
        }
        persist();
        broadcast(session);
        break;
      }
      default:
        break;
    }
  });

  ws.on('close', () => detach(ws));
});

server.listen(PORT, '0.0.0.0', () => {
  const port = server.address().port;
  const addresses = pickLanAddresses(os.networkInterfaces());
  console.log('Marriage server running:');
  console.log(`  Local:   http://localhost:${port}`);
  addresses.forEach(address => console.log(`  Network: http://${address}:${port}`));
  if (!addresses.length) console.log('  Network: no private IPv4 address detected');
  console.log(`  Data:    ${DATA_FILE}`);
});
```

  The executor must paste the real HTTP handler body (reference lines 16-67) where the comment is. The only change is the string on line 66.

- [ ] 3.4 Run `cd /Users/shreyaagarwal/aakashk_personal/projects/marriage_game && npm run test:server`. It must report 8 passing tests: 2 from net and 6 from sessions.

---

## Phase 4: Frontend `src/App.js` (new, written exactly)

- [ ] 4.1 Write `src/App.js`. The `InviteCard` component and `setAddressSession` are copied verbatim from reference `src/App.js` lines 23-100. Everything else is new.

```js
import { useMemo, useState, useEffect, useRef } from 'react';
import { Line } from 'react-chartjs-2';
import { QRCodeSVG } from 'qrcode.react';
import {
  Chart as ChartJS, CategoryScale, LinearScale, PointElement, LineElement, Title, Tooltip, Legend
} from 'chart.js';
import {
  DEFAULT_SETTINGS, canHoldMaal, computeRound, computeRunningTotals, computeStandings, computeTotals,
  formatMoney, formatPoints, normalizeSettings, validateRound, validateSetup
} from './scoring';
import { buildInviteUrl, parseSessionCode } from './invite';
import './App.css';

ChartJS.register(CategoryScale, LinearScale, PointElement, LineElement, Title, Tooltip, Legend);

const WS_URL = process.env.REACT_APP_WS_URL || `ws://${window.location.hostname}:3001`;
const STORAGE_KEY = 'marriage_session';
const PLAYER_COLORS = ['#d1495b', '#00798c', '#edae49', '#30638e', '#6a994e', '#8e5572', '#f4845f', '#5f6caf', '#2a9d8f', '#7a5c3e'];
const DEFAULT_PLAYERS = ['Aakash', 'Shreya', 'Aryan', 'Paa', 'Maa'];
const STATUS_LABELS = { seen: 'Seen', unseen: 'Unseen', dublee: 'Dublee', out: 'Out' };

// >>> PASTE reference App.js lines 23-100 here verbatim (setAddressSession + InviteCard) <<<

function settingsToDraft(settings) {
  const s = normalizeSettings(settings);
  return {
    seenPenalty: String(s.seenPenalty),
    unseenPenalty: String(s.unseenPenalty),
    enableDublee: s.enableDublee,
    dubleeWinnerPenalty: String(s.dubleeWinnerPenalty),
    pointValue: String(s.pointValue),
    currency: s.currency
  };
}

function cellLabel(entry, winner) {
  if (!entry) return '';
  const parts = [];
  if (entry.player === winner) parts.push('Winner');
  if (entry.status === 'seen') parts.push(`Maal ${entry.maal}`);
  if (entry.status === 'dublee') parts.push(`Dublee · Maal ${entry.maal}`);
  if (entry.status === 'unseen') parts.push('Unseen');
  if (entry.status === 'out') parts.push('Sat out');
  return parts.join(' · ');
}

function App() {
  const [sessionId, setSessionId] = useState(null);
  const [joinCode, setJoinCode] = useState('');
  const [sessionError, setSessionError] = useState('');
  const [players, setPlayers] = useState(DEFAULT_PLAYERS);
  const [settings, setSettings] = useState(() => normalizeSettings(DEFAULT_SETTINGS));
  const [rounds, setRounds] = useState([]);
  const [canUndo, setCanUndo] = useState(false);
  const [winner, setWinner] = useState('');
  const [maalInputs, setMaalInputs] = useState({});
  const [statuses, setStatuses] = useState({});
  const [roundError, setRoundError] = useState('');
  const [editingRound, setEditingRound] = useState(null);
  const [setupOpen, setSetupOpen] = useState(false);
  const [draftPlayers, setDraftPlayers] = useState(DEFAULT_PLAYERS);
  const [draftSettings, setDraftSettings] = useState(() => settingsToDraft(DEFAULT_SETTINGS));
  const [setupError, setSetupError] = useState('');
  const [loading, setLoading] = useState(true);
  const [connected, setConnected] = useState(false);
  const [inviteInfo, setInviteInfo] = useState(null);
  const [showQr, setShowQr] = useState(() => window.matchMedia?.('(max-width: 700px)').matches || false);
  const wsRef = useRef(null);
  const formRef = useRef(null);
  const savedSessionRef = useRef(null);
  const pendingInviteRef = useRef(false);

  useEffect(() => {
    let stopped = false;
    let reconnectTimer;
    const inviteCode = parseSessionCode(window.location.search);
    pendingInviteRef.current = Boolean(inviteCode);
    savedSessionRef.current = inviteCode || localStorage.getItem(STORAGE_KEY);

    function applyGameState(msg) {
      setPlayers(msg.players);
      setSettings(normalizeSettings(msg.settings));
      setRounds(msg.rounds);
      setCanUndo(Boolean(msg.canUndo));
    }

    function enterSession(msg) {
      localStorage.setItem(STORAGE_KEY, msg.sessionId);
      savedSessionRef.current = msg.sessionId;
      pendingInviteRef.current = false;
      setAddressSession(msg.sessionId);
      setSessionId(msg.sessionId);
      applyGameState(msg);
      setDraftPlayers(msg.players);
      setDraftSettings(settingsToDraft(msg.settings));
      setSetupError('');
      setSetupOpen(msg.rounds.length === 0);
      setLoading(false);
    }

    function connect() {
      if (stopped) return;
      const ws = new WebSocket(WS_URL);
      wsRef.current = ws;

      ws.onopen = () => {
        if (stopped) return;
        setConnected(true);
        if (savedSessionRef.current) {
          ws.send(JSON.stringify({ type: 'join_session', sessionId: savedSessionRef.current }));
        } else {
          setLoading(false);
        }
      };

      ws.onmessage = (event) => {
        const msg = JSON.parse(event.data);
        switch (msg.type) {
          case 'session_created':
          case 'session_joined':
            enterSession(msg);
            break;
          case 'session_update':
            applyGameState(msg);
            setEditingRound(current => (current !== null && current >= msg.rounds.length ? null : current));
            break;
          case 'update_rejected':
            setRoundError(msg.message);
            break;
          case 'error':
            setSessionError(pendingInviteRef.current
              ? 'This invite link is no longer active. Ask the host to create a new session.'
              : msg.message);
            if (pendingInviteRef.current) setAddressSession(null);
            pendingInviteRef.current = false;
            localStorage.removeItem(STORAGE_KEY);
            savedSessionRef.current = null;
            setSessionId(null);
            setLoading(false);
            break;
          default:
            break;
        }
      };

      ws.onclose = () => {
        if (stopped) return;
        setConnected(false);
        setLoading(false);
        reconnectTimer = setTimeout(connect, 2000);
      };

      ws.onerror = () => {
        setConnected(false);
        setLoading(false);
      };
    }

    connect();
    return () => {
      stopped = true;
      clearTimeout(reconnectTimer);
      if (wsRef.current) wsRef.current.close();
    };
  }, []);

  // >>> PASTE reference App.js lines 206-227 verbatim (the inviteInfo useEffect) <<<

  const canSend = (setError) => {
    if (!wsRef.current || wsRef.current.readyState !== WebSocket.OPEN) {
      setError('Disconnected from the game server. Reconnecting…');
      return false;
    }
    return true;
  };

  const sendGame = (next, setError) => {
    if (!canSend(setError)) return false;
    wsRef.current.send(JSON.stringify({
      type: 'update_game', sessionId, players: next.players, settings: next.settings, rounds: next.rounds
    }));
    setPlayers(next.players);
    setSettings(next.settings);
    setRounds(next.rounds);
    setCanUndo(true);
    return true;
  };

  // ---- round form ----
  const statusOf = player => statuses[player] || 'seen';
  const statusOptions = settings.enableDublee ? ['seen', 'unseen', 'dublee', 'out'] : ['seen', 'unseen', 'out'];

  const resetRoundForm = () => {
    setWinner('');
    setMaalInputs({});
    setStatuses({});
    setRoundError('');
  };

  const handleMaalChange = (player, value) => {
    if (value === '' || /^\d{1,3}$/.test(value)) {
      setMaalInputs(previous => ({ ...previous, [player]: value }));
      setRoundError('');
    }
  };

  const handleStatusChange = (player, status) => {
    setStatuses(previous => ({ ...previous, [player]: status }));
    if (!canHoldMaal(status)) setMaalInputs(previous => ({ ...previous, [player]: '' }));
    if (!canHoldMaal(status)) setWinner(current => (current === player ? '' : current));
    setRoundError('');
  };

  const handleWinnerChange = (player) => {
    setWinner(player);
    if (!canHoldMaal(statusOf(player))) setStatuses(previous => ({ ...previous, [player]: 'seen' }));
    setRoundError('');
  };

  const draftRound = {
    winner,
    entries: players.map(player => {
      const status = statusOf(player);
      const raw = maalInputs[player];
      return { player, status, maal: canHoldMaal(status) && raw !== undefined && raw !== '' ? Number(raw) : 0 };
    })
  };
  const draftError = validateRound(players, draftRound, settings);
  const preview = draftError ? null : computeRound(draftRound, settings);
  const livePlaying = draftRound.entries.filter(item => item.status !== 'out');
  const liveTotalMaal = livePlaying.reduce((sum, item) => sum + item.maal, 0);

  const handleRoundSubmit = (event) => {
    event.preventDefault();
    if (draftError) {
      setRoundError(draftError);
      return;
    }
    const newRounds = editingRound !== null
      ? rounds.map((round, index) => (index === editingRound ? draftRound : round))
      : [...rounds, draftRound];
    if (!sendGame({ players, settings, rounds: newRounds }, setRoundError)) return;
    setEditingRound(null);
    resetRoundForm();
  };

  const handleEditRound = (roundIndex) => {
    if (editingRound === roundIndex) {
      setEditingRound(null);
      resetRoundForm();
      return;
    }
    const round = rounds[roundIndex];
    const nextStatuses = {};
    const nextMaal = {};
    round.entries.forEach(item => {
      nextStatuses[item.player] = item.status;
      nextMaal[item.player] = canHoldMaal(item.status) ? String(item.maal) : '';
    });
    setEditingRound(roundIndex);
    setStatuses(nextStatuses);
    setMaalInputs(nextMaal);
    setWinner(round.winner);
    setRoundError('');
    formRef.current?.scrollIntoView?.({ behavior: 'smooth', block: 'start' });
  };

  const handleDeleteRound = (roundIndex) => {
    if (!window.confirm(`Delete round ${roundIndex + 1}? You can undo this.`)) return;
    const newRounds = rounds.filter((_, index) => index !== roundIndex);
    if (!sendGame({ players, settings, rounds: newRounds }, setRoundError)) return;
    setEditingRound(null);
    resetRoundForm();
  };

  const handleUndo = () => {
    if (!canUndo || !canSend(setRoundError)) return;
    wsRef.current.send(JSON.stringify({ type: 'undo', sessionId }));
    setEditingRound(null);
    resetRoundForm();
  };

  // ---- setup ----
  const playersLocked = rounds.length > 0;

  const openSetup = () => {
    setDraftPlayers(players);
    setDraftSettings(settingsToDraft(settings));
    setSetupError('');
    setSetupOpen(true);
  };
  const toggleSetup = () => (setupOpen ? setSetupOpen(false) : openSetup());

  const handleDraftPlayerChange = (index, value) => {
    setDraftPlayers(previous => previous.map((name, i) => (i === index ? value : name)));
    setSetupError('');
  };
  const handleAddPlayer = () => {
    setDraftPlayers(previous => [...previous, `Player ${previous.length + 1}`]);
    setSetupError('');
  };
  const handleRemovePlayer = (index) => {
    setDraftPlayers(previous => previous.filter((_, i) => i !== index));
    setSetupError('');
  };
  const handleDraftSettingChange = (key, value) => {
    setDraftSettings(previous => ({ ...previous, [key]: value }));
    setSetupError('');
  };

  const handleSetupSave = (event) => {
    event.preventDefault();
    const nextPlayers = playersLocked ? players : draftPlayers.map(name => name.trim());
    const error = validateSetup(nextPlayers, draftSettings);
    if (error) {
      setSetupError(error);
      return;
    }
    const nextSettings = normalizeSettings(draftSettings);
    if (!sendGame({ players: nextPlayers, settings: nextSettings, rounds }, setSetupError)) return;
    setSetupOpen(false);
    if (!playersLocked) resetRoundForm();
  };

  // ---- lobby ----
  const handleCreateSession = () => {
    if (!connected || !wsRef.current || wsRef.current.readyState !== WebSocket.OPEN) {
      setSessionError('Not connected to server. Make sure the server is running.');
      return;
    }
    setSessionError('');
    wsRef.current.send(JSON.stringify({ type: 'create_session' }));
  };

  const handleJoinSession = () => {
    if (!connected || !wsRef.current || wsRef.current.readyState !== WebSocket.OPEN) {
      setSessionError('Not connected to server. Make sure the server is running.');
      return;
    }
    if (!joinCode.trim()) {
      setSessionError('Please enter a session code');
      return;
    }
    setSessionError('');
    wsRef.current.send(JSON.stringify({ type: 'join_session', sessionId: joinCode.trim().toUpperCase() }));
  };

  const handleNewGame = () => {
    localStorage.removeItem(STORAGE_KEY);
    setAddressSession(null);
    savedSessionRef.current = null;
    pendingInviteRef.current = false;
    setSessionId(null);
    setRounds([]);
    setCanUndo(false);
    resetRoundForm();
    setEditingRound(null);
    setSetupOpen(false);
    setJoinCode('');
    setSessionError('');
    setLoading(false);
  };

  // ---- derived ----
  const roundResults = useMemo(() => rounds.map(round => computeRound(round, settings)), [rounds, settings]);
  const runningTotals = useMemo(() => computeRunningTotals(rounds, players, settings), [rounds, players, settings]);
  const totals = useMemo(() => computeTotals(rounds, players, settings), [rounds, players, settings]);
  const standings = useMemo(() => computeStandings(totals, players), [totals, players]);
  const leaders = new Set(rounds.length ? standings.filter(row => row.rank === 1).map(row => row.player) : []);
  const showMoney = settings.pointValue > 0;

  const chartData = useMemo(() => ({
    labels: ['Start', ...rounds.map((_, index) => `R${index + 1}`)],
    datasets: players.map((player, index) => ({
      label: player,
      data: [0, ...runningTotals.map(row => row[player] || 0)],
      borderColor: PLAYER_COLORS[index % PLAYER_COLORS.length],
      backgroundColor: PLAYER_COLORS[index % PLAYER_COLORS.length],
      tension: 0.15,
      pointRadius: rounds.length > 12 ? 1 : 2,
      pointHoverRadius: 5,
      borderWidth: 2
    }))
  }), [rounds, players, runningTotals]);

  // >>> PASTE reference App.js lines 374-390 verbatim (chartOptions useMemo) <<<

  if (loading) {
    return <div className="App loading-screen"><h1>Marriage Score Card</h1><p>Loading…</p></div>;
  }

  if (!sessionId) {
    // >>> PASTE reference App.js lines 397-417 verbatim, with "Begam Chor Score Card" -> "Marriage Score Card"
    //     and placeholder "Enter session code (e.g., MG-1234)" <<<
  }

  return (
    <main className="App">
      <div className="session-header">
        <span className="session-code">Session: <strong>{sessionId}</strong></span>
        <span className={`connection-indicator ${connected ? 'connected' : 'disconnected'}`}>
          <span className="connection-dot" aria-hidden="true" />{connected ? 'Connected' : 'Reconnecting'}
        </span>
        <div className="header-actions">
          <button type="button" className="undo-btn" onClick={handleUndo} disabled={!canUndo}>Undo</button>
          <button type="button" className="new-game-btn" onClick={handleNewGame}>New Game</button>
        </div>
      </div>

      <h1>Marriage Score Card</h1>
      <InviteCard code={sessionId} inviteInfo={inviteInfo} expanded={showQr} onToggle={() => setShowQr(expanded => !expanded)} />

      <section className="setup-card" aria-labelledby="setup-heading">
        <div className="setup-heading-row">
          <h2 id="setup-heading">Game setup</h2>
          <button type="button" className="secondary-btn" onClick={toggleSetup} aria-expanded={setupOpen}>
            {setupOpen ? 'Close' : 'Edit setup'}
          </button>
        </div>
        {!setupOpen && (
          <p className="setup-summary">
            {players.length} players · Seen pays {settings.seenPenalty} · Unseen pays {settings.unseenPenalty}
            {settings.enableDublee ? ` · Dublee winner takes ${settings.dubleeWinnerPenalty}` : ' · Dublee off'}
            {showMoney ? ` · ${settings.currency}${settings.pointValue} per point` : ''}
          </p>
        )}
        {setupOpen && (
          <form className="setup-form" onSubmit={handleSetupSave} noValidate>
            <fieldset>
              <legend>Players</legend>
              {draftPlayers.map((name, index) => (
                <div className="setup-player-row" key={index}>
                  <input
                    type="text"
                    aria-label={`Player ${index + 1} name`}
                    value={name}
                    maxLength={20}
                    disabled={playersLocked}
                    onChange={event => handleDraftPlayerChange(index, event.target.value)}
                  />
                  <button type="button" className="remove-btn" onClick={() => handleRemovePlayer(index)}
                    disabled={playersLocked || draftPlayers.length <= 2}>Remove</button>
                </div>
              ))}
              <div>
                <button type="button" className="secondary-btn" onClick={handleAddPlayer}
                  disabled={playersLocked || draftPlayers.length >= 10}>Add player</button>
              </div>
              {playersLocked && <p className="setup-note">Players are locked once rounds exist. Start a new game to change players.</p>}
            </fieldset>
            <fieldset>
              <legend>Scoring</legend>
              <div className="settings-grid">
                <label className="setting-field">Seen player pays winner
                  <input type="number" inputMode="numeric" min="0" max="100" step="1" value={draftSettings.seenPenalty}
                    onChange={event => handleDraftSettingChange('seenPenalty', event.target.value)} />
                </label>
                <label className="setting-field">Unseen player pays winner
                  <input type="number" inputMode="numeric" min="0" max="100" step="1" value={draftSettings.unseenPenalty}
                    onChange={event => handleDraftSettingChange('unseenPenalty', event.target.value)} />
                </label>
                <label className="setting-field">Seen pays a dublee winner
                  <input type="number" inputMode="numeric" min="0" max="100" step="1" value={draftSettings.dubleeWinnerPenalty}
                    disabled={!draftSettings.enableDublee}
                    onChange={event => handleDraftSettingChange('dubleeWinnerPenalty', event.target.value)} />
                </label>
                <label className="setting-field">Money per point (0 = off)
                  <input type="number" inputMode="decimal" min="0" step="0.01" value={draftSettings.pointValue}
                    onChange={event => handleDraftSettingChange('pointValue', event.target.value)} />
                </label>
                <label className="setting-field">Currency symbol
                  <input type="text" maxLength={3} value={draftSettings.currency}
                    onChange={event => handleDraftSettingChange('currency', event.target.value)} />
                </label>
                <label className="flag-option">
                  <input type="checkbox" checked={draftSettings.enableDublee}
                    onChange={event => handleDraftSettingChange('enableDublee', event.target.checked)} />
                  <span>Allow dublee</span>
                </label>
              </div>
              {rounds.length > 0 && <p className="setup-note">Scoring changes recalculate every round.</p>}
            </fieldset>
            {setupError && <p className="error" role="alert">{setupError}</p>}
            <div className="setup-footer"><button type="submit">Save setup</button></div>
          </form>
        )}
      </section>

      <section className="score-input" aria-labelledby="round-entry-heading" ref={formRef}>
        <h2 id="round-entry-heading">
          {editingRound !== null ? `Edit Round ${editingRound + 1}` : `Enter Round ${rounds.length + 1}`}
        </h2>
        <form onSubmit={handleRoundSubmit} noValidate>
          <div className="player-entry-list">
            {players.map((player, index) => {
              const status = statusOf(player);
              const holdsMaal = canHoldMaal(status);
              const net = preview ? preview.nets[player] : null;
              const hasNet = net !== null && net !== undefined;
              return (
                <div key={player} className={`player-score ${winner === player ? 'is-winner' : ''}`}>
                  <label className="share-label" htmlFor={`maal-${index}`}>{player}</label>
                  <label className="winner-option">
                    <input type="radio" name="winner" checked={winner === player} disabled={status === 'out'}
                      aria-label={`${player} is the winner`} onChange={() => handleWinnerChange(player)} />
                    <span>Winner</span>
                  </label>
                  <input
                    id={`maal-${index}`}
                    className="share-input"
                    type="number"
                    inputMode="numeric"
                    min="0"
                    max="999"
                    step="1"
                    placeholder={holdsMaal ? '0' : '—'}
                    value={holdsMaal ? (maalInputs[player] ?? '') : ''}
                    disabled={!holdsMaal}
                    onChange={event => handleMaalChange(player, event.target.value)}
                    aria-label={`${player} maal`}
                  />
                  <div className="status-group" role="radiogroup" aria-label={`${player} status`}>
                    {statusOptions.map(option => (
                      <label key={option} className="status-option">
                        <input type="radio" name={`status-${index}`} value={option} checked={status === option}
                          onChange={() => handleStatusChange(player, option)} />
                        <span>{STATUS_LABELS[option]}</span>
                      </label>
                    ))}
                  </div>
                  <output className={`resolved-preview ${hasNet ? 'adjusted' : ''}`}>
                    {status === 'out' ? 'Sitting out' : hasNet ? `Net: ${formatPoints(net)}` : 'Net: —'}
                  </output>
                </div>
              );
            })}
          </div>
          <div className="round-form-footer">
            <p className="points-counter">Total maal {liveTotalMaal} · {livePlaying.length} playing</p>
            {roundError && <p className="error" role="alert">{roundError}</p>}
            {editingRound !== null && (
              <button type="button" className="secondary-btn" onClick={() => handleEditRound(editingRound)}>Cancel edit</button>
            )}
            <button type="submit">{editingRound !== null ? 'Save Round' : 'Submit Round'}</button>
          </div>
        </form>
      </section>

      <section className="standings" aria-label="Current standings">
        <h2>Standings <span>· highest score leads</span></h2>
        <div className="standing-chips">
          {standings.map(row => (
            <div className={`standing-chip ${leaders.has(row.player) ? 'leader' : ''}`} key={row.player}>
              <span className="standing-rank">#{row.rank}</span>
              <span>{row.player}</span>
              <strong>{formatPoints(row.total)}</strong>
              {showMoney && <small className="standing-money">{formatMoney(row.total, settings)}</small>}
            </div>
          ))}
        </div>
      </section>

      {rounds.length > 0 && (
        <>
          <section className="score-graph" aria-label="Cumulative score graph">
            <h2>Score Progress</h2>
            <div className="chart-container"><Line options={chartOptions} data={chartData} /></div>
          </section>

          <section className="score-table">
            <h2>Round History</h2>
            <div className="table-scroll">
              <table>
                <caption className="visually-hidden">Round-by-round nets and running totals</caption>
                <thead>
                  <tr>
                    <th scope="col">Round</th>
                    <th scope="col">Total maal</th>
                    {players.map(player => <th scope="col" key={player}>{player}</th>)}
                    <th scope="col">Actions</th>
                  </tr>
                </thead>
                <tbody>
                  {rounds.map((round, roundIndex) => {
                    const result = roundResults[roundIndex];
                    return (
                      <tr key={roundIndex} className={editingRound === roundIndex ? 'editing' : ''}>
                        <th scope="row">{roundIndex + 1}</th>
                        <td>{result.totalMaal}</td>
                        {players.map(player => {
                          const item = round.entries.find(e => e.player === player);
                          const net = result.nets[player] ?? 0;
                          const label = cellLabel(item, round.winner);
                          return (
                            <td key={player} className={player === round.winner ? 'winner-cell' : ''}>
                              <span className={net < 0 ? 'negative-score' : ''}>{item?.status === 'out' ? '—' : formatPoints(net)}</span>
                              {label && <span className="score-badge">{label}</span>}
                              <span className="running-total">Σ {formatPoints(runningTotals[roundIndex][player])}</span>
                            </td>
                          );
                        })}
                        <td className="row-actions">
                          <button type="button" className="edit-btn" onClick={() => handleEditRound(roundIndex)}>
                            {editingRound === roundIndex ? 'Cancel' : 'Edit'}
                          </button>
                          <button type="button" className="delete-btn" onClick={() => handleDeleteRound(roundIndex)}>Delete</button>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
                <tfoot>
                  <tr className="total-row">
                    <th scope="row">Total</th>
                    <td>—</td>
                    {players.map(player => (
                      <td className={totals[player] < 0 ? 'negative-score' : ''} key={player}>
                        <strong>{formatPoints(totals[player])}</strong>
                        {showMoney && <span className="money-total">{formatMoney(totals[player], settings)}</span>}
                        {leaders.has(player) && <span className="leader-badge">Leading</span>}
                      </td>
                    ))}
                    <td>—</td>
                  </tr>
                </tfoot>
              </table>
            </div>
          </section>
        </>
      )}
    </main>
  );
}

export default App;
```

  **Pasting notes for the executor:**
  - Reference lines 23-100 contain `setAddressSession` and `InviteCard`; paste them unchanged.
  - Lines 206-227 are the `inviteInfo` effect.
  - Lines 374-390 are `chartOptions`.
  - Lines 397-417 are the lobby JSX. Wrap them as `return ( ...JSX... );` inside the `if (!sessionId)` block, change the title to "Marriage Score Card", and change the placeholder to `MG-1234`.
  - Use `window.confirm`, not a bare `confirm`, to avoid an ESLint error.

---

## Phase 5: Styles (copy, then edit `src/App.css`)

- [ ] 5.1 Make these exact find-and-replace edits in `src/App.css`.

  **(a) Card selector list**
  - Find: `.session-join, .score-input, .score-graph, .score-table, .standings {`
  - Replace: `.session-join, .score-input, .score-graph, .score-table, .standings, .setup-card {`

  **(b) Desktop grid**
  - Find: `  grid-template-columns: minmax(76px, 1fr) 76px minmax(110px, 1fr) minmax(145px, 1.2fr) 115px;`
  - Replace: `  grid-template-columns: minmax(90px, 1fr) 104px 80px minmax(250px, 2fr) 110px;`

  **(c) Mobile block.** Find these 10 lines inside `@media (max-width: 700px)`:

```css
  .player-score {
    grid-template-columns: minmax(66px, 1fr) 64px minmax(100px, 1fr);
    gap: 6px 8px;
    padding: 9px;
  }
  .share-input { min-height: 44px; }
  .flag-option { grid-row: 2; min-height: 44px; font-size: .82rem; }
  .flag-option:nth-of-type(2) { grid-column: 1 / 2; }
  .flag-option:nth-of-type(3) { grid-column: 2 / 4; }
  .resolved-preview { grid-column: 3; grid-row: 1; font-size: .76rem; }
```

  Replace them with:

```css
  .player-score {
    grid-template-columns: minmax(0, 1fr) auto 64px;
    gap: 6px 8px;
    padding: 9px;
  }
  .share-label { grid-column: 1; grid-row: 1; }
  .winner-option { grid-column: 2; grid-row: 1; min-height: 44px; font-size: .82rem; }
  .share-input { grid-column: 3; grid-row: 1; min-height: 44px; }
  .status-group { grid-column: 1 / -1; grid-row: 2; }
  .resolved-preview { grid-column: 1 / -1; grid-row: 3; text-align: left; font-size: .78rem; }
```

  **(d) The 380px block.** Replace the whole `@media (max-width: 380px) { ... }` block with:

```css
@media (max-width: 380px) {
  .status-option span { padding: 6px 8px; font-size: .74rem; }
  .resolved-preview { font-size: .72rem; }
  .settings-grid { grid-template-columns: 1fr; }
}
```

- [ ] 5.2 Append this block at the end of the file:

```css
/* ---- Marriage additions ---- */
.header-actions { display: flex; gap: 8px; }
.undo-btn { background: #71817a; padding: 8px 13px; font-size: .86rem; }
.undo-btn:disabled, .secondary-btn:disabled, .remove-btn:disabled { cursor: not-allowed; }
.secondary-btn { background: #eef3ed; color: var(--green-dark); border: 1px solid var(--line); padding: 8px 13px; font-size: .86rem; }
.secondary-btn:hover { background: #e2ebe1; }

.setup-card { padding: 18px 20px; margin-bottom: 18px; }
.setup-heading-row { display: flex; align-items: center; justify-content: space-between; gap: 12px; }
.setup-heading-row h2 { margin: 0; }
.setup-summary { margin: 8px 0 0; color: var(--muted); font-size: .9rem; }
.setup-form { display: grid; gap: 16px; margin-top: 14px; }
.setup-card fieldset { margin: 0; padding: 12px 14px; border: 1px solid var(--line); border-radius: 10px; display: grid; gap: 10px; }
.setup-card legend { padding: 0 6px; font-weight: 700; }
.setup-player-row { display: flex; gap: 8px; }
.setup-player-row input, .setting-field input { min-height: 40px; padding: 7px 10px; border: 1px solid #cbd8ce; border-radius: 7px; font: inherit; background: white; color: var(--ink); }
.setup-player-row input { flex: 1 1 auto; min-width: 0; }
.setup-player-row input:disabled, .setting-field input:disabled { background: #f0f3ef; color: var(--muted); }
.remove-btn { background: #faeaea; color: var(--danger); padding: 7px 11px; font-size: .82rem; }
.remove-btn:hover { background: #f3d6d6; }
.settings-grid { display: grid; grid-template-columns: repeat(auto-fit, minmax(180px, 1fr)); gap: 10px 14px; align-items: end; }
.setting-field { display: grid; gap: 5px; font-size: .88rem; color: var(--muted); }
.setting-field input { width: 100%; }
.setup-note { margin: 0; color: var(--muted); font-size: .82rem; }
.setup-footer { display: flex; justify-content: flex-end; }

.player-score.is-winner { border-color: var(--gold); background: #fff8df; }
.winner-option { display: flex; align-items: center; gap: 7px; min-height: 42px; font-size: .9rem; cursor: pointer; }
.winner-option input { width: 19px; height: 19px; margin: 0; accent-color: var(--gold); }
.share-input:disabled { background: #eef1ed; color: var(--muted); }
.status-group { display: flex; flex-wrap: wrap; gap: 4px; }
.status-option { position: relative; cursor: pointer; }
.status-option input { position: absolute; opacity: 0; width: 1px; height: 1px; margin: 0; }
.status-option span { display: inline-block; padding: 7px 10px; border: 1px solid #cbd8ce; border-radius: 20px; background: white; font-size: .82rem; }
.status-option input:checked + span { background: var(--green); border-color: var(--green); color: white; font-weight: 650; }
.status-option input:focus-visible + span { outline: 3px solid #e5b740; outline-offset: 2px; }
.round-form-footer .secondary-btn { margin-left: auto; }
.round-form-footer .secondary-btn + button { margin-left: 0; }

.standing-rank { color: var(--muted); font-size: .8rem; }
.standing-money, .money-total { display: block; color: var(--muted); font-size: .74rem; font-weight: 400; font-variant-numeric: tabular-nums; }
.running-total { display: block; margin-top: 3px; color: var(--muted); font-size: .72rem; font-weight: 400; }
.winner-cell { background: #fffbea; }
.row-actions { white-space: nowrap; }
.delete-btn { margin: 0 0 0 6px; padding: 6px 10px; font-size: .82rem; background: #faeaea; color: var(--danger); }
.delete-btn:hover { background: #f3d6d6; }

@media (max-width: 700px) {
  .setup-card { padding: 14px; }
  .settings-grid { grid-template-columns: 1fr 1fr; }
  .standing-chip { flex-wrap: wrap; }
  .row-actions { white-space: normal; }
  .delete-btn { margin: 6px 0 0; }
}
```

---

## Phase 6: README

- [ ] 6.1 Write `README.md` using the reference's section order and tone:
  - Title: `# Marriage Score Card`, plus a one-paragraph intro about the Nepali/Indian 3-deck Marriage card game.
  - **Features:** live sync, invite link and QR, setup (players, penalties, dublee, money per point), round entry with winner / maal / Seen-Unseen-Dublee-Out, live net preview, round history with nets and running totals, chart, standings, edit, delete, shared undo, sessions saved to `data/sessions.json` that survive restarts.
  - The **How It Works** table copied from the reference.
  - **Scoring Rules:** the formula, the conventions from "Decisions" item 6, and worked example 1 as a table.
  - **Tech Stack:** change Storage to "JSON file on the server (`data/sessions.json`, override with `DATA_FILE`)".
  - **Getting Started, Development and Production:** copied from the reference, with Begam Chor replaced by Marriage.
  - **Scripts:** the reference table plus `npm run test:all`.
  - **Project Structure:** list `server/sessions.mjs`, `server/net.mjs`, `src/scoring.js`, `src/invite.js`, `src/App.js`.
  - **License:** MIT.

---

## Phase 7: Verification

- [ ] 7.1 Install: `cd /Users/shreyaagarwal/aakashk_personal/projects/marriage_game && npm install` should exit 0.
- [ ] 7.2 Frontend tests: `cd /Users/shreyaagarwal/aakashk_personal/projects/marriage_game && CI=true npm test`. Both suites, `scoring.test.js` and `invite.test.js`, must pass with 0 failures.
- [ ] 7.3 Server tests: `cd /Users/shreyaagarwal/aakashk_personal/projects/marriage_game && npm run test:server` should report 8 pass and 0 fail.
- [ ] 7.4 Build: `cd /Users/shreyaagarwal/aakashk_personal/projects/marriage_game && CI=true npm run build`. It must say "Compiled successfully". With `CI=true` any ESLint warning fails the build; fix the warning, never suppress it.
- [ ] 7.5 Start the server in the background on a spare port. Port 3001 may be taken by the begum-chor server.
  - Command: `cd /Users/shreyaagarwal/aakashk_personal/projects/marriage_game && PORT=3101 node server.mjs`, run in the background.
  - Its output should include "Marriage server running" and a "Data:" line.
- [ ] 7.6 Check the HTTP endpoints:
  - `curl -s http://localhost:3101/health` should print `{"ok":true}`.
  - `curl -s http://localhost:3101/api/info` should return JSON with `"port":3101`.
  - `curl -s http://localhost:3101/ | grep -o '<title>[^<]*</title>'` should print `<title>Marriage Score Card</title>`.
- [ ] 7.7 WebSocket smoke test, creating a session and adding one round:

```bash
cd /Users/shreyaagarwal/aakashk_personal/projects/marriage_game && node -e "
const WebSocket = require('ws');
const ws = new WebSocket('ws://localhost:3101');
ws.on('open', () => ws.send(JSON.stringify({ type: 'create_session' })));
ws.on('message', d => {
  const m = JSON.parse(d);
  console.log(m.type, m.sessionId || '', m.rounds.length, m.canUndo);
  if (m.type === 'session_created') {
    ws.send(JSON.stringify({ type: 'update_game', sessionId: m.sessionId, players: m.players, settings: m.settings,
      rounds: [{ winner: 'Aakash', entries: m.players.map(p => ({ player: p, maal: 0, status: 'seen' })) }] }));
  } else { ws.close(); }
});"
```

  Expected output is `session_created MG-xxxx 0 false` followed by `session_update  1 true`. Write down the code.

- [ ] 7.8 Persistence check:
  - Run `cat /Users/shreyaagarwal/aakashk_personal/projects/marriage_game/data/sessions.json | head -20`. It must contain the code.
  - Stop the server with `lsof -ti tcp:3101 | xargs kill` and start it again as in step 7.5.
  - Run the join script below with the noted code. It must print `session_joined MG-xxxx 1 true`.

```bash
cd /Users/shreyaagarwal/aakashk_personal/projects/marriage_game && CODE=MG-xxxx node -e "
const WebSocket = require('ws');
const ws = new WebSocket('ws://localhost:3101');
ws.on('open', () => ws.send(JSON.stringify({ type: 'join_session', sessionId: process.env.CODE })));
ws.on('message', d => { const m = JSON.parse(d); console.log(m.type, m.sessionId || '', m.rounds && m.rounds.length, m.canUndo); ws.close(); });"
```

- [ ] 7.9 Stop the server with `lsof -ti tcp:3101 | xargs kill`. Leave `data/`; it is gitignored.
- [ ] 7.10 Optional manual UI check. Run `npm run prod` (port 3001, only if it is free) and open http://localhost:3001.
  1. Create a session.
  2. In setup, set money per point to 0.5 and save.
  3. Enter example 1 with A=Aakash, B=Shreya, C=Aryan, D=Paa, and Maa set to Out. Before submitting, the preview should show +41 / +2 / −18 / −25 / Sitting out.
  4. Submit. Standings should show money `+₹20.50` for Aakash.
  5. Edit the round, delete it, then press Undo. The round should come back.
  6. Open the invite link in a second tab. Both tabs should stay in sync.

---

## Pitfalls for the executor

- Do not add an `App.test.js` that renders `<App/>`, because it opens a WebSocket in jsdom. All scoring tests live in `src/scoring.test.js`.
- `src/scoring.js` and `server/sessions.mjs` cannot import each other: CRA's `src` is not loadable as Node ESM. `DEFAULT_SETTINGS` is therefore duplicated on purpose. Keep the two copies identical.
- macOS `sed` needs `-i ''`.
- Shell variables do not carry over between tool calls. Always use absolute paths.
- Do not run `git init` or commit.

### Critical Files for Implementation
- /Users/shreyaagarwal/aakashk_personal/projects/marriage_game/src/scoring.js
- /Users/shreyaagarwal/aakashk_personal/projects/marriage_game/src/scoring.test.js
- /Users/shreyaagarwal/aakashk_personal/projects/marriage_game/src/App.js (from /Users/shreyaagarwal/aakashk_personal/projects/begum-chor/src/App.js)
- /Users/shreyaagarwal/aakashk_personal/projects/marriage_game/server/sessions.mjs, with /Users/shreyaagarwal/aakashk_personal/projects/marriage_game/server/sessions.test.mjs
- /Users/shreyaagarwal/aakashk_personal/projects/marriage_game/server.mjs (from /Users/shreyaagarwal/aakashk_personal/projects/begum-chor/server.mjs)