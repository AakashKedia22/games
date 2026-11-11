# Plan v3: game history, player stats, export/share, faster entry

Project: `/Users/shreyaagarwal/aakashk_personal/projects/marriage_game` (git repo, v2 committed as `80ac953`).
Build on the current code. Do not change the scoring rules in `src/scoring.js`.

## Features

1. **Game history** — a "Finish game" button archives the current game (players + rounds + time) in the session and starts a fresh game with the same players. Past games are listed newest first, with an **all-time leaderboard** across them. Finishing and deleting past games are undoable and sync to every device.
2. **Player stats** — per player for the current game: total, Bandh count, Hath points, Joker points, best round, worst round, doubles triggered.
3. **Export / share** — download the current game (or any past game) as CSV; share the standings as text (native share sheet when available, else WhatsApp link); a WhatsApp button always.
4. **Faster entry** — −/+ stepper buttons around every Hath and Joker box; Enter moves to the next box and submits from the last; Hath auto-advances once the number is complete; focusing a box selects its text.

## Decisions

- Archived game shape: `{ finishedAt: number (ms since epoch), players: string[], rounds: Round[] }`. Stored in `session.games` (max 200, oldest dropped). A game needs at least 1 round to be finished.
- Undo snapshots now include `games`, so Undo reverts a finish or a past-game delete.
- WebSocket: new client → server messages `finish_game {sessionId}` and `delete_game {sessionId, index}`. All state messages (`session_created`, `session_joined`, `session_update`) now carry `games`.
- Stats "Hath points" and "Joker points" include the ×2 multiplier, so Hath + Joker = Total.
- "Doubles triggered" = rounds where that player entered 20+ Joker.
- All-time leaderboard groups by exact player name. A win = rank 1 in a finished game (ties all count as wins). Sorted by total desc, then wins desc, then name.
- CSV columns: `Round,Bandh,Multiplier` then per player `<name> Hath,<name> Joker,<name> Points,<name> Total` (Hath/Joker are the unmultiplied components shown in the history table, Points is the round score after ×2, Total is the running total). Last row is `Total` with only the per-player Total columns filled. Text fields that start with `= + - @` get a leading `'` (spreadsheet formula injection guard); numbers are written as is.
- Hath auto-advance: after typing, move to the next box when the Hath value is complete: `'0'`, any value ≥ 2, or 2 digits. (Hath max is 15, so `1` may still become `10`–`15`.) Joker never auto-advances.
- No new npm dependencies.

---

## Phase 1: Server — `server/sessions.mjs` (replace the whole file, write exactly)

```js
import fs from 'node:fs';
import path from 'node:path';

export const DEFAULT_PLAYERS = ['Aakash', 'Shreya', 'Aryan', 'Paa'];
// Keep in sync with DEFAULT_SETTINGS in src/scoring.js
export const DEFAULT_SETTINGS = {};
export const MAX_UNDO = 20;
export const MAX_GAMES = 200;
const CODE_PATTERN = /^MG-\d{4}$/;

const clone = value => JSON.parse(JSON.stringify(value));

export function isValidGameState(state) {
  return Boolean(state) &&
    Array.isArray(state.players) && (state.players.length === 3 || state.players.length === 4) &&
    state.players.every(player => typeof player === 'string' && player.trim() !== '' && player.length <= 20) &&
    Boolean(state.settings) && typeof state.settings === 'object' && !Array.isArray(state.settings) &&
    Array.isArray(state.rounds) && state.rounds.length <= 500 &&
    state.rounds.every(round => round && Array.isArray(round.entries));
}

export function isValidArchivedGame(game) {
  return Boolean(game) && Number.isFinite(game.finishedAt) &&
    isValidGameState({ players: game.players, settings: {}, rounds: game.rounds }) &&
    game.rounds.length > 0;
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
    games: [],
    undo: [],
    updatedAt: Date.now(),
    clients: []
  };
}

export function snapshot(session) {
  return clone({ players: session.players, settings: session.settings, rounds: session.rounds, games: session.games });
}

export function publicState(session) {
  return {
    players: session.players,
    settings: session.settings,
    rounds: session.rounds,
    games: session.games,
    canUndo: session.undo.length > 0
  };
}

function pushUndo(session) {
  session.undo.push(snapshot(session));
  if (session.undo.length > MAX_UNDO) session.undo.shift();
}

export function applyUpdate(session, state) {
  if (!isValidGameState(state)) return false;
  pushUndo(session);
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
  if (Array.isArray(previous.games)) session.games = previous.games;
  session.updatedAt = Date.now();
  return true;
}

// Archive the current game and start a fresh one with the same players.
export function finishGame(session, now = Date.now()) {
  if (!session.rounds.length) return false;
  pushUndo(session);
  const game = clone({ finishedAt: now, players: session.players, rounds: session.rounds });
  session.games = [...session.games, game].slice(-MAX_GAMES);
  session.rounds = [];
  session.updatedAt = now;
  return true;
}

export function deleteGame(session, index) {
  if (!Number.isInteger(index) || index < 0 || index >= session.games.length) return false;
  pushUndo(session);
  session.games = session.games.filter((_, i) => i !== index);
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
      games: session.games,
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
      games: Array.isArray(stored.games) ? stored.games.filter(isValidArchivedGame).slice(-MAX_GAMES) : [],
      undo: Array.isArray(stored.undo) ? stored.undo.filter(isValidGameState).slice(-MAX_UNDO) : [],
      updatedAt: Number(stored.updatedAt) || Date.now(),
      clients: []
    };
  }
  return sessions;
}
```

