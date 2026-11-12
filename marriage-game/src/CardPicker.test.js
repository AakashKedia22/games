import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { CardPicker, HandSummary } from './CardPicker';
import { PhotoReview } from './PhotoReview';
import { scoreCommitted, scoreHand, scoreNotCommitted } from './hand';
import { prepareUpload, startReview } from './recognition';

const D10 = ['2S', '2S', '3H', '3H', '4C', '4C', '5S', '5S', '9H', '9H', '10C', '10C', 'JS', 'JS', 'QH', 'QH', 'KC', 'KC',
  'AS', 'AS', '2C', '6C', '9C', 'KH', '8S', '10S', '3D', 'JD', 'AH', '4D'];
const DJK = ['2S', '2S', '3H', '3H', '4C', '4C', '9H', '9H', '10C', '10C', 'JS', 'JS', 'KC', 'KC', 'JK', 'JK', '2C', '6C', '9C',
  'KH', '8S', '10S', '3D', 'JD', 'AH', '4D', '10D', '6H', 'QC', '5S'];

const card = (index, code, confidence = 0.95) => ({ id: `abc-${index}`, code, confidence, alternatives: [], thumb: '' });

function mockFetch(cards) {
  global.fetch = jest.fn(async url => ({
    ok: true,
    status: 200,
    json: async () => (String(url).endsWith('/api/recognize') ? { cards } : { saved: cards.length })
  }));
}

async function photograph(player = 'Asha') {
  const file = new File(['x'], 'hand.jpg', { type: 'image/jpeg' });
  fireEvent.change(screen.getByLabelText(`Photo of ${player}'s cards`), { target: { files: [file] } });
  await screen.findByText(/^Found/);
}

afterEach(() => { delete global.fetch; });

test('using the photo cards respects the copy limit and the hand size', async () => {
  // 4 x 7D (only 3 decks; one is the open card) plus 28 other cards = 32 detections.
  const codes = ['7D', '7D', '7D', '7D'];
  ['S', 'H', 'C'].forEach(suit => ['A', '2', '3', '4', '5', '6', '7', '8', '9', '10'].forEach(rank => codes.push(rank + suit)));
  mockFetch(codes.slice(0, 32).map((code, index) => card(index, code)));
  const onChange = jest.fn();
  render(<CardPicker player="Asha" cards={[]} openCard="7D" onChange={onChange} />);
  await photograph();
  expect(screen.getByText('Over the copy limit (3 of each card, 2 of the opened card): 7♦ 7♦')).toBeInTheDocument();
  fireEvent.click(screen.getByRole('button', { name: /^Use 30 cards/ }));
  const hand = onChange.mock.calls[0][0];
  expect(hand).toHaveLength(30);
  expect(hand.filter(code => code === '7D')).toHaveLength(2);
  await waitFor(() => expect(global.fetch).toHaveBeenCalledTimes(2)); // photo, then the kept samples
});

test('a photo whose cards are all at the edge says how many were ignored', async () => {
  global.fetch = jest.fn(async () => ({ ok: true, status: 200, json: async () => ({ cards: [], ignoredAtEdge: 2 }) }));
  render(<CardPicker player="Asha" cards={[]} openCard="7D" onChange={() => {}} />);
  fireEvent.change(screen.getByLabelText("Photo of Asha's cards"), { target: { files: [new File(['x'], 'a.jpg', { type: 'image/jpeg' })] } });
  expect(await screen.findByRole('alert')).toHaveTextContent('2 at the edge');
});

test('a card with an unknown code opens the chooser without crashing', () => {
  const review = startReview([{ id: 'a-0', code: 'ZZ', confidence: 0.9 }, { id: 'a-1', code: 'AS', confidence: 0.9 }]);
  render(<PhotoReview review={review} openCard="7D" onChange={() => {}} onUse={() => {}} onCancel={() => {}}
    keepSamples onKeepSamplesChange={() => {}} />);
  fireEvent.click(screen.getByRole('button', { name: 'Unknown card, tap to change' }));
  expect(screen.getByRole('button', { name: 'Change to A♠' })).toBeInTheDocument();
  expect(screen.getByText(/1 to check/)).toBeInTheDocument();
});

