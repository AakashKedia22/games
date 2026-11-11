# Plan v4a: score rounds from each player's 30 cards

Project: `/Users/shreyaagarwal/aakashk_personal/projects/marriage_game` (v3 committed as `36ce294`).

v4 is split in two:
- **v4a (this plan):** players enter their 30 cards by tapping a card picker; the app works out Hath and Joker points with the rules engine and fills them in. Fully offline, no new dependencies.
- **v4b (later):** a phone photo fills the card picker automatically (EfficientNet-B0 card recognition). The picker from v4a becomes the "check and fix" screen for v4b.

## Already done (do NOT modify)

The rules engine is written and verified (exhaustive-search cross-check on 300 hands, 21 tests):
- `src/cards.js`: card codes (`'7D'`, `'10H'`, printed joker `'JK'`), values, validation.
- `src/jokers.js`: which cards are jokers for an opened card, and Joker points with bonuses.
- `src/hand.js`: `scoreHand(cards, openCard)` finds the best grouping and returns Hath and Joker points.
- Tests: `src/cards.test.js`, `src/jokers.test.js`, `src/hand.test.js`.

`scoreHand(cards, openCard)` returns either `{ error }` or:
```
{ committed, closed, hathValue, hath, triples, triplePoints, jokerCardPoints, jokerPoints,
  jokerParts: [{ label, count, points }], groups: [{ type, cards, wilds }], leftovers, unusedJokers }
```
`type` is one of `'pureRun' | 'run' | 'pureTriple' | 'set'`; `wilds` lists the indexes in `cards` that are jokers standing in for another card. It can take up to ~0.5 s on a laptop for joker-heavy hands, so results are cached (Phase 1).

## Decisions

- Round shape gains optional fields: `round.openCard` (e.g. `'7D'`) and `entry.cards` (array of codes). Old rounds without them keep working. The server needs no change (it only checks `entries` is an array).
- Card entry is optional per player: the Hath/Joker boxes still work by hand. When a player's hand has exactly 30 cards **and** the opened card is set, the computed Hath and Joker fill those boxes (the player can still adjust them afterwards).
- For the Bandh closer, Hath is ignored as before; the summary warns if the closer's cards are not fully closed.
- A hand with an error (wrong count, too many copies) shows the error and fills nothing.

---

## Phase 1: `src/handEntry.js` (write exactly)

```js
import { DECKS, HAND_SIZE, PRINTED_JOKER, SUITS, cardCode, parseCard, RANKS } from './cards';
import { scoreHand } from './hand';

export function maxCopies(code, openCard) {
  return code === openCard ? DECKS - 1 : DECKS;
}

function sortKey(code) {
  if (code === PRINTED_JOKER) return 1000;
  const card = parseCard(code);
  return SUITS.indexOf(card.suit) * 13 + card.rank;
}

export function sortCards(cards) {
  return [...(cards || [])].sort((a, b) => sortKey(a) - sortKey(b));
}

export function addCard(cards, code, openCard) {
  const list = cards || [];
  if (list.length >= HAND_SIZE) return list;
  if (list.filter(item => item === code).length >= maxCopies(code, openCard)) return list;
  return sortCards([...list, code]);
}

export function removeCard(cards, code) {
  const list = [...(cards || [])];
  const index = list.lastIndexOf(code);
  if (index >= 0) list.splice(index, 1);
  return list;
}

export function openCardOptions() {
  return SUITS.flatMap(suit => RANKS.map((_, index) => cardCode(index + 1, suit)));
}

export function isRedCode(code) {
  const card = parseCard(code);
  return Boolean(card && (card.suit === 'H' || card.suit === 'D'));
}

const cache = new Map();
const CACHE_LIMIT = 200;

// Scores a full hand once per (cards, opened card); returns null until the hand is complete.
export function scoreHandCached(cards, openCard) {
  if (!openCard || !cards || cards.length !== HAND_SIZE) return null;
  const key = `${openCard}|${sortCards(cards).join(',')}`;
  if (cache.has(key)) return cache.get(key);
  const result = scoreHand(cards, openCard);
  if (cache.size >= CACHE_LIMIT) cache.delete(cache.keys().next().value);
  cache.set(key, result);
  return result;
}
```

