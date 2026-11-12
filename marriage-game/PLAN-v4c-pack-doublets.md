# Plan v4c: Pack, the doublets route, free runs for uncommitted hands, and fixes 1–6

The plan is below, ready to save as `PLAN-v4c-pack-doublets.md`. Every engine number and every detector change in it was checked before writing it down:

- **Engine:** I ran the exact code below against the real `src/cards.js`, `src/jokers.js` and `src/hand.js`, using `node -e` with no files written. All the expected outputs in the tests come from that run. The existing `EVENS` (188), `TRIP` (134) and user-example (Hath 0, Joker 14) results are unchanged.
- **Speed:** 300 random hands heavy in pairs (6–13 pairs, 0–3 printed jokers) took at most 3 ms each in `scoreHand`.
- **Detector:** I ran the proposed `_card_quads` code by monkeypatching it in `vision/.venv` (no `.pyc` files written):
  - Strongly tilted (trapezoid) cards: the old code finds 0 at top/bottom ratio 0.6; the new code finds all of them at every angle.
  - 30 small 44×62 cards: old code 0, new code 30.
  - One card cut by the photo edge: old code accepts it; new code gives 1 card, 1 ignored.
  - All 9 existing `test_detect.py` tests still pass.

Earlier v4a said "do NOT modify hand.js". That rule is lifted for v4c only: change only the parts named below.

---

## Decisions (state these in the README)

**Pack**
- A round entry gains an optional `packed: true` field. The field is left out when not packed, so old rounds load unchanged.
- A packed player:
  - always pays exactly `PACK_HATH = 10` Hath to the closer, whatever is typed in the box;
  - keeps full Joker points (typed in, or worked out from their cards);
  - cannot be the Bandh closer.
- The ×2 double-round multiplier applies to the pack payment like any other Hath.
- No server change: `isValidGameState` only checks that `entries` is an array.

**Doublets**
- A doublet is two identical *natural* cards: same rank and same suit.
- Three copies give 1 doublet plus 1 spare card.
- Printed jokers (`JK`) never pair.
- No joker may stand in to complete a doublet.
- A pair of a card that is a joker this round (e.g. 8♦ 8♦ when 7♦ is opened) does count as a doublet, and still earns its normal Joker points.
- Targets: `{3: commit 9, close 11}` and `{4: commit 8, close 10}`.
  - Closed: Hath 0, the player may be the closer, and the other cards are ignored.
  - Committed but not closed: Hath is the value of the non-joker cards outside the doublets, including spares from triples. No runs or sets are formed from those cards.
- Joker points on this route = `jokerCardPoints` only. Pure-triple points are **not** added. This is controlled by a constant, `DOUBLETS_SCORE_TRIPLES = false`, so it is easy to flip.

**Choosing the route**
- The engine compares the sequences route and the doublets route and picks, in this order:
  1. closed beats not closed;
  2. then lower rounded Hath;
  3. then more Joker points;
  4. then sequences.
- Only if neither route commits is the "not committed" rule used.
- The result reports `route: 'sequences' | 'doublets' | null`.

**Not committed: free runs**
- Pure single-suit runs of 4 or 5 cards are free of Hath:
  - no wild cards are used;
  - a card that is a joker this round may be used as its natural self;
  - A-2-3-4 and J-Q-K-A count; runs never wrap.
- Runs of 3 are still charged.
- Pure triples (three identical non-joker cards) are free and score triple Joker points, as now.
- The engine picks: lowest rounded Hath, then most pure triples, then lowest raw value.
- A run of 6 or more in a row frees only 5 of those cards; 8 or more can be split into 4+4 or 4+5.

**The player count is passed into the engine**
- The signature becomes `scoreHand(cards, openCard, playerCount)`.
- When `playerCount` is not 3 or 4 (or is left out), the doublets route is switched off. Old calls and tests behave exactly as before.

---

## Phase 1: `src/hand.js`

1.1 After `hathFromValue`, add these constants:
```js
export const DOUBLET_COMMIT = { 3: 9, 4: 8 };
export const DOUBLET_CLOSE_EXTRA = 2;
// Three identical cards on the doublets route are a doublet plus a spare, so they earn no pure-triple points.
export const DOUBLETS_SCORE_TRIPLES = false;
export const FREE_RUN_MIN = 4;
export const FREE_RUN_MAX = 5;
```

1.2 After `codeOf` (keep `slotOf` and `codeOf`), add the helpers and the doublets route:
```js
const orderOf = code => {
  if (code === PRINTED_JOKER) return 1000;
  const card = parseCard(code);
  return slotOf(SUITS.indexOf(card.suit), card.rank);
};
const byOrder = (a, b) => orderOf(a) - orderOf(b);
const toList = node => {
  const items = [];
  for (let n = node; n; n = n.next) items.push(n.item);
  return items;
};

export function doubletTargets(playerCount) {
  const commit = DOUBLET_COMMIT[playerCount];
  return commit ? { commit, close: commit + DOUBLET_CLOSE_EXTRA } : null;
}

// Doublets are two identical natural cards (same rank and suit); three copies are a doublet
// and a spare. Printed jokers never pair and no joker completes a doublet.
export function findDoublets(cards) {
  const counts = countCards(cards);
  const codes = Object.keys(counts).sort(byOrder);
  const doublets = codes.filter(code => code !== PRINTED_JOKER && counts[code] >= 2);
  const rest = [];
  codes.forEach(code => {
    const left = doublets.includes(code) ? counts[code] - 2 : counts[code];
    for (let n = 0; n < left; n += 1) rest.push(code);
  });
  return { doublets, rest };
}

// Commit by doublets: null below the commit count. Closed hands ignore the other cards.
export function doubletArrangement(cards, openCard, playerCount) {
  const targets = doubletTargets(playerCount);
  if (!targets) return null;
  const { doublets, rest } = findDoublets(cards);
  if (doublets.length < targets.commit) return null;
  const closed = doublets.length >= targets.close;
  const leftovers = closed ? [] : rest.filter(code => !isJoker(code, openCard));
  return {
    closed,
    cost: leftovers.reduce((sum, code) => sum + cardValue(parseCard(code).rank), 0),
    groups: doublets.map(code => ({ type: 'doublet', cards: [code, code], wilds: [] })),
    leftovers,
    unusedJokers: closed ? [] : rest.filter(code => isJoker(code, openCard)),
    otherCards: closed ? rest : []
  };
}
```

