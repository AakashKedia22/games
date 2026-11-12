import { RANKS, SUITS, allCardCodes, cardCode, cardValue, countCards, parseCard } from './cards';
import { isJoker, jokerCardPoints, triplePoints } from './jokers';
import {
  COMMIT_SEQUENCES, bestArrangement, canCommitFrom, checkCommit, doubletArrangement, doubletTargets, findDoublets,
  freeRunArrangement, hathFromValue, naturalUse, scoreCommitted, scoreHand, scoreNotCommitted
} from './hand';

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

const S = text => text.split(' ');
const D10 = S('2S 2S 3H 3H 4C 4C 5S 5S 9H 9H 10C 10C JS JS QH QH KC KC AS AS 2C 6C 9C KH 8S 10S 3D JD AH 4D');
const D8T = S('2S 2S 3H 3H 4C 4C 9H 9H 10C 10C JS JS KC KC 5S 5S 5S 2C 6C 9C KH 8S 10S 3D JD AH 4D 10D 6H QC');
const DJK = S('2S 2S 3H 3H 4C 4C 9H 9H 10C 10C JS JS KC KC JK JK 2C 6C 9C KH 8S 10S 3D JD AH 4D 10D 6H QC 5S');
const D8D = S('2S 2S 3H 3H 4C 4C 9H 9H 10C 10C JS JS KC KC 8D 8D 2C 6C 9C KH 8S 10S 3D JD AH 4D 10D 6H QC 5S');
const BOTH = S('2S 3S 4S 2S 3S 4S 9H 10H JH 9H 10H JH QC KC AC 2D 2D 3C 3C 10S 10S 4H 4H 8S 6C 9C KH 3D JD AH');
const E1 = S('AS 2S 3S 4S JH QH KH AH 8C 9C 10C JC QC KC 9S KS 10S 6H 2H 4H 9H 8H 10D 10D QD 3D 2D 6C 4C KD');
const E2 = S('3H 4H 5H 5H 5H 6H 7S 7S 7S 7C 7C 7C JK JK JK 9D 9D 9D 10S QS KS 10C QC KC 10D QD 2S 2C 3S 3C');
const E2B = S('3H 4H 5H 5H 5H 6H 7S 7S 7S 7C 7C 7C JK JK JK 9D 9D 9D 10S QS KS 10C QC KC 10D QD 2S 4C 3S 3C');
const E3 = S('3D 4D 5D 6D AS 2S 3S 4S 9S KS 10S 6H 2H 4H 9H 8H 10D KD 6C 4C 2C 8C 9C JC KC JK 7H QH KD 9C');

test('doublet targets by player count', () => {
  expect(doubletTargets(3)).toEqual({ commit: 9, close: 11 });
  expect(doubletTargets(4)).toEqual({ commit: 8, close: 10 });
  expect(doubletTargets(5)).toBeNull();
  expect(doubletTargets()).toBeNull();
});

test('findDoublets: printed jokers never pair, a triple leaves one spare', () => {
  expect(findDoublets(S('5S 5S 5S JK JK 8D 8D 2C'))).toEqual({ doublets: ['5S', '8D'], rest: ['5S', '2C', 'JK', 'JK'] });
});

test('4 players: ten doublets close the hand with Hath 0', () => {
  const result = scoreHand(D10, '7D', 4);
  expect(result.route).toBe('doublets');
  expect(result.committed).toBe(true);
  expect(result.closed).toBe(true);
  expect(result.hath).toBe(0);
  expect(result.hathValue).toBe(0);
  expect(result.doublets).toBe(10);
  expect(result.groups).toHaveLength(10);
  expect(result.groups.every(group => group.type === 'doublet')).toBe(true);
  expect(result.leftovers).toEqual([]);
  expect(result.otherCards).toHaveLength(10);
});

test('3 players: the same hand is committed but not closed, and Hath is 0 anyway', () => {
  const result = scoreHand(D10, '7D', 3);
  expect(result.route).toBe('doublets');
  expect(result.committed).toBe(true);
  expect(result.closed).toBe(false);
  expect(result.hathValue).toBe(0);
  expect(result.hath).toBe(0);
  expect(result.leftovers).toEqual([]);
  expect(result.otherCards).toHaveLength(10);
});

test('no player count: the doublets route is off', () => {
  const result = scoreHand(D10, '7D');
  expect(result.committed).toBe(false);
  expect(result.route).toBeNull();
  expect(result.hathValue).toBe(218);
  expect(result.hath).toBe(15);
});

