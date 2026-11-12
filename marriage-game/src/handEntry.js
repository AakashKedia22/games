import { DECKS, HAND_SIZE, PRINTED_JOKER, SUITS, cardCode, parseCard, RANKS } from './cards';
import { canCommitFrom, scoreCommitted, scoreHand, scoreNotCommitted } from './hand';

export const MAX_COMMIT_CARDS = 25;

export function maxCopies(code, openCard) {
  return code === openCard ? DECKS - 1 : DECKS;
}

function sortKey(code) {
  if (code === PRINTED_JOKER) return 1000;
  const card = parseCard(code);
  return card ? SUITS.indexOf(card.suit) * 13 + card.rank : 2000;
}

export function sortCards(cards) {
  return [...(cards || [])].sort((a, b) => sortKey(a) - sortKey(b));
}

// limit: the most cards this list may hold; otherCards: the player's other list (copy limits count both).
export function addCard(cards, code, openCard, { limit = HAND_SIZE, otherCards = [] } = {}) {
  const list = cards || [];
  if (list.length >= limit) return list;
  const held = list.filter(item => item === code).length + otherCards.filter(item => item === code).length;
  if (held >= maxCopies(code, openCard)) return list;
  return sortCards([...list, code]);
}

export const commitLimit = cards => Math.min(MAX_COMMIT_CARDS, HAND_SIZE - (cards || []).length);
export const restLimit = commitCards => HAND_SIZE - (commitCards || []).length;

// The card fields a draft entry saves. legacy: a saved pre-v4f entry re-saved with its cards untouched
// stays without a committed flag, so an old closer can still be re-saved.
export function entryCardFields({ commitCards = [], cards = [], committed = false, legacy = false }) {
  if (committed) return { committed: true, commitCards: sortCards(commitCards), cards: sortCards(cards) };
  const all = sortCards([...commitCards, ...cards]);
  if (legacy && !commitCards.length) return all.length ? { cards: all } : {};
  return all.length ? { committed: false, cards: all } : {};
}

// Form state from a saved entry. legacy = saved before v4f (cards with no committed flag).
export function entryCardState(entry) {
  if (entry && entry.committed === true && Array.isArray(entry.commitCards)) {
    return { commitCards: entry.commitCards, cards: Array.isArray(entry.cards) ? entry.cards : [], committed: true, legacy: false };
  }
  if (entry && Array.isArray(entry.cards)) {
    return { commitCards: [], cards: entry.cards, committed: false, legacy: entry.committed === undefined };
  }
  return { commitCards: [], cards: [], committed: false, legacy: false };
}

// After a player's cards or the opened card change: the boxes take the scored values, or, when the
// hand can no longer be scored, lose the values the cards put there (a value the player typed over stays).
// `filled` is what the cards last put in the boxes: { hath, joker } strings, or undefined.
export function handFill(result, boxes, filled) {
  if (result && !result.error) {
    const next = { hath: String(result.hath), joker: String(result.jokerPoints) };
    return { ...next, filled: next };
  }
  if (!filled) return { hath: boxes.hath, joker: boxes.joker, filled: undefined };
  return {
    hath: boxes.hath === filled.hath ? '' : boxes.hath,
    joker: boxes.joker === filled.joker ? '' : boxes.joker,
    filled: undefined
  };
}

// Un-ticking Bandh gives the Hath box back its scored value; a Joker value the player typed stays.
// Returns { hath, filled } or null when the cards cannot be scored.
export function handHathBack(result, filled) {
  if (!result || result.error) return null;
  const hath = String(result.hath);
  return { hath, filled: { hath, joker: filled ? filled.joker : '' } };
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

// Scores a full hand once per (cards, opened card, player count); returns null until the hand is complete.
export function scoreHandCached(cards, openCard, playerCount) {
  if (!openCard || !cards || cards.length !== HAND_SIZE) return null;
  const key = `${openCard}|${playerCount || ''}|${sortCards(cards).join(',')}`;
  if (cache.has(key)) return cache.get(key);
  const result = scoreHand(cards, openCard, playerCount);
  if (cache.size >= CACHE_LIMIT) cache.delete(cache.keys().next().value);
  cache.set(key, result);
  return result;
}

// Scores one player's entry once per (route, opened card, player count, cards); null until 30 cards and an opened card.
export function scoreEntryCached({ commitCards = [], cards = [], committed = false }, openCard, playerCount) {
  if (!openCard || commitCards.length + cards.length !== HAND_SIZE) return null;
  const key = committed
    ? `C|${openCard}|${playerCount || ''}|${sortCards(commitCards).join(',')}|${sortCards(cards).join(',')}`
    : `N|${openCard}|${playerCount || ''}|${sortCards([...commitCards, ...cards]).join(',')}`;
  if (cache.has(key)) return cache.get(key);
  const result = committed
    ? scoreCommitted(commitCards, cards, openCard, playerCount)
    : scoreNotCommitted([...commitCards, ...cards], openCard, playerCount);
  if (cache.size >= CACHE_LIMIT) cache.delete(cache.keys().next().value);
  cache.set(key, result);
  return result;
}

// True when an un-ticked player's 30 cards could have been committed (shown as a hint).
export function commitHint({ commitCards = [], cards = [], committed = false }, playerCount) {
  const all = [...commitCards, ...cards];
  return !committed && all.length === HAND_SIZE && canCommitFrom(all, playerCount);
}