1.3 Directly before `scoreHand`, add `freeRunArrangement`. It works per suit, choosing at each step what to do with the lowest card left (the same idea as `pureMax`). The memo is keyed on base-4 counts; each memo entry is an array indexed by the number of triples, holding the lowest value for that count. The suits are then combined like a knapsack.
```js
// Not committed: pure runs of 4-5 (one suit, no wilds; a joker card may be itself; A-2-3-4 and
// J-Q-K-A, no wrap) and pure triples leave Hath. Lowest Hath, then most pure triples, then lowest value.
export function freeRunArrangement(cards, openCard) {
  const POWERS = Array.from({ length: 13 }, (_, n) => 4 ** n);
  const perSuit = SUITS.map(suit => {
    let start = 0;
    cards.forEach(code => {
      if (code === PRINTED_JOKER) return;
      const card = parseCard(code);
      if (card.suit === suit) start += POWERS[card.rank - 1];
    });
    const codeAt = index => cardCode(index + 1, suit);
    const joker = POWERS.map((_, index) => isJoker(codeAt(index), openCard));
    const memo = new Map();
    // best[t] = lowest leftover value using exactly t pure triples, for the cards left in this suit.
    function solve(key) {
      if (key === 0) return [{ value: 0, groups: null, left: null }];
      const known = memo.get(key);
      if (known) return known;
      const counts = [];
      for (let n = 0, rest = key; n < 13; n += 1, rest = Math.floor(rest / 4)) counts.push(rest % 4);
      const r = counts.findIndex(count => count > 0);
      const best = [];
      const offer = (nextKey, value, triples, group, leftover) => {
        solve(nextKey).forEach((option, t) => {
          if (!option) return;
          const total = option.value + value;
          if (best[t + triples] && best[t + triples].value <= total) return;
          best[t + triples] = {
            value: total,
            groups: group ? { item: group, next: option.groups } : option.groups,
            left: leftover ? { item: leftover, next: option.left } : option.left
          };
        });
      };
      // The lowest card is charged (joker cards cost nothing), or starts a triple or a run.
      offer(key - POWERS[r], joker[r] ? 0 : cardValue(r + 1), 0, null, codeAt(r));
      if (counts[r] >= 3 && !joker[r]) {
        offer(key - 3 * POWERS[r], 0, 1, { type: 'pureTriple', cards: [codeAt(r), codeAt(r), codeAt(r)], wilds: [] }, null);
      }
      for (let length = FREE_RUN_MIN; length <= FREE_RUN_MAX; length += 1) {
        const runs = [];
        if (r + length <= 13) runs.push(Array.from({ length }, (_, k) => r + k));
        if (r === 0) runs.push([...Array.from({ length: length - 1 }, (_, k) => 14 - length + k), 0]); // ace high
        runs.forEach(ranks => {
          if (ranks.some(index => counts[index] === 0)) return;
          const used = ranks.reduce((sum, index) => sum + POWERS[index], 0);
          offer(key - used, 0, 0, { type: 'pureRun', cards: ranks.map(codeAt), wilds: [] }, null);
        });
      }
      memo.set(key, best);
      return best;
    }
    return solve(start);
  });

  let combined = [{ value: 0, picks: [] }];
  perSuit.forEach(options => {
    const next = [];
    combined.forEach((so, t) => {
      if (!so) return;
      options.forEach((option, u) => {
        if (!option) return;
        const value = so.value + option.value;
        if (next[t + u] && next[t + u].value <= value) return;
        next[t + u] = { value, picks: [...so.picks, option] };
      });
    });
    combined = next;
  });
  // Rising t means more triples, so "<=" keeps the most triples at the lowest Hath.
  let chosen = null;
  let triples = 0;
  combined.forEach((option, t) => {
    if (!option) return;
    if (!chosen || hathFromValue(option.value) <= hathFromValue(chosen.value)) {
      chosen = option;
      triples = t;
    }
  });
  const spare = chosen.picks.flatMap(pick => toList(pick.left));
  return {
    cost: chosen.value,
    triples,
    groups: chosen.picks.flatMap(pick => toList(pick.groups)),
    leftovers: spare.filter(code => !isJoker(code, openCard)),
    unusedJokers: [...spare.filter(code => isJoker(code, openCard)), ...cards.filter(code => code === PRINTED_JOKER)]
  };
}
```

1.4 Replace `scoreHand` completely:
```js
// Closed beats open, then lower Hath, then more Joker points; a full tie keeps the earlier route (sequences).
function beats(a, b) {
  if (a.closed !== b.closed) return a.closed;
  if (a.hath !== b.hath) return a.hath < b.hath;
  return a.jokerPoints > b.jokerPoints;
}

// Hath and Joker points for one 30-card hand. playerCount (3 or 4) turns on the doublets route.
export function scoreHand(cards, openCard, playerCount) {
  const error = validateOpenCard(openCard) || validateHand(cards, openCard);
  if (error) return { error };
  const jokers = jokerCardPoints(cards, openCard);
  const base = {
    jokerCardPoints: jokers.points,
    jokerParts: jokers.parts,
    doublets: findDoublets(cards).doublets.length,
    doubletTarget: doubletTargets(playerCount)
  };
  const build = (route, committed, closed, arrangement, triples) => {
    const triplesPoints = triplePoints(triples);
    return {
      ...base, route, committed, closed,
      hathValue: arrangement.cost,
      hath: hathFromValue(arrangement.cost),
      triples,
      triplePoints: triplesPoints,
      jokerPoints: jokers.points + triplesPoints,
      groups: arrangement.groups,
      leftovers: arrangement.leftovers,
      unusedJokers: arrangement.unusedJokers,
      otherCards: arrangement.otherCards || []
    };
  };
  const candidates = [];
  const sequences = bestArrangement(cards, openCard);
  if (sequences) candidates.push(build('sequences', true, sequences.minCost === 0, sequences, sequences.triples));
  const pairs = doubletArrangement(cards, openCard, playerCount);
  if (pairs) {
    const counts = countCards(cards);
    const tripleCount = DOUBLETS_SCORE_TRIPLES
      ? Object.keys(counts).filter(code => counts[code] === 3 && !isJoker(code, openCard)).length
      : 0;
    candidates.push(build('doublets', true, pairs.closed, pairs, tripleCount));
  }
  if (candidates.length) return candidates.reduce((best, next) => (beats(next, best) ? next : best));
  const free = freeRunArrangement(cards, openCard);
  return build(null, false, false, free, free.triples);
}
```
Result fields are the old ones plus `route`, `doublets`, `doubletTarget` (`{commit, close}` or null) and `otherCards`. Group `type` may now also be `'doublet'`.