test('a triple is a doublet and a spare, and earns no triple points on the doublets route', () => {
  const result = scoreHand(D8T, '7D', 4);
  expect(result.route).toBe('doublets');
  expect(result.hathValue).toBe(0);
  expect(result.hath).toBe(0);
  expect(result.triples).toBe(0);
  expect(result.jokerPoints).toBe(0);
  expect(result.leftovers).toEqual([]);
  expect(result.otherCards).toContain('5S');
});

test('the same triple hand with 3 players misses the doublets target, so triples score', () => {
  const result = scoreHand(D8T, '7D', 3);
  expect(result.committed).toBe(false);
  expect(result.hathValue).toBe(194);
  expect(result.triples).toBe(1);
  expect(result.jokerPoints).toBe(2);
});

test('printed jokers never pair', () => {
  const result = scoreHand(DJK, '7D', 4);
  expect(result.committed).toBe(false);
  expect(result.doublets).toBe(7);
  expect(result.hathValue).toBe(199);
  expect(result.hath).toBe(15);
  expect(result.jokerPoints).toBe(6);
});

test('a pair of the joker card 8D is a doublet and keeps its Joker points', () => {
  const result = scoreHand(D8D, '7D', 4);
  expect(result.route).toBe('doublets');
  expect(result.hathValue).toBe(0);
  expect(result.hath).toBe(0);
  expect(result.jokerPoints).toBe(6);
  expect(result.groups.some(group => group.cards.join(' ') === '8D 8D')).toBe(true);
  expect(result.leftovers).toEqual([]);
  expect(scoreHand(D8D, '7D', 3).committed).toBe(false);
});

test('closed doublets beat the sequences route', () => {
  const result = scoreHand(BOTH, '7D', 4);
  expect(result.route).toBe('doublets');
  expect(result.closed).toBe(true);
  expect(result.hath).toBe(0);
});

test('committed doublets (Hath 0) beat a sequences route that leaves Hath, even when not closed', () => {
  const result = scoreHand(BOTH, '7D', 3);
  expect(result.route).toBe('doublets');
  expect(result.closed).toBe(false);
  expect(result.hath).toBe(0);
});

test("user's doublets hand: nine doublets commit with Hath 0 though not closed", () => {
  const hand = S('AS 3S 5S JS QS QS KS KS 2H 3H 3H JH JH QH AD 3D 3D 4D 4D 5D 9D JD JD QD QD 3C 3C 4C 7C JK');
  const result = scoreHand(hand, '5S', 4);
  expect(result.route).toBe('doublets');
  expect(result.committed).toBe(true);
  expect(result.closed).toBe(false);
  expect(result.doublets).toBe(9);
  expect(result.hath).toBe(0);
  expect(result.hathValue).toBe(0);
  expect(result.jokerPoints).toBe(8);
  expect(result.leftovers).toEqual([]);
});

test("user's hand: protecting the 2C triple keeps Hath 0 with Joker 10", () => {
  const hand = S('AS 2S 3S 6S 6S 8S 9S 10S AH 2H 3H 4H 4H 6H 7H 8H 8H 9H 10H 2D 2D 5D 6D 8D 9D 2C 2C 2C 9C 10C');
  const result = scoreHand(hand, '5S', 4);
  expect(result.committed).toBe(true);
  expect(result.hath).toBe(0);
  expect(result.hathValue).toBe(4);
  expect(result.jokerPoints).toBe(10);
});

test('the sequences route is reported for the user example', () => {
  const hand = ['2S', '3S', '4S', '5S', '6S', '10H', 'JH', 'QH', 'KH', '10C', 'JC', 'QC', 'KC', '2D', '3D', '4D',
    'JD', 'QD', 'KD', 'AD', '2H', 'AS', 'QS', '5C', '6C', '9H', '9C', 'JK', 'JK', 'JK'];
  const result = scoreHand(hand, '7D', 4);
  expect(result.route).toBe('sequences');
  expect(result.closed).toBe(true);
  expect(result.doublets).toBe(0);
  expect(result.jokerPoints).toBe(14);
});

test('not committed: A-2-3-4 and J-Q-K-A are free, and a 6-run frees 5 cards', () => {
  const result = scoreHand(E1, '7D', 4);
  expect(result.committed).toBe(false);
  expect(result.hathValue).toBe(121);
  expect(result.hath).toBe(12);
  expect(result.groups.map(group => `${group.type} ${group.cards.join(' ')}`)).toEqual([
    'pureRun AS 2S 3S 4S', 'pureRun JH QH KH AH', 'pureRun 9C 10C JC QC KC'
  ]);
  expect(result.leftovers).toContain('8C');
});