## Phase 2: Server tests — append to `server/sessions.test.mjs`

2.1 Change the import to:
```js
import {
  MAX_GAMES, MAX_UNDO, applyUndo, applyUpdate, createSession, deleteGame, finishGame, generateCode,
  isValidArchivedGame, isValidGameState, loadSessions, publicState, saveSessions
} from './sessions.mjs';
```

2.2 In the first test ('creates a session with defaults…') add: `assert.deepEqual(view.games, []);`

2.3 Append these tests at the end of the file (write exactly):

```js
test('finishGame archives the current game and undo brings it back', () => {
  const session = createSession();
  applyUpdate(session, state([ROUND, ROUND]));
  assert.equal(finishGame(session, 1700000000000), true);
  assert.deepEqual(session.rounds, []);
  assert.equal(session.games.length, 1);
  assert.deepEqual(session.games[0], { finishedAt: 1700000000000, players: ['A', 'B', 'C'], rounds: [ROUND, ROUND] });
  assert.deepEqual(publicState(session).games, session.games);
  assert.equal(applyUndo(session), true);
  assert.deepEqual(session.games, []);
  assert.deepEqual(session.rounds, [ROUND, ROUND]);
});

test('finishGame refuses an empty game without recording undo', () => {
  const session = createSession();
  assert.equal(finishGame(session), false);
  assert.equal(session.undo.length, 0);
  assert.deepEqual(session.games, []);
});

test('applyUpdate keeps archived games', () => {
  const session = createSession();
  applyUpdate(session, state([ROUND]));
  finishGame(session, 1);
  applyUpdate(session, state([ROUND]));
  assert.equal(session.games.length, 1);
  assert.deepEqual(session.rounds, [ROUND]);
});

test('deleteGame removes one archived game and is undoable', () => {
  const session = createSession();
  applyUpdate(session, state([ROUND]));
  finishGame(session, 1);
  applyUpdate(session, state([ROUND, ROUND]));
  finishGame(session, 2);
  assert.equal(deleteGame(session, 5), false);
  assert.equal(deleteGame(session, -1), false);
  assert.equal(deleteGame(session, '0'), false);
  assert.equal(deleteGame(session, 0), true);
  assert.deepEqual(session.games.map(game => game.finishedAt), [2]);
  assert.equal(applyUndo(session), true);
  assert.deepEqual(session.games.map(game => game.finishedAt), [1, 2]);
});

test('archived games are capped', () => {
  const session = createSession();
  for (let i = 0; i < MAX_GAMES + 3; i += 1) {
    applyUpdate(session, state([ROUND]));
    finishGame(session, i);
  }
  assert.equal(session.games.length, MAX_GAMES);
  assert.equal(session.games[0].finishedAt, 3);
});

test('saves and loads archived games, dropping invalid ones', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'marriage-'));
  try {
    const file = path.join(dir, 'sessions.json');
    const session = createSession();
    applyUpdate(session, state([ROUND]));
    finishGame(session, 42);
    session.games.push({ finishedAt: 'x', players: ['A'], rounds: [] });
    saveSessions(file, { 'MG-2222': session });
    const loaded = loadSessions(file);
    assert.deepEqual(loaded['MG-2222'].games, [{ finishedAt: 42, players: ['A', 'B', 'C'], rounds: [ROUND] }]);
    assert.equal(isValidArchivedGame({ finishedAt: 1, players: ['A', 'B', 'C'], rounds: [] }), false);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});
```

## Phase 3: `server.mjs`

3.1 Add `deleteGame, finishGame` to the import from `./server/sessions.mjs` (keep alphabetical order: `applyUndo, applyUpdate, createSession, deleteGame, finishGame, generateCode, loadSessions, publicState, saveSessions`).

3.2 In the `switch (msg.type)` add, directly after the `case 'undo': { … }` block:

