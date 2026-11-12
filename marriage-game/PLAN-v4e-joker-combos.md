# Plan v4e: joker combos are broken by natural use; choose by Joker − Hath

Project: `/Users/shreyaagarwal/aakashk_personal/projects/marriage_game`. The v4c and v4d changes are in the working tree and uncommitted; keep them. **Don't commit. Don't touch `/Users/shreyaagarwal/aakashk_personal/projects/begum-chor`.**

## The bug

The user's hand, with the opened card 5♠, 4 players, not committed:

```
2S 6S 7S 7S 2H 4H 5H 5H 5H 6H 7H 8H 10H QH QH KH AD 3D 4D KD AC 4C 5C 6C 10C 10C JC QC QC JK
```

The app shows **Hath 14 · Joker 22**. That is impossible:

- Hath 14 comes from making 4♥ 5♥ 6♥ 7♥ 8♥ a free run, which plays one 5♥ as itself. That saves 25 → 141 → Hath 14.
- Joker 22 still counts 5♥ 5♥ 5♥ as a joker triple (10 points), even though one of those 5♥ is now inside the run.

A card can't be in both. The two honest choices are:

| Choice | Hath | Joker | Joker − Hath |
|---|---|---|---|
| Keep 5♥ ×3 (no free run) | 166 → 17 → capped **15** | **22** | **+7** ← correct |
| Break it (5♥ into the run) | 141 → 14 | 12 (the 5♥ are worth 0 each, so the pair left over earns nothing) | −2 |

**Expected after the fix:** `committed false, hath 15, hathValue 166, jokerPoints 22`, and no group plays a 5♥ as itself.

## Rules (confirmed by the user, 2026-11-12)

1. **Combos:** a joker *combo* is
   - the copies bonus of one joker code (a pair earns +2; three copies earn 14, or 10 for a 0-value card);
   - "all four of the opened rank" (14).
2. **When a combo breaks:** a combo is broken when one of its cards is **played as itself** (a natural card) in a group. It is *not* broken in two cases:
   - the group is made only of all the copies of that code (e.g. a joker-card pure triple 5♥ 5♥ 5♥ holding all 3 copies, or a doublet holding both copies of a code held exactly twice);
   - the card is used as a **wild stand-in**: a joker filling a gap never breaks anything.
3. **A broken copy** scores only its single value. The copies that are not played as themselves still pool together for the copies bonus. For example, 6♦ ×3 with one 6♦ in a run gives 6♦ 6♦ = 6 plus 6♦ = 2, so 8.
4. **The opened run is exempt:** the 5-card run around the opened card (25) counts wherever its cards are. Natural use never breaks it.
5. **Choosing a grouping:** within a route, pick the grouping with the highest **Joker points − Hath**. Hath is taken after rounding and the 15 cap, and joker points include pure-triple points. Across routes:
   1. a closed hand still beats one that is not closed;
   2. then the higher Joker − Hath;
   3. then sequences.

## Phase 1: `src/jokers.js`

Change the signature to `jokerCardPoints(cards, openCard, natural = {})`. `natural` maps a code to the number of its copies played as themselves in a breaking way (rule 2).

Inside the `fours`/`runs` loop:

- **Feasibility.** Add a check: for each code in `sameRank`, `fours <= have(code) - (natural[code] || 0)`. The existing check `used[code] <= have(code)` stays, because the opened run may use natural copies.
- **Copies points.** For each joker code:
  ```js
  const left = have(code) - (used[code] || 0);                 // after fours and runs
  const naturalLeft = Math.max(0, Math.min(left, (natural[code] || 0) - runs * (runCodes.includes(code) ? 1 : 0)));
  const pooled = left - naturalLeft;
  const value = JOKER_VALUES[jokerKind(code, openCard)];
  const points = copiesPoints(value, pooled) + naturalLeft * value;
  ```
  - The opened run takes natural copies first, so they aren't wasted as singles.
  - Label the part `${formatCard(code)} ×${left}` as before. When `naturalLeft > 0`, add ` (${naturalLeft} in a run)` to the label.

With `natural = {}`, the result must be identical to today. All existing jokers tests must pass unchanged.