## Phase 2: `src/handEntry.test.js` (write exactly)

```js
import { addCard, isRedCode, maxCopies, openCardOptions, removeCard, scoreHandCached, sortCards } from './handEntry';

test('addCard sorts and respects copy limits', () => {
  let cards = [];
  cards = addCard(cards, 'KS', '7D');
  cards = addCard(cards, '2S', '7D');
  cards = addCard(cards, 'JK', '7D');
  cards = addCard(cards, 'AH', '7D');
  expect(cards).toEqual(['2S', 'KS', 'AH', 'JK']);
  cards = addCard(addCard(addCard(cards, '5C', '7D'), '5C', '7D'), '5C', '7D');
  expect(addCard(cards, '5C', '7D')).toBe(cards);
  const opened = addCard(addCard([], '7D', '7D'), '7D', '7D');
  expect(addCard(opened, '7D', '7D')).toBe(opened);
  expect(maxCopies('7D', '7D')).toBe(2);
  expect(maxCopies('7H', '7D')).toBe(3);
});

test('addCard stops at 30 cards', () => {
  const full = Array(30).fill('2S');
  expect(addCard(full, '3S', '7D')).toBe(full);
});

test('removeCard removes one copy', () => {
  expect(removeCard(['2S', '2S', 'JK'], '2S')).toEqual(['2S', 'JK']);
  expect(removeCard(['2S'], 'KH')).toEqual(['2S']);
});

test('helpers', () => {
  expect(sortCards(['JK', 'AC', 'AS', '10D'])).toEqual(['AS', '10D', 'AC', 'JK']);
  expect(openCardOptions()).toHaveLength(52);
  expect(isRedCode('7D')).toBe(true);
  expect(isRedCode('7S')).toBe(false);
  expect(isRedCode('JK')).toBe(false);
});

test('scoreHandCached only scores complete hands and caches results', () => {
  expect(scoreHandCached(['2S'], '7D')).toBeNull();
  const hand = ['2S', '3S', '4S', '5S', '6S', '10H', 'JH', 'QH', 'KH', '10C', 'JC', 'QC', 'KC', '2D', '3D', '4D',
    'JD', 'QD', 'KD', 'AD', '2H', 'AS', 'QS', '5C', '6C', '9H', '9C', 'JK', 'JK', 'JK'];
  expect(scoreHandCached(hand, '')).toBeNull();
  const first = scoreHandCached(hand, '7D');
  expect(first.hath).toBe(0);
  expect(first.jokerPoints).toBe(14);
  expect(scoreHandCached([...hand].reverse(), '7D')).toBe(first);
});
```

Run `cd /Users/shreyaagarwal/aakashk_personal/projects/marriage_game && CI=true npx react-scripts test --watchAll=false src/handEntry.test.js` → pass.

## Phase 3: `src/CardPicker.js` (write exactly)

