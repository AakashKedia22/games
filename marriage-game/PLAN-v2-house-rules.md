# Plan v2: switch Marriage Score Card to the house rules (Bandh / Hath / Joker)

Project: `/Users/shreyaagarwal/aakashk_personal/projects/marriage_game` (already built from `PLAN.md`).
This plan **replaces** the seen/unseen/dublee/maal scoring with the house rules below. Infrastructure (server, WebSocket sync, invite, undo, persistence, chart, styling) stays as is.

## The rules (from the user)

1. A game is played with **3 players or 4 players** (chosen at setup).
2. Each round, every player has a **Bandh** checkbox (game close) and two point inputs: **Hath** and **Joker**.
3. **Hath:** exactly one player closes the Bandh. Each other player's Hath is at most **15**. The closer collects the sum of the others' Hath; each other player loses their own Hath.
   Example: P1 closes, P2=0, P3=2, P4=12 → P1 **+14**, P2 **0**, P3 **−2**, P4 **−12**.
4. **Joker:** no limit. Each player scores the sum over every other player of (own joker − other's joker), which equals `joker_i × N − T` (T = total joker).
   Example: jokers 2, 5, 10, 25 → P1 (2−5)+(2−10)+(2−25) = **−34**, P2 **−22**, P3 **−2**, P4 (25−2)+(25−5)+(25−10) = **+58**.
5. **Round total** = Hath + Joker, shown in one table.
6. **Double round:** if in the previous round any player's *raw entered* Joker points were **over 20** (strictly > 20), every player's round total in the next round is **×2**.

## Decisions fixed by this plan

- Doubling triggers at 20 or more (20 doubles; 19 does not). Updated per user.
- Doubling depends only on the immediately previous round's raw jokers. A doubled round can itself trigger the next double. Multipliers are recomputed from the raw inputs, so editing/deleting rounds re-flows correctly.
- The closer's own Hath is ignored (input disabled, stored as 0).
- Hath for non-closers: whole number 0–15. Joker: whole number 0–9999. Blank means 0.
- Exactly one Bandh per round is required to submit.
- Players: exactly 3 or 4, chosen by a "Game mode" toggle in setup. Default players: `['Aakash', 'Shreya', 'Aryan', 'Paa']`.
- Settings keep only money per point and currency: `{ pointValue: 0, currency: '₹' }`.
- Round shape: `{ entries: [{ player: string, bandh: boolean, hath: number, joker: number }] }` (no `winner` field).
- Old saved sessions use the old shape; delete `data/sessions.json` (it only holds the smoke-test session MG-5886).

---

## Phase 1: Replace `src/scoring.js` (write exactly)

```js
export const PLAYER_COUNTS = [3, 4];
export const MAX_NAME_LENGTH = 20;
export const MAX_HATH = 15;
export const MAX_JOKER = 9999;
export const DOUBLE_THRESHOLD = 20;
export const MAX_POINT_VALUE = 10000;

// Keep in sync with DEFAULT_SETTINGS in server/sessions.mjs
export const DEFAULT_SETTINGS = Object.freeze({
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

function entryNumber(value) {
  return isBlank(value) ? 0 : Number(value);
}

export function normalizeSettings(settings) {
  const source = settings || {};
  return {
    pointValue: toNumber(source.pointValue, DEFAULT_SETTINGS.pointValue),
    currency: typeof source.currency === 'string' ? source.currency : DEFAULT_SETTINGS.currency
  };
}

export function validateRound(players, round) {
  if (!round || !Array.isArray(round.entries)) return 'Round data is missing.';
  const entries = players.map(player => round.entries.find(entry => entry.player === player));
  if (entries.some(entry => !entry)) return 'Every player needs an entry for this round.';
  const closers = entries.filter(entry => entry.bandh === true);
  if (closers.length !== 1) return 'Tick Bandh for exactly one player.';
  for (const entry of entries) {
    if (entry.bandh) continue;
    const hath = entryNumber(entry.hath);
    if (!Number.isInteger(hath) || hath < 0 || hath > MAX_HATH) {
      return `Hath points for ${entry.player} must be a whole number between 0 and ${MAX_HATH}.`;
    }
  }
  for (const entry of entries) {
    const joker = entryNumber(entry.joker);
    if (!Number.isInteger(joker) || joker < 0 || joker > MAX_JOKER) {
      return `Joker points for ${entry.player} must be a whole number between 0 and ${MAX_JOKER}.`;
    }
  }
  return null;
}

// A round where anyone entered more than 20 joker points doubles the next round.
export function triggersDouble(round) {
  if (!round || !Array.isArray(round.entries)) return false;
  return round.entries.some(entry => entryNumber(entry.joker) > DOUBLE_THRESHOLD);
}

export function multiplierFor(rounds, index) {
  return index > 0 && triggersDouble(rounds[index - 1]) ? 2 : 1;
}

export function nextMultiplier(rounds) {
  return multiplierFor(rounds || [], (rounds || []).length);
}

// Hath: the Bandh closer collects every other player's hath (max 15 each); the others lose theirs.
// Joker: joker_i * N - T, i.e. the sum of (own joker - other joker) over every other player.
// Net: (hath + joker) * multiplier.
export function computeRound(round, multiplier = 1) {
  const entries = round && Array.isArray(round.entries) ? round.entries : [];
  const playerCount = entries.length;
  const totalJoker = entries.reduce((sum, entry) => sum + entryNumber(entry.joker), 0);
  const closer = entries.find(entry => entry.bandh === true);

  const hath = {};
  const joker = {};
  const nets = {};
  let collected = 0;
  entries.forEach(entry => {
    hath[entry.player] = 0;
    if (closer && entry !== closer) {
      const lost = Math.min(entryNumber(entry.hath), MAX_HATH);
      hath[entry.player] = lost === 0 ? 0 : -lost;
      collected += lost;
    }
    joker[entry.player] = entryNumber(entry.joker) * playerCount - totalJoker;
  });
  if (closer) hath[closer.player] = collected;
  entries.forEach(entry => {
    nets[entry.player] = (hath[entry.player] + joker[entry.player]) * multiplier;
  });

  return {
    hath,
    joker,
    nets,
    multiplier,
    totalJoker,
    closer: closer ? closer.player : null,
    triggersDouble: triggersDouble(round),
    valid: Boolean(closer)
  };
}

export function computeRounds(rounds) {
  const list = rounds || [];
  return list.map((round, index) => computeRound(round, multiplierFor(list, index)));
}

export function computeRunningTotals(rounds, players) {
  const running = {};
  players.forEach(player => { running[player] = 0; });
  return computeRounds(rounds).map(({ nets }) => {
    players.forEach(player => { running[player] += nets[player] || 0; });
    return { ...running };
  });
}

export function computeTotals(rounds, players) {
  const running = computeRunningTotals(rounds, players);
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
  if (!PLAYER_COUNTS.includes(names.length)) return 'Marriage is played with 3 or 4 players.';
  if (names.some(name => !name)) return 'Every player needs a name.';
  if (names.some(name => name.length > MAX_NAME_LENGTH)) {
    return `Player names must be ${MAX_NAME_LENGTH} characters or fewer.`;
  }
  const lower = names.map(name => name.toLowerCase());
  if (new Set(lower).size !== lower.length) return 'Player names must be unique.';

  const s = settings || {};
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

## Phase 2: Replace `src/scoring.test.js` (write exactly)

```js
import {
  computeRound, computeRounds, computeRunningTotals, computeStandings, computeTotals, formatMoney,
  formatPoints, multiplierFor, nextMultiplier, triggersDouble, validateRound, validateSetup
} from './scoring';

const P4 = ['P1', 'P2', 'P3', 'P4'];
const round = (closer, hath, joker, players = P4) => ({
  entries: players.map((player, i) => ({ player, bandh: player === closer, hath: hath[i], joker: joker[i] }))
});
const sum = obj => Object.values(obj).reduce((a, b) => a + b, 0);

// Example 1 (user's hath example)
const EX1 = round('P1', [0, 0, 2, 12], [0, 0, 0, 0]);
// Example 2 (user's joker example)
const EX2 = round('P1', [0, 0, 0, 0], [2, 5, 10, 25]);
// Example 3: both together
const EX3 = round('P1', [0, 0, 2, 12], [2, 5, 10, 25]);
// Example 4: follows EX3, so it is doubled
const EX4 = round('P2', [5, 0, 15, 3], [1, 2, 3, 4]);

describe('hath', () => {
  test('closer collects the others, others lose theirs', () => {
    expect(computeRound(EX1).hath).toEqual({ P1: 14, P2: 0, P3: -2, P4: -12 });
    expect(computeRound(EX1).nets).toEqual({ P1: 14, P2: 0, P3: -2, P4: -12 });
  });
  test("closer's own hath is ignored", () => {
    const r = round('P1', [40, 1, 1, 1], [0, 0, 0, 0]);
    expect(computeRound(r).hath).toEqual({ P1: 3, P2: -1, P3: -1, P4: -1 });
    expect(validateRound(P4, r)).toBeNull();
  });
  test('hath is capped at 15 even if validation is bypassed', () => {
    expect(computeRound(round('P1', [0, 20, 0, 0], [0, 0, 0, 0])).hath).toEqual({ P1: 15, P2: -15, P3: 0, P4: 0 });
  });
});

describe('joker', () => {
  test("matches the user's pairwise example", () => {
    expect(computeRound(EX2).joker).toEqual({ P1: -34, P2: -22, P3: -2, P4: 58 });
  });
  test('equals the pairwise sum for every player', () => {
    const jokers = [2, 5, 10, 25];
    const result = computeRound(EX2).joker;
    P4.forEach((player, i) => {
      const pairwise = jokers.reduce((acc, other, j) => (j === i ? acc : acc + (jokers[i] - other)), 0);
      expect(result[player]).toBe(pairwise);
    });
  });
});

describe('round total', () => {
  test('adds hath and joker', () => {
    expect(computeRound(EX3).nets).toEqual({ P1: -20, P2: -22, P3: -4, P4: 46 });
  });
  test('3-player game', () => {
    const r = round('C', [15, 7, 0], [0, 30, 6], ['A', 'B', 'C']);
    const result = computeRound(r);
    expect(result.hath).toEqual({ A: -15, B: -7, C: 22 });
    expect(result.joker).toEqual({ A: -36, B: 54, C: -18 });
    expect(result.nets).toEqual({ A: -51, B: 47, C: 4 });
  });
});

describe('double round', () => {
  test('joker over 20 doubles the next round; exactly 20 does not', () => {
    expect(triggersDouble(round('P1', [0, 0, 0, 0], [20, 0, 0, 0]))).toBe(false);
    expect(triggersDouble(round('P1', [0, 0, 0, 0], [21, 0, 0, 0]))).toBe(true);
    expect(triggersDouble(EX3)).toBe(true);
  });
  test('the round after EX3 is doubled for all players', () => {
    const results = computeRounds([EX3, EX4]);
    expect(results[0].multiplier).toBe(1);
    expect(results[1].multiplier).toBe(2);
    expect(results[1].hath).toEqual({ P1: -5, P2: 23, P3: -15, P4: -3 });
    expect(results[1].joker).toEqual({ P1: -6, P2: -2, P3: 2, P4: 6 });
    expect(results[1].nets).toEqual({ P1: -22, P2: 42, P3: -26, P4: 6 });
  });
  test('running totals across a doubled round', () => {
    expect(computeTotals([EX3, EX4], P4)).toEqual({ P1: -42, P2: 20, P3: -30, P4: 52 });
    expect(computeRunningTotals([EX3, EX4], P4)).toHaveLength(2);
  });
  test('next multiplier and multiplierFor', () => {
    expect(nextMultiplier([])).toBe(1);
    expect(nextMultiplier([EX3])).toBe(2);
    expect(nextMultiplier([EX3, EX4])).toBe(1);
    expect(multiplierFor([EX3, EX4], 0)).toBe(1);
    expect(multiplierFor([EX3, EX4], 1)).toBe(2);
  });
  test('a doubled round can trigger the next double', () => {
    const r2 = round('P2', [0, 0, 0, 0], [30, 0, 0, 0]);
    const r3 = round('P3', [0, 0, 0, 0], [0, 0, 0, 0]);
    expect(computeRounds([EX3, r2, r3]).map(r => r.multiplier)).toEqual([1, 2, 2]);
  });
});

describe('zero-sum invariant', () => {
  test('random rounds always sum to zero', () => {
    let seed = 7;
    const rand = n => { seed = (seed * 1103515245 + 12345) % 2147483648; return seed % n; };
    for (let t = 0; t < 300; t += 1) {
      const players = rand(2) === 0 ? ['A', 'B', 'C'] : ['A', 'B', 'C', 'D'];
      const closer = players[rand(players.length)];
      const r = round(closer, players.map(() => rand(16)), players.map(() => rand(60)), players);
      const result = computeRound(r, rand(2) + 1);
      expect(sum(result.nets)).toBe(0);
      expect(sum(result.hath)).toBe(0);
      expect(sum(result.joker)).toBe(0);
    }
  });
});

describe('validateRound', () => {
  test('accepts a good round and blanks as 0', () => {
    expect(validateRound(P4, EX3)).toBeNull();
    expect(validateRound(P4, round('P1', ['', '', '', ''], ['', '', '', '']))).toBeNull();
  });
  test('requires exactly one bandh', () => {
    expect(validateRound(P4, round(null, [0, 0, 0, 0], [0, 0, 0, 0]))).toMatch(/exactly one/);
    const two = round('P1', [0, 0, 0, 0], [0, 0, 0, 0]);
    two.entries[1].bandh = true;
    expect(validateRound(P4, two)).toMatch(/exactly one/);
  });
  test('rejects hath over 15 and bad jokers', () => {
    expect(validateRound(P4, round('P1', [0, 16, 0, 0], [0, 0, 0, 0]))).toMatch(/Hath points for P2/);
    expect(validateRound(P4, round('P1', [0, 0, 0, 0], [0, -1, 0, 0]))).toMatch(/Joker points for P2/);
    expect(validateRound(P4, round('P1', [0, 0, 0, 0], [0, 2.5, 0, 0]))).toMatch(/Joker points for P2/);
  });
  test('needs an entry for every player', () => {
    expect(validateRound([...P4, 'P5'], EX3)).toMatch(/Every player/);
  });
});

describe('setup and formatting', () => {
  test('only 3 or 4 players', () => {
    const settings = { pointValue: 0, currency: '₹' };
    expect(validateSetup(['A', 'B', 'C'], settings)).toBeNull();
    expect(validateSetup(['A', 'B', 'C', 'D'], settings)).toBeNull();
    expect(validateSetup(['A', 'B'], settings)).toMatch(/3 or 4/);
    expect(validateSetup(['A', 'B', 'C', 'D', 'E'], settings)).toMatch(/3 or 4/);
    expect(validateSetup(['A', 'a', 'C'], settings)).toMatch(/unique/);
  });
  test('standings and formatting', () => {
    expect(computeStandings({ A: 5, B: 5, C: -10 }, ['A', 'B', 'C']).map(r => r.rank)).toEqual([1, 1, 3]);
    expect(formatPoints(14)).toBe('+14');
    expect(formatPoints(-2)).toBe('-2');
    expect(formatPoints(0)).toBe('0');
    expect(formatMoney(41, { pointValue: 0.5, currency: '₹' })).toBe('+₹20.50');
  });
});
```

Run `cd /Users/shreyaagarwal/aakashk_personal/projects/marriage_game && CI=true npx react-scripts test --watchAll=false src/scoring.test.js` — all must pass before moving on.

## Phase 3: Server (`server/sessions.mjs`, `server/sessions.test.mjs`)

3.1 In `server/sessions.mjs`:
- `DEFAULT_PLAYERS = ['Aakash', 'Shreya', 'Aryan', 'Paa'];`
- `DEFAULT_SETTINGS = { pointValue: 0, currency: '₹' };` (keep the "Keep in sync" comment)
- In `isValidGameState`: players length check becomes `(state.players.length === 3 || state.players.length === 4)`; the rounds check becomes `state.rounds.every(round => round && Array.isArray(round.entries))`.

3.2 In `server/sessions.test.mjs`, adapt to the new shapes (keep every test's intent):
- `ROUND` → `{ entries: [{ player: 'A', bandh: true, hath: 0, joker: 3 }, { player: 'B', bandh: false, hath: 5, joker: 0 }, { player: 'C', bandh: false, hath: 0, joker: 0 }] }`
- `state` helper → players `['A', 'B', 'C']`.
- `players.length` expectations of 5 → 4.
- `view.settings.seenPenalty === 3` → `view.settings.pointValue === 0`.
- The invalid-update test: `players: ['A']` stays invalid; change `players: ['A', 'B']` to `['A', 'B', 'C']` in the two other lines; replace the `rounds: [{ entries: [] }]` line (now valid) with `rounds: [{ winner: 'A' }]` (no entries → invalid). Add one more assertion that 5 players is rejected: `applyUpdate(session, { players: ['A','B','C','D','E'], settings: {}, rounds: [] })` → `false`.
- Read the whole file first and fix any other reference to `winner`, `maal`, `status`, or 2-player states.

3.3 `server.mjs`: grep for `winner|maal|seenPenalty|status`. Change only scoring-specific references, if any (there should be none).

3.4 Delete the old-format saved data: `rm -f /Users/shreyaagarwal/aakashk_personal/projects/marriage_game/data/sessions.json`.

Run `npm run test:server` — all must pass.

## Phase 4: `src/App.js`

Read the whole file first. Keep everything unrelated to scoring (WebSocket, invite card, lobby, undo, chart, standings, money, layout and CSS class names). Make these changes:

4.1 **Imports** from `./scoring`: `DEFAULT_SETTINGS, PLAYER_COUNTS, MAX_HATH, computeRound, computeRounds, computeRunningTotals, computeStandings, computeTotals, formatMoney, formatPoints, multiplierFor, nextMultiplier, normalizeSettings, validateRound, validateSetup`. Remove `canHoldMaal`, `STATUS_LABELS`, `cellLabel`. Remove any import that becomes unused (CI build fails on unused vars).

4.2 **Default players** in the client (if it has its own list) → `['Aakash', 'Shreya', 'Aryan', 'Paa']`.

4.3 **`settingsToDraft`** returns only `{ pointValue: String(s.pointValue), currency: s.currency }`.

4.4 **Setup panel:**
- Add a "Game mode" control above the player names: two radio buttons "3 players" / "4 players" (reuse the existing `status-group`/`status-option` classes). Checked = current draft player count. Switching to 3 drops the last name; switching to 4 appends `'Paa'` if not already used, else `'Player 4'`. Disabled when rounds exist (like player names).
- Remove the add-player / remove-player buttons if present (count is controlled by the mode toggle only).
- Remove the seen/unseen/dublee penalty fields and the "Allow dublee" checkbox. Keep money per point and currency.
- The setup summary line becomes: `{players.length} players · Hath max {MAX_HATH} · Joker over 20 doubles the next round` (plus the existing money text if any).

4.5 **Round entry state:** replace `winner`, `maalInputs`, `statuses` with:
- `const [bandh, setBandh] = useState('');` (player name of the closer)
- `const [hathInputs, setHathInputs] = useState({});`
- `const [jokerInputs, setJokerInputs] = useState({});`
- Number input handlers accept `''` or digits only (`/^\d*$/`), like the existing maal handler.
- Bandh checkbox handler: `setBandh(current => (current === player ? '' : player))`, and clear that player's hath input.
- Reset clears all three.
- Draft round:
  ```js
  const draftRound = {
    entries: players.map(player => ({
      player,
      bandh: bandh === player,
      hath: bandh === player || !hathInputs[player] ? 0 : Number(hathInputs[player]),
      joker: jokerInputs[player] ? Number(jokerInputs[player]) : 0
    }))
  };
  ```
- `const draftMultiplier = editingIndex !== null ? multiplierFor(rounds, editingIndex) : nextMultiplier(rounds);` (use whatever the existing edit-index state variable is called).
- `const draftError = validateRound(players, draftRound);`
- `const preview = draftError ? null : computeRound(draftRound, draftMultiplier);`
- Editing a round loads `bandh`, `hathInputs`, `jokerInputs` from its entries (as strings; closer's hath = '').
- Submitting stores `draftRound` (not including any `winner`).

4.6 **Round entry UI** — per player card (keep `player-score` class; add `is-winner` when they are the Bandh closer):
- Player name label.
- A checkbox labelled "Bandh" (`aria-label={`${player} closed the Bandh`}`).
- "Hath" number input: `min=0 max=15 step=1 inputMode="numeric"`, disabled and placeholder `—` for the closer, placeholder `0` otherwise, `aria-label={`${player} hath points`}`.
- "Joker" number input: `min=0 step=1 inputMode="numeric"`, placeholder `0`, `aria-label={`${player} joker points`}`.
- Preview line: when `preview` exists: `Hath {formatPoints(preview.hath[p])} · Joker {formatPoints(preview.joker[p])} · Total {formatPoints(preview.nets[p])}`; otherwise `Total: —`.
- Above the player cards, when `draftMultiplier === 2`, show a banner `<p className="double-banner" role="status">Double round — last round had more than 20 joker points. All points ×2.</p>`.
- Replace the "Total maal … playing" counter with `Total joker {sum of joker inputs}` and, if any joker input > 20, append ` · Next round will be doubled`.
- Show `draftError` as the existing form error does.

4.7 **History table:**
- `const roundResults = useMemo(() => computeRounds(rounds), [rounds]);`
- Running totals / totals / chart use `computeRunningTotals(rounds, players)` and `computeTotals(rounds, players)` (drop the `settings` argument everywhere for scoring calls; `formatMoney` still takes settings).
- Replace the "Total maal" column with two columns: "Bandh" (`result.closer`) and "×" (`×2` if `result.multiplier === 2`, else empty).
- Each player cell: main number `formatPoints(result.nets[player])` (negative class as before), plus a small sub-line `H {formatPoints(result.hath[player])} · J {formatPoints(result.joker[player])}` in the existing sub-label element/class (the one `cellLabel` used). Mark the closer's cell with the existing `winner-cell` class.
- Keep running-total rows / Edit / Delete exactly as they are.

4.8 Remove every remaining reference to `winner`, `maal`, `status`, `seen`, `dublee`, `Penalty`. Verify: `grep -n "maal\|Maal\|dublee\|seenPenalty\|unseen\|canHoldMaal\|STATUS" src/App.js` prints nothing.

## Phase 5: `src/App.css`

Add:
```css
.double-banner {
  margin: 0 0 12px;
  padding: 10px 14px;
  border-radius: 10px;
  background: #fff4d6;
  color: #7a4b00;
  font-weight: 600;
}
.bandh-option {
  display: flex;
  align-items: center;
  gap: 6px;
  font-size: 0.9rem;
}
.points-pair {
  display: grid;
  grid-template-columns: 1fr 1fr;
  gap: 8px;
}
.points-pair label {
  display: flex;
  flex-direction: column;
  font-size: 0.8rem;
  gap: 4px;
}
@media (prefers-color-scheme: dark) {
  .double-banner { background: #4a3a10; color: #ffe2a0; }
}
```
Use `bandh-option` on the Bandh checkbox label and wrap the Hath/Joker inputs (each inside its own `<label>` with text "Hath"/"Joker") in `<div className="points-pair">`. If App.css has no dark-mode block at all, omit the media query.

## Phase 6: README

Replace the "Scoring Rules" section and the worked example with the six rules above, the two examples (hath: +14/0/−2/−12; joker: −34/−22/−2/+58), and the double-round rule (strictly over 20, previous round only, applies to all players). Update the "Round entry" feature bullet to: "pick the Bandh closer, enter Hath (max 15) and Joker points, with a live preview and double-round banner". Mention 3- and 4-player modes. Remove all seen/unseen/dublee/maal wording.

## Phase 7: Verification

1. `cd /Users/shreyaagarwal/aakashk_personal/projects/marriage_game && CI=true npm test` — all suites pass (report counts).
2. `npm run test:server` — all pass.
3. `CI=true npm run build` — "Compiled successfully" with no warnings. Fix warnings, never suppress them.
4. `grep -rn "maal\|dublee\|unseen\|seenPenalty" src server server.mjs README.md` — no matches.
5. Start `PORT=3101 node server.mjs` in the background; `curl -s http://localhost:3101/health` → `{"ok":true}`. WebSocket smoke test: create a session, send `update_game` with the server's `players`/`settings` and one round `{ entries: players.map((p, i) => ({ player: p, bandh: i === 0, hath: i === 0 ? 0 : 2, joker: 0 })) }`; expect `session_created MG-xxxx 0 false` then `session_update  1 true`. Then stop the server (`lsof -ti tcp:3101 | xargs kill`) and `rm -f data/sessions.json`.
6. Do not run git init or commit. Do not touch begum-chor.