```js
      case 'finish_game':
      case 'delete_game': {
        const session = sessions[msg.sessionId];
        if (!session) {
          send(ws, { type: 'error', message: 'Session not found. Check the code and try again.' });
          return;
        }
        const changed = msg.type === 'finish_game' ? finishGame(session) : deleteGame(session, msg.index);
        if (!changed) {
          send(ws, {
            type: 'update_rejected',
            message: msg.type === 'finish_game'
              ? 'Play at least one round before finishing the game.'
              : 'That game could not be deleted. Refresh and try again.'
          });
          return;
        }
        persist();
        broadcast(session);
        break;
      }
```

Run `cd /Users/shreyaagarwal/aakashk_personal/projects/marriage_game && npm run test:server` → all pass (14 tests).

## Phase 4: New pure modules (write exactly)

### 4.1 `src/stats.js`

```js
import { DOUBLE_THRESHOLD, computeRounds, computeStandings, computeTotals } from './scoring';

export function computePlayerStats(rounds, players) {
  const list = rounds || [];
  const results = computeRounds(list);
  const stats = {};
  players.forEach(player => {
    stats[player] = {
      player, rounds: 0, total: 0, bandhs: 0, hathPoints: 0, jokerPoints: 0, best: null, worst: null, doublesTriggered: 0
    };
  });
  results.forEach((result, index) => {
    players.forEach(player => {
      const row = stats[player];
      const net = result.nets[player] ?? 0;
      const entry = list[index].entries.find(item => item.player === player);
      row.rounds += 1;
      row.total += net;
      row.hathPoints += (result.hath[player] ?? 0) * result.multiplier;
      row.jokerPoints += (result.joker[player] ?? 0) * result.multiplier;
      if (result.closer === player) row.bandhs += 1;
      row.best = row.best === null ? net : Math.max(row.best, net);
      row.worst = row.worst === null ? net : Math.min(row.worst, net);
      if (entry && Number(entry.joker) >= DOUBLE_THRESHOLD) row.doublesTriggered += 1;
    });
  });
  return players.map(player => stats[player]);
}

export function summarizeGame(game) {
  const totals = computeTotals(game.rounds, game.players);
  const standings = computeStandings(totals, game.players);
  return {
    finishedAt: game.finishedAt,
    players: game.players,
    roundCount: game.rounds.length,
    totals,
    standings,
    winners: standings.filter(row => row.rank === 1).map(row => row.player)
  };
}

export function computeAllTime(games) {
  const rows = {};
  (games || []).forEach(game => {
    const summary = summarizeGame(game);
    game.players.forEach(player => {
      if (!rows[player]) rows[player] = { player, games: 0, wins: 0, total: 0 };
      rows[player].games += 1;
      rows[player].total += summary.totals[player] || 0;
      if (summary.winners.includes(player)) rows[player].wins += 1;
    });
  });
  const list = Object.values(rows);
  list.sort((a, b) => b.total - a.total || b.wins - a.wins || a.player.localeCompare(b.player));
  return list.map(row => ({ ...row, rank: list.filter(other => other.total > row.total).length + 1 }));
}
```

### 4.2 `src/export.js`

```js
import { computeRounds, computeRunningTotals, computeStandings, computeTotals, formatPoints } from './scoring';

export function csvEscape(value) {
  if (typeof value === 'number') return String(value);
  let text = String(value ?? '');
  if (/^[=+\-@]/.test(text)) text = `'${text}`;
  return /[",\n\r]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text;
}

export function gameToCsv(players, rounds) {
  const results = computeRounds(rounds);
  const running = computeRunningTotals(rounds, players);
  const totals = computeTotals(rounds, players);
  const header = ['Round', 'Bandh', 'Multiplier'];
  players.forEach(player => header.push(`${player} Hath`, `${player} Joker`, `${player} Points`, `${player} Total`));
  const lines = [header];
  results.forEach((result, index) => {
    const row = [index + 1, result.closer ?? '', result.multiplier];
    players.forEach(player => {
      row.push(result.hath[player] ?? 0, result.joker[player] ?? 0, result.nets[player] ?? 0, running[index][player] ?? 0);
    });
    lines.push(row);
  });
  const totalRow = ['Total', '', ''];
  players.forEach(player => totalRow.push('', '', '', totals[player] ?? 0));
  lines.push(totalRow);
  return lines.map(line => line.map(csvEscape).join(',')).join('\n') + '\n';
}

export function standingsText(players, rounds, sessionId) {
  const count = (rounds || []).length;
  const lines = [`Marriage Score Card · ${sessionId}`];
  if (!count) {
    lines.push('No rounds played yet');
    return lines.join('\n');
  }
  lines.push(`After ${count} ${count === 1 ? 'round' : 'rounds'}`);
  computeStandings(computeTotals(rounds, players), players).forEach(row => {
    lines.push(`${row.rank}. ${row.player} ${formatPoints(row.total)}`);
  });
  return lines.join('\n');
}