```js
import { useState } from 'react';
import { HAND_SIZE, PRINTED_JOKER, RANKS, SUITS, SUIT_SYMBOLS, cardCode, countCards, formatCard } from './cards';
import { addCard, isRedCode, maxCopies, removeCard } from './handEntry';

const GROUP_LABELS = { pureRun: 'Pure run', run: 'Run', pureTriple: 'Pure triple', set: 'Set' };

export function CardPicker({ player, cards, openCard, onChange }) {
  const [suit, setSuit] = useState('S');
  const counts = countCards(cards);
  const tabs = [...SUITS, PRINTED_JOKER];
  const codes = suit === PRINTED_JOKER ? [PRINTED_JOKER] : RANKS.map((_, index) => cardCode(index + 1, suit));
  const handFull = cards.length >= HAND_SIZE;

  return (
    <div className="card-picker">
      <div className="card-picker-head">
        <strong className={handFull ? 'hand-full' : ''}>{cards.length}/{HAND_SIZE} cards</strong>
        <button type="button" className="secondary-btn" onClick={() => onChange([])} disabled={!cards.length}>Clear</button>
      </div>
      <div className="suit-tabs" role="tablist" aria-label={`${player} suit`}>
        {tabs.map(tab => (
          <button
            key={tab}
            type="button"
            role="tab"
            aria-selected={suit === tab}
            className={`suit-tab ${suit === tab ? 'active' : ''} ${tab === 'H' || tab === 'D' ? 'red' : ''}`}
            onClick={() => setSuit(tab)}
          >
            {tab === PRINTED_JOKER ? 'Joker' : SUIT_SYMBOLS[tab]}
          </button>
        ))}
      </div>
      <div className="rank-grid">
        {codes.map(code => {
          const count = counts[code] || 0;
          const disabled = handFull || count >= maxCopies(code, openCard);
          return (
            <button
              key={code}
              type="button"
              className={`rank-btn ${count ? 'has-cards' : ''} ${isRedCode(code) ? 'red' : ''}`}
              disabled={disabled}
              aria-label={`Add ${formatCard(code)}${count ? `, ${count} in hand` : ''}`}
              onClick={() => onChange(addCard(cards, code, openCard))}
            >
              <span>{code === PRINTED_JOKER ? 'Joker' : code.slice(0, -1)}</span>
              {count > 0 && <span className="rank-count">×{count}</span>}
            </button>
          );
        })}
      </div>
      {cards.length > 0 && (
        <div className="hand-chips" aria-label={`${player} cards, tap a card to remove it`}>
          {cards.map((code, index) => (
            <button
              key={`${code}-${index}`}
              type="button"
              className={`card-chip ${isRedCode(code) ? 'red' : ''}`}
              aria-label={`Remove ${formatCard(code)}`}
              onClick={() => onChange(removeCard(cards, code))}
            >
              {formatCard(code)}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

export function HandSummary({ result, isCloser }) {
  if (!result) return null;
  if (result.error) return <p className="hand-error" role="alert">{result.error}</p>;
  const status = result.committed ? (result.closed ? 'Closed' : 'Committed') : 'Not committed';
  return (
    <details className="hand-summary">
      <summary>
        {status} · Hath {isCloser ? '—' : result.hath} · Joker {result.jokerPoints}
      </summary>
      {isCloser && !result.closed && (
        <p className="hand-warning">These cards are not fully closed. Check the cards before submitting a Bandh.</p>
      )}
      {result.groups.length > 0 && (
        <ul className="group-list">
          {result.groups.map((group, index) => (
            <li key={index}>
              <span className="group-type">{GROUP_LABELS[group.type]}</span>
              {group.cards.map((code, position) => (
                <span key={position} className={`card-chip static ${isRedCode(code) ? 'red' : ''} ${group.wilds.includes(position) ? 'wild-card' : ''}`}>
                  {formatCard(code)}{group.wilds.includes(position) ? '★' : ''}
                </span>
              ))}
            </li>
          ))}
        </ul>
      )}
      {result.leftovers.length > 0 && (
        <p className="hand-line">
          Left over ({result.hathValue} → Hath {result.hath}): {result.leftovers.map(formatCard).join(' ')}
        </p>
      )}
      <p className="hand-line">
        Joker points: {result.jokerParts.map(part => `${part.label} = ${part.points}`).join(', ') || 'no joker cards'}
        {result.triples > 0 ? `, pure triples ×${result.triples} = ${result.triplePoints}` : ''}
      </p>
      <p className="hand-note">★ = joker standing in for another card</p>
    </details>
  );
}
```

## Phase 4: `src/App.js`

Read the whole file first. Keep everything not mentioned.

4.1 **Imports.** Add:
```js
import { CardPicker, HandSummary } from './CardPicker';
import { openCardOptions, scoreHandCached } from './handEntry';
import { HAND_SIZE, formatCard } from './cards';
```

4.2 **State** (next to `hathInputs`/`jokerInputs`):
```js
  const [openCard, setOpenCard] = useState('');
  const [handCards, setHandCards] = useState({});
  const [pickerFor, setPickerFor] = useState(null);
```

