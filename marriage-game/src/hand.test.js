import { RANKS, allCardCodes, cardValue, countCards, parseCard } from './cards';
import { isJoker } from './jokers';
import { COMMIT_SEQUENCES, bestArrangement, hathFromValue, scoreHand } from './hand';

// Five pure runs, no jokers when 7♦ is opened (24 cards).
const COMMIT = ['2S', '3S', '4S', '5S', '6S', '9H', '10H', 'JH', 'QH', 'KH', '2C', '3C', '4C', '5C', '6C',
  '10D', 'JD', 'QD', 'KD', 'AD', '9C', '10C', 'JC', 'QC'];

test('Hath rounding and cap', () => {
  expect([0, 4, 5, 120, 124, 125, 150, 155, 210].map(hathFromValue)).toEqual([0, 0, 1, 12, 12, 13, 15, 15, 15]);
});

test("user's example: A♠ Q♠ 5♣ 6♣ 9♥ 9♣ and 3 jokers leave nothing", () => {
  const hand = ['2S', '3S', '4S', '5S', '6S', '10H', 'JH', 'QH', 'KH', '10C', 'JC', 'QC', 'KC', '2D', '3D', '4D',
    'JD', 'QD', 'KD', 'AD', '2H', 'AS', 'QS', '5C', '6C', '9H', '9C', 'JK', 'JK', 'JK'];
  const result = scoreHand(hand, '7D');
  expect(result.committed).toBe(true);
  expect(result.closed).toBe(true);
  expect(result.hathValue).toBe(0);
  expect(result.hath).toBe(0);
  expect(result.jokerPoints).toBe(14);
});

test('committed hand that has not closed counts only the cheapest leftovers', () => {
  const result = scoreHand([...COMMIT, '8S', '4H', '3H', 'QS', 'KS', '4D'], '7D');
  expect(result.committed).toBe(true);
  expect(result.closed).toBe(false);
  // Sets Q♠ Q♥ Q♣ and K♠ K♥ K♦ re-use run ends; 8♠ 3♥ 4♥ A♦ 4♦ are left.
  expect(result.hathValue).toBe(29);
  expect(result.hath).toBe(3);
  expect(result.jokerPoints).toBe(0);
});

test('a joker fills the most valuable gap', () => {
  const result = scoreHand([...COMMIT, '8S', '4H', '3H', 'QS', 'KS', 'JK'], '7D');
  expect(result.hathValue).toBe(15);
  expect(result.hath).toBe(2);
  expect(result.jokerPoints).toBe(2);
});

test('a joker never completes a pure triple', () => {
  const result = scoreHand([...COMMIT, '4D', '4D', 'JK', '8S', 'QS', '3H'], '7D');
  expect(result.groups.some(group => group.type === 'pureTriple' && group.cards.includes('JK'))).toBe(false);
  expect(result.hathValue).toBe(19);
});

test('A-2-3 and Q-K-A are runs; K-A-2 is not', () => {
  const four = ['2S', '3S', '4S', '5S', '6S', '2C', '3C', '4C', '5C', '6C', '10D', 'JD', 'QD', 'KD', 'AD', '9C', '10C', 'JC', 'QC'];
  const rest = ['8S', 'QS', '8H', '6H', '4D', '9S', '10H', '3D'];
  expect(scoreHand([...four, 'KH', 'AH', '2H', ...rest], '7D').committed).toBe(false);
  expect(scoreHand([...four, 'QH', 'KH', 'AH', ...rest], '7D').committed).toBe(true);
  expect(scoreHand([...four, 'AH', '2H', '3H', ...rest], '7D').committed).toBe(true);
});

test('a hand without 5 pure sequences counts every non-joker card', () => {
  const evens = suit => ['2', '4', '6', '8', '10', 'Q'].map(rank => rank + suit);
  const hand = [...evens('S'), ...evens('H'), ...evens('C'), '2D', '4D', '10D', 'QD',
    '4S', '4H', '4C', '10S', '10H', '10C', 'JK', '7H'];
  const result = scoreHand(hand, '7D');
  expect(result.committed).toBe(false);
  expect(result.hathValue).toBe(188);
  expect(result.hath).toBe(15);
  expect(result.jokerPoints).toBe(4);
});

test('pure triples count as Joker points and leave Hath, even without commit', () => {
  const evens = suit => ['2', '4', '6', '8', '10', 'Q'].map(rank => rank + suit);
  const hand = [...evens('S'), ...evens('H'), ...evens('C'), '2D', '4D', '10D', 'QD',
    '4S', '4S', '4H', '4H', '4C', '4C', 'JK', '7H'];
  const result = scoreHand(hand, '7D');
  expect(result.committed).toBe(false);
  // 4♠, 4♥ and 4♣ are each held three times.
  expect(result.triples).toBe(3);
  expect(result.triplePoints).toBe(14);
  expect(result.jokerPoints).toBe(18);
  expect(result.hathValue).toBe(134);
  expect(result.hath).toBe(13);
});

test('returns an error for an invalid hand', () => {
  expect(scoreHand(['2S'], '7D').error).toMatch(/30 cards/);
  expect(scoreHand(COMMIT, 'JK').error).toMatch(/redrawn/);
});

