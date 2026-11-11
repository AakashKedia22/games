import {
  PRINTED_JOKER, SUITS, cardCode, cardValue, countCards, parseCard, validateHand, validateOpenCard
} from './cards';
import { isJoker, jokerCardPoints, triplePoints } from './jokers';

export const COMMIT_SEQUENCES = 5;
export const MAX_HATH = 15;
export const WILD = 'WILD';

// 120 -> 12, 124 -> 12, 125 -> 13, never more than 15.
export function hathFromValue(value) {
  return Math.min(MAX_HATH, Math.round(value / 10));
}

const slotOf = (suitIndex, rank) => suitIndex * 13 + rank - 1;
const codeOf = slot => cardCode((slot % 13) + 1, SUITS[Math.floor(slot / 13)]);

// Finds the grouping of a hand with at least 5 pure sequences that leaves the
// fewest Hath points (ties on Hath: the most pure triples). Returns null when
// the hand has no 5 pure sequences, i.e. the player did not commit.
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
export function bestArrangement(cards, openCard) {
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
  for (let slot = 0; slot < 52; slot += 1) jokerSlot[slot] = isJoker(codeOf(slot), openCard);

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

    // 2. Pure triple: three identical cards, never completed by a joker.
    if (counts[i] >= 2) {
      add([i, i], 0, { type: 'pureTriple', cost: 0, triples: jokerSlot[i] ? 0 : 1, cards: [code, code, code] });
    }

    // 3. Runs of 3-5 in this suit. Positions 1..14 put the ace at 1 (A-2-3) or 14 (Q-K-A); no wrap.
    const ownPositions = rank === 1 ? [1, 14] : [rank];
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
            if (slot > i && counts[slot] > 0) fill(position + 1, [...slots, slot], [...cards, codeOf(slot)], wilds);
            fill(position + 1, slots, [...cards, WILD], wilds + 1);
          };
          fill(first, [], [], 0);
        }
      }
    });

    // 4. Mixed-suit sets of 3-4: one card per suit; jokers fill the rest.
    const laterSuits = [];
    for (let s = suitIndex + 1; s < 4; s += 1) {
      if (counts[slotOf(s, rank)] > 0) laterSuits.push(slotOf(s, rank));
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
      if (wild < 0 || pure < COMMIT_SEQUENCES || budget <= 0) return null;
      return { score: 0, cost: 0, triples: 0, groups: null };
    }
    if (pure < COMMIT_SEQUENCES && pure + pureCapacity() < COMMIT_SEQUENCES) return null;

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
      const result = solve(wild - move.wilds, isPure ? Math.min(COMMIT_SEQUENCES, pure + 1) : pure, limit, room - move.cost);
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

// Hath and Joker points for one 30-card hand.
export function scoreHand(cards, openCard) {
  const error = validateOpenCard(openCard) || validateHand(cards, openCard);
  if (error) return { error };
  const jokers = jokerCardPoints(cards, openCard);
  const arrangement = bestArrangement(cards, openCard);

  if (arrangement) {
    const triplesPoints = triplePoints(arrangement.triples);
    return {
      committed: true,
      closed: arrangement.minCost === 0,
      hathValue: arrangement.cost,
      hath: hathFromValue(arrangement.cost),
      triples: arrangement.triples,
      triplePoints: triplesPoints,
      jokerCardPoints: jokers.points,
      jokerPoints: jokers.points + triplesPoints,
      jokerParts: jokers.parts,
      groups: arrangement.groups,
      leftovers: arrangement.leftovers,
      unusedJokers: arrangement.unusedJokers
    };
  }

  // Not committed: every non-joker card counts, except pure triples.
  const counts = countCards(cards);
  let value = 0;
  let triples = 0;
  const groups = [];
  const leftovers = [];
  Object.keys(counts).sort().forEach(code => {
    if (isJoker(code, openCard)) return;
    if (counts[code] === 3) {
      triples += 1;
      groups.push({ type: 'pureTriple', cards: [code, code, code], wilds: [] });
      return;
    }
    value += cardValue(parseCard(code).rank) * counts[code];
    for (let n = 0; n < counts[code]; n += 1) leftovers.push(code);
  });
  const triplesPoints = triplePoints(triples);
  return {
    committed: false,
    closed: false,
    hathValue: value,
    hath: hathFromValue(value),
    triples,
    triplePoints: triplesPoints,
    jokerCardPoints: jokers.points,
    jokerPoints: jokers.points + triplesPoints,
    jokerParts: jokers.parts,
    groups,
    leftovers,
    unusedJokers: cards.filter(code => isJoker(code, openCard))
  };
}
