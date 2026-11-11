import { DECKS, HAND_SIZE, PRINTED_JOKER, SUITS, cardCode, parseCard, RANKS } from './cards';
import { scoreHand } from './hand';

export function maxCopies(code, openCard) {
  return code === openCard ? DECKS - 1 : DECKS;
}

function sortKey(code) {
  if (code === PRINTED_JOKER) return 1000;
  const card = parseCard(code);
  return SUITS.indexOf(card.suit) * 13 + card.rank;
}

export function sortCards(cards) {
  return [...(cards || [])].sort((a, b) => sortKey(a) - sortKey(b));
}

export function addCard(cards, code, openCard) {
  const list = cards || [];
  if (list.length >= HAND_SIZE) return list;
  if (list.filter(item => item === code).length >= maxCopies(code, openCard)) return list;
  return sortCards([...list, code]);
}

export function removeCard(cards, code) {
  const list = [...(cards || [])];
  const index = list.lastIndexOf(code);
  if (index >= 0) list.splice(index, 1);
  return list;
}

export function openCardOptions() {
  return SUITS.flatMap(suit => RANKS.map((_, index) => cardCode(index + 1, suit)));
}

export function isRedCode(code) {
  const card = parseCard(code);
  return Boolean(card && (card.suit === 'H' || card.suit === 'D'));
}

const cache = new Map();
const CACHE_LIMIT = 200;

// Scores a full hand once per (cards, opened card); returns null until the hand is complete.
export function scoreHandCached(cards, openCard) {
  if (!openCard || !cards || cards.length !== HAND_SIZE) return null;
  const key = `${openCard}|${sortCards(cards).join(',')}`;
  if (cache.has(key)) return cache.get(key);
  const result = scoreHand(cards, openCard);
  if (cache.size >= CACHE_LIMIT) cache.delete(cache.keys().next().value);
  cache.set(key, result);
  return result;
}