4.3 **Fill Hath/Joker from a scored hand.** Add next to the round-form handlers:
```js
  const fillFromHand = (player, cards, open) => {
    const result = scoreHandCached(cards, open);
    if (!result || result.error) return;
    setHathInputs(previous => ({ ...previous, [player]: String(result.hath) }));
    setJokerInputs(previous => ({ ...previous, [player]: String(result.jokerPoints) }));
    setRoundError('');
  };

  const handleCardsChange = (player, cards) => {
    setHandCards(previous => ({ ...previous, [player]: cards }));
    fillFromHand(player, cards, openCard);
  };

  const handleOpenCardChange = (code) => {
    setOpenCard(code);
    players.forEach(player => fillFromHand(player, handCards[player], code));
  };

  const togglePicker = (player) => setPickerFor(current => (current === player ? null : player));
```

4.4 **`resetRoundForm`** — also clear the new state: add `setOpenCard(''); setHandCards({}); setPickerFor(null);`

4.5 **`draftRound`** — include the cards and opened card:
```js
  const draftRound = {
    ...(openCard ? { openCard } : {}),
    entries: players.map(player => ({
      player,
      bandh: bandh === player,
      hath: bandh === player || !hathInputs[player] ? 0 : Number(hathInputs[player]),
      joker: jokerInputs[player] ? Number(jokerInputs[player]) : 0,
      ...(handCards[player] && handCards[player].length ? { cards: handCards[player] } : {})
    }))
  };
```

4.6 **`handleEditRound`** — after loading hath/joker inputs, also load cards and the opened card:
```js
    const nextCards = {};
    round.entries.forEach(item => { if (Array.isArray(item.cards)) nextCards[item.player] = item.cards; });
    setHandCards(nextCards);
    setOpenCard(round.openCard || '');
    setPickerFor(null);
```

4.7 **Opened card field.** Inside the round `<form>`, directly after the double-round banner and before `<div className="player-entry-list">`:
```jsx
          <label className="open-card-field">
            Opened joker card
            <select value={openCard} onChange={event => handleOpenCardChange(event.target.value)}>
              <option value="">Not set</option>
              {openCardOptions().map(code => <option key={code} value={code}>{formatCard(code)}</option>)}
            </select>
          </label>
```

4.8 **Per-player cards.** Inside each `player-score` div, after the closing `</div>` of `points-pair` and before the `<output className="resolved-preview">`, add:
```jsx
                  <div className="cards-row">
                    <button type="button" className="secondary-btn cards-btn" aria-expanded={pickerFor === player}
                      onClick={() => togglePicker(player)}>
                      Cards {(handCards[player] || []).length}/{HAND_SIZE}
                    </button>
                    {!openCard && (handCards[player] || []).length === HAND_SIZE && (
                      <span className="hand-note">Set the opened joker card to score</span>
                    )}
                  </div>
                  {pickerFor === player && (
                    <CardPicker player={player} cards={handCards[player] || []} openCard={openCard}
                      onChange={cards => handleCardsChange(player, cards)} />
                  )}
                  <HandSummary result={scoreHandCached(handCards[player], openCard)} isCloser={isCloser} />
```

4.9 Make sure no ESLint warning remains (every new import used).

## Phase 5: `src/App.css` — append (write exactly)

