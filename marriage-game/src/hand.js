import {
  HAND_SIZE, PRINTED_JOKER, SUITS, cardCode, cardValue, countCards, parseCard, validateCards, validateHand,
  validateOpenCard
} from './cards';
import { isJoker, jokerCardPoints, triplePoints } from './jokers';

export const COMMIT_SEQUENCES = 5;
export const MAX_HATH = 15;
export const WILD = 'WILD';

// 120 -> 12, 124 -> 12, 125 -> 13, never more than 15.
export function hathFromValue(value) {
  return Math.min(MAX_HATH, Math.round(value / 10));
}

export const DOUBLET_COMMIT = { 3: 9, 4: 8 };
export const DOUBLET_CLOSE_EXTRA = 2;
// Three identical cards on the doublets route are a doublet plus a spare, so they earn no pure-triple points.
export const DOUBLETS_SCORE_TRIPLES = false;
export const FREE_RUN_MIN = 4;
export const FREE_RUN_MAX = 5;
// Protect sets tried per route before the search over combo breaks stops.
export const MAX_PROTECT_SEARCH = 64;

const slotOf = (suitIndex, rank) => suitIndex * 13 + rank - 1;
const codeOf = slot => cardCode((slot % 13) + 1, SUITS[Math.floor(slot / 13)]);

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
// and a spare. Printed jokers never pair and no joker completes a doublet. A protected code
// held three times is never a doublet (it would play a copy as itself).
export function findDoublets(cards, protect = new Set()) {
  const counts = countCards(cards);
  const codes = Object.keys(counts).sort(byOrder);
  const doublets = codes.filter(code => code !== PRINTED_JOKER && counts[code] >= 2
    && !(protect.has(code) && counts[code] >= 3));
  const rest = [];
  codes.forEach(code => {
    const left = doublets.includes(code) ? counts[code] - 2 : counts[code];
    for (let n = 0; n < left; n += 1) rest.push(code);
  });
  return { doublets, rest };
}

// Commit by doublets: null below the commit count. Once committed, Hath is 0 and every other card
// is ignored; `closed` (commit + 2 doublets) only decides who can be the Bandh closer.
export function doubletArrangement(cards, openCard, playerCount, protect = new Set()) {
  const targets = doubletTargets(playerCount);
  if (!targets) return null;
  const { doublets, rest } = findDoublets(cards, protect);
  if (doublets.length < targets.commit) return null;
  return {
    closed: doublets.length >= targets.close,
    cost: 0,
    groups: doublets.map(code => ({ type: 'doublet', cards: [code, code], wilds: [] })),
    leftovers: [],
    unusedJokers: [],
    otherCards: rest
  };
}

// Joker codes whose combo can be broken: held 2+ times, or one of the four opened-rank cards when all four are held.
export function comboCodes(cards, openCard) {
  const counts = countCards(cards);
  const open = parseCard(openCard);
  const sameRank = SUITS.map(suit => cardCode(open.rank, suit));
  const codes = Object.keys(counts).filter(code => code !== PRINTED_JOKER && isJoker(code, openCard) && counts[code] >= 2);
  if (sameRank.every(code => counts[code])) codes.push(...sameRank);
  return [...new Set(codes)];
}

// How many copies of each joker code a grouping plays as itself. A group made only of all the
// copies of one code (a pure triple of three, a doublet of two) does not count.
export function naturalUse(groups, cards, openCard) {
  const counts = countCards(cards);
  const natural = {};
  groups.forEach(group => {
    group.cards.forEach((code, index) => {
      if (group.wilds.includes(index) || !isJoker(code, openCard)) return;
      const allCopies = group.cards.every(other => other === code) && group.cards.length === counts[code];
      if (!allCopies) natural[code] = (natural[code] || 0) + 1;
    });
  });
  return natural;
}

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

