import {
  LOW_CONFIDENCE, apiBase, needsCheck, recognizePhoto, reviewCards, reviewSamples, reviewSummary,
  saveTrainingSamples, setChoice, startReview, toggleRemoved
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
  expect(await recognizePhoto(photo, 'http://host:3001', fetchFn)).toEqual(CARDS);
  expect(calls[0].url).toBe('http://host:3001/api/recognize');
  expect(calls[0].options).toEqual({ method: 'POST', headers: { 'Content-Type': 'image/jpeg' }, body: photo });
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