## Phase 2: `src/hand.js`

### 2.1 Helpers (put them before `bestArrangement`)

```js
// Joker codes whose combo can be broken: held 2+ times, or one of the four opened-rank cards when all four are held.
export function comboCodes(cards, openCard) { ... }

// How many copies of each joker code a grouping plays as itself in a breaking way (see the rules in PLAN-v4e).
export function naturalUse(groups, cards, openCard) { ... }
```

**`comboCodes`**
- Take every joker code with `counts[code] >= 2`.
- Add the four `cardCode(openRank, suit)` codes when each is held at least once.
- Never include `PRINTED_JOKER`. Printed jokers are always wild and cannot be played as themselves.

**`naturalUse`**
- For each group, the natural cards are those at indices **not** in `group.wilds`.
- For each natural card that is a joker code, count it in `natural[code]`, unless the group is "all copies of one code": every card in the group is that code and the group length equals `counts[code]`. That covers a pure triple of a code held 3 times, and a doublet of a code held 2 times.
- Free-run groups (`pureRun` from `freeRunArrangement`) and doublet groups go through the same rule.

### 2.2 A `protect` option on each arrangement

`protect` is a `Set` of codes. For a protected code, natural use is forbidden except as the all-copies group.

- **`bestArrangement(cards, openCard, protect = new Set())`.** Build `protectSlot[52]` from `protect`. In `movesFor(i)`:
  - If `protectSlot[i]`, only these moves are allowed for `i`:
    - `'wild'`;
    - `'pureTriple'`, and only when `counts[i] + 1 === totalCount[i]`. `totalCount` is the count in the hand; `take(i)` has already removed one. That is: all copies.
  - In runs, a later slot with `protectSlot[slot]` may not be used as a natural card. It can only be filled by a WILD.
  - In sets, `laterSuits` must skip protected slots.
- **`freeRunArrangement(cards, openCard, protect = new Set())`.**
  - In a suit's `solve`, a run may not include a protected rank.
  - The "charged" move for a protected joker card stays at 0 cost, as today.
  - Pure triples there are never joker cards, so nothing changes for them.
- **`doubletArrangement(cards, openCard, playerCount, protect = new Set())`.**
  - A protected code held 3 times may not form a doublet; it goes to `rest`.
  - A code held exactly 2 times is fine, because its doublet is the all-copies group.
  - Implement this by passing `protect` and `counts` into `findDoublets(cards, protect)`. Keep its old behaviour when `protect` is empty.

### 2.3 Search over protect sets

This replaces the body of `scoreHand`, after validation:

```js
// Each route: start with nothing protected; when the best grouping breaks a combo, also try protecting
// the broken codes (every reachable subset, breadth first). Keep the grouping with the best Joker − Hath.
function bestOfRoute(run, cards, openCard) { ... }
```

- `run(protect)` returns an arrangement or null.
- For each arrangement:
  1. compute `natural = naturalUse(arr.groups, cards, openCard)`;
  2. compute `jokers = jokerCardPoints(cards, openCard, natural)`;
  3. compute `jokerPoints = jokers.points + triplePoints(triples)`;
  4. `hath = hathFromValue(arr.cost)`;
  5. `closed`, as for the route;
  6. `score = jokerPoints - hath`.
- **Queue:** start with `new Set()`. After evaluating protect set `S`, for every code in `comboCodes` that is broken (`natural[code] > 0`) and not in `S`, enqueue `S ∪ {code}`, unless it was already seen (key = sorted codes joined).
- **Stop:** when the queue is empty, or after **64 evaluations** as a safety cap.
- **Best within a route:**
  1. closed first;
  2. then the higher `score`;
  3. then the lower hath;
  4. then the earlier one.
- **Speed:**
  - If the first, unprotected arrangement breaks nothing, it is optimal: it has the lowest Hath and the full Joker points. Return it straight away.
  - `bestArrangement` runs only once in that common case.

The routes run in this order:
- `sequences` (`bestArrangement` with protect), giving committed true, `closed = arr.minCost === 0`;
- `doublets` (when `playerCount` is 3 or 4), using the closed flag of that arrangement;
- if neither commits, the not-committed route (`freeRunArrangement` with protect).

