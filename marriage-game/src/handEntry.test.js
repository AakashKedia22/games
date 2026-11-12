import {
  addCard, commitHint, entryCardFields, entryCardState, handFill, handHathBack, isRedCode, maxCopies, openCardOptions,
  removeCard, scoreEntryCached, scoreHandCached, sortCards
} from './handEntry';

const FIVE = '2S 3S 4S 9H 10H JH 2C 3C 4C 10D JD QD 9C 10C JC'.split(' ');
const CA = '6H 7H 8H 8H 9H 10H AH 2H 3H 4H 8S 9S 10S 2C 2C 2C'.split(' ');
const USER = 'AS 2S 3S 6S 6S 8S 9S 10S AH 2H 3H 4H 4H 6H 7H 8H 8H 9H 10H 2D 2D 5D 6D 8D 9D 2C 2C 2C 9C 10C'.split(' ');
const minus = (a, b) => {
  const left = [...a];
  b.forEach(code => { const at = left.indexOf(code); if (at >= 0) left.splice(at, 1); });
  return left;
};

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

test('sortCards puts unknown codes last instead of crashing', () => {
  expect(sortCards(['XX', 'JK', '2S'])).toEqual(['2S', 'JK', 'XX']);
  expect(sortCards([undefined, '2S'])).toEqual(['2S', undefined]);
});

test('handFill fills the boxes from a scored hand', () => {
  expect(handFill({ hath: 3, jokerPoints: 14 }, { hath: '', joker: '' })).toEqual({
    hath: '3', joker: '14', filled: { hath: '3', joker: '14' }
  });
});

test('handFill clears the values the cards put in when the hand cannot be scored', () => {
  expect(handFill(null, { hath: '3', joker: '14' }, { hath: '3', joker: '14' })).toEqual({
    hath: '', joker: '', filled: undefined
  });
  expect(handFill({ error: 'x' }, { hath: '5', joker: '14' }, { hath: '3', joker: '14' })).toEqual({
    hath: '5', joker: '', filled: undefined
  });
  expect(handFill(null, { hath: '5', joker: '2' }, undefined)).toEqual({
    hath: '5', joker: '2', filled: undefined
  });
});

test('scoreHandCached keeps the 3-player and 4-player results apart', () => {
  const D10 = ['2S', '2S', '3H', '3H', '4C', '4C', '5S', '5S', '9H', '9H', '10C', '10C', 'JS', 'JS', 'QH', 'QH', 'KC', 'KC',
    'AS', 'AS', '2C', '6C', '9C', 'KH', '8S', '10S', '3D', 'JD', 'AH', '4D'];
  expect(scoreHandCached(D10, '7D', 4).closed).toBe(true);
  expect(scoreHandCached(D10, '7D', 3).closed).toBe(false);
});

test('handHathBack restores only the Hath box and keeps a typed Joker value', () => {
  expect(handHathBack({ hath: 3, jokerPoints: 14 }, { hath: '3', joker: '14' })).toEqual({
    hath: '3', filled: { hath: '3', joker: '14' }
  });
  expect(handHathBack({ hath: 3, jokerPoints: 14 }, undefined)).toEqual({ hath: '3', filled: { hath: '3', joker: '' } });
  expect(handHathBack(null, { hath: '3', joker: '14' })).toBeNull();
  expect(handHathBack({ error: 'x' }, undefined)).toBeNull();
});

test('addCard respects a smaller limit and counts the other list for copies', () => {
  expect(addCard([], '9C', '7D', { otherCards: ['9C', '9C', '9C'] })).toEqual([]);
  const full = ['2S'];
  expect(addCard(full, '3S', '7D', { limit: 1 })).toBe(full);
});

test('entryCardFields saves the committed fields, or the cards of an un-ticked player', () => {
  expect(entryCardFields({ commitCards: ['3S', '2S'], cards: ['KH'], committed: true }))
    .toEqual({ committed: true, commitCards: ['2S', '3S'], cards: ['KH'] });
  expect(entryCardFields({ commitCards: ['3S'], cards: ['2S'], committed: false })).toEqual({ committed: false, cards: ['2S', '3S'] });
  expect(entryCardFields({})).toEqual({});
});

test('entryCardState reads legacy entries as un-ticked, and saved entries as they were stored', () => {
  expect(entryCardState({ cards: USER })).toEqual({ commitCards: [], cards: USER, committed: false, legacy: true });
  expect(entryCardState({ committed: false, cards: USER })).toMatchObject({ legacy: false });
  expect(entryCardState({ committed: true, commitCards: CA, cards: minus(USER, CA) }))
    .toEqual({ commitCards: CA, cards: minus(USER, CA), committed: true, legacy: false });
  expect(entryCardState({ hath: 3 })).toEqual({ commitCards: [], cards: [], committed: false, legacy: false });
});

test('scoreEntryCached scores a committed entry once, and returns null until 30 cards', () => {
  const entry = { commitCards: CA, cards: minus(USER, CA), committed: true };
  const first = scoreEntryCached(entry, '5S', 4);
  expect(first).toMatchObject({ hath: 1, jokerPoints: 10 });
  expect(scoreEntryCached(entry, '5S', 4)).toBe(first);
  expect(scoreEntryCached({ ...entry, committed: false }, '5S', 4)).toMatchObject({ hath: 10 });
  expect(scoreEntryCached({ commitCards: CA, cards: minus(USER, CA).slice(1), committed: true }, '5S', 4)).toBeNull();
  expect(scoreEntryCached(entry, '', 4)).toBeNull();
});

test('commitHint: a full un-ticked hand that holds five sequences, and nothing else', () => {
  expect(commitHint({ cards: USER }, 4)).toBe(true);
  expect(commitHint({ commitCards: CA, cards: minus(USER, CA), committed: true }, 4)).toBe(false);
  expect(commitHint({ cards: USER.slice(1) }, 4)).toBe(false);
  expect(commitHint({ cards: FIVE.slice(0, 12) }, 4)).toBe(false);
});