test('not committed: a rounding tie goes to the pure triple', () => {
  const result = scoreHand(E2, '7D', 4);
  expect(result.hathValue).toBe(103);
  expect(result.hath).toBe(10);
  expect(result.triples).toBe(1);
  expect(result.jokerPoints).toBe(50);
  expect(result.groups).toEqual([{ type: 'pureTriple', cards: ['5H', '5H', '5H'], wilds: [] }]);
});

test('not committed: a run wins when its Hath is lower', () => {
  const result = scoreHand(E2B, '7D', 4);
  expect(result.hathValue).toBe(102);
  expect(result.hath).toBe(10);
  expect(result.triples).toBe(0);
  expect(result.jokerPoints).toBe(48);
  expect(result.groups).toEqual([{ type: 'pureRun', cards: ['3H', '4H', '5H', '6H'], wilds: [] }]);
});

test('not committed: joker cards count as their natural selves; a printed joker never does', () => {
  const result = scoreHand(E3, '7D', 4);
  expect(result.hathValue).toBe(133);
  expect(result.hath).toBe(13);
  expect(result.jokerPoints).toBe(8);
  expect(result.groups.map(group => group.cards)).toEqual(expect.arrayContaining([
    ['3D', '4D', '5D', '6D'], ['6H', '7H', '8H', '9H']
  ]));
  expect(result.unusedJokers).toEqual(['JK']);
});

test('random hands: groupings keep every card, and free hands follow the rules', () => {
  let seed = 4242;
  const rand = n => { seed = (seed * 1103515245 + 12345) % 2147483648; return seed % n; };
  for (let round = 0; round < 40; round += 1) {
    const deck = [];
    for (let d = 0; d < 3; d += 1) deck.push(...allCardCodes());
    const open = deck.filter(code => code !== 'JK')[rand(156)];
    deck.splice(deck.indexOf(open), 1);
    const hand = [];
    while (hand.length < 30) hand.push(deck.splice(rand(deck.length), 1)[0]);

    const started = Date.now();
    const result = scoreHand(hand, open, 4);
    expect(Date.now() - started).toBeLessThan(1000);
    expect(result.error).toBeUndefined();
    const sumOf = codes => codes.reduce((sum, code) => sum + cardValue(parseCard(code).rank), 0);
    if (!result.committed) {
      result.groups.forEach(group => {
        if (group.type === 'pureTriple') {
          expect(group.cards).toHaveLength(3);
          expect(new Set(group.cards).size).toBe(1);
          expect(isJoker(group.cards[0], open)).toBe(false);
        } else {
          expect(group.type).toBe('pureRun');
          expect(group.cards.length).toBeGreaterThanOrEqual(4);
          expect(group.cards.length).toBeLessThanOrEqual(5);
          checkGroup(group, open);
        }
      });
      const used = [...result.groups.flatMap(group => group.cards), ...result.leftovers, ...result.unusedJokers];
      expect(countCards(used)).toEqual(countCards(hand));
      expect(result.hathValue).toBe(sumOf(result.leftovers));
      const counts = countCards(hand);
      const oldValue = Object.keys(counts)
        .filter(code => !isJoker(code, open) && counts[code] !== 3)
        .reduce((sum, code) => sum + cardValue(parseCard(code).rank) * counts[code], 0);
      expect(result.hathValue).toBeLessThanOrEqual(oldValue);
    }
    if (result.route === 'doublets') {
      const used = [...result.groups.flatMap(group => group.cards), ...result.leftovers,
        ...result.unusedJokers, ...result.otherCards];
      expect(countCards(used)).toEqual(countCards(hand));
    }
  }
});

// The user's hand (5♠ opened, 4 players): 5♥ ×3 is kept whole, so the 4♥-8♥ run is not made.
const BUG_HAND = S('2S 6S 7S 7S 2H 4H 5H 5H 5H 6H 7H 8H 10H QH QH KH AD 3D 4D KD AC 4C 5C 6C 10C 10C JC QC QC JK');
const COMMITTED_HAND = S('2S 6S 7S 7S 2H 4H 5H 5H 5H 6H 7H 8H JH QH QH KH AD 3D 4D KD AC 4C 5C 6C 10C 10C JC QC QC JK');

test("user's bug hand: the 5♥ triple is kept whole and no run plays a 5♥", () => {
  const result = scoreHand(BUG_HAND, '5S', 4);
  expect(result.committed).toBe(false);
  expect(result.hathValue).toBe(166);
  expect(result.hath).toBe(15);
  expect(result.jokerPoints).toBe(22);
  expect(result.brokenCombos).toEqual([]);
  result.groups
    .filter(group => group.cards.some((code, index) => code === '5H' && !group.wilds.includes(index)))
    .forEach(group => expect(group).toEqual({ type: 'pureTriple', cards: ['5H', '5H', '5H'], wilds: [] }));
});

