import {
  LOW_CONFIDENCE, apiBase, droppedLines, needsCheck, photoCardsPlan, recognizePhoto, reviewCards, reviewSamples,
  reviewSummary, saveTrainingSamples, setChoice, startReview, toggleRemoved
} from './recognition';

const CARDS = [
  { id: 'abc-0', code: '7D', confidence: 0.98, alternatives: [], thumb: '' },
  { id: 'abc-1', code: '8D', confidence: 0.41, alternatives: [{ code: '6D', confidence: 0.3 }], thumb: '' },
  { id: 'abc-2', code: 'JK', confidence: 0.9, alternatives: [], thumb: '' }
];

const reply = (status, body) => async () => ({ ok: status < 400, status, json: async () => body });

test('apiBase turns the WebSocket address into the HTTP origin', () => {
  expect(apiBase('ws://192.168.1.5:3001')).toBe('http://192.168.1.5:3001');
  expect(apiBase('wss://cards.example:8443/socket')).toBe('https://cards.example:8443');
});

test('recognizePhoto posts the photo and returns the cards', async () => {
  const calls = [];
  const fetchFn = async (url, options) => { calls.push({ url, options }); return reply(200, { cards: CARDS })(); };
  const photo = { type: 'image/jpeg' };
  expect(await recognizePhoto(photo, 'http://host:3001', fetchFn)).toEqual({ cards: CARDS, ignoredAtEdge: 0 });
  expect(calls[0].url).toBe('http://host:3001/api/recognize');
  expect(calls[0].options).toEqual({ method: 'POST', headers: { 'Content-Type': 'image/jpeg' }, body: photo });
  expect(await recognizePhoto({ type: '' }, 'http://h', reply(200, { ignoredAtEdge: 3 }))).toEqual({ cards: [], ignoredAtEdge: 3 });
});

test('recognizePhoto reports the server message on failure', async () => {
  await expect(recognizePhoto({ type: '' }, 'http://h', reply(503, { error: 'Card recognition is not set up' })))
    .rejects.toThrow('Card recognition is not set up');
  await expect(recognizePhoto({ type: '' }, 'http://h', async () => ({ ok: false, status: 502, json: async () => { throw new Error('html'); } })))
    .rejects.toThrow('Card recognition failed (502).');
});

test('saveTrainingSamples is best effort', async () => {
  expect(await saveTrainingSamples([], 'http://h', reply(200, { saved: 9 }))).toBe(0);
  expect(await saveTrainingSamples([{ id: 'a-0', code: 'AS' }], 'http://h', reply(200, { saved: 1 }))).toBe(1);
  expect(await saveTrainingSamples([{ id: 'a-0', code: 'AS' }], 'http://h', async () => { throw new Error('offline'); })).toBe(0);
});

test('review: low-confidence cards need a check until the player decides', () => {
  let review = startReview(CARDS);
  expect(LOW_CONFIDENCE).toBe(0.6);
  expect(review.cards.map(needsCheck)).toEqual([false, true, false]);
  expect(reviewSummary(review)).toEqual({ found: 3, kept: 3, toCheck: 1 });

  review = setChoice(review, 'abc-1', '6D');
  expect(reviewCards(review)).toEqual(['7D', '6D', 'JK']);
  expect(reviewSummary(review).toCheck).toBe(0);

  review = toggleRemoved(review, 'abc-2');
  expect(reviewCards(review)).toEqual(['7D', '6D']);
  expect(reviewSamples(review)).toEqual([{ id: 'abc-0', code: '7D' }, { id: 'abc-1', code: '6D' }]);
  expect(reviewSummary(review)).toEqual({ found: 3, kept: 2, toCheck: 0 });

  review = toggleRemoved(review, 'abc-2');
  expect(reviewCards(review)).toEqual(['7D', '6D', 'JK']);
});

test('review: a card the recognizer flags needs a check even when it is sure of the code', () => {
  let review = startReview([{ id: 'k-0', code: '9D', confidence: 0.95, check: true }, { id: 'k-1', code: 'AS', confidence: 0.95 }]);
  expect(review.cards[0].check).toBe(true);
  expect(review.cards[1].check).toBe(false);
  expect(review.cards.map(needsCheck)).toEqual([true, false]);
  review = setChoice(review, 'k-0', '9D');
  expect(review.cards.map(needsCheck)).toEqual([false, false]);
});