## Phase 2: `src/hand.test.js` (add; keep every existing test)

Import `scoreHand`, `findDoublets`, `doubletTargets` and `freeRunArrangement` as well. Add `const S = text => text.split(' ');`. All hands below use opened card `'7D'`, so the joker cards are 7♠ 7♥ 7♦ 7♣ 5♦ 6♦ 8♦ 9♦ and JK.

```js
const D10 = S('2S 2S 3H 3H 4C 4C 5S 5S 9H 9H 10C 10C JS JS QH QH KC KC AS AS 2C 6C 9C KH 8S 10S 3D JD AH 4D');
const D8T = S('2S 2S 3H 3H 4C 4C 9H 9H 10C 10C JS JS KC KC 5S 5S 5S 2C 6C 9C KH 8S 10S 3D JD AH 4D 10D 6H QC');
const DJK = S('2S 2S 3H 3H 4C 4C 9H 9H 10C 10C JS JS KC KC JK JK 2C 6C 9C KH 8S 10S 3D JD AH 4D 10D 6H QC 5S');
const D8D = S('2S 2S 3H 3H 4C 4C 9H 9H 10C 10C JS JS KC KC 8D 8D 2C 6C 9C KH 8S 10S 3D JD AH 4D 10D 6H QC 5S');
const BOTH = S('2S 3S 4S 2S 3S 4S 9H 10H JH 9H 10H JH QC KC AC 2D 2D 3C 3C 10S 10S 4H 4H 8S 6C 9C KH 3D JD AH');
const E1 = S('AS 2S 3S 4S JH QH KH AH 8C 9C 10C JC QC KC 9S KS 10S 6H 2H 4H 9H 8H 10D 10D QD 3D 2D 6C 4C KD');
const E2 = S('3H 4H 5H 5H 5H 6H 7S 7S 7S 7C 7C 7C JK JK JK 9D 9D 9D 10S QS KS 10C QC KC 10D QD 2S 2C 3S 3C');
const E2B = S('3H 4H 5H 5H 5H 6H 7S 7S 7S 7C 7C 7C JK JK JK 9D 9D 9D 10S QS KS 10C QC KC 10D QD 2S 4C 3S 3C');
const E3 = S('3D 4D 5D 6D AS 2S 3S 4S 9S KS 10S 6H 2H 4H 9H 8H 10D KD 6C 4C 2C 8C 9C JC KC JK 7H QH KD 9C');
```

| Test | Call | Expect |
|---|---|---|
| targets | `doubletTargets(3)`, `(4)`, `(5)`, `()` | `{commit:9,close:11}`, `{commit:8,close:10}`, `null`, `null` |
| findDoublets | `findDoublets(S('5S 5S 5S JK JK 8D 8D 2C'))` | `{ doublets: ['5S','8D'], rest: ['5S','8D'…]` — exactly: `doublets ['5S','8D']`, `rest ['5S','2C','JK','JK']` |
| 4p closed by doublets | `scoreHand(D10,'7D',4)` | `route 'doublets'`, `committed true`, `closed true`, `hath 0`, `hathValue 0`, `doublets 10`, 10 groups all `type 'doublet'`, `leftovers []`, `otherCards.length 10` |
| 3p committed, not closed | `scoreHand(D10,'7D',3)` | `route 'doublets'`, `closed false`, `hathValue 72`, `hath 7`, `leftovers ['8S','10S','AH','KH','3D','4D','JD','2C','6C','9C']` |
| no player count → no doublets | `scoreHand(D10,'7D')` | `committed false`, `route null`, `hathValue 218`, `hath 15` |
| triple = doublet + spare | `scoreHand(D8T,'7D',4)` | `route 'doublets'`, `hathValue 103`, `hath 10`, `triples 0`, `jokerPoints 0`, `leftovers` contains `'5S'` |
| same hand, 3p (8 < 9) | `scoreHand(D8T,'7D',3)` | `committed false`, `hathValue 194`, `triples 1`, `jokerPoints 2` |
| printed jokers never pair | `scoreHand(DJK,'7D',4)` | `committed false`, `doublets 7`, `hathValue 199`, `hath 15`, `jokerPoints 6` |
| joker-card pair counts | `scoreHand(D8D,'7D',4)` | `route 'doublets'`, `hathValue 103`, `hath 10`, `jokerPoints 6`, a group with cards `['8D','8D']`, `leftovers` has no `'8D'`; and `scoreHand(D8D,'7D',3).committed === false` |
| closed doublets beat sequences | `scoreHand(BOTH,'7D',4)` | `route 'doublets'`, `closed true`, `hath 0` |
| Hath tie → sequences | `scoreHand(BOTH,'7D',3)` | `route 'sequences'`, `hathValue 94`, `hath 9` (doublets would give 86 → also 9) |
| sequences route reported | user's example hand (existing), `scoreHand(hand,'7D',4)` | `route 'sequences'`, `closed true`, `doublets 0`, `jokerPoints 14` |
| free runs: A-2-3-4, J-Q-K-A, a 6-run frees 5 | `scoreHand(E1,'7D',4)` | `committed false`, `hathValue 121`, `hath 12`, groups (as `type:cards`) exactly `pureRun AS 2S 3S 4S`, `pureRun JH QH KH AH`, `pureRun 9C 10C JC QC KC`; `leftovers` contains `'8C'` |
| rounding tie → triple | `scoreHand(E2,'7D',4)` | `hathValue 103`, `hath 10`, `triples 1`, `jokerPoints 50`, `groups` = `[{type:'pureTriple',cards:['5H','5H','5H'],wilds:[]}]` |
| run wins when Hath is lower | `scoreHand(E2B,'7D',4)` | `hathValue 102`, `hath 10`, `triples 0`, `jokerPoints 48`, `groups` = `[{type:'pureRun',cards:['3H','4H','5H','6H'],wilds:[]}]` |
| joker cards as their natural selves; printed joker never | `scoreHand(E3,'7D',4)` | `hathValue 133`, `hath 13`, `jokerPoints 8`, groups include `['3D','4D','5D','6D']` and `['6H','7H','8H','9H']`, `unusedJokers` `['JK']` |

