import { PRINTED_JOKER, cardCode, countCards, formatCard, isRed, parseCard } from './cards';

export const JOKER_VALUES = { opened: 4, sameColour: 2, neighbour: 2, printed: 2, otherColour: 0 };
export const FOUR_OF_RANK_POINTS = 14;
export const OPENED_RUN_POINTS = 25;
// Pure triples (3 identical cards forming one group) by how many a player has.
export const TRIPLE_POINTS = [0, 2, 6, 14, 20, 25];

// Ranks wrap around for jokers only: with K open, the neighbours are J, Q, A, 2.
function wrapRank(rank) {
  return ((rank - 1 + 13) % 13) + 1;
}

export function neighbourCodes(openCard) {
  const open = parseCard(openCard);
  return [-2, -1, 1, 2].map(step => cardCode(wrapRank(open.rank + step), open.suit));
}

export function jokerKind(code, openCard) {
  if (code === PRINTED_JOKER) return 'printed';
  const card = parseCard(code);
  const open = parseCard(openCard);
  if (!card || !open || open.joker) return null;
  if (card.rank === open.rank) {
    if (card.suit === open.suit) return 'opened';
    return isRed(card.suit) === isRed(open.suit) ? 'sameColour' : 'otherColour';
  }
  return neighbourCodes(openCard).includes(code) ? 'neighbour' : null;
}

export function isJoker(code, openCard) {
  return jokerKind(code, openCard) !== null;
}

// Points for 0-3 copies of one joker card: a pair earns +2, three earn 14
// (10 for a 0-value card, whose pair earns nothing).
export function copiesPoints(value, count) {
  if (count <= 0) return 0;
  if (count === 1) return value;
  if (count === 2) return value === 0 ? 0 : value * 2 + 2;
  return value === 0 ? 10 : 14;
}

export function triplePoints(count) {
  return TRIPLE_POINTS[Math.min(count, TRIPLE_POINTS.length - 1)];
}

// Best Joker points from the joker cards in a hand. Each card counts toward one
// bonus at most; the split with the most points wins. `natural` maps a joker code to
// the copies played as themselves in a breaking way: those earn only their single
// value, and the rest of the copies still pool for the copies bonus.
export function jokerCardPoints(cards, openCard, natural = {}) {
  const counts = countCards(cards);
  const open = parseCard(openCard);
  const jokerCodes = Object.keys(counts).filter(code => isJoker(code, openCard)).sort();
  const sameRank = ['S', 'H', 'D', 'C'].map(suit => cardCode(open.rank, suit));
  const run = neighbourCodes(openCard);
  const runCodes = [run[0], run[1], openCard, run[2], run[3]];
  const have = code => counts[code] || 0;

  let best = null;
  for (let fours = 0; fours <= 2; fours += 1) {
    for (let runs = 0; runs <= 2; runs += 1) {
      const used = {};
      sameRank.forEach(code => { used[code] = (used[code] || 0) + fours; });
      runCodes.forEach(code => { used[code] = (used[code] || 0) + runs; });
      if (Object.keys(used).some(code => used[code] > have(code))) continue;
      if (sameRank.some(code => fours > have(code) - (natural[code] || 0))) continue;
      const parts = [];
      const broken = [];
      if (fours) parts.push({ label: `All four ${formatCard(openCard).slice(0, -1)}s`, count: fours, points: fours * FOUR_OF_RANK_POINTS });
      if (runs) parts.push({ label: `Run ${runCodes.map(formatCard).join(' ')}`, count: runs, points: runs * OPENED_RUN_POINTS });
      jokerCodes.forEach(code => {
        const left = have(code) - (used[code] || 0);                 // after fours and runs
        // The opened run takes natural copies first, so they aren't wasted as singles.
        const naturalLeft = Math.max(0, Math.min(left, (natural[code] || 0) - runs * (runCodes.includes(code) ? 1 : 0)));
        const pooled = left - naturalLeft;
        const value = JOKER_VALUES[jokerKind(code, openCard)];
        const points = copiesPoints(value, pooled) + naturalLeft * value;
        if (naturalLeft > 0) broken.push(code);
        if (left > 0) {
          const label = `${formatCard(code)} ×${left}${naturalLeft && left > 1 ? ` (${naturalLeft} played as itself)` : ''}`;
          parts.push({ label, count: left, points });
        }
      });
      const points = parts.reduce((sum, part) => sum + part.points, 0);
      if (!best || points > best.points) best = { points, parts, broken };
    }
  }
  return best;
}