test('review: an unknown code is never an alternative and always needs a check', () => {
  const review = startReview([{ id: 'a-0', code: 'ZZ', confidence: 0.9 }, { id: 'a-1', code: 'AS', confidence: 0.9 }]);
  expect(review.cards[0].alternatives).toEqual([]);
  expect(review.cards.map(needsCheck)).toEqual([true, false]);
  expect(reviewSamples(review)).toEqual([{ id: 'a-1', code: 'AS' }]);
});

test('review: a card with missing fields gets safe defaults', () => {
  const card = startReview([{ id: 'b-0' }]).cards[0];
  expect(card.code).toBe('');
  expect(card.confidence).toBe(0);
});

test('review: setChoice keeps the edge count', () => {
  const review = startReview([{ id: 'c-0', code: 'AS', confidence: 0.9 }], 2);
  expect(setChoice(review, 'c-0', 'KS').ignoredAtEdge).toBe(2);
});

test('the cards used are capped at 30 with copy limits, and every drop is listed', () => {
  const codes = ['7D', '7D', '7D', '7D'];
  ['S', 'H', 'C'].forEach(suit => ['A', '2', '3', '4', '5', '6', '7', '8', '9', '10'].forEach(rank => codes.push(rank + suit)));
  const review = startReview(codes.map((code, index) => ({ id: `p-${index}`, code, confidence: 0.9 })));
  const plan = photoCardsPlan(review, '7D');
  expect(plan.cards).toHaveLength(30);
  expect(plan.dropped).toEqual([
    { code: '7D', reason: 'copies' }, { code: '7D', reason: 'copies' },
    { code: '9C', reason: 'full' }, { code: '10C', reason: 'full' }
  ]);
  expect(droppedLines(plan.dropped)).toEqual([
    'Over the copy limit (3 of each card, 2 of the opened card): 7♦ 7♦',
    'Over 30 cards: 9♣ 10♣'
  ]);
});

test('the cards used: printed jokers are capped at three', () => {
  const review = startReview(['JK', 'JK', 'JK', 'JK'].map((code, index) => ({ id: `j-${index}`, code, confidence: 0.9 })));
  const plan = photoCardsPlan(review, '7D');
  expect(plan.cards).toEqual(['JK', 'JK', 'JK']);
  expect(plan.dropped).toEqual([{ code: 'JK', reason: 'copies' }]);
});

test('the cards used: unknown codes are dropped and named', () => {
  expect(droppedLines(photoCardsPlan(startReview([{ id: 'u-0', code: 'ZZ', confidence: 0.9 }]), '7D').dropped))
    .toEqual(['Not a known card: ZZ']);
  expect(droppedLines(photoCardsPlan(startReview([{ id: 'u-1', code: '', confidence: 0.9 }]), '7D').dropped))
    .toEqual(['Not a known card: ?']);
});

test('the cards used: removed cards are not counted', () => {
  let review = startReview([{ id: 'r-0', code: 'AS', confidence: 0.9 }, { id: 'r-1', code: '2S', confidence: 0.9 }]);
  review = toggleRemoved(review, 'r-0');
  expect(photoCardsPlan(review, '7D').cards).toEqual(['2S']);
});

test('photoCardsPlan counts the other list for copies and stops at the list limit', () => {
  const review = startReview(['7D', '7D', 'AS'].map((code, i) => ({ id: `p-${i}`, code, confidence: 0.9 })));
  const plan = photoCardsPlan(review, '7D', { otherCards: ['7D'], limit: 1 });
  expect(plan.cards).toEqual(['7D']);
  expect(plan.dropped).toEqual([{ code: '7D', reason: 'copies' }, { code: 'AS', reason: 'full' }]);
});

test('droppedLines names the limit it was given', () => {
  expect(droppedLines([{ code: '2H', reason: 'full' }], 15)).toEqual(['Over 15 cards: 2♥']);
});