Also add a randomized test, seeded with the same LCG as the existing one, `seed = 4242`, over 40 hands:
- Build each hand of 30 random cards from 3 decks (respecting `validateHand`), with a random opened card.
- Call `r = scoreHand(hand, open, 4)`.
- If `!r.committed`:
  - every group is `pureTriple` (3 identical non-joker cards), or `pureRun` of length 4–5 that passes the existing `checkGroup` with no wilds;
  - `countCards([...groups.flatMap(g => g.cards), ...leftovers, ...unusedJokers])` equals `countCards(hand)`;
  - `hathValue` equals the sum of the leftover values;
  - `hathValue` is at most the old rule's value (every non-joker card except codes held 3 times).
- If `r.route === 'doublets'`, the same card-conservation check holds with `otherCards` added.
- Every hand must score in under 1 s (check with `Date.now()`). Measured worst case: 3 ms.

The existing tests stay unchanged and must still pass: they call `scoreHand(hand,'7D')` with no player count. I checked: `EVENS` gives 188 and `TRIP` gives 134.

## Phase 3: `src/handEntry.js` and its test

3.1 `sortKey`: unknown codes go last instead of crashing.
```js
  const card = parseCard(code);
  return card ? SUITS.indexOf(card.suit) * 13 + card.rank : 2000;
```

3.2 `scoreHandCached(cards, openCard, playerCount)`:
- set the key to `` `${openCard}|${playerCount || ''}|${sortCards(cards).join(',')}` ``;
- call `scoreHand(cards, openCard, playerCount)`.

3.3 Add the pure helper behind bug fix #1:
```js
// After a player's cards or the opened card change: the boxes take the scored values, or, when the
// hand can no longer be scored, lose the values the cards put there (a value the player typed over stays).
// `filled` is what the cards last put in the boxes: { hath, joker } strings, or undefined.
export function handFill(result, boxes, filled) {
  if (result && !result.error) {
    const next = { hath: String(result.hath), joker: String(result.jokerPoints) };
    return { ...next, filled: next };
  }
  if (!filled) return { hath: boxes.hath, joker: boxes.joker, filled: undefined };
  return {
    hath: boxes.hath === filled.hath ? '' : boxes.hath,
    joker: boxes.joker === filled.joker ? '' : boxes.joker,
    filled: undefined
  };
}
```

3.4 Tests:
- `sortCards(['XX','JK','2S'])` → `['2S','JK','XX']`.
- `sortCards([undefined,'2S'])` → `['2S', undefined]`.
- `handFill({hath:3,jokerPoints:14}, {hath:'',joker:''})` → `{hath:'3',joker:'14',filled:{hath:'3',joker:'14'}}`.
- `handFill(null, {hath:'3',joker:'14'}, {hath:'3',joker:'14'})` → `{hath:'',joker:'',filled:undefined}`.
- `handFill({error:'x'}, {hath:'5',joker:'14'}, {hath:'3',joker:'14'})` → `{hath:'5',joker:'',filled:undefined}`.
- `handFill(null, {hath:'5',joker:'2'}, undefined)` → `{hath:'5',joker:'2',filled:undefined}`.
- Using `D10` from Phase 2: `scoreHandCached(D10,'7D',4).closed === true` and `scoreHandCached(D10,'7D',3).closed === false`, so the two counts are cached separately.

## Phase 4: `src/scoring.js` (Pack)

4.1 `export const PACK_HATH = 10;`

4.2 `validateRound`:
- After the "exactly one" closer check, add: `const packedCloser = entries.find(entry => entry.bandh === true && entry.packed === true); if (packedCloser) return `${packedCloser.player} packed, so they cannot close the Bandh.`;`
- In the Hath loop, change `if (entry.bandh) continue;` to `if (entry.bandh || entry.packed === true) continue;`.

4.3 `computeRound`:
- Use `const lost = entry.packed === true ? PACK_HATH : Math.min(entryNumber(entry.hath), MAX_HATH);`.
- Add `packed: entries.filter(entry => entry.packed === true && entry !== closer).map(entry => entry.player)` to the returned object.

4.4 Tests in `scoring.test.js`. Define `const PK = round('P1', [0, 3, 0, 0], [2, 5, 10, 25]); PK.entries[2].packed = true;`.
- `computeRound(PK).hath` → `{P1:13,P2:-3,P3:-10,P4:0}`.
- `.joker` → `{P1:-34,P2:-22,P3:-2,P4:58}`.
- `.nets` → `{P1:-21,P2:-25,P3:-12,P4:58}`; the sum is 0.
- `.packed` → `['P3']`.
- A typed Hath is ignored: with `PK.entries[2].hath = 15` the result is still -10.
- Doubled: `computeRound(PK, 2).nets.P3` → `-24`.
- `validateRound(P4, PK)` → null, even with `hath: 99` on the packed entry.
- Packed closer: `round('P1',…)` with `entries[0].packed = true` → matches `/cannot close/`.
- Old rounds give `computeRound(EX1).packed` → `[]`.

## Phase 5: `src/export.js` and `src/stats.js`

5.1 CSV:
- Header: `['Round', 'Bandh', 'Multiplier', 'Packed']`.
- Row: `[index + 1, result.closer ?? '', result.multiplier, result.packed.join('; ')]`.
- Total row: `['Total', '', '', '']`.
- Update the expected test strings. Insert `Packed,` after `Multiplier,` in the header. Rows become `'1,P1,1,,14,…'` and `'2,P2,2,,-5,…'`. The total row becomes `'Total,,,,,,,-42,,,,20,,,,-30,,,,52'`.
- New test: `gameToCsv(P4,[PK])` second line is `'1,P1,1,P3,13,-34,-21,-21,-3,-22,-25,-25,-10,-2,-12,-12,0,58,58,58'`. With P2 also packed, the Packed cell is `P2; P3` and P1's Hath is `20`.

5.2 Stats:
- Add `packs: 0` to each row.
- Inside the loop: `if (entry && entry.packed === true) row.packs += 1;`.
- Add `packs: 0` to the existing `toEqual` objects.
- New test: `computePlayerStats([PK], P4)` gives P3 `packs` 1 and `hathPoints` -10; the others have `packs` 0.

## Phase 6: `src/CardPicker.js` → `HandSummary`

