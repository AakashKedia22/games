import { useState } from 'react';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { HandPanel } from './HandPanel';

const FIVE = '2S 3S 4S 9H 10H JH 2C 3C 4C 10D JD QD 9C 10C JC'.split(' ');

function Harness({ commit = [], rest = [], open = '7D' }) {
  const [commitCards, setCommit] = useState(commit);
  const [cards, setCards] = useState(rest);
  const [committed, setCommitted] = useState(false);
  return <HandPanel player="Asha" commitCards={commitCards} cards={cards} committed={committed} openCard={open} playerCount={4}
    onCommitCardsChange={setCommit} onCardsChange={setCards} onCommittedChange={setCommitted} />;
}
const tick = () => screen.getByRole('checkbox', { name: 'Asha committed' });

function mockFetch(cards) {
  global.fetch = jest.fn(async url => ({
    ok: true,
    status: 200,
    json: async () => (String(url).endsWith('/api/recognize') ? { cards } : { saved: cards.length })
  }));
}

afterEach(() => { delete global.fetch; });

test('T1: the tick stays disabled until the commit cards are a valid commit', () => {
  render(<Harness commit={FIVE.slice(0, 12)} />);
  expect(tick()).toBeDisabled();
  expect(screen.getByText('4 sequences, need 5 ✗')).toBeInTheDocument();
  fireEvent.click(screen.getByRole('tab', { name: '♣' }));
  fireEvent.click(screen.getByRole('button', { name: 'Add 9♣' }));
  fireEvent.click(screen.getByRole('button', { name: 'Add 10♣' }));
  expect(screen.getByText('4 sequences + 2 extra cards ✗')).toBeInTheDocument();
  expect(tick()).toBeDisabled();
  fireEvent.click(screen.getByRole('button', { name: 'Add J♣' }));
  expect(screen.getByText('5 pure sequences ✓')).toBeInTheDocument();
  expect(tick()).toBeEnabled();
});

test('T2: ticking locks the commit cards and opens the Bandh', () => {
  render(<Harness commit={FIVE} />);
  fireEvent.click(tick());
  expect(tick()).toBeChecked();
  expect(screen.getByRole('tab', { name: '2 · Bandh 0/15' })).toHaveAttribute('aria-selected', 'true');
  expect(screen.getByText('0/15 cards')).toBeInTheDocument();
  fireEvent.click(screen.getByRole('tab', { name: /^1 · Committed 15/ }));
  expect(screen.getByText('Locked. Untick Committed to change these cards.')).toBeInTheDocument();
  expect(screen.queryByRole('button', { name: /^Add / })).toBeNull();
  expect(screen.queryByRole('button', { name: 'Clear' })).toBeNull();
  expect(screen.queryByRole('button', { name: /^Remove / })).toBeNull();
  expect(screen.queryByLabelText("Photo of Asha's Bandh cards")).toBeNull();
});

test('T3: unticking unlocks the commit cards', () => {
  render(<Harness commit={FIVE} />);
  fireEvent.click(tick());
  fireEvent.click(screen.getByRole('tab', { name: /^1 · Committed 15/ }));
  fireEvent.click(tick());
  expect(tick()).not.toBeChecked();
  expect(screen.getByRole('tab', { name: /^1 · Committed 15/ })).toHaveAttribute('aria-selected', 'true');
  expect(screen.getByRole('button', { name: 'Add A♠' })).toBeEnabled();
  expect(screen.getByRole('button', { name: 'Clear' })).toBeEnabled();
});

test('T4: Clear empties the commit cards; on the Bandh tab it only clears the Bandh', () => {
  const { unmount } = render(<Harness commit={FIVE} />);
  fireEvent.click(screen.getByRole('button', { name: 'Clear' }));
  expect(screen.getByText('Enter the cards that were shown')).toBeInTheDocument();
  expect(tick()).toBeDisabled();
  expect(screen.getByRole('tab', { name: '1 · Committed 0' })).toBeInTheDocument();
  unmount();

  render(<Harness commit={FIVE} />);
  fireEvent.click(tick());
  fireEvent.click(screen.getByRole('button', { name: 'Add A♠' }));
  fireEvent.click(screen.getByRole('button', { name: 'Add 2♠' }));
  expect(screen.getByText('2/15 cards')).toBeInTheDocument();
  fireEvent.click(screen.getByRole('button', { name: 'Clear' }));
  expect(screen.getByText('0/15 cards')).toBeInTheDocument();
  expect(screen.getByRole('tab', { name: /^1 · Committed 15/ })).toBeInTheDocument();
  expect(tick()).toBeChecked();
});

test('T5: the copy limit counts both lists', () => {
  render(<Harness rest={['9C', '9C', '9C']} />);
  expect(screen.getByRole('tab', { name: 'All cards 3/30' })).toHaveAttribute('aria-selected', 'true');
  fireEvent.click(screen.getByRole('tab', { name: /^1 · Committed 0/ }));
  fireEvent.click(screen.getByRole('tab', { name: '♣' }));
  expect(screen.getByRole('button', { name: 'Add 9♣' })).toBeDisabled();
});

test('T6: a photo on the Bandh respects the copy limit of both lists and the 15-card limit', async () => {
  mockFetch(['7D', '7D', 'AS', '2S', '3S', '4S', '5S', '6S', '7S', '8S', '9S', '10S', 'JS', 'QS', 'KS', 'AH', '2H']
    .map((code, index) => ({ id: `abc-${index}`, code, confidence: 0.95, alternatives: [], thumb: '' })));
  render(<Harness commit={'6D 7D 8D 9H 10H JH 2C 3C 4C 10D JD QD 9C 10C JC'.split(' ')} open="7D" />);
  fireEvent.click(tick());
  const file = new File(['x'], 'hand.jpg', { type: 'image/jpeg' });
  fireEvent.change(screen.getByLabelText("Photo of Asha's Bandh cards"), { target: { files: [file] } });
  expect(await screen.findByText(/^Found/)).toBeInTheDocument();
  expect(screen.getByText('Over the copy limit (3 of each card, 2 of the opened card): 7♦')).toBeInTheDocument();
  expect(screen.getByText('Over 15 cards: 2♥')).toBeInTheDocument();
  fireEvent.click(screen.getByRole('button', { name: /^Use 15 cards/ }));
  await waitFor(() => expect(screen.getByText('15/15 cards')).toBeInTheDocument());
});
