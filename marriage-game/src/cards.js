// Card codes: rank + suit, e.g. 'AS', '10H', '7D', 'QC'. The printed joker is 'JK'.
export const SUITS = ['S', 'H', 'D', 'C'];
export const RANKS = ['A', '2', '3', '4', '5', '6', '7', '8', '9', '10', 'J', 'Q', 'K'];
export const SUIT_SYMBOLS = { S: '♠', H: '♥', D: '♦', C: '♣' };
export const SUIT_NAMES = { S: 'Spades', H: 'Hearts', D: 'Diamonds', C: 'Clubs' };
export const PRINTED_JOKER = 'JK';
export const HAND_SIZE = 30;
export const DECKS = 3;

export function isRed(suit) {
  return suit === 'H' || suit === 'D';
}

// rank is 1 (A) .. 13 (K)
export function cardCode(rank, suit) {
  return `${RANKS[rank - 1]}${suit}`;
}

export function parseCard(code) {
  if (code === PRINTED_JOKER) return { joker: true };
  if (typeof code !== 'string') return null;
  const match = /^(A|[2-9]|10|J|Q|K)([SHDC])$/.exec(code);
  if (!match) return null;
  return { rank: RANKS.indexOf(match[1]) + 1, suit: match[2] };
}

// Hath value: 2-10 at face value; J, Q, K and A count 10.
export function cardValue(rank) {
  return rank === 1 || rank >= 10 ? 10 : rank;
}

export function formatCard(code) {
  if (code === PRINTED_JOKER) return 'Joker';
  const card = parseCard(code);
  return card ? `${RANKS[card.rank - 1]}${SUIT_SYMBOLS[card.suit]}` : String(code);
}

export function allCardCodes() {
  const codes = [];
  SUITS.forEach(suit => RANKS.forEach((_, index) => codes.push(cardCode(index + 1, suit))));
  codes.push(PRINTED_JOKER);
  return codes;
}

export function countCards(cards) {
  const counts = {};
  (cards || []).forEach(code => { counts[code] = (counts[code] || 0) + 1; });
  return counts;
}

export function validateOpenCard(openCard) {
  const card = parseCard(openCard);
  if (!card || card.joker) return 'Pick the opened joker card (a printed joker is redrawn).';
  return null;
}

// Codes and copy limits only (any length).
export function validateCards(cards, openCard) {
  if (!Array.isArray(cards)) return 'Cards are missing.';
  const bad = cards.find(code => !parseCard(code));
  if (bad !== undefined) return `Unknown card: ${bad}.`;
  const counts = countCards(cards);
  const over = Object.keys(counts).find(code => counts[code] > DECKS);
  if (over) return `There are only ${DECKS} of ${formatCard(over)} in 3 decks.`;
  if (openCard && counts[openCard] > DECKS - 1) {
    return `${formatCard(openCard)} is the opened card, so a hand can hold at most ${DECKS - 1}.`;
  }
  return null;
}

export function validateHand(cards, openCard) {
  if (!Array.isArray(cards)) return 'Cards are missing.';
  if (cards.length !== HAND_SIZE) return `A hand has ${HAND_SIZE} cards; this one has ${cards.length}.`;
  return validateCards(cards, openCard);
}