test("user's committed hand: the 5♥ triple is an all-copies group, so nothing breaks", () => {
  const result = scoreHand(COMMITTED_HAND, '5S', 4);
  expect(result.committed).toBe(true);
  expect(result.route).toBe('sequences');
  expect(result.hath).toBe(2);
  expect(result.hathValue).toBe(17);
  expect(result.jokerPoints).toBe(22);
  expect(result.brokenCombos).toEqual([]);
});

test('breaking a 0-value pair wins when the run it joins saves Hath', () => {
  // 5♣ 6♣ 7♣ 8♣ is a free run and plays one 7♣ (the pair is worth 0). Keeping both 7♣ whole would
  // leave 5♣ 6♣ 8♣ (19) over: Hath 15 instead of 13, so the break wins by 2.
  const hand = S('5C 6C 7C 7C 8C 3S 4S 10H AS QD 3D 4D QC 6H 9H 2H AC JC KH 4H 9S 3H 10D 2C KS JH 8S QS JS AH');
  const result = scoreHand(hand, '7D', 4);
  expect(result.committed).toBe(false);
  expect(result.groups.map(group => group.cards.join(' '))).toContain('5C 6C 7C 8C');
  expect(result.brokenCombos).toEqual(['7C']);
  expect(result.jokerPoints).toBe(0);
  expect(result.hath).toBe(13);
});

test('a played card in the opened run never breaks the combo', () => {
  // 5♦ 6♦ 7♦ 8♦ 9♦ is the opened run (25) and takes a natural 6♦; the spare 6♦ is a single (2).
  const hand = ['5D', '6D', '7D', '8D', '9D', '6D'];
  const natural = naturalUse([{ type: 'pureRun', cards: ['5D', '6D', '7D', '8D', '9D'], wilds: [] }], hand, '7D');
  const result = jokerCardPoints(hand, '7D', natural);
  expect(result.points).toBe(27);
  expect(result.broken).toEqual([]);
});

test('random 4-player hands: the score is honest, the search is fast, and no route is worse than its unprotected grouping', () => {
  let seed = 7;
  const rand = n => { seed = (seed * 1103515245 + 12345) % 2147483648; return seed % n; };
  // Joker − Hath of one grouping, with its natural cards counted and no protect set.
  const honest = (arrangement, triples, hand, open) => {
    const natural = naturalUse(arrangement.groups, hand, open);
    return jokerCardPoints(hand, open, natural).points + triplePoints(triples) - hathFromValue(arrangement.cost);
  };
  for (let round = 0; round < 60; round += 1) {
    const deck = [];
    for (let d = 0; d < 3; d += 1) deck.push(...allCardCodes());
    const open = deck.filter(code => code !== 'JK')[rand(156)];
    deck.splice(deck.indexOf(open), 1);
    const hand = [];
    while (hand.length < 30) hand.push(deck.splice(rand(deck.length), 1)[0]);

    const started = Date.now();
    const result = scoreHand(hand, open, 4);
    expect(Date.now() - started).toBeLessThan(2000);
    expect(result.error).toBeUndefined();

    const natural = naturalUse(result.groups, hand, open);
    expect(jokerCardPoints(hand, open, natural).points + result.triplePoints).toBe(result.jokerPoints);

    const unprotected = result.route === 'sequences' ? bestArrangement(hand, open)
      : result.route === 'doublets' ? doubletArrangement(hand, open, 4)
        : freeRunArrangement(hand, open);
    const triples = result.route === 'doublets' ? 0 : unprotected.triples;
    expect(result.jokerPoints - result.hath).toBeGreaterThanOrEqual(honest(unprotected, triples, hand, open));
  }
});

test('the search protects a combo the opened run happened to absorb', () => {
  // The unprotected grouping plays J♥ Q♥ K♥ (absorbed by the opened run), so K♥ looks unbroken; but
  // protecting K♥ and 10♥ lets a better split keep the K♥ triple whole: Joker 80 - Hath 2, not 77 - 2.
  const hand = S('JS 10S 9H 6H JD 9H JH QH 5S 9H JC JS 10D JH KH JD KH AS 9S KH JS 2H JC JD 10H 3C 10H 3H JC 3H');
  const result = scoreHand(hand, 'JH', 4);
  expect(result.hath).toBe(2);
  expect(result.jokerPoints).toBe(80);
});