export function whatsappUrl(text) {
  return `https://wa.me/?text=${encodeURIComponent(text)}`;
}

export function csvFileName(date) {
  const d = date instanceof Date ? date : new Date(date);
  const pad = number => String(number).padStart(2, '0');
  return `marriage-${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}.csv`;
}
```

### 4.3 `src/entry.js`

```js
export function stepValue(value, delta, min = 0, max) {
  const current = value === '' || value === undefined ? 0 : Number(value);
  let next = (Number.isFinite(current) ? current : 0) + delta;
  if (next < min) next = min;
  if (max !== undefined && next > max) next = max;
  return String(next);
}

// Hath tops out at 15, so "1" may still grow into 10-15; anything else is final.
export function isCompleteHath(value) {
  if (!value) return false;
  return value === '0' || value.length >= 2 || Number(value) >= 2;
}
```

## Phase 5: Tests for the new modules (write exactly)

### 5.1 `src/stats.test.js`

```js
import { computeAllTime, computePlayerStats, summarizeGame } from './stats';

const P4 = ['P1', 'P2', 'P3', 'P4'];
const round = (closer, hath, joker, players = P4) => ({
  entries: players.map((player, i) => ({ player, bandh: player === closer, hath: hath[i], joker: joker[i] }))
});
const EX3 = round('P1', [0, 0, 2, 12], [2, 5, 10, 25]);
const EX4 = round('P2', [5, 0, 15, 3], [1, 2, 3, 4]);
const R3 = round('P3', [15, 7, 0], [0, 30, 6], ['P1', 'P2', 'P3']);

test('player stats across a normal and a doubled round', () => {
  const stats = computePlayerStats([EX3, EX4], P4);
  expect(stats).toEqual([
    { player: 'P1', rounds: 2, total: -42, bandhs: 1, hathPoints: 4, jokerPoints: -46, best: -20, worst: -22, doublesTriggered: 0 },
    { player: 'P2', rounds: 2, total: 20, bandhs: 1, hathPoints: 46, jokerPoints: -26, best: 42, worst: -22, doublesTriggered: 0 },
    { player: 'P3', rounds: 2, total: -30, bandhs: 0, hathPoints: -32, jokerPoints: 2, best: -4, worst: -26, doublesTriggered: 0 },
    { player: 'P4', rounds: 2, total: 52, bandhs: 0, hathPoints: -18, jokerPoints: 70, best: 46, worst: 6, doublesTriggered: 1 }
  ]);
  stats.forEach(row => expect(row.hathPoints + row.jokerPoints).toBe(row.total));
});

test('player stats with no rounds', () => {
  expect(computePlayerStats([], ['A', 'B', 'C'])[0]).toEqual(
    { player: 'A', rounds: 0, total: 0, bandhs: 0, hathPoints: 0, jokerPoints: 0, best: null, worst: null, doublesTriggered: 0 }
  );
});

test('summarizeGame finds the winner and shared wins', () => {
  const summary = summarizeGame({ finishedAt: 5, players: P4, rounds: [EX3, EX4] });
  expect(summary.totals).toEqual({ P1: -42, P2: 20, P3: -30, P4: 52 });
  expect(summary.winners).toEqual(['P4']);
  expect(summary.roundCount).toBe(2);
  const tied = summarizeGame({ finishedAt: 6, players: ['A', 'B', 'C'], rounds: [round('A', [0, 0, 0], [0, 0, 0], ['A', 'B', 'C'])] });
  expect(tied.winners).toEqual(['A', 'B', 'C']);
});

test('all-time leaderboard across games', () => {
  const games = [
    { finishedAt: 1, players: P4, rounds: [EX3, EX4] },
    { finishedAt: 2, players: ['P1', 'P2', 'P3'], rounds: [R3] }
  ];
  expect(computeAllTime(games)).toEqual([
    { player: 'P2', games: 2, wins: 1, total: 67, rank: 1 },
    { player: 'P4', games: 1, wins: 1, total: 52, rank: 2 },
    { player: 'P3', games: 2, wins: 0, total: -26, rank: 3 },
    { player: 'P1', games: 2, wins: 0, total: -93, rank: 4 }
  ]);
  expect(computeAllTime([])).toEqual([]);
});
```

### 5.2 `src/export.test.js`

```js
import { csvEscape, csvFileName, gameToCsv, standingsText, whatsappUrl } from './export';

const P4 = ['P1', 'P2', 'P3', 'P4'];
const round = (closer, hath, joker, players = P4) => ({
  entries: players.map((player, i) => ({ player, bandh: player === closer, hath: hath[i], joker: joker[i] }))
});
const EX3 = round('P1', [0, 0, 2, 12], [2, 5, 10, 25]);
const EX4 = round('P2', [5, 0, 15, 3], [1, 2, 3, 4]);