- Change the import to `import { PACK_HATH } from './scoring';`.
- `GROUP_LABELS` gains `doublet: 'Doublet'`.
- The signature becomes `HandSummary({ result, isCloser, isPacked })`.
```js
function statusText(result) {
  if (!result.committed) return 'Not committed';
  const status = result.closed ? 'Closed' : 'Committed';
  return result.route === 'doublets' ? `${status} · ${result.doublets} doublets` : status;
}
```
- Summary line: `{isPacked ? 'Packed · ' : ''}{statusText(result)} · Hath {isCloser ? '—' : isPacked ? PACK_HATH : result.hath} · Joker {result.jokerPoints}`.
- After the closer warning, add:
  - `result.route === 'doublets' && result.doubletTarget` → `<p className="hand-line">Doublets: {d} ({commit} to commit, {close} to close)</p>`;
  - `!result.committed && result.doubletTarget && result.doublets > 0` → `<p className="hand-note">Doublets: {d} of {commit} needed to commit</p>`;
  - `!result.committed` → `<p className="hand-note">Not committed: runs of 4–5 and pure triples are free; all other cards count.</p>`.
- After the leftovers line: `result.otherCards.length > 0` → `<p className="hand-line">Other cards (not counted): {result.otherCards.map(formatCard).join(' ')}</p>`.
- Show the ★ note only when `result.groups.some(group => group.wilds.length)`.
- Tests in `CardPicker.test.js`:
  - `render(<HandSummary result={scoreHand(D10,'7D',4)} />)` → `getByText('Closed · 10 doublets · Hath 0 · Joker 0')`;
  - `render(<HandSummary result={scoreHand(DJK,'7D',4)} isPacked />)` → `getByText('Packed · Not committed · Hath 10 · Joker 6')`.
  - Copy the D10 and DJK arrays from Phase 2 into this test file.

## Phase 7: `src/App.js`

Read the whole file first. Keep everything not mentioned.

7.1 Imports:
- add `PACK_HATH` to the `./scoring` import;
- add `handFill` to the `./handEntry` import.

7.2 State and ref:
- `const [packed, setPacked] = useState({});`
- `const autoFillRef = useRef({});`

7.3 `resetRoundForm` also calls `setPacked({})` and sets `autoFillRef.current = {}`.

7.4 Replace `fillFromHand` (around line 357). This is **bug fix #1**: changing the opened card, setting it to "Not set", or making a hand unscorable now clears the values the cards put in the boxes instead of leaving stale ones.
```js
  const fillFromHand = (player, cards, open) => {
    const result = scoreHandCached(cards, open, players.length);
    const next = handFill(result, { hath: hathInputs[player], joker: jokerInputs[player] }, autoFillRef.current[player]);
    autoFillRef.current = { ...autoFillRef.current, [player]: next.filled };
    setHathInputs(previous => ({ ...previous, [player]: next.hath }));
    setJokerInputs(previous => ({ ...previous, [player]: next.joker }));
    if (next.filled) setRoundError('');
  };
```
`handleCardsChange` and `handleOpenCardChange` stay as they are; they already call `fillFromHand`.

7.5 `handleBandhChange`:
- Use `if (packed[player]) return;` as the first line.
- After clearing the Hath, when unticking (`bandh === player`), call `fillFromHand(player, handCards[player], openCard)`.

7.6 Add the pack handler:
```js
  const handlePackedChange = (player) => {
    setPacked(previous => ({ ...previous, [player]: !previous[player] }));
    if (!packed[player] && bandh === player) setBandh('');
    setRoundError('');
  };
```

7.7 `draftRound` entries:
- `hath: bandh === player ? 0 : packed[player] ? PACK_HATH : (!hathInputs[player] ? 0 : Number(hathInputs[player]))`;
- add `...(packed[player] ? { packed: true } : {})`.

7.8 `handleEditRound`:
- `nextHath[item.player] = item.bandh || item.packed === true ? '' : String(item.hath);`
- build `nextPacked` from `item.packed === true` and call `setPacked(nextPacked)`.
- Rebuild `autoFillRef.current`: for each item with `cards`, take `result = scoreHandCached(item.cards, round.openCard, players.length)`. When it is valid and `String(result.hath) === nextHath[p]` and `String(result.jokerPoints) === nextJoker[p]`, set `{ hath, joker }`. Otherwise leave it out.

7.9 Entry row JSX:
- Wrap the Bandh label in `<div className="entry-flags">…</div>` and add a second label inside it:
```jsx
<label className="bandh-option">
  <input type="checkbox" checked={Boolean(packed[player])} aria-label={`${player} packed`}
    onChange={() => handlePackedChange(player)} />
  <span>Packed</span>
</label>
```
- The Bandh input gets `disabled={Boolean(packed[player])}`.
- `const isPacked = Boolean(packed[player]);`.
- Add `is-packed` to the `player-score` class when packed.
- Hath stepper:
  - `value={isCloser ? '' : isPacked ? String(PACK_HATH) : hathInputs[player]}`
  - `disabled={isCloser || isPacked}`
  - `placeholder={isCloser ? '—' : '0'}`
- Pass `players.length` as the third argument to the `scoreHandCached` call inside `<HandSummary …>`, and add `isPacked={isPacked}`.

7.10 Round history cell: after the `score-badge` span, add `{result.packed.includes(player) && <span className="packed-tag">Packed</span>}`.

7.11 Stats table: add `['Packed', row => row.packs]` after `'Bandh closed'`.

7.12 Setup summary: `… · Hath max {MAX_HATH} · Pack pays {PACK_HATH} · Joker of 20 …`.

## Phase 8: `src/App.css` (append)

```css
/* ---- v4c: pack ---- */
.entry-flags { display: flex; align-items: center; gap: 10px; flex-wrap: wrap; }
.player-score.is-packed { background: #f4f6f3; }
.bandh-option input:disabled + span { opacity: .45; }
.packed-tag {
  display: inline-block; margin-left: 4px; padding: 0 5px; border-radius: 6px;
  background: #eef3ed; color: var(--muted); font-size: .66rem; font-weight: 600;
}
@media (max-width: 700px) {
  .player-score .entry-flags { grid-column: 2; grid-row: 1; gap: 8px; }
  .entry-flags .bandh-option { min-height: 44px; }
  .packed-tag { display: block; width: fit-content; margin: 2px 0 0; }
}
```

## Phase 9: server (Pack)

No code change. Add a test to `server/sessions.test.mjs`: `isValidGameState(state([{ entries: [{player:'A',bandh:true,hath:0,joker:0},{player:'B',bandh:false,packed:true,hath:10,joker:3},{player:'C',bandh:false,hath:2,joker:0}] }, ROUND]))` is `true`. Then `applyUpdate` keeps `packed: true`.

---

## Section B: fixes 2–6