// ---- v4f: committed cards are locked; Bandh is scored from the Bandh cards only ----
const FIVE = S('2S 3S 4S 9H 10H JH 2C 3C 4C 10D JD QD 9C 10C JC');
const D8 = S('2S 2S 3H 3H 4C 4C 9H 9H 10C 10C JS JS KC KC AS AS');
const USER = S('AS 2S 3S 6S 6S 8S 9S 10S AH 2H 3H 4H 4H 6H 7H 8H 8H 9H 10H 2D 2D 5D 6D 8D 9D 2C 2C 2C 9C 10C');
const CA = S('6H 7H 8H 8H 9H 10H AH 2H 3H 4H 8S 9S 10S 2C 2C 2C');
const CB = S('AS 2S 3S 6H 7H 8H 8H 9H 10H AH 2H 3H 4H 8S 9S 10S');
const CC = S('AS 2S 3S 6H 7H 8H 8H 9H 10H AH 2H 3H 4H 2C 2C 2C');
const minus = (a, b) => {
  const left = [...a];
  b.forEach(code => { const at = left.indexOf(code); if (at >= 0) left.splice(at, 1); });
  return left;
};
const sortedGroups = groups => groups.map(group => group.cards.join(' ')).sort();

describe('checkCommit', () => {
  const check = (cards, playerCount = 4) => checkCommit(cards, '7D', playerCount);

  test('five pure sequences that use every card', () => {
    const result = check(FIVE);
    expect(result).toMatchObject({ ok: true, route: 'sequences', message: '5 pure sequences ✓' });
    expect(sortedGroups(result.groups)).toEqual(['10D JD QD', '2C 3C 4C', '2S 3S 4S', '9C 10C JC', '9H 10H JH']);
    expect(result.groups.every(group => group.type === 'pureRun' && group.wilds.length === 0)).toBe(true);
  });

  test('four sequences are not enough', () => {
    const result = check(FIVE.slice(0, 12));
    expect(result).toMatchObject({ ok: false, route: null, message: '4 sequences, need 5 ✗' });
    expect(result.groups).toEqual([]);
  });

  test('a fifth sequence with two extra cards', () => {
    expect(check([...FIVE, 'KS', '5H'])).toMatchObject({ ok: false, message: '5 sequences + 2 extra cards ✗' });
  });

  test('a printed joker or a joker card that is not a natural card leaves extra cards', () => {
    const withJoker = S('2S 3S 4S 9H 10H JH 2C 3C 4C 10D JD QD 9C JK JC');
    expect(check(withJoker)).toMatchObject({ ok: false, message: '4 sequences + 3 extra cards ✗' });
    const withCard = S('2S 3S 4S 9H 10H JH 2C 3C 4C 10D JD QD 9C 8D JC');
    expect(check(withCard)).toMatchObject({ ok: false, message: '4 sequences + 3 extra cards ✗' });
  });

  test('joker cards count as themselves in a run', () => {
    expect(check(S('6D 7D 8D 9H 10H JH 2C 3C 4C 10D JD QD 9C 10C JC'))).toMatchObject({ ok: true, route: 'sequences' });
  });

  test('a pure triple is one of the five sequences', () => {
    const result = check(S('4D 4D 4D 9H 10H JH 2C 3C 4C 10D JD QD 9C 10C JC'));
    expect(result).toMatchObject({ ok: true, route: 'sequences' });
    expect(result.groups).toContainEqual(expect.objectContaining({ type: 'pureTriple', cards: ['4D', '4D', '4D'] }));
  });

  test('ace high and ace low runs both count; K-A-2 does not wrap', () => {
    expect(check(S('QS KS AS AH 2H 3H 2C 3C 4C 10D JD QD 9C 10C JC'))).toMatchObject({ ok: true, route: 'sequences' });
    expect(check(S('KS AS 2S AH 2H 3H 2C 3C 4C 10D JD QD 9C 10C JC')))
      .toMatchObject({ ok: false, message: '4 sequences + 3 extra cards ✗' });
  });

  test('a run of six can be split into two sequences', () => {
    expect(check(S('2S 3S 4S 5S 6S 7S 9H 10H JH 2C 3C 4C 10D JD QD'))).toMatchObject({ ok: true, route: 'sequences' });
  });

  test('six sequences is not a commit', () => {
    expect(check([...FIVE, '6H', '7H', '8H'])).toMatchObject({ ok: false, message: '6 sequences: commit exactly 5 ✗' });
  });

  test('eight doublets commit four players; nine commit three', () => {
    const eight = check(D8);
    expect(eight).toMatchObject({ ok: true, route: 'doublets', message: '8 doublets ✓' });
    expect(eight.groups).toHaveLength(8);
    expect(eight.groups.every(group => group.type === 'doublet')).toBe(true);
    expect(check(D8, 3)).toMatchObject({ ok: false, message: '8 doublets, need 9 ✗' });
    expect(check([...D8, 'QD', 'QD'], 3)).toMatchObject({ ok: true, route: 'doublets', message: '9 doublets ✓' });
    expect(check([...D8, 'QD', 'QD'], 4)).toMatchObject({ ok: false, message: '9 doublets: commit exactly 8 ✗' });
  });

  test('doublets with an extra card, or a joker that fails to pair', () => {
    expect(check([...D8, '5S'])).toMatchObject({ ok: false, message: '8 doublets + 1 extra card ✗' });
    const jokers = D8.map(code => (code === 'AS' ? 'JK' : code));
    expect(check(jokers)).toMatchObject({ ok: false, message: '7 doublets + 2 extra cards ✗' });
  });

  test('without a player count there is no doublets route', () => {
    expect(checkCommit(D8, '7D', undefined)).toMatchObject({ ok: false, message: 'No pure sequence yet ✗' });
  });

  test('empty and short lists', () => {
    expect(check([])).toMatchObject({ ok: false, message: 'Enter the cards that were shown' });
    expect(check(['5H'])).toMatchObject({ ok: false, message: 'No pure sequence yet ✗' });
    expect(check(['2S', '3S', '4S'])).toMatchObject({ ok: false, message: '1 sequence, need 5 ✗' });
  });

  test('copy limits and unknown codes', () => {
    expect(check(['5H', '5H', '5H', '5H'])).toMatchObject({ ok: false, message: 'There are only 3 of 5♥ in 3 decks.' });
    expect(checkCommit(['7D', '7D', '7D'], '7D', 4)).toMatchObject({
      ok: false, message: '7♦ is the opened card, so a hand can hold at most 2.'
    });
    expect(check(['2S', 'ZZ'])).toMatchObject({ ok: false, message: 'Unknown card: ZZ.' });
  });

  test('the opened card is only used for the copy limit', () => {
    expect(checkCommit(FIVE, '', 4)).toMatchObject({ ok: true, route: 'sequences' });
  });
});