test('csvEscape quotes and guards formulas', () => {
  expect(csvEscape(-42)).toBe('-42');
  expect(csvEscape('Aakash')).toBe('Aakash');
  expect(csvEscape('a,b')).toBe('"a,b"');
  expect(csvEscape('say "hi"')).toBe('"say ""hi"""');
  expect(csvEscape('=SUM(A1)')).toBe("'=SUM(A1)");
  expect(csvEscape('')).toBe('');
});

test('gameToCsv writes one row per round plus totals', () => {
  expect(gameToCsv(P4, [EX3, EX4])).toBe([
    'Round,Bandh,Multiplier,P1 Hath,P1 Joker,P1 Points,P1 Total,P2 Hath,P2 Joker,P2 Points,P2 Total,P3 Hath,P3 Joker,P3 Points,P3 Total,P4 Hath,P4 Joker,P4 Points,P4 Total',
    '1,P1,1,14,-34,-20,-20,0,-22,-22,-22,-2,-2,-4,-4,-12,58,46,46',
    '2,P2,2,-5,-6,-22,-42,23,-2,42,20,-15,2,-26,-30,-3,6,6,52',
    'Total,,,,,,-42,,,,20,,,,-30,,,,52',
    ''
  ].join('\n'));
});

test('standingsText lists ranks', () => {
  expect(standingsText(P4, [EX3, EX4], 'MG-1234')).toBe(
    'Marriage Score Card · MG-1234\nAfter 2 rounds\n1. P4 +52\n2. P2 +20\n3. P3 -30\n4. P1 -42'
  );
  expect(standingsText(P4, [EX3], 'MG-1234').split('\n')[1]).toBe('After 1 round');
  expect(standingsText(P4, [], 'MG-1234')).toBe('Marriage Score Card · MG-1234\nNo rounds played yet');
});

test('whatsappUrl and csvFileName', () => {
  expect(whatsappUrl('a b\nc')).toBe('https://wa.me/?text=a%20b%0Ac');
  expect(csvFileName(new Date(2026, 10, 9, 21, 30))).toBe('marriage-2026-11-09.csv');
});
```

### 5.3 `src/entry.test.js`

```js
import { isCompleteHath, stepValue } from './entry';

test('stepValue clamps to the range', () => {
  expect(stepValue('', 1, 0, 15)).toBe('1');
  expect(stepValue('15', 1, 0, 15)).toBe('15');
  expect(stepValue('0', -1, 0, 15)).toBe('0');
  expect(stepValue('', -1, 0, 15)).toBe('0');
  expect(stepValue('7', -1, 0)).toBe('6');
  expect(stepValue('99', 1, 0)).toBe('100');
});

