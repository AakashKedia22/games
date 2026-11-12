# Plan v4f: committed cards are locked; Bandh is scored from the Bandh cards only

Project: `/Users/shreyaagarwal/aakashk_personal/projects/marriage_game`. The v4c, v4d and v4e changes are uncommitted in the working tree; build on them. **Don't commit. Don't touch `/Users/shreyaagarwal/aakashk_personal/projects/begum-chor`.** The engine must stay under 1 s worst case. Nothing may overflow sideways at 360 px.

**How the numbers were checked.** I ran every engine number below in memory with `node --input-type=module`. The script loaded the real `src/cards.js`, `src/jokers.js` and `src/hand.js` as `data:` URLs, applied the patches from this plan as string replacements, and appended the new functions. No project file or temp file was written.

**Timing.**
- 300 random committed hands (5 runs plus a 15-card Bandh with 0–3 printed jokers and many joker cards): worst `scoreCommitted` 4 ms, worst `scoreNotCommitted` 1 ms.
- `checkCommit` on 30 cards, 50 calls: 3 ms in total.

---

## 0. The user's hand (the reason for this change)

Opened 5♠, 4 players:
`AS 2S 3S 6S 6S 8S 9S 10S AH 2H 3H 4H 4H 6H 7H 8H 8H 9H 10H 2D 2D 5D 6D 8D 9D 2C 2C 2C 9C 10C`

| How it is scored | Hath value | Hath | Joker | Notes |
|---|---|---|---|---|
| Old 30-card search, `scoreHand(...)` (kept for old rounds) | 4 | **0** | 10 | Plays 4♥ in `4H 6S★ 6H 7H 8H` and also commits A♥ 2♥ 3♥ 4♥ and 8♥ 9♥ 10♥. Leftovers 2♦ 2♦ |
| **Commit A** (locked): 6♥7♥8♥ · 8♥9♥10♥ · A♥2♥3♥4♥ · 8♠9♠10♠ · 2♣2♣2♣ | 8 | **1** | **10** | Bandh (14): `AS 2S 3S 6S 6S 4H 2D 2D 5D 6D 8D 9D 9C 10C` |
| **Commit B** (locked): A♠2♠3♠ · 6♥7♥8♥ · 8♥9♥10♥ · A♥2♥3♥4♥ · 8♠9♠10♠ | 8 | **1** | **10** | Bandh: `6S 6S 4H 2D 2D 5D 6D 8D 9D 2C 2C 2C 9C 10C` |
| **Commit C** (locked): A♠2♠3♠ · 6♥7♥8♥ · 8♥9♥10♥ · A♥2♥3♥4♥ · 2♣2♣2♣ | 8 | **1** | **10** | Bandh: `6S 6S 8S 9S 10S 4H 2D 2D 5D 6D 8D 9D 9C 10C` |
| Not committed (no tick), `scoreNotCommitted` | 97 | 10 | 10 | Free runs `AH 2H 3H 4H` and `6H 7H 8H 9H 10H`, plus the triple 2♣ |

**Bandh grouping for Commit A:**
- `AS 2S 3S` (pure run);
- `5D 6D 6S★ 8D 9D` (6♠ stands in for 7♦);
- `6S★ 9C 10C` (6♠ stands in for 8♣);
- left over: 4♥ 2♦ 2♦ = 8.

