import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { CardPicker } from './CardPicker';
import { prepareUpload } from './recognition';

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
  fireEvent.click(screen.getByRole('button', { name: /^Use 32 cards/ }));
  const hand = onChange.mock.calls[0][0];
  expect(hand).toHaveLength(30);
  expect(hand.filter(code => code === '7D')).toHaveLength(2);
  await waitFor(() => expect(global.fetch).toHaveBeenCalledTimes(2)); // photo, then the kept samples
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