```css
/* ---- v4a: card entry ---- */
.open-card-field { display: flex; align-items: center; gap: 10px; margin: 0 0 12px; font-weight: 600; }
.open-card-field select {
  min-height: 42px;
  padding: 6px 10px;
  border: 1px solid #cbd8ce;
  border-radius: 7px;
  background: white;
  color: var(--ink);
  font: inherit;
}
.cards-row, .card-picker, .hand-summary, .hand-error { grid-column: 1 / -1; }
.cards-row { display: flex; align-items: center; gap: 10px; flex-wrap: wrap; }
.cards-btn { margin: 0; }
.card-picker {
  display: grid;
  gap: 10px;
  padding: 10px;
  background: white;
  border: 1px solid var(--line);
  border-radius: 10px;
}
.card-picker-head { display: flex; align-items: center; justify-content: space-between; gap: 10px; }
.card-picker-head button { margin: 0; }
.hand-full { color: var(--green-dark); }
.suit-tabs { display: grid; grid-template-columns: repeat(5, minmax(0, 1fr)); gap: 6px; }
.suit-tab {
  margin: 0;
  padding: 8px 0;
  min-height: 44px;
  background: #eef3ed;
  color: var(--ink);
  border: 1px solid var(--line);
  border-radius: 8px;
  font-size: 1.2rem;
}
.suit-tab.red { color: #c0392b; }
.suit-tab.active { background: var(--green); color: white; border-color: var(--green); }
.rank-grid { display: grid; grid-template-columns: repeat(auto-fill, minmax(52px, 1fr)); gap: 6px; }
.rank-btn {
  position: relative;
  margin: 0;
  padding: 0;
  min-height: 48px;
  background: white;
  color: var(--ink);
  border: 1px solid #cbd8ce;
  border-radius: 8px;
  font-size: 1.05rem;
  font-weight: 700;
}
.rank-btn.red { color: #c0392b; }
.rank-btn.has-cards { background: #fff8df; border-color: var(--gold); }
.rank-btn:disabled { opacity: .45; cursor: not-allowed; }
.rank-count {
  position: absolute;
  top: 2px;
  right: 4px;
  font-size: .68rem;
  color: var(--muted);
}
.hand-chips, .group-list li { display: flex; flex-wrap: wrap; gap: 4px; }
.card-chip {
  margin: 0;
  padding: 4px 7px;
  min-height: 30px;
  background: white;
  color: var(--ink);
  border: 1px solid #cbd8ce;
  border-radius: 6px;
  font-size: .85rem;
  font-weight: 600;
  font-variant-numeric: tabular-nums;
}
.card-chip.red { color: #c0392b; }
.card-chip.static { display: inline-flex; align-items: center; min-height: 0; }
.card-chip.wild-card { background: #fff8df; border-color: var(--gold); }
.hand-summary { font-size: .88rem; }
.hand-summary summary { cursor: pointer; font-weight: 600; color: var(--green-dark); }
.group-list { list-style: none; margin: 8px 0; padding: 0; display: grid; gap: 6px; }
.group-type { min-width: 76px; color: var(--muted); font-size: .78rem; align-self: center; }
.hand-line { margin: 6px 0 0; }
.hand-note { margin: 4px 0 0; color: var(--muted); font-size: .78rem; }
.hand-warning, .hand-error { margin: 6px 0 0; color: var(--danger); font-size: .85rem; font-weight: 600; }

@media (max-width: 700px) {
  .open-card-field { flex-direction: column; align-items: stretch; gap: 6px; }
  .rank-grid { grid-template-columns: repeat(5, minmax(0, 1fr)); }
  .cards-btn { flex: 1 1 auto; }
}
```

## Phase 6: README

- Add a **Card entry (v4a)** feature bullet: set the opened joker card, tap in each player's 30 cards, and the app works out Hath and Joker points (best grouping, joker bonuses, pure triples), with a breakdown.
- Add a short **House rules** section summarising: 3 decks with printed jokers; Commit = 5 pure sequences (runs of 3–5, A-2-3 and Q-K-A allowed, no wrap; or 3 identical cards); joker cards for opened card R♦ = all four R, R±1 and R±2 of ♦ (wrapping), printed jokers; Bandh = all 30 cards in runs (jokers allowed), pure triples (no jokers) or mixed-suit sets of 3–4 (jokers allowed); Hath = leftover card value (2–10 face value, J Q K A = 10, jokers excluded) ÷ 10 rounded half up, max 15; Joker points table (opened card 4; same-colour rank, neighbours, printed joker 2; other-colour rank 0; pair +2; three = 14 (10 for 0-value); all four ranks = 14; R−2..R+2 run = 25; pure triples 1/2/3/4/5 = 2/6/14/20/25; each card in one bonus only, best split counts).
- Project structure: add `cards.js`, `jokers.js`, `hand.js`, `handEntry.js`, `CardPicker.js` and their tests.

## Phase 7: Verification

1. `cd /Users/shreyaagarwal/aakashk_personal/projects/marriage_game && CI=true npm test` — all suites pass (report counts; expect 9 suites).
2. `npm run test:server` — 14 pass.
3. `CI=true npm run build` — "Compiled successfully." with no warnings.
4. Do not commit. Do not modify `src/cards.js`, `src/jokers.js`, `src/hand.js` or their tests. Do not touch begum-chor.