**Joker points for Commit A:**
- 3♠ ×1 = 2;
- 5♦ ×1 = 0;
- 6♠ ×2 = 6 (wild use doesn't break the pair);
- pure triples ×1 (2♣, locked) = 2;
- total 10.

`brokenCombos` is `[]`. Commits B and C give the same totals: in B the 2♣ triple is formed in the Bandh; in C, 8♠ 9♠ 10♠ is a Bandh pure run.

---

## 1. Rules (state these in the README "House rules")

1. **Committed tick.** A per-player tick in the round entry. It can be switched on only when the player's *commit cards* form exactly one of:
   - **Sequences:** exactly 5 pure sequences that use every commit card.
     - A run is 3–5 cards of one suit. A-2-3 and Q-K-A count; runs never wrap.
     - A pure triple is 3 identical cards.
     - No wilds. A joker card may be used as itself. A printed joker (JK) can never be used.
   - **Doublets:** exactly 8 doublets (4 players) or 9 (3 players), with no other cards. Each code appears exactly twice; JK never pairs.
   - A run of 6 or more may be split (e.g. 2–4 and 5–7). If both readings were possible, sequences win; with 3 decks this can't actually happen.
2. **Locked.** While the tick is on, the commit cards are read-only. Unticking unlocks them, and no card moves.
3. **Bandh cards.** The other `30 − N` cards.
   - **Sequences route:**
     - Hath is the best grouping of the Bandh cards only, with every existing group type: runs with wilds, mixed sets, pure runs, pure triples.
     - The ×/10 rounding and the 15 cap apply.
     - No minimum number of pure sequences in the Bandh.
     - Closed means every Bandh card is grouped (`minCost === 0`).
   - **Doublets route:** Hath 0. Closed means at least 2 doublets among the Bandh cards (`DOUBLET_CLOSE_EXTRA`). Every other card is ignored.
4. **Joker points** come from all 30 cards, with the v4e combo rules.
   - "Natural use" is counted over the locked groups **plus** the Bandh groups.
   - Locked groups are all natural, except all-copies groups: a triple of a code held 3 times, or a doublet of a code held exactly 2 times in all 30 cards.
   - Wild use in the Bandh never breaks a combo.
   - The opened 5-card run counts wherever its cards are.
   - Pure-triple points = `triplePoints(locked non-joker triples + Bandh pure triples)`.
   - Within the Bandh grouping, the v4e search over protect sets still picks the best Joker − Hath.
   - On the doublets route, Bandh doublets only prove the close. They never break a combo (assumption A3), and no triple points are added (`DOUBLETS_SCORE_TRIPLES = false`).
5. **Not committed (no tick).** The commit list and the other list are pooled; all 30 cards are scored with the not-committed rule only (free 4–5 runs and pure triples). This holds **even if the cards contain 5 sequences**; the summary then shows a hint.
6. **Bandh closer.** The closer must be ticked Committed. `validateRound` blocks a closer with `committed === false`.
   - "Not closed" stays a warning in HandSummary, as today.
   - Packed rules are unchanged; packed players may skip card entry.
   - Entries with no card data (manual scoring) are not affected.
7. **`scoreHand` / `bestArrangement` with 5 required sequences** stay for tests, back-compat, and the legacy note on old saved rounds. New entries never use the automatic "find 5 sequences in 30 cards" search.
8. **Photos.** One photo button per list. The copy limits (3 decks, 2 of the opened card) count the two lists together. Each list has its own size limit:
   - commit: `min(25, 30 − other cards)`;
   - Bandh/other: `30 − commit cards`.

---

## 2. Data shape and migration

A round entry gains optional fields. Old fields are unchanged.

```js
// v4f committed player
{ player, bandh, hath, joker, packed?, committed: true, commitCards: ['6H','7H',...], cards: [ ...the Bandh cards ] }
// v4f player with cards, not committed (all of their cards; the commit list is pooled in)
{ player, bandh, hath, joker, packed?, committed: false, cards: [ ...30 cards ] }
// No cards entered (manual): no committed, no cards, no commitCards (as today)
// Legacy (v4a–v4e): { ..., cards: [30] } with NO `committed` field
```

- `committed` is written (`true` or `false`) whenever the player has any card data. That is how a legacy entry is told apart: `Array.isArray(entry.cards) && entry.committed === undefined`.
- **Legacy rounds** load, show and total exactly as stored: `computeRound` never looks at cards.
  - On **Edit**, a legacy entry opens unticked, with its 30 cards in the "All cards" list, and the Hath/Joker boxes keep the stored values.
  - HandSummary shows the new not-committed score plus a legacy note with the old 30-card score (`scoreHandCached`).
  - Nothing is recomputed unless the user changes cards.
- **CSV:** a new `Committed` column after `Packed`, listing players with `committed === true`, joined by `; `. Cards are not exported (as today).
- **Server:** see §7. Old files on disk are never dropped by the new checks.

---

## 3. Engine

### 3.1 `src/cards.js`: add `validateCards` and refactor `validateHand`

```js
// Codes and copy limits only (any length).
export function validateCards(cards, openCard) {
  if (!Array.isArray(cards)) return 'Cards are missing.';
  const bad = cards.find(code => !parseCard(code));
  if (bad !== undefined) return `Unknown card: ${bad}.`;
  const counts = countCards(cards);
  const over = Object.keys(counts).find(code => counts[code] > DECKS);
  if (over) return `There are only ${DECKS} of ${formatCard(over)} in 3 decks.`;
  if (openCard && counts[openCard] > DECKS - 1) {
    return `${formatCard(openCard)} is the opened card, so a hand can hold at most ${DECKS - 1}.`;
  }
  return null;
}
export function validateHand(cards, openCard) {
  if (!Array.isArray(cards)) return 'Cards are missing.';
  if (cards.length !== HAND_SIZE) return `A hand has ${HAND_SIZE} cards; this one has ${cards.length}.`;
  return validateCards(cards, openCard);
}
```

The messages and their order are unchanged, so the existing tests pass.

### 3.2 `src/hand.js`

**Imports.** Add `HAND_SIZE` and `validateCards` from `./cards`.

**(a) `bestArrangement` takes a required number of pure sequences.**
- Signature: `export function bestArrangement(cards, openCard, protect = new Set(), required = COMMIT_SEQUENCES)`.
- Inside `solve`, replace:
  - `pure < COMMIT_SEQUENCES` (twice) with `pure < required`;
  - `pureCapacity() < COMMIT_SEQUENCES` with `pureCapacity() < required`;
  - `Math.min(COMMIT_SEQUENCES, pure + 1)` with `Math.min(required, pure + 1)`.
- Update the header comment: with `required = 0` it is the best grouping of any card list. It never returns null, because "leave out" and "wild" moves always exist.

**(b) Locked groups in `evaluate` and `bestOfRoute`.** Behaviour is identical when `fixed` is `[]`.

```js
function evaluate(arrangement, { closed, triples }, cards, openCard, fixed = []) {
  const combos = comboCodes(cards, openCard);
  const natural = naturalUse([...fixed, ...arrangement.groups], cards, openCard);
  const own = naturalUse(arrangement.groups, cards, openCard);   // only these can be protected
  ...unchanged...
  playedCombos: combos.filter(code => own[code] > 0)
}
function bestOfRoute(run, describe, cards, openCard, fixed = []) {
  ... evaluate(arrangement, describe(arrangement), cards, openCard, fixed) ...
}
```

**(c) Pure-sequence partition** (put it after `naturalUse`). This is the exact code I ran. `toList` and `byOrder` already exist.

```js
// For a card list: best[g] = { left, groups } = the fewest cards left out when the cards form exactly g
// pure sequences (runs of 3-5 in one suit, A-2-3 and Q-K-A, no wrap; or 3 identical cards). No wilds;
// a printed joker is always left out. Missing index = impossible.
export function commitPartitions(cards) {
  const POWERS = Array.from({ length: 13 }, (_, n) => 4 ** n);
  const printed = cards.filter(code => code === PRINTED_JOKER).length;
  const perSuit = SUITS.map(suit => {
    let start = 0;
    cards.forEach(code => {
      if (code === PRINTED_JOKER) return;
      const card = parseCard(code);
      if (card.suit === suit) start += POWERS[card.rank - 1];
    });
    const codeAt = index => cardCode(index + 1, suit);
    const memo = new Map();
    function solve(key) {
      if (key === 0) return [{ left: 0, groups: null }];
      const known = memo.get(key);
      if (known) return known;
      const counts = [];
      for (let n = 0, rest = key; n < 13; n += 1, rest = Math.floor(rest / 4)) counts.push(rest % 4);
      const r = counts.findIndex(count => count > 0);
      const best = [];
      const offer = (nextKey, left, groupsAdded, group) => {
        solve(nextKey).forEach((option, g) => {
          if (!option) return;
          const total = option.left + left;
          const k = g + groupsAdded;
          if (best[k] && best[k].left <= total) return;
          best[k] = { left: total, groups: group ? { item: group, next: option.groups } : option.groups };
        });
      };
      offer(key - POWERS[r], 1, 0, null); // leave the lowest card out
      if (counts[r] >= 3) offer(key - 3 * POWERS[r], 0, 1, { type: 'pureTriple', cards: [codeAt(r), codeAt(r), codeAt(r)], wilds: [] });
      for (let length = 3; length <= 5; length += 1) {
        const runs = [];
        if (r + length <= 13) runs.push(Array.from({ length }, (_, k) => r + k));
        if (r === 0) runs.push([...Array.from({ length: length - 1 }, (_, k) => 14 - length + k), 0]); // ace high
        runs.forEach(ranks => {
          if (ranks.some(index => counts[index] === 0)) return;
          offer(key - ranks.reduce((sum, index) => sum + POWERS[index], 0), 0, 1,
            { type: 'pureRun', cards: ranks.map(codeAt), wilds: [] });
        });
      }
      memo.set(key, best);
      return best;
    }
    return solve(start);
  });
  let combined = [{ left: printed, picks: [] }];
  perSuit.forEach(options => {
    const next = [];
    combined.forEach((so, t) => {
      if (!so) return;
      options.forEach((option, u) => {
        if (!option) return;
        const left = so.left + option.left;
        if (next[t + u] && next[t + u].left <= left) return;
        next[t + u] = { left, picks: [...so.picks, option] };
      });
    });
    combined = next;
  });
  return combined.map(option => option && { left: option.left, groups: option.picks.flatMap(pick => toList(pick.groups)) });
}
```

**(d) `checkCommit`.** This is the exact message logic I verified.

```js
const plural = (n, word) => `${n} ${word}${n === 1 ? '' : 's'}`;

// Whether the shown cards are a valid commit: exactly 5 pure sequences using every card, or exactly
// the doublet target (8 with 4 players, 9 with 3) and nothing else. openCard is only used for the copy limit.
export function checkCommit(commitCards, openCard, playerCount) {
  const cards = commitCards || [];
  const fail = message => ({ ok: false, route: null, groups: [], message });
  if (!cards.length) return fail('Enter the cards that were shown');
  const error = validateCards(cards, openCard);
  if (error) return fail(error);
  const parts = commitPartitions(cards);
  if (parts[COMMIT_SEQUENCES] && parts[COMMIT_SEQUENCES].left === 0) {
    return { ok: true, route: 'sequences', groups: parts[COMMIT_SEQUENCES].groups, message: '5 pure sequences ✓' };
  }
  const targets = doubletTargets(playerCount);
  const counts = countCards(cards);
  const pairCodes = Object.keys(counts).filter(code => code !== PRINTED_JOKER && counts[code] >= 2).sort(byOrder);
  const spare = cards.length - 2 * pairCodes.length;
  if (targets && pairCodes.length === targets.commit && spare === 0) {
    return { ok: true, route: 'doublets', message: `${targets.commit} doublets ✓`,
      groups: pairCodes.map(code => ({ type: 'doublet', cards: [code, code], wilds: [] })) };
  }
  let most = 0;
  for (let g = 1; g <= COMMIT_SEQUENCES; g += 1) if (parts[g]) most = g;
  const d = pairCodes.length;
  if (targets && d > most) {
    if (spare > 0) return fail(`${plural(d, 'doublet')} + ${plural(spare, 'extra card')} ✗`);
    return fail(d < targets.commit ? `${plural(d, 'doublet')}, need ${targets.commit} ✗`
      : `${plural(d, 'doublet')}: commit exactly ${targets.commit} ✗`);
  }
  const exactMore = parts.findIndex((p, g) => g > COMMIT_SEQUENCES && p && p.left === 0);
  if (exactMore > 0) return fail(`${exactMore} sequences: commit exactly ${COMMIT_SEQUENCES} ✗`);
  if (most === 0) return fail('No pure sequence yet ✗');
  const left = parts[most].left;
  if (left === 0) return fail(`${plural(most, 'sequence')}, need ${COMMIT_SEQUENCES} ✗`);
  return fail(`${plural(most, 'sequence')} + ${plural(left, 'extra card')} ✗`);
}

// Hint only: could these cards have been committed (5 disjoint pure sequences, or enough doublets)?
export function canCommitFrom(cards, playerCount) {
  if (validateCards(cards)) return false;
  const targets = doubletTargets(playerCount);
  return commitPartitions(cards).some((option, g) => option && g >= COMMIT_SEQUENCES)
    || Boolean(targets && findDoublets(cards).doublets.length >= targets.commit);
}
```

**(e) `scoreNotCommitted`.** Move the free-run block from the end of `scoreHand` into a helper; `scoreHand` calls the helper and stays identical.

```js
function notCommitted(cards, openCard, playerCount) {
  const free = bestOfRoute(
    protect => freeRunArrangement(cards, openCard, protect),
    arrangement => ({ closed: false, triples: arrangement.triples }),
    cards, openCard
  );
  return report(null, false, free, cards, playerCount);
}
// No Committed tick: all 30 cards, the not-committed rule only (never the sequences or doublets routes).
export function scoreNotCommitted(cards, openCard, playerCount) {
  const error = validateOpenCard(openCard) || validateHand(cards, openCard);
  if (error) return { error };
  return notCommitted(cards, openCard, playerCount);
}
```

**(f) `scoreCommitted`.** This is what I ran.

```js
// A committed player: the commit cards are locked as checked by checkCommit; Hath comes from the Bandh
// cards only; Joker points from all 30 cards (locked groups count as natural use).
export function scoreCommitted(commitCards, bandhCards, openCard, playerCount) {
  const commit = checkCommit(commitCards, openCard, playerCount);
  if (!commit.ok) return { error: `Committed cards: ${commit.message}` };
  const bandh = bandhCards || [];
  const need = HAND_SIZE - commitCards.length;
  if (bandh.length !== need) return { error: `Bandh cards: ${bandh.length} of ${need}.` };
  const all = [...commitCards, ...bandh];
  const error = validateOpenCard(openCard) || validateHand(all, openCard);
  if (error) return { error };
  if (commit.route === 'sequences') {
    const lockedTriples = commit.groups.filter(group => group.type === 'pureTriple' && !isJoker(group.cards[0], openCard)).length;
    const found = bestOfRoute(
      protect => bestArrangement(bandh, openCard, protect, 0),
      arrangement => ({ closed: arrangement.minCost === 0, triples: lockedTriples + arrangement.triples }),
      all, openCard, commit.groups
    );
    return { ...report('sequences', true, found, all, playerCount), lockedGroups: commit.groups };
  }
  // Doublets: Hath 0; Bandh doublets only prove the close and never break a combo.
  const { doublets, rest } = findDoublets(bandh);
  const natural = naturalUse(commit.groups, all, openCard);
  const jokers = jokerCardPoints(all, openCard, natural);
  const combos = comboCodes(all, openCard);
  return {
    route: 'doublets', committed: true, closed: doublets.length >= DOUBLET_CLOSE_EXTRA,
    hathValue: 0, hath: 0, triples: 0, triplePoints: 0,
    jokerPoints: jokers.points, jokerCardPoints: jokers.points, jokerParts: jokers.parts,
    brokenCombos: jokers.broken.filter(code => combos.includes(code)),
    doublets: commit.groups.length + doublets.length, doubletTarget: doubletTargets(playerCount),
    lockedGroups: commit.groups,
    groups: doublets.map(code => ({ type: 'doublet', cards: [code, code], wilds: [] })),
    leftovers: [], unusedJokers: [], otherCards: rest
  };
}
```

**Result shapes.**
- Results of `scoreHand` and `scoreNotCommitted` don't get `lockedGroups`; consumers use `result.lockedGroups || []`.
- In `scoreCommitted`, `groups`, `leftovers` and `unusedJokers` refer to the Bandh cards only.

---

## 4. `src/handEntry.js` and `src/recognition.js`

**handEntry.js.** Imports become `{ scoreHand, scoreCommitted, scoreNotCommitted, checkCommit, canCommitFrom }` from `./hand`.

```js
export const MAX_COMMIT_CARDS = 25;

// limit: the most cards this list may hold; otherCards: the player's other list (copy limits count both).
export function addCard(cards, code, openCard, { limit = HAND_SIZE, otherCards = [] } = {}) {
  const list = cards || [];
  if (list.length >= limit) return list;
  const held = list.filter(item => item === code).length + otherCards.filter(item => item === code).length;
  if (held >= maxCopies(code, openCard)) return list;
  return sortCards([...list, code]);
}

export const commitLimit = (cards) => Math.min(MAX_COMMIT_CARDS, HAND_SIZE - (cards || []).length);
export const restLimit = (commitCards) => HAND_SIZE - (commitCards || []).length;

// The card fields a draft entry saves.
export function entryCardFields({ commitCards = [], cards = [], committed = false }) {
  if (committed) return { committed: true, commitCards: sortCards(commitCards), cards: sortCards(cards) };
  const all = sortCards([...commitCards, ...cards]);
  return all.length ? { committed: false, cards: all } : {};
}

// Form state from a saved entry. legacy = saved before v4f (cards with no committed flag).
export function entryCardState(entry) {
  if (entry && entry.committed === true && Array.isArray(entry.commitCards)) {
    return { commitCards: entry.commitCards, cards: Array.isArray(entry.cards) ? entry.cards : [], committed: true, legacy: false };
  }
  if (entry && Array.isArray(entry.cards)) {
    return { commitCards: [], cards: entry.cards, committed: false, legacy: entry.committed === undefined };
  }
  return { commitCards: [], cards: [], committed: false, legacy: false };
}

// Scores one player's entry once per (route, opened card, player count, cards); null until 30 cards and an opened card.
export function scoreEntryCached({ commitCards = [], cards = [], committed = false }, openCard, playerCount) {
  if (!openCard || commitCards.length + cards.length !== HAND_SIZE) return null;
  const key = committed
    ? `C|${openCard}|${playerCount || ''}|${sortCards(commitCards).join(',')}|${sortCards(cards).join(',')}`
    : `N|${openCard}|${playerCount || ''}|${sortCards([...commitCards, ...cards]).join(',')}`;
  if (cache.has(key)) return cache.get(key);
  const result = committed
    ? scoreCommitted(commitCards, cards, openCard, playerCount)
    : scoreNotCommitted([...commitCards, ...cards], openCard, playerCount);
  if (cache.size >= CACHE_LIMIT) cache.delete(cache.keys().next().value);
  cache.set(key, result);
  return result;
}

// True when an un-ticked player's 30 cards could have been committed (shown as a hint).
export function commitHint({ commitCards = [], cards = [], committed = false }, playerCount) {
  const all = [...commitCards, ...cards];
  return !committed && all.length === HAND_SIZE && canCommitFrom(all, playerCount);
}
```

- `handFill`, `handHathBack` and `scoreHandCached` are unchanged. The `C|` and `N|` keys never collide with `scoreHandCached` keys, which start with an opened card code.
- **Note:** `handFill` keeps its current behaviour. A scorable result overwrites the boxes; when the cards stop scoring, only the values the cards put in are cleared, and typed values stay.

**recognition.js**
- `photoCardsPlan(review, openCard, { limit = HAND_SIZE, otherCards = [] } = {})`:
  - the copies check becomes `cards.filter(c => c === code).length + otherCards.filter(c => c === code).length >= maxCopies(code, openCard)`;
  - the full check becomes `cards.length >= limit`.
- `droppedLines(dropped, limit = HAND_SIZE)`: the `full` label becomes `` `Over ${limit} cards` ``. Build the labels inside the function; keep the copies and unknown text unchanged.

---

## 5. UI

### 5.1 `src/CardPicker.js`: generalize `CardPicker`

New signature (the defaults keep every existing test passing):

```js
export function CardPicker({ player, cards, openCard, onChange, label = 'cards', limit = HAND_SIZE,
  otherCards = [], counterText, locked = false })
```

- `handFull = cards.length >= limit`.
- The counter shows `counterText ?? \`${cards.length}/${limit} cards\``.
- A rank button is disabled when `handFull || (counts[code] || 0) + otherCount(code) >= maxCopies(code, openCard)`; it calls `addCard(cards, code, openCard, { limit, otherCards })`. The aria label is unchanged and counts this list only.
- Photo input: `` aria-label={`Photo of ${player}'s ${label}`} ``. With the default label it stays "Photo of Asha's cards".
- `usePhotoCards`: `onChange(photoCardsPlan(photo.review, openCard, { limit, otherCards }).cards)`. Pass `limit` and `otherCards` to `<PhotoReview>`.
- **`locked` mode** (return early, before the photo-review branch):

```jsx
<div className="card-picker is-locked">
  <div className="card-picker-head"><strong>{counter}</strong></div>
  <p className="hand-note">Locked. Untick Committed to change these cards.</p>
  <div className="hand-chips" aria-label={`${player} ${label}`}>
    {cards.map((code, index) => <span key={`${code}-${index}`} className={`card-chip static ${isRedCode(code) ? 'red' : ''}`}>{formatCard(code)}</span>)}
  </div>
</div>
```

**PhotoReview.js**
- New props `limit = HAND_SIZE` and `otherCards = []`.
- Call `photoCardsPlan(review, openCard, { limit, otherCards })`.
- The warning becomes `plan.cards.length !== limit` with the text `Using {n} of {limit}. …`.
- Call `droppedLines(plan.dropped, limit)`.

### 5.2 New `src/HandPanel.js`

```jsx
import { useState } from 'react';
import { HAND_SIZE } from './cards';
import { CardPicker } from './CardPicker';
import { checkCommit } from './hand';
import { commitLimit, restLimit } from './handEntry';

export function HandPanel({ player, commitCards, cards, committed, openCard, playerCount,
  onCommitCardsChange, onCardsChange, onCommittedChange }) {
  const [step, setStep] = useState(() => (committed || (cards.length > 0 && commitCards.length === 0) ? 'rest' : 'commit'));
  const check = checkCommit(commitCards, openCard, playerCount);
  const restMax = restLimit(commitCards);
  const restName = committed ? '2 · Bandh' : commitCards.length ? '2 · Other cards' : 'All cards';
  const statusClass = !commitCards.length ? 'empty' : check.ok ? 'ok' : 'bad';
  const toggle = () => {
    if (!committed && !check.ok) return;
    onCommittedChange(!committed);
    setStep(committed ? 'commit' : 'rest');
  };
  return (
    <div className="hand-panel">
      <div className="step-tabs" role="tablist" aria-label={`${player} card entry`}>
        <button type="button" role="tab" className="step-tab" aria-selected={step === 'commit'} onClick={() => setStep('commit')}>
          1 · Committed {commitCards.length}
        </button>
        <button type="button" role="tab" className="step-tab" aria-selected={step === 'rest'} onClick={() => setStep('rest')}>
          {restName} {cards.length}/{restMax}
        </button>
      </div>
      <div className="commit-row">
        <label className="commit-tick">
          <input type="checkbox" checked={committed} disabled={!committed && !check.ok}
            aria-label={`${player} committed`} onChange={toggle} />
          <span>Committed</span>
        </label>
        <p className={`commit-status ${statusClass}`} role="status">{check.message}</p>
      </div>
      {step === 'commit' ? (
        <CardPicker key="commit" player={player} label="committed cards" cards={commitCards} otherCards={cards}
          limit={commitLimit(cards)} counterText={`${commitCards.length} committed cards`} openCard={openCard}
          locked={committed} onChange={onCommitCardsChange} />
      ) : (
        <CardPicker key="rest" player={player} label={committed ? 'Bandh cards' : 'cards'} cards={cards}
          otherCards={commitCards} limit={restMax} openCard={openCard} onChange={onCardsChange} />
      )}
    </div>
  );
}
```

(`HAND_SIZE` is unused; drop that import if ESLint complains.)

### 5.3 `HandSummary` (`src/CardPicker.js`)

New props: `HandSummary({ result, isCloser, isPacked, hint = false, legacyResult = null })`. Keep the existing `<summary>` line and `statusText`. A committed result shows "Committed · Hath 1 · Joker 10"; a doublets result shows "Committed · 9 doublets · …" (`doublets` = locked + Bandh).

Factor the group `<ul>` into `function GroupList({ groups, className = '' })`, using the current markup. Inside `<details>`, in this order:

1. The closer warning (unchanged).
2. If `locked.length` (where `const locked = result.lockedGroups || []`):
   - `<p className="hand-section">Shown (locked)</p><GroupList groups={locked} className="locked" />`;
   - then `<p className="hand-section">Bandh</p>`, followed by `<GroupList groups={result.groups} />` or `<p className="hand-note">No groups in the Bandh cards.</p>`.
   - Otherwise render `<GroupList groups={result.groups} />` when it has groups (as today).
3. Doublets lines:
   - when `result.route === 'doublets' && locked.length`: `Doublets: {locked.length} shown + {result.groups.length} in Bandh ({DOUBLET_CLOSE_EXTRA} in Bandh to close)`;
   - else the existing doublets lines.
4. The existing not-committed note, leftovers line, other-cards line, joker line, broken-combos line and ★ note, unchanged.
5. `hint`: `<p className="hand-note">These cards hold 5 pure sequences or enough doublets. If they were shown, enter them under 1 · Committed and tick Committed.</p>`.
6. `legacyResult && !legacyResult.error`: `<p className="hand-note">Saved before commit cards were split. The old 30-card search gave Hath {legacyResult.hath} · Joker {legacyResult.jokerPoints}; the boxes keep the saved values.</p>`.

Import `DOUBLET_CLOSE_EXTRA` from `./hand`.

### 5.4 `src/App.js`

**State.** Add:
- `const [commitCards, setCommitCards] = useState({})`;
- `const [committed, setCommitted] = useState({})`;
- `const [legacyCards, setLegacyCards] = useState({})`.

Clear all three in `resetRoundForm`.

**Imports.**
- `HandPanel`;
- `checkCommit` from `./hand`;
- from `./handEntry`: `entryCardFields, entryCardState, scoreEntryCached, commitHint` (plus the existing ones).

**Helper:**

```js
const entryOf = (player, change = {}) => ({
  commitCards: commitCards[player] || [], cards: handCards[player] || [], committed: Boolean(committed[player]), ...change
});
```

**Handlers.**
- `fillFromHand(player, entry, open)`: `result = scoreEntryCached(entry, open, players.length)`; the rest is unchanged.
- `handleCardsChange(player, list)`: `setHandCards(...)`, `setLegacyCards(p => ({ ...p, [player]: false }))`, `fillFromHand(player, entryOf(player, { cards: list }), openCard)`.
- `handleCommitCardsChange(player, list)`: the same, for `commitCards`.
- `handleCommittedChange(player, value)`:
  - if `value && !checkCommit(commitCards[player] || [], openCard, players.length).ok`, return;
  - `setCommitted(p => ({ ...p, [player]: value }))`, clear legacy, `fillFromHand(player, entryOf(player, { committed: value }), openCard)`, `setRoundError('')`.
- `handleOpenCardChange(code)`: for each player, `const keep = !committed[player] || checkCommit(commitCards[player] || [], code, players.length).ok`. If not, untick that player. Then `fillFromHand(player, entryOf(player, { committed: committed[player] && keep }), code)`.
- `handleBandhChange` (untick): `handHathBack(scoreEntryCached(entryOf(player), openCard, players.length), …)`.

**`draftRound` entries.** Replace the `cards` spread with `...entryCardFields(entryOf(player))`.

**`handleEditRound`.**
- For each entry, `const s = entryCardState(item)`; fill `nextCommitCards[item.player] = s.commitCards`, `nextCards[...] = s.cards`, `nextCommitted[...] = s.committed`, `nextLegacy[...] = s.legacy`.
- The auto-fill match uses `scoreEntryCached(s, round.openCard, players.length)`.
- Set all four states.

**Player row JSX.**
- Cards button text: ``Cards {total}/{HAND_SIZE}{committed[player] ? ' · Committed' : ''}``, where `total` = commit + other.
- "Set the opened joker card" note: when `total === HAND_SIZE`.
- `{pickerFor === player && <HandPanel player={player} commitCards={…} cards={…} committed={Boolean(committed[player])} openCard={openCard} playerCount={players.length} onCommitCardsChange={l => handleCommitCardsChange(player, l)} onCardsChange={l => handleCardsChange(player, l)} onCommittedChange={v => handleCommittedChange(player, v)} />}`.
- `<HandSummary result={scoreEntryCached(entryOf(player), openCard, players.length)} isCloser isPacked hint={commitHint(entryOf(player), players.length)} legacyResult={legacyCards[player] && (handCards[player] || []).length === HAND_SIZE ? scoreHandCached(handCards[player], openCard, players.length) : null} />`.

### 5.5 CSS (append to `src/App.css`)

```css
/* ---- v4f: commit cards ---- */
.hand-panel { grid-column: 1 / -1; display: grid; gap: 8px; min-width: 0; }
.card-picker { min-width: 0; }
.step-tabs { display: grid; grid-template-columns: repeat(2, minmax(0, 1fr)); gap: 6px; }
.step-tab { margin: 0; min-height: 44px; padding: 6px 8px; background: #eef3ed; color: var(--ink);
  border: 1px solid var(--line); border-radius: 8px; font-size: .85rem; font-weight: 600; white-space: normal; overflow-wrap: anywhere; }
.step-tab[aria-selected="true"] { background: var(--green); color: white; border-color: var(--green); }
.commit-row { display: flex; align-items: center; flex-wrap: wrap; gap: 4px 12px; }
.commit-tick { display: flex; align-items: center; gap: 6px; min-height: 44px; font-weight: 600; }
.commit-tick input:disabled + span { opacity: .45; }
.commit-status { margin: 0; flex: 1 1 150px; min-width: 0; font-size: .85rem; overflow-wrap: anywhere; }
.commit-status.ok { color: var(--green-dark); }
.commit-status.bad { color: var(--danger); }
.commit-status.empty { color: var(--muted); }
.card-picker.is-locked { background: #f4f6f3; }
.group-list.locked .card-chip { background: #eef3ed; }
.hand-section { margin: 8px 0 0; font-weight: 600; font-size: .82rem; }
```

### 5.6 Mobile layout at 360 px

The usable width inside a player card is about 300 px (App 340, score-input padding 10, player-score padding 9). Top to bottom:

1. Name | [Bandh] [Packed] (unchanged; the Committed tick is **not** added to this row, so it doesn't get crowded).
2. Hath | Joker steppers.
3. `[Cards 30/30 · Committed]` (full width).
4. The panel, when open:
   - **Tabs row**: two equal tabs of about 145 px, `1 · Committed 16` and `2 · Bandh 14/14`. They wrap to 2 lines if needed and are at least 44 px tall.
   - **Commit row**: `[x] Committed` and the status text, which wraps under the tick when narrow (e.g. "4 sequences + 2 extra cards ✗").
   - **The active picker**: the existing head (counter, Photo, Clear), the 5 suit tabs, a 5-column rank grid (about 50 px buttons), and the chips (which wrap).
5. HandSummary (`<details>`): "Shown (locked)" groups, then "Bandh" groups, the left-over line and the joker line. Chips wrap, so nothing is wider than the card.
6. The preview line.

Verify with a 360 px screenshot that `document.documentElement.scrollWidth === 360`.

---

## 6. `src/scoring.js`, `src/export.js`

**`validateRound`.** After the `packedCloser` check, add:

```js
const unshown = entries.find(entry => entry.bandh === true && entry.committed === false);
if (unshown) return `${unshown.player} did not tick Committed, so they cannot close the Bandh.`;
```

**`computeRound`.** Return also `committed: entries.filter(entry => entry.committed === true).map(entry => entry.player)`.

**`gameToCsv`.**
- The header becomes `['Round', 'Bandh', 'Multiplier', 'Packed', 'Committed']`.
- Each row adds `result.committed.join('; ')` after packed.
- `totalRow = ['Total', '', '', '', '']`.

---

## 7. `server/sessions.mjs`

```js
const CARD_CODE = /^(?:(?:A|[2-9]|10|J|Q|K)[SHDC]|JK)$/;
const isCardList = (list, max) => Array.isArray(list) && list.length <= max && list.every(code => typeof code === 'string' && CARD_CODE.test(code));

// Optional card fields on a round entry (v4a cards, v4f commitCards/committed).
export function isValidEntryCards(entry) {
  if (!entry || typeof entry !== 'object') return false;
  if (entry.cards !== undefined && !isCardList(entry.cards, 30)) return false;
  if (entry.commitCards !== undefined && !isCardList(entry.commitCards, 25)) return false;
  if (entry.committed !== undefined && typeof entry.committed !== 'boolean') return false;
  if (entry.commitCards !== undefined && entry.committed !== true) return false;
  return (entry.cards || []).length + (entry.commitCards || []).length <= 30;
}
export function hasValidCards(state) {
  return state.rounds.every(round => round.entries.every(isValidEntryCards));
}
```

- `applyUpdate`: `if (!isValidGameState(state) || !hasValidCards(state)) return false;`.
- **Leave `isValidGameState` and `loadSessions` unchanged**, so no saved session or undo snapshot on disk is ever dropped.

---

## 8. Tests (exact inputs and outputs, all verified)

Helpers: `const S = s => s.trim() ? s.trim().split(/\s+/) : [];` and `const sortedGroups = gs => gs.map(g => g.cards.join(' ')).sort();`.

Constants:
- `FIVE = '2S 3S 4S 9H 10H JH 2C 3C 4C 10D JD QD 9C 10C JC'`
- `D8 = '2S 2S 3H 3H 4C 4C 9H 9H 10C 10C JS JS KC KC AS AS'`
- `USER = 'AS 2S 3S 6S 6S 8S 9S 10S AH 2H 3H 4H 4H 6H 7H 8H 8H 9H 10H 2D 2D 5D 6D 8D 9D 2C 2C 2C 9C 10C'`
- `CA = '6H 7H 8H 8H 9H 10H AH 2H 3H 4H 8S 9S 10S 2C 2C 2C'`
- `CB = 'AS 2S 3S 6H 7H 8H 8H 9H 10H AH 2H 3H 4H 8S 9S 10S'`
- `CC = 'AS 2S 3S 6H 7H 8H 8H 9H 10H AH 2H 3H 4H 2C 2C 2C'`
- `minus(a, b)` removes one copy of each card of `b` from `a`.

### 8.1 `src/hand.test.js`: `checkCommit` (opened `'7D'`, 4 players unless stated)

| Input | ok | route | message | extra |
|---|---|---|---|---|
| FIVE | true | sequences | `5 pure sequences ✓` | `sortedGroups` = `['10D JD QD','2C 3C 4C','2S 3S 4S','9C 10C JC','9H 10H JH']`; every group `pureRun` with `wilds: []` |
| first 12 of FIVE (`2S 3S 4S 9H 10H JH 2C 3C 4C 10D JD QD`) | false | null | `4 sequences, need 5 ✗` | groups `[]` |
| FIVE + `KS 5H` | false | | `5 sequences + 2 extra cards ✗` | |
| `2S 3S 4S 9H 10H JH 2C 3C 4C 10D JD QD 9C JK JC` (wild JK) | false | | `4 sequences + 3 extra cards ✗` | |
| same with `8D` instead of `JK` (joker card as a wild) | false | | `4 sequences + 3 extra cards ✗` | |
| `6D 7D 8D 9H 10H JH 2C 3C 4C 10D JD QD 9C 10C JC` (joker cards as themselves) | true | sequences | `5 pure sequences ✓` | |
| `4D 4D 4D 9H 10H JH 2C 3C 4C 10D JD QD 9C 10C JC` (triple) | true | sequences | | a group `{type:'pureTriple', cards:['4D','4D','4D']}` |
| `QS KS AS AH 2H 3H 2C 3C 4C 10D JD QD 9C 10C JC` | true | sequences | | |
| `KS AS 2S AH 2H 3H 2C 3C 4C 10D JD QD 9C 10C JC` (K-A-2 wraps) | false | | `4 sequences + 3 extra cards ✗` | |
| `2S 3S 4S 5S 6S 7S 9H 10H JH 2C 3C 4C 10D JD QD` (run of 6 split) | true | sequences | | |
| FIVE + `6H 7H 8H` | false | | `6 sequences: commit exactly 5 ✗` | |
| D8 | true | doublets | `8 doublets ✓` | 8 groups, all `doublet` |
| D8, 3 players | false | | `8 doublets, need 9 ✗` | |
| D8 + `QD QD`, 3 players | true | doublets | `9 doublets ✓` | |
| D8 + `QD QD`, 4 players | false | | `9 doublets: commit exactly 8 ✗` | |
| D8 + `5S` | false | | `8 doublets + 1 extra card ✗` | |
| D8 with `AS AS` → `JK JK` | false | | `7 doublets + 2 extra cards ✗` | |
| D8, playerCount `undefined` | false | | `No pure sequence yet ✗` | |
| `[]` | false | | `Enter the cards that were shown` | |
| `5H` | false | | `No pure sequence yet ✗` | |
| `2S 3S 4S` | false | | `1 sequence, need 5 ✗` | |
| `5H 5H 5H 5H` | false | | `There are only 3 of 5♥ in 3 decks.` | |
| `7D 7D 7D`, opened `7D` | false | | `7♦ is the opened card, so a hand can hold at most 2.` | |
| FIVE, opened `''` | true | sequences | | (openCard isn't needed) |
| `2S ZZ` | false | | `Unknown card: ZZ.` | |

### 8.2 `src/hand.test.js`: `scoreCommitted`

**1. User, Commit A.** `scoreCommitted(S(CA), minus(S(USER), S(CA)), '5S', 4)`:
- Bandh = `AS 2S 3S 6S 6S 4H 2D 2D 5D 6D 8D 9D 9C 10C` (14 cards);
- `route 'sequences'`, `committed true`, `closed false`, `hathValue 8`, `hath 1`, `jokerPoints 10`, `jokerCardPoints 8`, `triples 1`, `triplePoints 2`, `brokenCombos []`;
- `sortedGroups(lockedGroups)` = `['2C 2C 2C','6H 7H 8H','8H 9H 10H','8S 9S 10S','AH 2H 3H 4H']`;
- `sortedGroups(groups)` = `['5D 6D 6S 8D 9D','6S 9C 10C','AS 2S 3S']`;
- `leftovers` sorted = `['2D','2D','4H']`.

**2. The old search is lower.** `scoreHand(S(USER), '5S', 4)` gives `route 'sequences'`, `hath 0`, `hathValue 4`, `jokerPoints 10`, and a group whose cards join to `'4H 6S 6H 7H 8H'` with `wilds [1]`. Assert `scoreCommitted(...A...).hath (1) > scoreHand(...).hath (0)`.

**3. Commit B.** `scoreCommitted(S(CB), minus(USER, CB), '5S', 4)`:
- `hath 1`, `hathValue 8`, `jokerPoints 10`, `triples 1`;
- `sortedGroups(groups)` = `['2C 2C 2C','5D 6D 6S 8D 9D','6S 9C 10C']`;
- `lockedGroups` contains `'AS 2S 3S'`.

**4. Commit C.** `scoreCommitted(S(CC), minus(USER, CC), '5S', 4)`: `hath 1`, `hathValue 8`, `jokerPoints 10`; the groups contain `'8S 9S 10S'`.

**5. Not committed.** `scoreNotCommitted(S(USER), '5S', 4)`:
- `committed false`, `route null`, `hathValue 97`, `hath 10`, `jokerPoints 10`;
- `sortedGroups` = `['2C 2C 2C','6H 7H 8H 9H 10H','AH 2H 3H 4H']`.

**6. Joker points across both parts.** Opened `'5S'`, 4 players.
- Commit = `5H 5H 5H 4C 5C 6C 3S 4S 5S 6S 7S 2C 2C 2C 9D 10D JD`.
- Bandh = `5C 9H 9H 9H KS KH KD 7D 8D JK QS QH 3D`.
- Expect `hath 0`, `hathValue 3`, `closed false`, `triples 2`, `triplePoints 6`, `jokerCardPoints 41`, `jokerPoints 47`, `brokenCombos ['5C']`.
- `jokerParts` labels/points:
  - `Run 3♠ 4♠ 5♠ 6♠ 7♠` 25 (the opened run counts inside a locked run);
  - `5♣ ×2 (1 played as itself)` 4 (natural use in the locked `4C 5C 6C` breaks the pair);
  - `5♥ ×3` 10 (the all-copies locked triple keeps its bonus);
  - `Joker ×1` 2.
- The Bandh groups include a `run` with cards `['5C','7D','8D']` and `wilds [0]` (wild use doesn't break the pair).
- The same 30 cards via `scoreNotCommitted`: `jokerPoints 49`, with `5♣ ×2` = 6.

**7. Closed flag.** Opened `'7D'`. Commit FIVE plus Bandh `5S 6S 7S KH KD KC QH QD JK 8D 4H 5H 6H AS AH` gives `closed true`, `hath 0`, `hathValue 0`, `jokerPoints 4`, `leftovers []`. Swapping `AH` for `2H` in that Bandh gives `closed false`, `hathValue 10`, `hath 1`, `leftovers ['AS']`.

**8. Doublets route.** Opened `'7D'`.

| Players | Commit | Bandh | Expected |
|---|---|---|---|
| 4 | D8 | `QH QH 6C 6C 9C KH 8S 10S 3D JD AH 4D 5S 6H` | `route 'doublets'`, `closed true`, `hath 0`, `doublets 10`, `sortedGroups(groups)` = `['6C 6C','QH QH']`, `otherCards` length 10, `jokerPoints 0` |
| 4 | D8 | `QH QH 2C 6C 9C KH 8S 10S 3D JD AH 4D 5S 6H` | `closed false`, `hath 0`, `doublets 9` |
| 3 | D8 + `QD QD` | `QH QH 6C 6C 9C KH 8S 10S 3D JD AH 4D` | `closed true`, `doublets 11` |
| 3 | D8 + `QD QD` | `QH QH 2C 6C 9C KH 8S 10S 3D JD AH 4D` | `closed false`, `doublets 10` |
| 4 | `2S 2S 3H 3H 4C 4C 9H 9H 10C 10C JS JS KC KC 8D 8D` (locked doublet whose third copy is in the Bandh) | `QH QH 6C 6C 9C KH 8S 10S 3D JD AH 4D 5S 8D` | `jokerPoints 6`, part `8♦ ×3 (2 played as itself)` = 6, `brokenCombos ['8D']` |
| 4 | D8 | `QH QH 8D 8D 8D KH 8S 10S 3D JD AH 4D 5S 6H` (Bandh doublet doesn't break) | `closed true`, `jokerPoints 14`, part `8♦ ×3` = 14 |

**9. Errors.**
- Commit FIVE with a Bandh of 14 → `error 'Bandh cards: 14 of 15.'`.
- Commit = the first 12 of FIVE with any Bandh → `error 'Committed cards: 4 sequences, need 5 ✗'`.
- Commit A with the Bandh's first card replaced by `'2C'` → `error 'There are only 3 of 2♣ in 3 decks.'`.

**10. Property test.** Seeded LCG (`seed = (seed * 1103515245 + 12345) % 2147483648`), 60 hands. Generator:
- random opened card;
- commit = random 3-card same-suit runs (start rank 0–10) until 15 cards, respecting the copy limits;
- Bandh = 0–3 `JK` plus random cards (35% chance from the 4 opened-rank codes and the 3 nearest neighbours) up to 15.

For each result `r` (skip errors):
- `countCards([...r.groups.flatMap(g => g.cards), ...r.leftovers, ...r.unusedJokers])` equals `countCards(bandh)`;
- `jokerCardPoints(all, open, naturalUse([...r.lockedGroups, ...r.groups], all, open)).points + r.triplePoints === r.jokerPoints`;
- each hand takes under 1000 ms.

**11. Hints.**
- `canCommitFrom(S(USER), 4) === true`.
- `canCommitFrom(S('2S 4S 6S 8S 10S QS 2H 4H 6H 8H 10H QH 2C 4C 6C 8C 10C QC 2D 4D 10D QD 4S 4H 4C 10S 10H 10C JK 7H'), 4) === false`. That is the existing EVENS hand: it has no 5 pure sequences and 0 doublets. Confirm the doublet count with `findDoublets` before asserting.

All existing hand, jokers, cards, scoring and stats tests must pass unchanged, apart from §8.5.

### 8.3 `src/handEntry.test.js`

- `addCard([], '9C', '7D', { otherCards: ['9C','9C','9C'] })` → `[]`.
- `addCard(['2S'], '3S', '7D', { limit: 1 })` → the same array (`toBe`).
- `entryCardFields({ commitCards: ['3S','2S'], cards: ['KH'], committed: true })` → `{ committed: true, commitCards: ['2S','3S'], cards: ['KH'] }`.
- `entryCardFields({ commitCards: ['3S'], cards: ['2S'], committed: false })` → `{ committed: false, cards: ['2S','3S'] }`.
- `entryCardFields({})` → `{}`.
- `entryCardState`:
  - `{ cards: X }` (30) → `{ commitCards: [], cards: X, committed: false, legacy: true }`;
  - `{ committed: false, cards: X }` → `legacy: false`;
  - `{ committed: true, commitCards: C, cards: B }` → `{ commitCards: C, cards: B, committed: true, legacy: false }`;
  - `{ hath: 3 }` → all empty, `legacy false`.
- `scoreEntryCached({ commitCards: S(CA), cards: minus(USER, CA), committed: true }, '5S', 4)`:
  - `hath 1`, `jokerPoints 10`;
  - the same call again returns the same object (`toBe`);
  - with `committed: false` → `hath 10`;
  - with 29 cards → `null`;
  - with openCard `''` → `null`.
- `commitHint({ cards: S(USER) }, 4) === true`; with `committed: true` → `false`; with 29 cards → `false`.

### 8.4 `src/recognition.test.js`

- `photoCardsPlan(startReview(['7D','7D','AS'].map((code, i) => ({ id: `p-${i}`, code, confidence: 0.9 }))), '7D', { otherCards: ['7D'], limit: 1 })`:
  - `cards` = `['7D']`;
  - `dropped` = `[{ code: '7D', reason: 'copies' }, { code: 'AS', reason: 'full' }]`.
- `droppedLines([{ code: '2H', reason: 'full' }], 15)` → `['Over 15 cards: 2♥']`.

### 8.5 `src/scoring.test.js`, `src/export.test.js`

**validateRound**, 3 players where P1 is the closer:
- `committed: false` → `'P1 did not tick Committed, so they cannot close the Bandh.'`;
- `committed: true` → `null`;
- the field missing (legacy or manual) → `null`.

**computeRound.** `committed` lists only the entries with `committed: true`.

**Export.** Update the exact strings:
- header: `'Round,Bandh,Multiplier,Packed,Committed,P1 Hath,P1 Joker,...'`;
- rows: `'1,P1,1,,,14,-34,-20,-20,0,-22,-22,-22,-2,-2,-4,-4,-12,58,46,46'` and `'2,P2,2,,,-5,-6,-22,-42,23,-2,42,20,-15,2,-26,-30,-3,6,6,52'`;
- total: `'Total,,,,,,,,-42,,,,20,,,,-30,,,,52'`;
- packed: `'1,P1,1,P3,,13,-34,-21,-21,-3,-22,-25,-25,-10,-2,-12,-12,0,58,58,58'` and `/^1,P1,1,P2; P3,,20,/`.

**New export test.** With `PK.entries[0].committed = true; PK.entries[2].committed = true` (no packed), row 1 starts with `'1,P1,1,,P1; P3,'`.

### 8.6 `server/sessions.test.mjs`

- `applyUpdate` accepts, each returning `true` and keeping the fields:
  - `{player:'A', bandh:true, hath:0, joker:10, committed:true, commitCards: <15 codes from FIVE>, cards: <15 codes>}`;
  - legacy `{cards: <30 codes>}`;
  - `{committed:false, cards: <30>}`.
- `applyUpdate` returns `false` and records no undo for:
  - `cards` of 31 codes;
  - `commitCards: ['ZZ']` with `committed: true`;
  - `committed: 'yes'`;
  - `commitCards` without `committed: true`;
  - 16 commit + 15 cards.
- `loadSessions`: write a sessions file in a `fs.mkdtempSync` dir (as the existing test does) whose entry has `cards: 'oops'`. The session still loads.
- `isValidEntryCards` is exported and tested directly with the same cases.

### 8.7 `src/HandPanel.test.js` (new) and `src/CardPicker.test.js`

**Harness:**

```jsx
function Harness({ commit = [], rest = [], open = '7D' }) {
  const [commitCards, setCommit] = useState(commit);
  const [cards, setCards] = useState(rest);
  const [committed, setCommitted] = useState(false);
  return <HandPanel player="Asha" commitCards={commitCards} cards={cards} committed={committed} openCard={open} playerCount={4}
    onCommitCardsChange={setCommit} onCardsChange={setCards} onCommittedChange={setCommitted} />;
}
const tick = () => screen.getByRole('checkbox', { name: 'Asha committed' });
```

**T1: the tick is disabled until valid.** Render with `commit = first 12 of FIVE`.
- `tick()` is disabled; `getByText('4 sequences, need 5 ✗')`.
- Click tab `'♣'`, then `Add 9♣` and `Add 10♣` → `'4 sequences + 2 extra cards ✗'`, still disabled.
- `Add J♣` → `'5 pure sequences ✓'`, enabled.

**T2: ticking locks.** Render with `commit = FIVE`.
- Click `tick()` → checked.
- The tab named `'2 · Bandh 0/15'` has `aria-selected="true"`; `getByText('0/15 cards')`.
- Click tab `/^1 · Committed 15/` → `getByText('Locked. Untick Committed to change these cards.')`.
- `queryByRole('button', { name: /^Add / })`, `queryByRole('button', { name: 'Clear' })` and `queryByRole('button', { name: /^Remove / })` are all null.
- `getByLabelText` for the Bandh photo is absent on this tab.

**T3: unticking unlocks.** Continue T2: click `tick()` → unchecked; the commit tab is selected; `Add A♠` is enabled and `Clear` is enabled.

**T4: clearing.**
- Commit FIVE, unticked: click `Clear` → `'Enter the cards that were shown'`, `tick()` disabled, tab `'1 · Committed 0'`.
- Second case, commit FIVE: tick, then on the Bandh tab click `Add A♠`, `Add 2♠` → `'2/15 cards'`. Click `Clear` → `'0/15 cards'`; the tab `/^1 · Committed 15/` is still there and `tick()` is still checked.

**T5: copy limit across both lists.** `rest = ['9C','9C','9C']`.
- The default tab is `'All cards 3/30'`.
- Click tab `/^1 · Committed 0/`, then tab `'♣'` → `Add 9♣` is disabled.

**T6: photo on the Bandh.** Commit = `6D 7D 8D 9H 10H JH 2C 3C 4C 10D JD QD 9C 10C JC` (valid; holds one 7D), opened `'7D'`.
- Tick, then `mockFetch` detections `['7D','7D','AS','2S','3S','4S','5S','6S','7S','8S','9S','10S','JS','QS','KS','AH','2H']` (17).
- Change `getByLabelText("Photo of Asha's Bandh cards")`.
- Shows `'Over the copy limit (3 of each card, 2 of the opened card): 7♦'` and `'Over 15 cards: 2♥'`.
- Click `/^Use 15 cards/` → `'15/15 cards'`.

**CardPicker.test.js additions.**
- `render(<HandSummary result={scoreCommitted(S(CA), minus(USER, CA), '5S', 4)} />)`:
  - `getByText('Committed · Hath 1 · Joker 10')`, `getByText('Shown (locked)')`, `getByText('Bandh')`;
  - `getByText(/Left over \(8 → Hath 1\): 4♥ 2♦ 2♦/)`. Leftover order follows `bestArrangement`; if it differs, assert with a regex on `/Left over \(8 → Hath 1\)/` only.
- `<HandSummary result={scoreNotCommitted(...USER...)} legacyResult={scoreHand(USER, '5S', 4)} hint />` → texts matching `/old 30-card search gave Hath 0 · Joker 10/` and `/hold 5 pure sequences/`.
- All existing CardPicker tests stay unchanged; the defaults keep "Photo of Asha's cards" and "1/30 cards".

---

## 9. Order of work and verification

1. cards.js (`validateCards`), then hand.js (a–f), then the hand tests.
2. handEntry.js and recognition.js, with their tests.
3. CardPicker, PhotoReview, the new HandPanel and HandSummary, with their tests.
4. App.js wiring and CSS.
5. scoring.js, export.js and the server, with their tests.
6. README "House rules": add §1 rules 1–8 and the data note (`committed`/`commitCards`; legacy rounds keep their stored values).
7. Checks:
   - `CI=true npx react-scripts test --watchAll=false`, all passing;
   - `node --test server/*.test.mjs`;
   - `CI=true npm run build` → "Compiled successfully";
   - a manual run at 360 px: enter commit A for a player, tick, enter the Bandh, and check the boxes show Hath 1 / Joker 10 with no horizontal scroll.
   - Report the slowest property-test hand.
   - Leave no background processes.

---

## 10. Assumptions to confirm with the user

- **A1.** A player without the tick is always scored as not committed, even when their 30 cards contain 5 sequences. The app only shows a hint.
- **A2.** A doublet commit is *exactly* 8 or 9 doublets and nothing else. 6 sequences, or 5 sequences plus extra cards, is not a valid commit.
- **A3.** On the doublets route, Bandh doublets only prove the close and never break a joker combo. A *locked* doublet of a code with a third copy elsewhere does break it, as in v4e.
- **A4.** A closer who has entered cards but not ticked Committed is blocked from submitting. A ticked closer whose Bandh is not closed only gets the existing warning. Manual entries without cards are not checked.
- **A5.** Old rounds are not re-split automatically. On Edit they open unticked and keep their saved Hath/Joker; the legacy note shows the old score, and the user re-enters commit cards by hand if they want a rescore.
- **A6.** CSV gains a `Committed` column. Cards are still not exported.
- **A7.** The Committed tick lives in the cards panel, not next to Bandh/Packed, to keep the 360 px row uncrowded. The Cards button shows "· Committed" when it is on.

### Critical Files for Implementation
- /Users/shreyaagarwal/aakashk_personal/projects/marriage_game/src/hand.js
- /Users/shreyaagarwal/aakashk_personal/projects/marriage_game/src/handEntry.js
- /Users/shreyaagarwal/aakashk_personal/projects/marriage_game/src/CardPicker.js (plus the new src/HandPanel.js)
- /Users/shreyaagarwal/aakashk_personal/projects/marriage_game/src/App.js
- /Users/shreyaagarwal/aakashk_personal/projects/marriage_game/server/sessions.mjs