### B1. Fix #2: the review screen must not crash on bad data (`src/recognition.js`, `src/PhotoReview.js`)

`recognition.js`: import `parseCard`, `formatCard`, `HAND_SIZE` and `DECKS` from `./cards`, and `addCard` and `maxCopies` from `./handEntry`.

- `startReview(cards, ignoredAtEdge = 0)` becomes:
```js
  return {
    ignoredAtEdge,
    cards: (cards || []).map(card => {
      const code = typeof card.code === 'string' ? card.code : '';
      return {
        ...card,
        code,
        confidence: Number.isFinite(card.confidence) ? card.confidence : 0,
        alternatives: Array.isArray(card.alternatives) ? card.alternatives.filter(item => item && typeof item.code === 'string') : [],
        chosen: code, confirmed: false, removed: false
      };
    })
  };
```
- `updateCard` returns `{ ...review, cards: … }`, so `ignoredAtEdge` survives edits.
- `needsCheck`: `!card.removed && !card.confirmed && (card.confidence < LOW_CONFIDENCE || !parseCard(card.chosen))`.
- `reviewSamples` also filters on `parseCard(card.chosen)`.

`PhotoReview.js` `CardChooser`:
```js
  const parsed = parseCard(card.chosen);
  const [suit, setSuit] = useState(() => (parsed && !parsed.joker ? parsed.suit : 'S'));
  const guesses = [card.code, ...(card.alternatives || []).map(item => item.code)]
    .filter((code, index, list) => parseCard(code) && list.indexOf(code) === index);
```
On the grid label and its aria-label, show `'?'` and "Unknown card" when `!parseCard(card.chosen)`.

Tests:
- `startReview([{ id:'a-0', code:'ZZ', confidence:0.9 }, { id:'a-1', code:'AS', confidence:0.9 }])`:
  - `cards[0].alternatives` is `[]`;
  - `needsCheck` gives `[true,false]`;
  - `reviewSamples` gives `[{id:'a-1',code:'AS'}]`.
- `startReview([{id:'b-0'}]).cards[0]` has `code ''` and `confidence 0`.
- Render `PhotoReview` with that first review and `openCard="7D"`, then click `"Unknown card, tap to change"`. The chooser appears (a `"Change to A♠"` button exists) with no crash, and `"1 to check"` is shown.

### B2. Fix #4: "Use N cards" shows what will really be added (`recognition.js`, `PhotoReview.js`, `CardPicker.js`)

```js
// What "Use cards" really adds: unknown codes, copies over the limit (3 decks; the opened card
// has one copy face up) and cards past 30 are dropped, in photo order.
export function photoCardsPlan(review, openCard) {
  let cards = [];
  const dropped = [];
  reviewCards(review).forEach(code => {
    if (!parseCard(code)) dropped.push({ code, reason: 'unknown' });
    else if (cards.filter(item => item === code).length >= maxCopies(code, openCard)) dropped.push({ code, reason: 'copies' });
    else if (cards.length >= HAND_SIZE) dropped.push({ code, reason: 'full' });
    else cards = addCard(cards, code, openCard);
  });
  return { cards, dropped };
}

const DROP_LABELS = {
  copies: `Over the copy limit (${DECKS} of each card, ${DECKS - 1} of the opened card)`,
  full: `Over ${HAND_SIZE} cards`,
  unknown: 'Not a known card'
};
export function droppedLines(dropped) {
  return ['copies', 'full', 'unknown']
    .map(reason => ({ reason, codes: dropped.filter(item => item.reason === reason).map(item => item.code) }))
    .filter(group => group.codes.length)
    .map(group => `${DROP_LABELS[group.reason]}: ${group.codes.map(code => (parseCard(code) ? formatCard(code) : code || '?')).join(' ')}`);
}
```

`PhotoReview` gains an `openCard` prop and computes `const plan = photoCardsPlan(review, openCard);`.
- The "Using N of 30" warning uses `plan.cards.length`.
- Render each `droppedLines(plan.dropped)` line as `<p className="hand-warning">`.
- The button reads `Use {plan.cards.length} cards` and has `disabled={!plan.cards.length}`.
- When `review.ignoredAtEdge > 0`: `<p className="hand-note">{n} {n === 1 ? 'card' : 'cards'} at the edge of the photo {n === 1 ? 'was' : 'were'} ignored. Move them in and retake to include them.</p>`.

`CardPicker`:
- Pass `openCard={openCard}` to `PhotoReview`.
- `usePhotoCards` calls `onChange(photoCardsPlan(photo.review, openCard).cards)`.
- In `handlePhoto`: `const { cards: found, ignoredAtEdge } = await recognizePhoto(...)`, then `startReview(found, ignoredAtEdge)`.
  - When nothing is found and `ignoredAtEdge > 0`, the error is `` `No whole cards found: ${ignoredAtEdge} at the edge of the photo were ignored. Move the cards in from the edges and try again.` ``.

Client `recognizePhoto` returns `{ cards: Array.isArray(data.cards) ? data.cards : [], ignoredAtEdge: Number.isInteger(data.ignoredAtEdge) ? data.ignoredAtEdge : 0 }`.

Tests:
- In `recognition.test.js`, the existing posting test now expects `{ cards: CARDS, ignoredAtEdge: 0 }`. A reply of `{ ignoredAtEdge: 3 }` gives `{ cards: [], ignoredAtEdge: 3 }`.
- Plan with 4×`7D` plus A–10 of ♠ ♥ ♣ (34 cards), opened `7D`:
  - `cards.length` is 30;
  - `dropped` is `[{code:'7D',reason:'copies'},{code:'7D',reason:'copies'},{code:'9C',reason:'full'},{code:'10C',reason:'full'}]`;
  - `droppedLines` is `['Over the copy limit (3 of each card, 2 of the opened card): 7♦ 7♦', 'Over 30 cards: 9♣ 10♣']`.
- `['JK','JK','JK','JK']` → `cards` has three JK and one JK is dropped as `copies`.
- `'ZZ'` → `'Not a known card: ZZ'`; `''` → `'Not a known card: ?'`.
- Removed cards are not counted.
- `setChoice` keeps `ignoredAtEdge`.
- In `CardPicker.test.js`, the first test's button becomes `/^Use 30 cards/`. Before clicking, assert `getByText('Over the copy limit (3 of each card, 2 of the opened card): 7♦ 7♦')`.
- New test: mock `{ cards: [], ignoredAtEdge: 2 }` → the alert contains `"2 at the edge"`.