describe('scoreCommitted', () => {
  test("user's hand, Commit A: Hath 1 and Joker 10 from the Bandh cards", () => {
    const bandh = minus(USER, CA);
    expect(bandh).toHaveLength(14);
    const result = scoreCommitted(CA, bandh, '5S', 4);
    expect(result).toMatchObject({
      route: 'sequences', committed: true, closed: false, hathValue: 8, hath: 1, jokerPoints: 10,
      jokerCardPoints: 8, triples: 1, triplePoints: 2, brokenCombos: []
    });
    expect(sortedGroups(result.lockedGroups)).toEqual(['2C 2C 2C', '6H 7H 8H', '8H 9H 10H', '8S 9S 10S', 'AH 2H 3H 4H']);
    expect(sortedGroups(result.groups)).toEqual(['5D 6D 6S 8D 9D', '6S 9C 10C', 'AS 2S 3S']);
    expect(result.leftovers.slice().sort()).toEqual(['2D', '2D', '4H']);
  });

  test('the old 30-card search gives Hath 0, so the locked hand scores higher on Hath', () => {
    const old = scoreHand(USER, '5S', 4);
    expect(old).toMatchObject({ route: 'sequences', hath: 0, hathValue: 4, jokerPoints: 10 });
    expect(old.groups).toContainEqual(expect.objectContaining({ wilds: [1] }));
    expect(old.groups.map(group => group.cards.join(' '))).toContain('4H 6S 6H 7H 8H');
    expect(scoreCommitted(CA, minus(USER, CA), '5S', 4).hath).toBeGreaterThan(old.hath);
  });

  test("user's hand, Commit B: the 2♣ triple is in the Bandh", () => {
    const result = scoreCommitted(CB, minus(USER, CB), '5S', 4);
    expect(result).toMatchObject({ hath: 1, hathValue: 8, jokerPoints: 10, triples: 1 });
    expect(sortedGroups(result.groups)).toEqual(['2C 2C 2C', '5D 6D 6S 8D 9D', '6S 9C 10C']);
    expect(sortedGroups(result.lockedGroups)).toContain('AS 2S 3S');
  });

  test("user's hand, Commit C: 8♠ 9♠ 10♠ is a Bandh run", () => {
    const result = scoreCommitted(CC, minus(USER, CC), '5S', 4);
    expect(result).toMatchObject({ hath: 1, hathValue: 8, jokerPoints: 10 });
    expect(sortedGroups(result.groups)).toContain('8S 9S 10S');
  });

  test("user's hand, not committed: Hath 10 and Joker 10", () => {
    const result = scoreNotCommitted(USER, '5S', 4);
    expect(result).toMatchObject({ committed: false, route: null, hathValue: 97, hath: 10, jokerPoints: 10 });
    expect(sortedGroups(result.groups)).toEqual(['2C 2C 2C', '6H 7H 8H 9H 10H', 'AH 2H 3H 4H']);
  });

  test('joker points count the locked groups too', () => {
    const commit = S('5H 5H 5H 4C 5C 6C 3S 4S 5S 6S 7S 2C 2C 2C 9D 10D JD');
    const bandh = S('5C 9H 9H 9H KS KH KD 7D 8D JK QS QH 3D');
    const result = scoreCommitted(commit, bandh, '5S', 4);
    expect(result).toMatchObject({
      hath: 0, hathValue: 3, closed: false, triples: 2, triplePoints: 6, jokerCardPoints: 41, jokerPoints: 47,
      brokenCombos: ['5C']
    });
    expect(result.jokerParts.map(part => [part.label, part.points])).toEqual([
      ['Run 3♠ 4♠ 5♠ 6♠ 7♠', 25], ['5♣ ×2 (1 played as itself)', 4], ['5♥ ×3', 10], ['Joker ×1', 2]
    ]);
    expect(result.groups).toContainEqual(expect.objectContaining({ type: 'run', cards: ['5C', '7D', '8D'], wilds: [0] }));
    const notCommitted = scoreNotCommitted([...commit, ...bandh], '5S', 4);
    expect(notCommitted.jokerPoints).toBe(49);
    expect(notCommitted.jokerParts.find(part => part.label === '5♣ ×2')).toMatchObject({ points: 6 });
  });

  test('closed means every Bandh card is grouped', () => {
    const closed = scoreCommitted(FIVE, S('5S 6S 7S KH KD KC QH QD JK 8D 4H 5H 6H AS AH'), '7D', 4);
    expect(closed).toMatchObject({ closed: true, hath: 0, hathValue: 0, jokerPoints: 4 });
    expect(closed.leftovers).toEqual([]);
    const open = scoreCommitted(FIVE, S('5S 6S 7S KH KD KC QH QD JK 8D 4H 5H 6H AS 2H'), '7D', 4);
    expect(open).toMatchObject({ closed: false, hathValue: 10, hath: 1 });
    expect(open.leftovers).toEqual(['AS']);
  });

  describe('doublets route', () => {
    const rows = [
      [4, D8, S('QH QH 6C 6C 9C KH 8S 10S 3D JD AH 4D 5S 6H'),
        { closed: true, hath: 0, doublets: 10, jokerPoints: 0, otherCards: 10 }],
      [4, D8, S('QH QH 2C 6C 9C KH 8S 10S 3D JD AH 4D 5S 6H'), { closed: false, hath: 0, doublets: 9 }],
      [3, [...D8, 'QD', 'QD'], S('QH QH 6C 6C 9C KH 8S 10S 3D JD AH 4D'), { closed: true, hath: 0, doublets: 11 }],
      [3, [...D8, 'QD', 'QD'], S('QH QH 2C 6C 9C KH 8S 10S 3D JD AH 4D'), { closed: false, hath: 0, doublets: 10 }]
    ];
    rows.forEach(([players, commit, bandh, expected], index) => {
      test(`row ${index + 1}`, () => {
        const result = scoreCommitted(commit, bandh, '7D', players);
        expect(result).toMatchObject({ route: 'doublets', closed: expected.closed, hath: expected.hath, doublets: expected.doublets });
        if (expected.jokerPoints !== undefined) expect(result.jokerPoints).toBe(expected.jokerPoints);
        if (expected.otherCards !== undefined) expect(result.otherCards).toHaveLength(expected.otherCards);
      });
    });

    test('the Bandh doublets of row 1 are 6♣ and Q♥', () => {
      const result = scoreCommitted(D8, S('QH QH 6C 6C 9C KH 8S 10S 3D JD AH 4D 5S 6H'), '7D', 4);
      expect(sortedGroups(result.groups)).toEqual(['6C 6C', 'QH QH']);
    });

    test('a locked doublet whose third copy is in the Bandh breaks the combo', () => {
      const commit = S('2S 2S 3H 3H 4C 4C 9H 9H 10C 10C JS JS KC KC 8D 8D');
      const result = scoreCommitted(commit, S('QH QH 6C 6C 9C KH 8S 10S 3D JD AH 4D 5S 8D'), '7D', 4);
      expect(result.jokerPoints).toBe(6);
      expect(result.jokerParts.map(part => [part.label, part.points])).toContainEqual(['8♦ ×3 (2 played as itself)', 6]);
      expect(result.brokenCombos).toEqual(['8D']);
    });

    test('a Bandh doublet does not break a combo', () => {
      const result = scoreCommitted(D8, S('QH QH 8D 8D 8D KH 8S 10S 3D JD AH 4D 5S 6H'), '7D', 4);
      expect(result).toMatchObject({ closed: true, jokerPoints: 14 });
      expect(result.jokerParts.map(part => [part.label, part.points])).toContainEqual(['8♦ ×3', 14]);
    });
  });

  test('errors name the cards that are wrong', () => {
    expect(scoreCommitted(FIVE, S('AS 2S 3S 6S 6S 4H 2D 2D 5D 6D 8D 9D 9C 10C'), '7D', 4))
      .toEqual({ error: 'Bandh cards: 14 of 15.' });
    expect(scoreCommitted(FIVE.slice(0, 12), USER.slice(0, 18), '7D', 4))
      .toEqual({ error: 'Committed cards: 4 sequences, need 5 ✗' });
    const bandh = minus(USER, CA);
    expect(scoreCommitted(CA, ['2C', ...bandh.slice(1)], '5S', 4))
      .toEqual({ error: 'There are only 3 of 2♣ in 3 decks.' });
  });
});

