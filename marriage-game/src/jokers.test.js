import { copiesPoints, jokerCardPoints, jokerKind, neighbourCodes, triplePoints } from './jokers';

const points = (cards, open = '7D') => jokerCardPoints(cards, open).points;

test('which cards are jokers when 7♦ is opened', () => {
  expect(jokerKind('7D', '7D')).toBe('opened');
  expect(jokerKind('7H', '7D')).toBe('sameColour');
  expect(jokerKind('7S', '7D')).toBe('otherColour');
  expect(jokerKind('7C', '7D')).toBe('otherColour');
  expect(['5D', '6D', '8D', '9D'].map(code => jokerKind(code, '7D'))).toEqual(Array(4).fill('neighbour'));
  expect(jokerKind('JK', '7D')).toBe('printed');
  expect(jokerKind('4D', '7D')).toBeNull();
  expect(jokerKind('10D', '7D')).toBeNull();
  expect(jokerKind('6H', '7D')).toBeNull();
});

test('neighbours wrap around the ace for jokers', () => {
  expect(neighbourCodes('KD')).toEqual(['JD', 'QD', 'AD', '2D']);
  expect(neighbourCodes('AD')).toEqual(['QD', 'KD', '2D', '3D']);
  expect(neighbourCodes('2D')).toEqual(['KD', 'AD', '3D', '4D']);
  expect(neighbourCodes('QD')).toEqual(['10D', 'JD', 'KD', 'AD']);
});

test('a black opened card mirrors the colours', () => {
  expect(jokerKind('7C', '7S')).toBe('sameColour');
  expect(jokerKind('7H', '7S')).toBe('otherColour');
  expect(points(['7C'], '7S')).toBe(2);
  expect(points(['7H', '7D'], '7S')).toBe(0);
});

test('points for copies of one card', () => {
  expect([0, 1, 2, 3].map(n => copiesPoints(2, n))).toEqual([0, 2, 6, 14]);
  expect([0, 1, 2].map(n => copiesPoints(4, n))).toEqual([0, 4, 10]);
  expect([0, 1, 2, 3].map(n => copiesPoints(0, n))).toEqual([0, 0, 0, 10]);
});

test("the user's joker point examples", () => {
  expect(points(['7D'])).toBe(4);
  expect(points(['7D', '7D'])).toBe(10);
  expect(points(['6D', '6D'])).toBe(6);
  expect(points(['JK', 'JK'])).toBe(6);
  expect(points(['6D', '6D', '6D'])).toBe(14);
  expect(points(['JK', 'JK', 'JK'])).toBe(14);
  expect(points(['7H', '7H', '7H'])).toBe(14);
  expect(points(['7S', '7S', '7S'])).toBe(10);
  expect(points(['7C', '7C'])).toBe(0);
  expect(points(['7S'])).toBe(0);
  expect(points(['7H', '7C', '7D', '7S'])).toBe(14);
  expect(points(['5D', '6D', '7D', '8D', '9D'])).toBe(25);
  expect(points(['7D', '6D', '6D', '9D', 'JK'])).toBe(14);
  expect(points(['2S', 'KH', '4D'])).toBe(0);
});

test('a card counts toward one bonus only, and the best split wins', () => {
  // Run (25) + 7♥ (2) beats four 7s (14) + four neighbours (8).
  expect(points(['7D', '7H', '7C', '7S', '5D', '6D', '8D', '9D'])).toBe(27);
  // Four 7s (14) + the spare 7♦ (4) beats the 7♦ pair (10) + 7♥ (2).
  expect(points(['7D', '7D', '7H', '7C', '7S'])).toBe(18);
  // Two full runs.
  expect(points(['5D', '6D', '7D', '8D', '9D', '5D', '6D', '7D', '8D', '9D'])).toBe(50);
  const result = jokerCardPoints(['7D', '7H', '7C', '7S', '5D', '6D', '8D', '9D'], '7D');
  expect(result.parts.map(part => part.points).reduce((a, b) => a + b, 0)).toBe(27);
});

test('a copy played as itself breaks the pair: 6♦ ×3 with one 6♦ in a run is 6 + 2', () => {
  expect(jokerCardPoints(['6D', '6D', '6D'], '7D', { '6D': 1 }).points).toBe(8);
  expect(jokerCardPoints(['6D', '6D', '6D'], '7D', { '6D': 1 }).broken).toEqual(['6D']);
  expect(jokerCardPoints(['6D', '6D', '6D'], '7D').points).toBe(14);
});

test('a 0-value card played as itself earns nothing extra', () => {
  expect(jokerCardPoints(['5H', '5H', '5H'], '5S', { '5H': 1 }).points).toBe(0);
});

test('a natural four of the opened rank is not allowed, so the singles count', () => {
  // Unrestricted, the four 7s are 14. With one 7♣ played as itself they are singles: 7♥ 2 + 7♣ 0 + 7♠ 0 + 7♦ 4.
  expect(points(['7H', '7C', '7S', '7D'])).toBe(14);
  expect(jokerCardPoints(['7H', '7C', '7S', '7D'], '7D', { '7C': 1 }).points).toBe(6);
});

test('the opened run takes natural copies, so they do not break it', () => {
  // 5♦ 6♦ 7♦ 8♦ 9♦ is the run (25) and takes the natural 6♦; the spare 6♦ is a single (2).
  const cards = ['5D', '6D', '7D', '8D', '9D', '6D'];
  expect(jokerCardPoints(cards, '7D', { '6D': 1 }).points).toBe(25 + 2);
  expect(jokerCardPoints(cards, '7D', { '6D': 1 }).broken).toEqual([]);
});

test('pure triple points', () => {
  expect([0, 1, 2, 3, 4, 5, 6].map(triplePoints)).toEqual([0, 2, 6, 14, 20, 25, 25]);
});