### B3. Fix #3: a timeout kills a wedged worker (`server/vision.mjs`)

- In `handleLine`, replace `entry.resolve(message.cards)` with `entry.resolve({ cards: Array.isArray(message.cards) ? message.cards : [], ignoredAtEdge: Number.isInteger(message.ignoredAtEdge) ? message.ignoredAtEdge : 0 });`.
- In `recognize`, before `setTimeout`, add `const sentTo = worker;`. The timer body becomes:
```js
        waiting.delete(id);
        reject(new Error('Card recognition timed out.'));
        // A worker that misses a reply is stuck: kill it so the next photo starts a fresh one.
        if (sentTo && worker === sentTo) {
          worker = null;
          failAll(new Error('Card recognition was restarted after a photo took too long. Try again.'));
          sentTo.kill();
        }
```
  `worker = null` comes before `kill()`, so the exit handler (`worker !== child`) does nothing.
- In `recognizePhoto` (HTTP helper): `const result = await recognizer.recognize(file); const cards = Array.isArray(result) ? result : result.cards; return { status: 200, body: { cards, ignoredAtEdge: Array.isArray(result) ? 0 : result.ignoredAtEdge || 0 } };`.

Update tests in `server/vision.test.mjs`:
- 'recognize sends…': both calls expect `{ cards, ignoredAtEdge: 0 }`.
- 'a crashed worker…': `{ cards: [], ignoredAtEdge: 0 }`.
- 'an error followed by an exit…': `{ cards: [{ id: 'ok' }], ignoredAtEdge: 0 }`.
- 'replies split…': compare `first.cards` and `second.cards`.
- 'recognizePhoto stores…': body `{ cards: [...], ignoredAtEdge: 0 }`.

New tests:
- (a) A reply `{id, cards: [], ignoredAtEdge: 2}` resolves to `{ cards: [], ignoredAtEdge: 2 }`.
- (b) A timed-out request kills the stuck worker, fails the others, and the next photo gets a fresh worker:
```js
  let starts = 0; const killed = [];
  const { spawnFn } = fakeSpawn(request => (starts === 1 ? null : { id: request.id, cards: [] }));
  const recognizer = createRecognizer(PATHS, {
    spawnFn: (...args) => { starts += 1; const child = spawnFn(...args); const kill = child.kill; child.kill = () => { killed.push(starts); kill(); }; return child; },
    exists: always, timeoutMs: 30
  });
  const first = recognizer.recognize('/tmp/a.jpg');
  const second = recognizer.recognize('/tmp/b.jpg');
  await assert.rejects(first, /timed out/);
  await assert.rejects(second, /restarted/);
  assert.equal(killed.length, 1);
  assert.deepEqual(await recognizer.recognize('/tmp/c.jpg'), { cards: [], ignoredAtEdge: 0 });
  assert.equal(starts, 2);
  recognizer.stop();
```

### B4. Fixes #5 and #6: `vision/detect.py` (edge cards, tilt, small cards)

Constants:
- `CARD_RATIO = (0.5, 0.9)`
- `MIN_FILL = 0.85` (kept)
- `MIN_SOLIDITY = 0.93`
- `MIN_AREA_RATIO = 0.0006`
- `MIN_AREA_PIXELS = 400`
- `EDGE_MARGIN = 0.004` (fraction of the longer side of the work image)

Replace `_card_quads` and add the helpers:
```python
def _quad_shape(contour):
    """Corners, short/long side ratio and fill, measured on the card's own 4-corner outline (works under tilt)."""
    approx = cv2.approxPolyDP(contour, 0.02 * cv2.arcLength(contour, True), True)
    if len(approx) == 4 and cv2.isContourConvex(approx):
        corners = order_corners(approx.reshape(-1, 2))
    else:
        corners = order_corners(cv2.boxPoints(cv2.minAreaRect(contour)))
    tl, tr, br, bl = corners
    width = (np.linalg.norm(tr - tl) + np.linalg.norm(br - bl)) / 2
    height = (np.linalg.norm(bl - tl) + np.linalg.norm(br - tr)) / 2
    polygon = cv2.contourArea(corners.reshape(-1, 1, 2))
    if min(width, height) == 0 or polygon == 0:
        return corners, 0.0, 0.0
    return corners, min(width, height) / max(width, height), cv2.contourArea(contour) / polygon


def _touches_edge(contour, shape, margin):
    x, y, w, h = cv2.boundingRect(contour)
    return x <= margin or y <= margin or x + w >= shape[1] - margin or y + h >= shape[0] - margin


def _card_quads(mask, min_area, max_area, margin):
    """Card outlines in a mask, plus how many card-sized shapes were cut off by the photo edge."""
    quads, at_edge = [], 0
    contours, _ = cv2.findContours(mask, cv2.RETR_EXTERNAL, cv2.CHAIN_APPROX_SIMPLE)
    for contour in contours:
        area = cv2.contourArea(contour)
        if area < min_area or area > max_area:
            continue
        if _touches_edge(contour, mask.shape, margin):
            at_edge += 1
            continue
        hull = cv2.contourArea(cv2.convexHull(contour))
        if hull == 0 or area / hull < MIN_SOLIDITY:  # overlapping cards make a dented outline
            continue
        corners, ratio, fill = _quad_shape(contour)
        if not CARD_RATIO[0] <= ratio <= CARD_RATIO[1] or fill < MIN_FILL:
            continue
        quads.append(corners)
    return quads, at_edge
```

Replace `find_cards`:
```python
def find_cards_with_edges(image, min_area_ratio=MIN_AREA_RATIO, max_area_ratio=0.25):
    """Return (cards, ignored_at_edge). cards: [{'corners', 'crop'}] in reading order."""
    height, width = image.shape[:2]
    scale = min(1.0, WORK_SIZE / max(height, width))
    small = cv2.resize(image, None, fx=scale, fy=scale, interpolation=cv2.INTER_AREA) if scale < 1 else image
    gray = cv2.cvtColor(small, cv2.COLOR_BGR2GRAY)
    total = gray.shape[0] * gray.shape[1]
    margin = max(2.0, EDGE_MARGIN * max(gray.shape))
    min_area = max(MIN_AREA_PIXELS, min_area_ratio * total)
    best, best_edge = [], 0
    for mask in _masks(gray):
        quads, at_edge = _card_quads(mask, min_area, max_area_ratio * total, margin)
        if len(quads) > len(best) or (len(quads) == len(best) and at_edge > best_edge):
            best, best_edge = quads, at_edge
    cards = []
    for quad in _reading_order(best):
        corners = quad / scale
        cards.append({'corners': corners, 'crop': warp_card(image, corners)})
    return cards, best_edge


def find_cards(image, min_area_ratio=MIN_AREA_RATIO, max_area_ratio=0.25):
    """Return [{'corners': 4x2 array in photo pixels, 'crop': CARD_H x CARD_W x 3 image}]."""
    return find_cards_with_edges(image, min_area_ratio, max_area_ratio)[0]
```

