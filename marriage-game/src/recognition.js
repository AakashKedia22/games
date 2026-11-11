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
  return Array.isArray(data.cards) ? data.cards : [];
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

export function startReview(cards) {
  return { cards: cards.map(card => ({ ...card, chosen: card.code, confirmed: false, removed: false })) };
}

const updateCard = (review, id, change) => ({
  cards: review.cards.map(card => (card.id === id ? { ...card, ...change(card) } : card))
});

export function setChoice(review, id, code) {
  return updateCard(review, id, () => ({ chosen: code, confirmed: true, removed: false }));
}

export function toggleRemoved(review, id) {
  return updateCard(review, id, card => ({ removed: !card.removed, confirmed: true }));
}

export function needsCheck(card) {
  return !card.removed && !card.confirmed && card.confidence < LOW_CONFIDENCE;
}

export function reviewCards(review) {
  return review.cards.filter(card => !card.removed).map(card => card.chosen);
}

// Every kept card becomes a training sample with the label the player accepted.
export function reviewSamples(review) {
  return review.cards.filter(card => !card.removed).map(card => ({ id: card.id, code: card.chosen }));
}

export function reviewSummary(review) {
  return {
    found: review.cards.length,
    kept: review.cards.filter(card => !card.removed).length,
    toCheck: review.cards.filter(needsCheck).length
  };
}