// Finds the grouping of a hand with at least `required` pure sequences that leaves the
// fewest Hath points (ties on Hath: the most pure triples). Returns null when
// the hand has no such grouping. With required = 0 it is the best grouping of any card list
// (it never returns null then, because "leave out" and "wild" moves always exist).
// `cost` is the leftover value of the chosen grouping; `minCost` is the lowest
// leftover value of any grouping (they differ only when a grouping with more
// pure triples rounds to the same Hath).
//
// Cards are processed in a fixed order (suit, then rank). The lowest remaining
// card is either left over, or starts a group whose other natural cards all
// come later in the order; jokers fill any other slot. A card that is a joker
// this round may be played as itself or turned into a wild card. Wild cards
// may be borrowed before the joker card that supplies them is reached, as long
// as the balance ends at zero or above.
// `protect` holds joker codes that may not be played as themselves, except as all their copies in one
// pure triple; they can only be wild cards.
export function bestArrangement(cards, openCard, protect = new Set(), required = COMMIT_SEQUENCES) {
  const counts = new Array(52).fill(0);
  const jokerSlot = new Array(52).fill(false);
  let printed = 0;
  cards.forEach(code => {
    if (code === PRINTED_JOKER) {
      printed += 1;
      return;
    }
    const card = parseCard(code);
    counts[slotOf(SUITS.indexOf(card.suit), card.rank)] += 1;
  });
  const totalCount = counts.slice();
  for (let slot = 0; slot < 52; slot += 1) jokerSlot[slot] = isJoker(codeOf(slot), openCard);
  const protectSlot = Array.from({ length: 52 }, (_, slot) => protect.has(codeOf(slot)));

  // The remaining cards are kept as a base-4 number split over two doubles
  // (26 slots each), so a memo key is cheap to build.
  const POWERS = Array.from({ length: 26 }, (_, n) => 4 ** n);
  let low = 0;
  let high = 0;
  counts.forEach((count, slot) => {
    if (slot < 26) low += count * POWERS[slot];
    else high += count * POWERS[slot - 26];
  });
  const take = (slot, n = 1) => {
    counts[slot] -= n;
    if (slot < 26) low -= n * POWERS[slot];
    else high -= n * POWERS[slot - 26];
  };
  const put = (slot, n = 1) => take(slot, -n);

  // Every way to use the lowest remaining card; moves with the same effect are listed once.
  function movesFor(i) {
    const suitIndex = Math.floor(i / 13);
    const rank = (i % 13) + 1;
    const code = codeOf(i);
    const moves = [];
    const seen = new Set();
    const add = (slots, wilds, move) => {
      const key = `${move.type === 'pureRun' || move.type === 'pureTriple' ? 'p' : 'n'}|${wilds}|${[...slots].sort((a, b) => a - b).join(',')}`;
      if (move.type !== 'leftover' && move.type !== 'wild' && move.type !== 'pureTriple') {
        if (seen.has(key)) return;
        seen.add(key);
      }
      moves.push({ slots, wilds, ...move });
    };

    // 1. Leave the card out, or turn a joker card into a wild card.
    if (jokerSlot[i]) add([], -1, { type: 'wild', cost: 0, triples: 0, cards: [code] });
    else add([], 0, { type: 'leftover', cost: cardValue(rank), triples: 0, cards: [code] });

    // 2. Pure triple: three identical cards, never completed by a joker. A protected joker
    // only makes a triple from all of its copies.
    if (counts[i] >= 2 && (!protectSlot[i] || counts[i] + 1 === totalCount[i])) {
      add([i, i], 0, { type: 'pureTriple', cost: 0, triples: jokerSlot[i] ? 0 : 1, cards: [code, code, code] });
    }

    // 3. Runs of 3-5 in this suit. Positions 1..14 put the ace at 1 (A-2-3) or 14 (Q-K-A); no wrap.
    // A protected joker card is never a natural card in a run.
    const ownPositions = protectSlot[i] ? [] : rank === 1 ? [1, 14] : [rank];
    ownPositions.forEach(own => {
      for (let length = 3; length <= 5; length += 1) {
        for (let first = Math.max(1, own - length + 1); first <= own && first + length - 1 <= 14; first += 1) {
          const fill = (position, slots, cards, wilds) => {
            if (position === first + length) {
              const endWild = cards[0] === WILD || cards[cards.length - 1] === WILD;
              if (endWild && length > 3) return;
              add(slots, wilds, { type: wilds === 0 ? 'pureRun' : 'run', cost: 0, triples: 0, cards });
              return;
            }
            if (position === own) {
              fill(position + 1, slots, [...cards, code], wilds);
              return;
            }
            const slot = slotOf(suitIndex, position === 14 ? 1 : position);
            if (slot > i && counts[slot] > 0 && !protectSlot[slot]) fill(position + 1, [...slots, slot], [...cards, codeOf(slot)], wilds);
            fill(position + 1, slots, [...cards, WILD], wilds + 1);
          };
          fill(first, [], [], 0);
        }
      }
    });

    // 4. Mixed-suit sets of 3-4: one card per suit; jokers fill the rest.
    if (!protectSlot[i]) {
      const laterSuits = [];
      for (let s = suitIndex + 1; s < 4; s += 1) {
        if (counts[slotOf(s, rank)] > 0 && !protectSlot[slotOf(s, rank)]) laterSuits.push(slotOf(s, rank));
      }
      for (let mask = 0; mask < 1 << laterSuits.length; mask += 1) {
        const chosen = laterSuits.filter((_, bit) => mask & (1 << bit));
        for (let size = 3; size <= 4; size += 1) {
          const wilds = size - 1 - chosen.length;
          if (wilds < 0 || (wilds > 0 && size > 3)) continue;
          add(chosen, wilds, {
            type: 'set', cost: 0, triples: 0, cards: [code, ...chosen.map(codeOf), ...Array(wilds).fill(WILD)]
          });
        }
      }
    }
    // Try the moves most likely to lead to a low score first, so the bound tightens early.
    const rankOf = move => {
      if (move.type === 'leftover') return 1000;
      if (move.type === 'wild') return 900;
      return move.wilds * 10 - move.slots.length;
    };
    return moves.sort((a, b) => rankOf(a) - rankOf(b));
  }

  // Phase 1 score = leftover value * 100 - pure triples: lowest value first, triples break
  // ties. Phase 2 (below) then trades value for triples inside one Hath step.
  let costWeight = 100;
  let tripleWeight = 1;
  let memo = new Map();

  // Most pure groups (runs and triples, no jokers) one suit can still form, memoised on its cards.
  const SUIT_RANGE = POWERS[13];
  const pureMemo = new Map();
  function pureMax(key) {
    if (key === 0) return 0;
    const known = pureMemo.get(key);
    if (known !== undefined) return known;
    const counts13 = [];
    for (let n = 0, rest = key; n < 13; n += 1, rest = Math.floor(rest / 4)) counts13.push(rest % 4);
    const r = counts13.findIndex(count => count > 0);
    let best = pureMax(key - POWERS[r]); // leave this card out
    if (counts13[r] >= 3) best = Math.max(best, 1 + pureMax(key - 3 * POWERS[r]));
    const tryRun = (ranks) => { // ranks: 0-based slots, ace-high is slot 0
      if (ranks.some(n => counts13[n] === 0)) return;
      best = Math.max(best, 1 + pureMax(key - ranks.reduce((sum, n) => sum + POWERS[n], 0)));
    };
    for (let length = 3; length <= 5; length += 1) {
      if (r + length <= 13) tryRun(Array.from({ length }, (_, k) => r + k));
      if (r === 0) tryRun([0, ...Array.from({ length: length - 1 }, (_, k) => 13 - (length - 1) + k)]);
    }
    pureMemo.set(key, best);
    return best;
  }
  const pureCapacity = () => {
    let total = 0;
    for (const half of [low, high]) {
      total += pureMax(half % SUIT_RANGE) + pureMax(Math.floor(half / SUIT_RANGE));
    }
    return total;
  };

  // Lowest score still possible: every remaining 3-of-a-kind non-joker card becomes a triple.
  function lowerBound() {
    let bound = 0;
    for (let slot = 0; slot < 52; slot += 1) if (counts[slot] >= 3 && !jokerSlot[slot]) bound -= tripleWeight;
    return bound;
  }

  // Returns the best result scoring below budget, or null if there is none.
  // The memo keeps exact results, or a lower bound when a search was cut short.
  // `room` is how much leftover value may still be spent (phase 2 only).
  function solve(wild, pure, budget, room) {
    let i = 0;
    while (i < 52 && counts[i] === 0) i += 1;
    let convertible = 0;
    for (let j = i; j < 52; j += 1) if (jokerSlot[j]) convertible += counts[j];
    if (wild + convertible < 0) return null;
    if (i === 52) {
      if (wild < 0 || pure < required || budget <= 0) return null;
      return { score: 0, cost: 0, triples: 0, groups: null };
    }
    if (pure < required && pure + pureCapacity() < required) return null;

    const key = `${low},${high},${wild},${pure},${room}`;
    const known = memo.get(key);
    if (known) {
      if (known.exact !== undefined) return known.exact && known.exact.score < budget ? known.exact : null;
      if (known.lower >= budget) return null;
    }
    const floor = lowerBound();
    if (floor >= budget) return null;

    let best = null;
    take(i);
    const moves = movesFor(i);
    for (const move of moves) {
      if (move.cost > room) continue;
      const moveScore = move.cost * costWeight - move.triples * tripleWeight;
      const limit = (best ? best.score : budget) - moveScore;
      move.slots.forEach(slot => take(slot));
      const isPure = move.type === 'pureRun' || move.type === 'pureTriple';
      const result = solve(wild - move.wilds, isPure ? Math.min(required, pure + 1) : pure, limit, room - move.cost);
      move.slots.forEach(slot => put(slot));
      if (result) {
        best = {
          score: result.score + moveScore,
          cost: result.cost + move.cost,
          triples: result.triples + move.triples,
          groups: { group: { type: move.type, cards: move.cards }, next: result.groups }
        };
        if (best.score <= floor) break;
      }
    }
    put(i);
    if (best) memo.set(key, { exact: best });
    else memo.set(key, { lower: budget === Infinity ? Infinity : Math.max(budget, known ? known.lower : -Infinity) });
    return best;
  }

  let result = solve(printed, 0, Infinity, Infinity);
  if (!result) return null;
  const minCost = result.cost;

  // Phase 2: ties on Hath go to the grouping with more pure triples, so look for one
  // that stays within the same rounded Hath. Skipped when no more triples are possible.
  let triplesPossible = 0;
  for (let slot = 0; slot < 52; slot += 1) if (counts[slot] >= 3 && !jokerSlot[slot]) triplesPossible += 1;
  const hath = hathFromValue(minCost);
  // A hand that closes fully keeps its full close: a Bandh needs every card grouped.
  if (minCost > 0 && result.triples < triplesPossible) {
    const room = hath >= MAX_HATH ? Infinity : hath * 10 + 4; // highest value that still rounds to this Hath
    if (room > minCost) {
      costWeight = 1;
      tripleWeight = 1000;
      memo = new Map();
      const alternative = solve(printed, 0, Infinity, room);
      if (alternative && alternative.triples > result.triples) result = alternative;
    }
  }

  const groups = [];
  const wildCards = Array(printed).fill(PRINTED_JOKER);
  const leftovers = [];
  for (let node = result.groups; node; node = node.next) {
    if (node.group.type === 'wild') wildCards.push(node.group.cards[0]);
    else if (node.group.type === 'leftover') leftovers.push(node.group.cards[0]);
    else groups.push(node.group);
  }
  // Show which joker card stands in for each wild slot.
  const filled = groups.map(group => ({
    type: group.type,
    cards: group.cards.map(card => (card === WILD ? wildCards.shift() : card)),
    wilds: group.cards.map((card, index) => (card === WILD ? index : -1)).filter(index => index >= 0)
  }));
  return {
    cost: result.cost,
    minCost,
    triples: result.triples,
    groups: filled,
    leftovers,
    unusedJokers: wildCards
  };
}

