import { addCard, isRedCode, maxCopies, openCardOptions, removeCard, scoreHandCached, sortCards } from './handEntry';

test('addCard sorts and respects copy limits', () => {
  let cards = [];
  cards = addCard(cards, 'KS', '7D');
  cards = addCard(cards, '2S', '7D');
  cards = addCard(cards, 'JK', '7D');
  cards = addCard(cards, 'AH', '7D');
  expect(cards).toEqual(['2S', 'KS', 'AH', 'JK']);
  cards = addCard(addCard(addCard(cards, '5C', '7D'), '5C', '7D'), '5C', '7D');
  expect(addCard(cards, '5C', '7D')).toBe(cards);
  const opened = addCard(addCard([], '7D', '7D'), '7D', '7D');
  expect(addCard(opened, '7D', '7D')).toBe(opened);
  expect(maxCopies('7D', '7D')).toBe(2);
  expect(maxCopies('7H', '7D')).toBe(3);
});

test('addCard stops at 30 cards', () => {
  const full = Array(30).fill('2S');
  expect(addCard(full, '3S', '7D')).toBe(full);
});

test('removeCard removes one copy', () => {
  expect(removeCard(['2S', '2S', 'JK'], '2S')).toEqual(['2S', 'JK']);
  expect(removeCard(['2S'], 'KH')).toEqual(['2S']);
});

test('helpers', () => {
  expect(sortCards(['JK', 'AC', 'AS', '10D'])).toEqual(['AS', '10D', 'AC', 'JK']);
  expect(openCardOptions()).toHaveLength(52);
  expect(isRedCode('7D')).toBe(true);
  expect(isRedCode('7S')).toBe(false);
  expect(isRedCode('JK')).toBe(false);
});

test('scoreHandCached only scores complete hands and caches results', () => {
  expect(scoreHandCached(['2S'], '7D')).toBeNull();
  const hand = ['2S', '3S', '4S', '5S', '6S', '10H', 'JH', 'QH', 'KH', '10C', 'JC', 'QC', 'KC', '2D', '3D', '4D',
    'JD', 'QD', 'KD', 'AD', '2H', 'AS', 'QS', '5C', '6C', '9H', '9C', 'JK', 'JK', 'JK'];
  expect(scoreHandCached(hand, '')).toBeNull();
  const first = scoreHandCached(hand, '7D');
  expect(first.hath).toBe(0);
  expect(first.jokerPoints).toBe(14);
  expect(scoreHandCached([...hand].reverse(), '7D')).toBe(first);
});