describe('v4f random committed hands', () => {
  test('every Bandh card is kept, the joker points add up, and each hand is fast', () => {
    let seed = 777;
    const rand = n => { seed = (seed * 1103515245 + 12345) % 2147483648; return seed % n; };
    const codes = allCardCodes().filter(code => code !== 'JK');
    let checked = 0;
    for (let round = 0; round < 60; round += 1) {
      const open = codes[rand(codes.length)];
      const openRank = parseCard(open).rank;
      const copies = {};
      const fits = code => (copies[code] || 0) < (code === open ? 2 : 3);
      const take = (list, code) => { copies[code] = (copies[code] || 0) + 1; list.push(code); };

      // The commit: five random 3-card runs in one suit.
      const commit = [];
      for (let guard = 0; commit.length < 15 && guard < 500; guard += 1) {
        const suit = SUITS[rand(4)];
        const start = rand(11);
        const run = [0, 1, 2].map(k => cardCode(start + k + 1, suit));
        if (commit.length + run.length <= 15 && run.every(fits)) run.forEach(code => take(commit, code));
      }
      if (commit.length !== 15) continue;

      // The Bandh: 0-3 printed jokers, then random cards (35% from ranks near the opened card).
      const bandh = Array.from({ length: rand(4) }, () => 'JK');
      const near = codes.filter(code => Math.abs(parseCard(code).rank - openRank) <= 3);
      for (let guard = 0; bandh.length < 15 && guard < 1000; guard += 1) {
        const pool = rand(100) < 35 ? near : codes;
        const code = pool[rand(pool.length)];
        if (fits(code)) take(bandh, code);
      }
      if (bandh.length !== 15) continue;

      const all = [...commit, ...bandh];
      const started = Date.now();
      const result = scoreCommitted(commit, bandh, open, 4);
      expect(Date.now() - started).toBeLessThan(1000);
      if (result.error) continue;
      checked += 1;
      expect(countCards([...result.groups.flatMap(group => group.cards), ...result.leftovers, ...result.unusedJokers]))
        .toEqual(countCards(bandh));
      const natural = naturalUse([...result.lockedGroups, ...result.groups], all, open);
      expect(jokerCardPoints(all, open, natural).points + result.triplePoints).toBe(result.jokerPoints);
    }
    expect(checked).toBeGreaterThan(20);
  });
});

describe('v4f hints and not committed', () => {
  test('canCommitFrom: five sequences hint, and an EVENS hand with no sequences and six doublets does not', () => {
    expect(canCommitFrom(USER, 4)).toBe(true);
    const evens = S('2S 4S 6S 8S 10S QS 2H 4H 6H 8H 10H QH 2C 4C 6C 8C 10C QC 2D 4D 10D QD 4S 4H 4C 10S 10H 10C JK 7H');
    expect(findDoublets(evens).doublets).toHaveLength(6);
    expect(canCommitFrom(evens, 4)).toBe(false);
  });

  test('scoreNotCommitted checks the hand', () => {
    expect(scoreNotCommitted(USER.slice(1), '5S', 4)).toEqual({ error: expect.any(String) });
    expect(scoreNotCommitted(USER, '', 4)).toEqual({ error: 'Pick the opened joker card (a printed joker is redrawn).' });
  });
});