// Not committed: pure runs of 4-5 (one suit, no wilds; a joker card may be itself; A-2-3-4 and
// J-Q-K-A, no wrap) and pure triples leave Hath. Lowest Hath, then most pure triples, then lowest value.
export function freeRunArrangement(cards, openCard, protect = new Set()) {
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
    const blocked = POWERS.map((_, index) => protect.has(codeAt(index)));
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
          if (ranks.some(index => counts[index] === 0 || blocked[index])) return;
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

// Closed beats open, then higher Joker - Hath, then lower Hath; a full tie keeps the earlier one
// (within a route the earlier grouping, across routes the sequences route).
function beats(a, b) {
  if (a.closed !== b.closed) return a.closed;
  const scoreA = a.jokerPoints - a.hath;
  const scoreB = b.jokerPoints - b.hath;
  if (scoreA !== scoreB) return scoreA > scoreB;
  return a.hath < b.hath;
}

// Joker points, Hath and the joker split for one grouping. Its natural cards decide which combos break.
function evaluate(arrangement, { closed, triples }, cards, openCard, fixed = []) {
  const combos = comboCodes(cards, openCard);
  const natural = naturalUse([...fixed, ...arrangement.groups], cards, openCard);
  const own = naturalUse(arrangement.groups, cards, openCard); // only these can be protected
  const jokers = jokerCardPoints(cards, openCard, natural);
  const triplesPoints = triplePoints(triples);
  return {
    arrangement,
    closed,
    triples,
    triplesPoints,
    jokers,
    hath: hathFromValue(arrangement.cost),
    jokerPoints: jokers.points + triplesPoints,
    brokenCombos: jokers.broken.filter(code => combos.includes(code)),
    // Combo codes played as themselves anywhere, even when the opened run happens to absorb them:
    // protecting one can still free a better split, so the search tries each.
    playedCombos: combos.filter(code => own[code] > 0)
  };
}

// Each route starts with nothing protected. When the best grouping breaks a combo, the search also
// protects the broken codes (every reachable subset, breadth first), so a grouping can keep a combo
// whole. Returns the best grouping found, or null when the route does not commit.
function bestOfRoute(run, describe, cards, openCard, fixed = []) {
  const keyOf = protect => [...protect].sort().join(',');
  const seen = new Set([keyOf(new Set())]);
  const queue = [new Set()];
  let best = null;
  for (let tried = 0; queue.length && tried < MAX_PROTECT_SEARCH; tried += 1) {
    const protect = queue.shift();
    const arrangement = run(protect);
    if (!arrangement) continue;
    const found = evaluate(arrangement, describe(arrangement), cards, openCard, fixed);
    if (!best || beats(found, best)) best = found;
    found.playedCombos.forEach(code => {
      const next = new Set([...protect, code]);
      if (protect.has(code) || seen.has(keyOf(next))) return;
      seen.add(keyOf(next));
      queue.push(next);
    });
  }
  return best;
}

// The result for one route. Its fields come from the chosen grouping.
function report(route, committed, found, cards, playerCount) {
  const { arrangement, jokers } = found;
  return {
    route,
    committed,
    closed: found.closed,
    hathValue: arrangement.cost,
    hath: found.hath,
    triples: found.triples,
    triplePoints: found.triplesPoints,
    jokerPoints: found.jokerPoints,
    jokerCardPoints: jokers.points,
    jokerParts: jokers.parts,
    brokenCombos: found.brokenCombos,
    doublets: route === 'doublets' ? arrangement.groups.length : findDoublets(cards).doublets.length,
    doubletTarget: doubletTargets(playerCount),
    groups: arrangement.groups,
    leftovers: arrangement.leftovers,
    unusedJokers: arrangement.unusedJokers,
    otherCards: arrangement.otherCards || []
  };
}

// Hath and Joker points for one 30-card hand. playerCount (3 or 4) turns on the doublets route.
export function scoreHand(cards, openCard, playerCount) {
  const error = validateOpenCard(openCard) || validateHand(cards, openCard);
  if (error) return { error };
  const candidates = [];
  const sequences = bestOfRoute(
    protect => bestArrangement(cards, openCard, protect),
    arrangement => ({ closed: arrangement.minCost === 0, triples: arrangement.triples }),
    cards, openCard
  );
  if (sequences) candidates.push(report('sequences', true, sequences, cards, playerCount));
  const counts = countCards(cards);
  const tripleCount = DOUBLETS_SCORE_TRIPLES
    ? Object.keys(counts).filter(code => counts[code] === 3 && !isJoker(code, openCard)).length
    : 0;
  const pairs = bestOfRoute(
    protect => doubletArrangement(cards, openCard, playerCount, protect),
    arrangement => ({ closed: arrangement.closed, triples: tripleCount }),
    cards, openCard
  );
  if (pairs) candidates.push(report('doublets', true, pairs, cards, playerCount));
  if (candidates.length) return candidates.reduce((best, next) => (beats(next, best) ? next : best));
  return notCommitted(cards, openCard, playerCount);
}

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