// Independent check of a grouping against the rules.
function checkGroup(group, openCard) {
  const naturals = group.cards.filter((_, index) => !group.wilds.includes(index));
  group.wilds.forEach(index => expect(isJoker(group.cards[index], openCard)).toBe(true));
  expect(naturals.includes('JK')).toBe(false);
  const parsed = naturals.map(parseCard);
  if (group.type === 'pureTriple') {
    expect(group.cards).toHaveLength(3);
    expect(group.wilds).toHaveLength(0);
    expect(new Set(group.cards).size).toBe(1);
  } else if (group.type === 'set') {
    expect(group.cards.length).toBeGreaterThanOrEqual(3);
    expect(group.cards.length).toBeLessThanOrEqual(4);
    expect(new Set(parsed.map(card => card.rank)).size).toBe(1);
    expect(new Set(parsed.map(card => card.suit)).size).toBe(parsed.length);
  } else {
    expect(['pureRun', 'run']).toContain(group.type);
    expect(group.type === 'pureRun').toBe(group.wilds.length === 0);
    expect(group.cards.length).toBeGreaterThanOrEqual(3);
    expect(group.cards.length).toBeLessThanOrEqual(5);
    expect(new Set(parsed.map(card => card.suit)).size).toBe(1);
    // Natural cards sit at consecutive positions, ace low or high, never wrapping.
    const startsWith = aceHigh => new Set(group.cards
      .map((code, index) => ({ code, index }))
      .filter(({ index }) => !group.wilds.includes(index))
      .map(({ code, index }) => {
        const rank = parseCard(code).rank;
        return (aceHigh && rank === 1 ? 14 : rank) - index;
      }));
    const fits = aceHigh => {
      const starts = startsWith(aceHigh);
      const [start] = [...starts];
      return starts.size === 1 && start >= 1 && start + group.cards.length - 1 <= 14;
    };
    expect(fits(false) || fits(true)).toBe(true);
  }
}

test('every grouping found follows the rules and uses each card once', () => {
  let seed = 2026;
  const rand = n => { seed = (seed * 1103515245 + 12345) % 2147483648; return seed % n; };
  let checked = 0;
  for (let round = 0; round < 25; round += 1) {
    const deck = [];
    for (let d = 0; d < 3; d += 1) deck.push(...allCardCodes());
    const open = deck.filter(code => code !== 'JK')[rand(156)];
    deck.splice(deck.indexOf(open), 1);
    const hand = [];
    const take = code => { const index = deck.indexOf(code); if (index >= 0) { deck.splice(index, 1); hand.push(code); } return index >= 0; };
    let runs = 0;
    while (runs < 5) {
      const suit = 'SHDC'[rand(4)];
      const start = 1 + rand(11);
      const codes = [start, start + 1, start + 2].map(rank => RANKS[rank - 1] + suit);
      if (codes.every(code => deck.includes(code))) { codes.forEach(take); runs += 1; }
    }
    const jokers = deck.filter(code => isJoker(code, open));
    for (let k = rand(8); k > 0 && jokers.length; k -= 1) take(jokers.splice(rand(jokers.length), 1)[0]);
    while (hand.length < 30) take(deck[rand(deck.length)]);

    const result = bestArrangement(hand, open);
    expect(result).not.toBeNull();
    result.groups.forEach(group => checkGroup(group, open));
    const pure = result.groups.filter(group => group.type === 'pureRun' || group.type === 'pureTriple').length;
    expect(pure).toBeGreaterThanOrEqual(COMMIT_SEQUENCES);
    const used = [...result.groups.flatMap(group => group.cards), ...result.leftovers, ...result.unusedJokers];
    expect(countCards(used)).toEqual(countCards(hand));
    expect(result.leftovers.every(code => !isJoker(code, open))).toBe(true);
    expect(result.cost).toBe(result.leftovers.reduce((sum, code) => sum + cardValue(parseCard(code).rank), 0));
    checked += 1;
  }
  expect(checked).toBe(25);
});

test('ties on Hath go to the grouping with more pure triples', () => {
  // Leaving 4♥ 2♦ (value 6) lets 3♠ 3♠ 3♠ stand as a triple; the cheapest grouping (value 5) has none.
  // Both round to Hath 1.
  const hand = ['3S', '4S', '5S', '6S', 'JC', 'QC', 'KC', 'AC', '5S', '5S', 'KS', '2D', '4S', '2C', 'KS', 'KS', 'AS',
    '9D', '3C', '4H', '2C', '8H', 'AH', '9C', '3S', '2H', '8S', 'JC', '3S', '10D'];
  const result = bestArrangement(hand, '2S');
  expect(result.minCost).toBe(5);
  expect(result.cost).toBe(6);
  expect(result.triples).toBe(1);
  expect(hathFromValue(result.cost)).toBe(hathFromValue(result.minCost));
});

test('four pure sequences plus jokers is still not a commit', () => {
  const hand = [...COMMIT.slice(0, 20), 'JK', 'JK', 'JK', '8S', '9S', '4H', '8C', '3D', '7H', '8D'];
  expect(bestArrangement(hand, '7D')).toBeNull();
  expect(scoreHand(hand, '7D').committed).toBe(false);
});

test('ties on Hath can trade several leftover cards for three triples', () => {
  const hand = 'JH QH KH 8D 9D 10D JD QD 2S 3S 4S 5S 6S JD QD KD 6D 7D 8D 9S 3D AC 6H QD 8D 2D JD 8S 5D 9H'.split(' ');
  const result = bestArrangement(hand, '9C');
  expect(result.minCost).toBe(16);
  expect(result.cost).toBe(21);
  expect(result.triples).toBe(3);
});