`vision/recognize.py`:
- Import `find_cards_with_edges`.
- Rename the body of `recognize` to `recognize_photo(self, request_id, path)`:
  - it uses `found, at_edge = find_cards_with_edges(image)`;
  - it returns `{'cards': cards, 'ignoredAtEdge': at_edge}` (also when nothing is found).
- Keep `def recognize(self, request_id, path): return self.recognize_photo(request_id, path)['cards']`.
- In `main`: `reply = {'id': request_id, **recognizer.recognize_photo(request_id, request['path'])}`.
- Update the docstring.

Python tests:
- In `vision/tests/test_detect.py`, `draw_card` only calls `putText` when `label` is truthy.
- Import `find_cards_with_edges`.
- Add `draw_quad(image, corners)` → `cv2.fillPoly(image, [np.int32(corners)], (235, 235, 235))`.
- `test_tilted_card_is_found` (perspective, the old code fails at top 0.6): for each `angle in (0, 30, 60, 90, 135, 200)`:
  - `image = table(600, 600)`;
  - trapezoid points `[[-45, -107.5], [45, -107.5], [75, 107.5], [-75, 107.5]]` (top 0.6 × bottom 150, height 215), rotated by `angle` about (300, 300);
  - `cards = find_cards(image)`; assert `len(cards) == 1, angle` and `cards[0]['crop'].mean() > 200`.
- `test_small_cards_are_found` (the old code finds 0): in `table(1600, 1200)`, draw 30 cards of `size=(44, 62)`, `label=''`, at `(150 + col*240, 140 + row*230)`, angle `(row*6+col) % 7 - 3`. Assert `len(find_cards(image)) == 30`.
- `test_cards_cut_by_the_photo_edge_are_ignored_and_counted`: `image = table(800, 600)`, `draw_card(image, (40, 300))` (cut off) and `draw_card(image, (400, 300))`. `cards, ignored = find_cards_with_edges(image)` gives `len(cards) == 1`, x-centre within 8 px of 400, and `ignored == 1`. Also `find_cards(image)` has length 1.
- In `vision/tests/test_recognize.py` round trip, add `assert reply['ignoredAtEdge'] == 0`.

---

## Phase 10: README

- Feature bullets:
  - Pack (pays 10 Hath, keeps Joker points, cannot close);
  - doublets route (8 to commit / 10 to close with 4 players, 9 / 11 with 3; identical natural cards only; printed jokers do not pair; three copies = doublet + spare);
  - not committed: runs of 4–5 and pure triples are free;
  - photo: edge cards ignored and reported; tilted and small cards detected; dropped cards are listed.
- Update the House rules section to match the Decisions above.

## Phase 11: Verification

1. `cd /Users/shreyaagarwal/aakashk_personal/projects/marriage_game && CI=true npx react-scripts test --watchAll=false`: all suites pass. Report the counts.
2. `node --test server/*.test.mjs`: all pass.
3. `cd vision && .venv/bin/python -m pytest -q`: all pass.
4. `CI=true npm run build`: "Compiled successfully" with no warnings, and every new import is used.
5. Manual check at 360 px wide in the browser's device toolbar:
   - the round form with Bandh and Packed side by side, Packed ticked, a doublets summary open, and round history with a "Packed" tag;
   - `document.documentElement.scrollWidth <= 360`.
6. Manual check of bug #1: enter 30 cards with the opened card set, so the boxes fill. Then:
   - set the opened card to "Not set" → both boxes clear;
   - set it again → both refill;
   - type over Hath, then remove a card → the typed Hath stays and Joker clears.
7. Do not commit. Do not touch `/Users/shreyaagarwal/aakashk_personal/projects/begum-chor`.

## Assumptions to confirm with the user

1. Printed jokers (JK JK) do **not** count as a doublet.
2. A pair of a card that is a joker this round (e.g. 8♦ 8♦ with 7♦ opened) **does** count as a doublet, and still earns its Joker points.
3. Three identical cards = 1 doublet + 1 spare. The spare counts in Hath unless the hand is closed.
4. On the doublets route, pure-triple Joker points are **not** added; only the joker-card points from jokers.js count. One constant flips this: `DOUBLETS_SCORE_TRIPLES`.
5. A closed doublets hand ignores its other cards (Hath 0). A committed-but-not-closed one charges every non-joker card outside the doublets, with no runs or sets formed from them.
6. Route ties: closed first, then lower Hath, then more Joker points, then sequences. Example: BOTH with 3 players gives sequences 94 vs doublets 86; both are Hath 9, so sequences is chosen.
7. Not committed: runs are at most 5 cards, so 6 in a row frees only 5. Ties are broken by rounded Hath, then most triples. A triple of a joker card is not a "pure triple"; it already scores as joker copies, as now.
8. Pack:
   - always exactly 10, even if the cards would score less;
   - ×2 in a double round;
   - the packed player's Joker points count fully, and their 20+ Joker can trigger the next double.
9. CSV gets one "Packed" column listing packed players, separated by "; ".

### Critical Files for Implementation
- /Users/shreyaagarwal/aakashk_personal/projects/marriage_game/src/hand.js
- /Users/shreyaagarwal/aakashk_personal/projects/marriage_game/src/App.js
- /Users/shreyaagarwal/aakashk_personal/projects/marriage_game/src/scoring.js
- /Users/shreyaagarwal/aakashk_personal/projects/marriage_game/src/recognition.js (with src/PhotoReview.js, src/CardPicker.js)
- /Users/shreyaagarwal/aakashk_personal/projects/marriage_game/server/vision.mjs and /Users/shreyaagarwal/aakashk_personal/projects/marriage_game/vision/detect.py

Note on the read-only rule: I ran one `mkdir -p` on the session scratchpad folder, `/private/tmp/claude-501/-Users-shreyaagarwal-aakashk-personal-projects-marriage-game/21938fd6-49c5-4a59-9da9-456f098923a6/scratchpad`. It created at most that one empty folder; nothing was written into it, and no project files were touched.