Note that a protect set can make the sequences route impossible (null). That candidate is simply skipped. The unprotected one always exists if the hand can commit at all.

**`beats(a, b)`:**
1. `a.closed !== b.closed` → `a.closed`;
2. then `a.jokerPoints - a.hath` against `b`'s value;
3. then the lower hath;
4. otherwise keep `b` (sequences first).

**The result object** keeps every existing field. `jokerCardPoints`, `jokerParts` and `jokerPoints` now come from the chosen grouping's `natural` map. Add `brokenCombos: [codes]`, the codes with `natural[code] > 0`, for the summary.

### 2.4 `src/CardPicker.js`, `HandSummary`

When `result.brokenCombos.length`, add a line:

`<p className="hand-note">Played as plain cards (no joker bonus): {codes.map(formatCard).join(' ')}</p>`

## Phase 3: tests in `src/hand.test.js` (and `jokers.test.js`)

### `jokers.test.js`
- `jokerCardPoints(['6D','6D','6D'], '7D', { '6D': 1 }).points === 8`.
- `jokerCardPoints(['5H','5H','5H'], '5S', { '5H': 1 }).points === 0`.
- With `natural = {}`, every existing test is unchanged.
- **Four of a rank:** `['7H','7C','7D','7S']`, opened `'7D'`... An opened card can't be held more than twice. Instead, use `['7H','7C','7S','7D']` with opened `'7D'` and `natural {'7C': 1}`. The four-combo is not allowed, so the points are the singles: 7H 2, 7C 0, 7S 0, 7D 4 = 6. **The implementer must first print the current value with `natural = {}`, to confirm the four-combo (14) applies, and assert 6 for the natural case.**

### `hand.test.js`
1. **The user's bug hand (above), `scoreHand(hand, '5S', 4)`:**
   - `committed false`, `hathValue 166`, `hath 15`, `jokerPoints 22`;
   - no group whose natural cards include `'5H'` unless it is the all-copies triple;
   - `brokenCombos` is `[]`.
2. **The user's committed hand** (`2S 6S 7S 7S 2H 4H 5H 5H 5H 6H 7H 8H JH QH QH KH AD 3D 4D KD AC 4C 5C 6C 10C 10C JC QC QC JK`, `'5S'`, 4 players):
   - `committed true`, `hath 2`, `hathValue 17`, `jokerPoints 22`. This is unchanged: the 7♠ are used only as wilds, and the 5♥ triple is an all-copies group.
3. **Breaking wins when it saves more Hath than the bonus is worth.** The implementer must construct a hand where it does, by hand or by searching random hands with a small script in the scratchpad: a 0-value joker pair (bonus 0) played naturally to save Hath. Assert:
   - the grouping plays it naturally;
   - `brokenCombos` contains it;
   - jokerPoints equals the single-value sum.
4. **Property test** (seeded LCG as existing, 60 hands, 4 players, random opened card). For each result `r`:
   - recompute `natural = naturalUse(r.groups, hand, open)`; `jokerCardPoints(hand, open, natural).points + r.triplePoints` must equal `r.jokerPoints`;
   - `r.jokerPoints - r.hath` must be ≥ the same score of the unprotected arrangement of the same route, evaluated honestly;
   - every hand must score in under 2 s.
5. **Existing tests that change.** Every existing expectation must still pass. If one changes, **do not edit it blindly**. Work out by hand whether the old value double-counted a combo, then report it with the reasoning. Change it only if the old value broke the rule.

## Phase 4: verification

- `CI=true npx react-scripts test --watchAll=false`: all pass.
- `node --test server/*.test.mjs`: all pass.
- `cd vision && .venv/bin/python -m pytest -q`: all pass. Nothing should change in vision.
- `CI=true npm run build`: "Compiled successfully".
- Report the time of the slowest hand in the property test.
- Update the "House rules" section of README.md: joker combos are broken by natural use, wild use doesn't break them, the opened run counts anywhere, and the grouping is chosen by Joker − Hath.
