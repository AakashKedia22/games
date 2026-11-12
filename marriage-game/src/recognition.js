import { DECKS, HAND_SIZE, formatCard, parseCard } from './cards';
import { addCard, maxCopies } from './handEntry';

// Talks to the game server's card recognition (POST /api/recognize) and keeps
// the state of the "check the cards" screen.
export const LOW_CONFIDENCE = 0.6;
const MAX_UPLOAD_SIDE = 3000;

export function apiBase(wsUrl) {
  return new URL(wsUrl.replace(/^ws:/, 'http:').replace(/^wss:/, 'https:')).origin;
}

function defaultBase() {
  return apiBase(process.env.REACT_APP_WS_URL || `ws://${window.location.hostname}:3001`);
}

// Re-encode the photo as a JPEG no larger than 3000 px: turns iPhone HEIC photos
// into something the server can read and keeps uploads small. Falls back to the
// original file if the browser can't decode it.
export async function prepareUpload(file) {
  try {
    const bitmap = await createImageBitmap(file, { imageOrientation: 'from-image' });
    const scale = Math.min(1, MAX_UPLOAD_SIDE / Math.max(bitmap.width, bitmap.height));
    const canvas = document.createElement('canvas');
    canvas.width = Math.round(bitmap.width * scale);
    canvas.height = Math.round(bitmap.height * scale);
    canvas.getContext('2d').drawImage(bitmap, 0, 0, canvas.width, canvas.height);
    const blob = await new Promise(resolve => canvas.toBlob(resolve, 'image/jpeg', 0.9));
    return blob || file;
  } catch (error) {
    return file;
  }
}

export async function recognizePhoto(photo, base = defaultBase(), fetchFn = fetch) {
  const response = await fetchFn(`${base}/api/recognize`, {
    method: 'POST',
    headers: { 'Content-Type': photo.type || 'image/jpeg' },
    body: photo
  });
  let data = {};
  try {
    data = await response.json();
  } catch (error) {
    data = {};
  }
  if (!response.ok) throw new Error(data.error || `Card recognition failed (${response.status}).`);
  return {
    cards: Array.isArray(data.cards) ? data.cards : [],
    ignoredAtEdge: Number.isInteger(data.ignoredAtEdge) ? data.ignoredAtEdge : 0
  };
}

// Best effort: a failed save never blocks the player.
export async function saveTrainingSamples(samples, base = defaultBase(), fetchFn = fetch) {
  if (!samples.length) return 0;
  try {
    const response = await fetchFn(`${base}/api/training-samples`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ samples })
    });
    const data = await response.json();
    return response.ok ? data.saved || 0 : 0;
  } catch (error) {
    return 0;
  }
}

export function startReview(cards, ignoredAtEdge = 0) {
  return {
    ignoredAtEdge,
    cards: (cards || []).map(card => {
      const code = typeof card.code === 'string' ? card.code : '';
      return {
        ...card,
        code,
        confidence: Number.isFinite(card.confidence) ? card.confidence : 0,
        alternatives: Array.isArray(card.alternatives) ? card.alternatives.filter(item => item && typeof item.code === 'string') : [],
        check: card.check === true,
        chosen: code, confirmed: false, removed: false
      };
    })
  };
}

const updateCard = (review, id, change) => ({
  ...review,
  cards: review.cards.map(card => (card.id === id ? { ...card, ...change(card) } : card))
});

export function setChoice(review, id, code) {
  return updateCard(review, id, () => ({ chosen: code, confirmed: true, removed: false }));
}

export function toggleRemoved(review, id) {
  return updateCard(review, id, card => ({ removed: !card.removed, confirmed: true }));
}

// A card needs a look when the recognizer says so (overlap, a misread corner, a weak detection), when it is
// unsure of the code, or when the code is not a card at all, until the player decides.
export function needsCheck(card) {
  return !card.removed && !card.confirmed && (card.check === true || card.confidence < LOW_CONFIDENCE || !parseCard(card.chosen));
}

export function reviewCards(review) {
  return review.cards.filter(card => !card.removed).map(card => card.chosen);
}

// Every kept card becomes a training sample with the label the player accepted.
export function reviewSamples(review) {
  return review.cards.filter(card => !card.removed && parseCard(card.chosen)).map(card => ({ id: card.id, code: card.chosen }));
}

export function reviewSummary(review) {
  return {
    found: review.cards.length,
    kept: review.cards.filter(card => !card.removed).length,
    toCheck: review.cards.filter(needsCheck).length
  };
}

// What "Use cards" really adds: unknown codes, copies over the limit (3 decks; the opened card
// has one copy face up) and cards past 30 are dropped, in photo order.
// limit: the most cards this list may hold; otherCards: the player's other list (copy limits count both).
export function photoCardsPlan(review, openCard, { limit = HAND_SIZE, otherCards = [] } = {}) {
  let cards = [];
  const dropped = [];
  reviewCards(review).forEach(code => {
    if (!parseCard(code)) dropped.push({ code, reason: 'unknown' });
    else if (cards.filter(item => item === code).length + otherCards.filter(item => item === code).length >= maxCopies(code, openCard)) {
      dropped.push({ code, reason: 'copies' });
    } else if (cards.length >= limit) dropped.push({ code, reason: 'full' });
    else cards = addCard(cards, code, openCard, { limit, otherCards });
  });
  return { cards, dropped };
}

export function droppedLines(dropped, limit = HAND_SIZE) {
  const labels = {
    copies: `Over the copy limit (${DECKS} of each card, ${DECKS - 1} of the opened card)`,
    full: `Over ${limit} cards`,
    unknown: 'Not a known card'
  };
  return ['copies', 'full', 'unknown']
    .map(reason => ({ reason, codes: dropped.filter(item => item.reason === reason).map(item => item.code) }))
    .filter(group => group.codes.length)
    .map(group => `${labels[group.reason]}: ${group.codes.map(code => (parseCard(code) ? formatCard(code) : code || '?')).join(' ')}`);
}