test('cancelling the check screen leaves the hand alone and nothing is saved', async () => {
  mockFetch([card(0, 'AS'), card(1, 'KH', 0.3)]);
  const onChange = jest.fn();
  render(<CardPicker player="Asha" cards={['2C']} openCard="7D" onChange={onChange} />);
  await photograph();
  expect(screen.getByText(/1 to check/)).toBeInTheDocument();
  fireEvent.click(screen.getByRole('button', { name: 'Cancel' }));
  expect(onChange).not.toHaveBeenCalled();
  expect(global.fetch).toHaveBeenCalledTimes(1);
  expect(screen.getByText('1/30 cards')).toBeInTheDocument();
});

test('no cards found and a failed upload show a message, not the check screen', async () => {
  mockFetch([]);
  render(<CardPicker player="Asha" cards={[]} openCard="7D" onChange={() => {}} />);
  fireEvent.change(screen.getByLabelText("Photo of Asha's cards"), { target: { files: [new File(['x'], 'a.jpg', { type: 'image/jpeg' })] } });
  expect(await screen.findByRole('alert')).toHaveTextContent('No cards found');
  global.fetch = jest.fn(async () => ({ ok: false, status: 503, json: async () => ({ error: 'Card recognition is not set up' }) }));
  fireEvent.change(screen.getByLabelText("Photo of Asha's cards"), { target: { files: [new File(['x'], 'a.jpg', { type: 'image/jpeg' })] } });
  await waitFor(() => expect(screen.getByRole('alert')).toHaveTextContent('not set up'));
});

test('prepareUpload falls back to the original file when the browser cannot decode it (HEIC)', async () => {
  const heic = new File(['x'], 'IMG.HEIC', { type: 'image/heic' });
  global.createImageBitmap = async () => { throw new Error('unsupported'); };
  expect(await prepareUpload(heic)).toBe(heic);
  global.createImageBitmap = async () => ({ width: 6000, height: 4000 });
  const drawn = [];
  const realCreate = document.createElement.bind(document);
  jest.spyOn(document, 'createElement').mockImplementation(tag => {
    if (tag !== 'canvas') return realCreate(tag);
    return { getContext: () => ({ drawImage: (...args) => drawn.push(args) }), toBlob: callback => callback(null) };
  });
  expect(await prepareUpload(heic)).toBe(heic); // toBlob gave nothing: still falls back
  expect(drawn[0].slice(3)).toEqual([3000, 2000]); // downscaled to 3000 px on the long side
  document.createElement.mockRestore();
  delete global.createImageBitmap;
});

test('the summary names a closed doublets hand', () => {
  render(<HandSummary result={scoreHand(D10, '7D', 4)} />);
  expect(screen.getByText('Closed · 10 doublets · Hath 0 · Joker 0')).toBeInTheDocument();
});

test('the summary marks a packed, not committed hand', () => {
  render(<HandSummary result={scoreHand(DJK, '7D', 4)} isPacked />);
  expect(screen.getByText('Packed · Not committed · Hath 10 · Joker 6')).toBeInTheDocument();
});

const S = text => text.split(' ');
const CA = S('6H 7H 8H 8H 9H 10H AH 2H 3H 4H 8S 9S 10S 2C 2C 2C');
const USER = S('AS 2S 3S 6S 6S 8S 9S 10S AH 2H 3H 4H 4H 6H 7H 8H 8H 9H 10H 2D 2D 5D 6D 8D 9D 2C 2C 2C 9C 10C');
const minus = (a, b) => {
  const left = [...a];
  b.forEach(code => { const at = left.indexOf(code); if (at >= 0) left.splice(at, 1); });
  return left;
};

test('the summary of a committed hand shows the locked groups, then the Bandh', () => {
  render(<HandSummary result={scoreCommitted(CA, minus(USER, CA), '5S', 4)} />);
  expect(screen.getByText('Committed · Hath 1 · Joker 10')).toBeInTheDocument();
  expect(screen.getByText('Shown (locked)')).toBeInTheDocument();
  expect(screen.getByText('Bandh')).toBeInTheDocument();
  expect(screen.getByText(/Left over \(8 → Hath 1\)/)).toBeInTheDocument();
});

test('the summary of a not committed hand shows the hint and the old 30-card score', () => {
  render(<HandSummary result={scoreNotCommitted(USER, '5S', 4)} legacyResult={scoreHand(USER, '5S', 4)} hint />);
  expect(screen.getByText(/old 30-card search gave Hath 0 · Joker 10/)).toBeInTheDocument();
  expect(screen.getByText(/hold 5 pure sequences/)).toBeInTheDocument();
});