test('isCompleteHath', () => {
  expect(isCompleteHath('')).toBe(false);
  expect(isCompleteHath('1')).toBe(false);
  expect(isCompleteHath('0')).toBe(true);
  expect(isCompleteHath('2')).toBe(true);
  expect(isCompleteHath('9')).toBe(true);
  expect(isCompleteHath('10')).toBe(true);
  expect(isCompleteHath('15')).toBe(true);
});
```

Run `CI=true npx react-scripts test --watchAll=false` → every suite passes. **The expected values above are verified correct; if a test fails, fix the module code, never the test.**

## Phase 6: `src/App.js`

Read the whole file first. Keep everything else unchanged.

6.1 **Imports.** Add:
```js
import { computeAllTime, computePlayerStats, summarizeGame } from './stats';
import { csvFileName, gameToCsv, standingsText, whatsappUrl } from './export';
import { isCompleteHath, stepValue } from './entry';
```

6.2 **Helpers above `function App()`** (after `setAddressSession`):

```js
function downloadText(fileName, text, type = 'text/csv;charset=utf-8') {
  const blob = new Blob([text], { type });
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = fileName;
  document.body.appendChild(link);
  link.click();
  link.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

function focusNextEntry(current, form) {
  const fields = Array.from(form.querySelectorAll('input[data-entry]:not(:disabled)'));
  const index = fields.indexOf(current);
  if (index >= 0 && index < fields.length - 1) {
    fields[index + 1].focus();
    fields[index + 1].select();
    return true;
  }
  return false;
}

function PointStepper({ id, label, value, onChange, max, disabled, placeholder, onKeyDown, onFocus }) {
  return (
    <div className="stepper">
      <button type="button" className="step-btn" tabIndex={-1} aria-label={`Decrease ${label}`}
        disabled={disabled} onClick={() => onChange(stepValue(value ?? '', -1, 0, max))}>−</button>
      <input
        id={id}
        data-entry=""
        className="point-input"
        type="number"
        inputMode="numeric"
        enterKeyHint="next"
        min="0"
        max={max}
        step="1"
        placeholder={placeholder}
        value={value ?? ''}
        disabled={disabled}
        onChange={event => onChange(event.target.value, event.target)}
        onKeyDown={onKeyDown}
        onFocus={onFocus}
        aria-label={label}
      />
      <button type="button" className="step-btn" tabIndex={-1} aria-label={`Increase ${label}`}
        disabled={disabled} onClick={() => onChange(stepValue(value ?? '', 1, 0, max))}>+</button>
    </div>
  );
}
```

6.3 **State.** Add `const [games, setGames] = useState([]);` and `const [shareMessage, setShareMessage] = useState('');`.
- In `applyGameState(msg)` add `setGames(Array.isArray(msg.games) ? msg.games : []);`
- In `handleNewGame` add `setGames([]);`

6.4 **Hath auto-advance.** Change `handleHathChange` to accept the input element and advance when complete:
```js
  const handleHathChange = (player, value, input) => {
    if (/^\d*$/.test(value)) {
      setHathInputs(previous => ({ ...previous, [player]: value }));
      setRoundError('');
      if (input && isCompleteHath(value)) focusNextEntry(input, input.form);
    }
  };
```
(`handleJokerChange` stays as is; it ignores the extra argument.)

6.5 **Keyboard handlers** (next to the round-form handlers):
```js
  const handleEntryKeyDown = (event) => {
    if (event.key !== 'Enter') return;
    event.preventDefault();
    if (!focusNextEntry(event.target, event.target.form)) event.target.form.requestSubmit();
  };
  const handleEntryFocus = (event) => event.target.select();
```

6.6 **Replace the two `<label>` blocks inside `<div className="points-pair">`** with:
```jsx
                    <label htmlFor={`hath-${index}`}>
                      Hath
                      <PointStepper
                        id={`hath-${index}`}
                        label={`${player} hath points`}
                        value={isCloser ? '' : hathInputs[player]}
                        max={MAX_HATH}
                        disabled={isCloser}
                        placeholder={isCloser ? '—' : '0'}
                        onChange={(value, input) => handleHathChange(player, value, input)}
                        onKeyDown={handleEntryKeyDown}
                        onFocus={handleEntryFocus}
                      />
                    </label>
                    <label htmlFor={`joker-${index}`}>
                      Joker
                      <PointStepper
                        id={`joker-${index}`}
                        label={`${player} joker points`}
                        value={jokerInputs[player]}
                        placeholder="0"
                        onChange={value => handleJokerChange(player, value)}
                        onKeyDown={handleEntryKeyDown}
                        onFocus={handleEntryFocus}
                      />
                    </label>
```
Note: the `−`/`+` buttons call `onChange` without an input element, so they never auto-advance.

6.7 **Finish game / delete past game handlers** (next to `handleUndo`):
```js
  const handleFinishGame = () => {
    if (!rounds.length) return;
    if (!window.confirm(`Finish this game after ${rounds.length} ${rounds.length === 1 ? 'round' : 'rounds'}? It moves to Past games and a new game starts with the same players. You can undo this.`)) return;
    if (!canSend(setRoundError)) return;
    wsRef.current.send(JSON.stringify({ type: 'finish_game', sessionId }));
    setEditingRound(null);
    resetRoundForm();
  };

  const handleDeleteGame = (index) => {
    if (!window.confirm('Delete this past game? You can undo this.')) return;
    if (!canSend(setRoundError)) return;
    wsRef.current.send(JSON.stringify({ type: 'delete_game', sessionId, index }));
  };
```

6.8 **Share/export handlers:**
```js
  const shareText = standingsText(players, rounds, sessionId);
  const handleShare = async () => {
    setShareMessage('');
    if (navigator.share) {
      try {
        await navigator.share({ title: 'Marriage Score Card', text: shareText });
        return;
      } catch (error) {
        if (error && error.name === 'AbortError') return;
      }
    }
    window.open(whatsappUrl(shareText), '_blank', 'noopener');
  };
  const handleDownloadCsv = () => {
    downloadText(csvFileName(new Date()), gameToCsv(players, rounds));
    setShareMessage('Score sheet downloaded.');
  };
  const handleDownloadGameCsv = (game) => downloadText(csvFileName(game.finishedAt), gameToCsv(game.players, game.rounds));
```
(Place `shareText` after the derived values block so it is computed on every render. Remove `setShareMessage` uses if ESLint reports it unused — it should not, since both are used.)

6.9 **Derived values** (in the `// ---- derived ----` block):
```js
  const playerStats = useMemo(() => computePlayerStats(rounds, players), [rounds, players]);
  const pastGames = useMemo(() => games.map((game, index) => ({ ...summarizeGame(game), index })).reverse(), [games]);
  const allTime = useMemo(() => computeAllTime(games), [games]);
```

6.10 **Standings section** — after the `standing-chips` div and inside the same `<section>`, add:
```jsx
        <div className="standings-actions">
          <button type="button" className="secondary-btn" onClick={handleShare} disabled={!rounds.length}>Share</button>
          <a className={`secondary-btn whatsapp-link ${rounds.length ? '' : 'is-disabled'}`}
            href={rounds.length ? whatsappUrl(shareText) : undefined} target="_blank" rel="noreferrer"
            aria-disabled={!rounds.length}>WhatsApp</a>
          <button type="button" className="secondary-btn" onClick={handleDownloadCsv} disabled={!rounds.length}>Download CSV</button>
          <button type="button" className="finish-btn" onClick={handleFinishGame} disabled={!rounds.length}>Finish game</button>
        </div>
        {shareMessage && <p className="copy-message" role="status">{shareMessage}</p>}
```

6.11 **Player Stats section** — directly after the Round History `</section>` (still inside the fragment that renders when rounds exist; if Round History is only rendered when `rounds.length > 0`, put this in the same condition):
```jsx
          <section className="score-table stats-table" aria-labelledby="stats-heading">
            <h2 id="stats-heading">Player Stats</h2>
            <div className="table-scroll">
              <table>
                <thead>
                  <tr>
                    <th scope="col">Stat</th>
                    {players.map(player => <th scope="col" key={player}>{player}</th>)}
                  </tr>
                </thead>
                <tbody>
                  {[
                    ['Total', row => formatPoints(row.total)],
                    ['Bandh closed', row => row.bandhs],
                    ['Hath points', row => formatPoints(row.hathPoints)],
                    ['Joker points', row => formatPoints(row.jokerPoints)],
                    ['Best round', row => (row.best === null ? '—' : formatPoints(row.best))],
                    ['Worst round', row => (row.worst === null ? '—' : formatPoints(row.worst))],
                    ['Doubles triggered', row => row.doublesTriggered]
                  ].map(([label, render]) => (
                    <tr key={label}>
                      <th scope="row">{label}</th>
                      {playerStats.map(row => <td key={row.player}>{render(row)}</td>)}
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </section>
```

6.12 **Past Games section** — after Player Stats, rendered whenever `games.length > 0` (also when the current game has no rounds yet — so place it **outside** any `rounds.length > 0` condition, just before `</main>`):
```jsx
      {games.length > 0 && (
        <section className="score-table past-games" aria-labelledby="past-games-heading">
          <h2 id="past-games-heading">Past Games</h2>
          <h3 className="subheading">All-time leaderboard</h3>
          <div className="table-scroll">
            <table>
              <thead>
                <tr>
                  <th scope="col">#</th>
                  <th scope="col">Player</th>
                  <th scope="col">Games</th>
                  <th scope="col">Wins</th>
                  <th scope="col">Total</th>
                </tr>
              </thead>
              <tbody>
                {allTime.map(row => (
                  <tr key={row.player}>
                    <td>{row.rank}</td>
                    <th scope="row">{row.player}</th>
                    <td>{row.games}</td>
                    <td>{row.wins}</td>
                    <td className={row.total < 0 ? 'negative-score' : ''}>{formatPoints(row.total)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <h3 className="subheading">Finished games</h3>
          <ul className="past-game-list">
            {pastGames.map(game => (
              <li key={`${game.finishedAt}-${game.index}`} className="past-game">
                <div className="past-game-head">
                  <strong>{new Date(game.finishedAt).toLocaleString([], { dateStyle: 'medium', timeStyle: 'short' })}</strong>
                  <span>{game.roundCount} {game.roundCount === 1 ? 'round' : 'rounds'} · Winner: {game.winners.join(', ')}</span>
                </div>
                <div className="past-game-scores">
                  {game.standings.map(row => (
                    <span key={row.player} className={row.total < 0 ? 'negative-score' : ''}>{row.player} {formatPoints(row.total)}</span>
                  ))}
                </div>
                <div className="past-game-actions">
                  <button type="button" className="secondary-btn" onClick={() => handleDownloadGameCsv(games[game.index])}>CSV</button>
                  <button type="button" className="delete-btn" onClick={() => handleDeleteGame(game.index)}>Delete</button>
                </div>
              </li>
            ))}
          </ul>
        </section>
      )}
```

6.13 Check: `roundError` is shown inside the round form, so finish/delete rejections from the server (`update_rejected`) appear there — no extra change needed.

## Phase 7: `src/App.css` — append (write exactly)

```css
/* ---- v3: steppers, share row, stats, past games ---- */
.stepper { display: grid; grid-template-columns: 38px minmax(0, 1fr) 38px; gap: 4px; align-items: stretch; }
.stepper .point-input { min-width: 0; padding: 8px 4px; }
.step-btn {
  margin: 0;
  padding: 0;
  min-height: 46px;
  border-radius: 7px;
  background: #eef3ed;
  color: var(--green-dark);
  border: 1px solid var(--line);
  font-size: 1.3rem;
  font-weight: 700;
  line-height: 1;
}
.step-btn:hover { background: #e2ebe1; }
.step-btn:disabled { opacity: .45; cursor: not-allowed; }
.player-score { grid-template-columns: minmax(90px, 1fr) auto minmax(280px, 320px) minmax(180px, 1.2fr); }
.point-input::-webkit-outer-spin-button, .point-input::-webkit-inner-spin-button { -webkit-appearance: none; margin: 0; }
.point-input { -moz-appearance: textfield; appearance: textfield; }

.standings-actions { display: flex; flex-wrap: wrap; gap: 8px; margin-top: 14px; }
.standings-actions > * { margin: 0; }
.whatsapp-link { display: inline-flex; align-items: center; text-decoration: none; border-radius: 8px; }
.whatsapp-link.is-disabled { opacity: .5; pointer-events: none; }
.finish-btn { margin-left: auto; padding: 8px 13px; font-size: .86rem; }

.stats-table tbody th { white-space: nowrap; font-weight: 600; }
.subheading { margin: 14px 0 8px; font-size: .95rem; color: var(--muted); }
.past-game-list { list-style: none; margin: 0; padding: 0; display: grid; gap: 8px; }
.past-game {
  display: grid;
  grid-template-columns: minmax(180px, 1fr) 2fr auto;
  gap: 8px 14px;
  align-items: center;
  padding: 10px 12px;
  background: #f8faf6;
  border: 1px solid #e8eee7;
  border-radius: 10px;
}
.past-game-head { display: grid; gap: 2px; }
.past-game-head span { color: var(--muted); font-size: .82rem; }
.past-game-scores { display: flex; flex-wrap: wrap; gap: 6px 12px; font-size: .9rem; font-variant-numeric: tabular-nums; }
.past-game-actions { display: flex; gap: 6px; }
.past-game-actions button { margin: 0; }

@media (max-width: 700px) {
  .points-pair { gap: 8px; }
  .stepper { grid-template-columns: 34px minmax(0, 1fr) 34px; gap: 3px; }
  .step-btn { min-height: 48px; font-size: 1.2rem; }
  .standings-actions { display: grid; grid-template-columns: 1fr 1fr; }
  .standings-actions > * { justify-content: center; text-align: center; }
  .finish-btn { margin-left: 0; grid-column: 1 / -1; }
  .past-game { grid-template-columns: 1fr; }
  .past-game-actions button { flex: 1 1 0; }
}
```

The existing mobile rule `.points-pair { grid-column: 1 / -1; grid-row: 2; }` stays — the steppers live inside it.

## Phase 8: README

- Features list: add bullets for **Finish game & past games** (archive, all-time leaderboard, undoable), **Player stats**, **Export & share** (CSV, share sheet / WhatsApp), and **Faster entry** (−/+ steppers, Enter to move on, Hath auto-advance).
- Project structure: add `src/stats.js`, `src/export.js`, `src/entry.js` and their tests.
- Note under "Scoring Rules" that stats' Hath/Joker points include the ×2 of double rounds.

## Phase 9: Verification

1. `cd /Users/shreyaagarwal/aakashk_personal/projects/marriage_game && CI=true npm test` — every suite passes (scoring, invite, stats, export, entry). Report counts.
2. `npm run test:server` — all pass (14). Report counts.
3. `CI=true npm run build` — "Compiled successfully." with no warnings. Fix warnings; never suppress them.
4. Start the server in the background on port 3001 **only if it is free** (`lsof -nP -iTCP:3001 -sTCP:LISTEN`); otherwise use `PORT=3101` with `DATA_FILE=/private/tmp/claude-501/-Users-shreyaagarwal-aakashk-personal-projects-marriage-game/21938fd6-49c5-4a59-9da9-456f098923a6/scratchpad/v3-sessions.json`. WebSocket smoke test with `node -e` and the project's `ws` package:
   - `create_session` → `update_game` with one valid round → `finish_game` → expect the next `session_update` to have `rounds.length === 0` and `games.length === 1`.
   - `undo` → expect `rounds.length === 1`, `games.length === 0`.
   - `finish_game` on an empty game → expect `update_rejected`.
   Print each message's `type`, `rounds.length`, `games?.length`.
5. Stop the server you started. Delete the scratchpad data file. Do not touch `data/sessions.json` if it exists.
6. Do **not** commit. Do not touch begum-chor.
