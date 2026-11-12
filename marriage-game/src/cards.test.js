import { allCardCodes, cardValue, formatCard, parseCard, validateHand, validateOpenCard } from './cards';

test('parses card codes', () => {
  expect(parseCard('AS')).toEqual({ rank: 1, suit: 'S' });
  expect(parseCard('10H')).toEqual({ rank: 10, suit: 'H' });
  expect(parseCard('KD')).toEqual({ rank: 13, suit: 'D' });
  expect(parseCard('JK')).toEqual({ joker: true });
  expect(parseCard('1S')).toBeNull();
  expect(parseCard('11H')).toBeNull();
  expect(parseCard('7X')).toBeNull();
});

test('card values for Hath', () => {
  expect([1, 2, 7, 9, 10, 11, 12, 13].map(cardValue)).toEqual([10, 2, 7, 9, 10, 10, 10, 10]);
});

test('formats cards', () => {
  expect(formatCard('7D')).toBe('7♦');
  expect(formatCard('10S')).toBe('10♠');
  expect(formatCard('JK')).toBe('Joker');
  expect(allCardCodes()).toHaveLength(53);
});

test('validates the opened card and the hand', () => {
  expect(validateOpenCard('7D')).toBeNull();
  expect(validateOpenCard('JK')).toMatch(/redrawn/);
  expect(validateOpenCard('')).toMatch(/opened/);
  const hand = Array(10).fill(null).flatMap(() => ['2S', '3S', '4S']);
  expect(validateHand(hand.slice(0, 29), '7D')).toMatch(/30 cards; this one has 29/);
  expect(validateHand([...hand.slice(0, 27), '5S', '5S', 'ZZ'], '7D')).toMatch(/Unknown card: ZZ/);
  expect(validateHand(hand, '7D')).toMatch(/only 3 of 2♠/);
  const ok = ['AS', '2S', '3S', '4S', '5S', '6S', '8S', '9S', '10S', 'JS', 'QS', 'KS',
    'AH', '2H', '3H', '4H', '5H', '6H', '8H', '9H', '10H', 'JH', 'QH', 'KH', 'JK', 'JK', 'JK', '7D', '7D', '2C'];
  expect(validateHand(ok, '7D')).toBeNull();
  expect(validateHand([...ok.slice(0, 29), '7D'], '7D')).toMatch(/at most 2/);
});
