import fs from 'node:fs';
import path from 'node:path';

export const DEFAULT_PLAYERS = ['Aakash', 'Shreya', 'Aryan', 'Paa'];
// Keep in sync with DEFAULT_SETTINGS in src/scoring.js
export const DEFAULT_SETTINGS = {};
export const MAX_UNDO = 20;
export const MAX_GAMES = 200;
const CODE_PATTERN = /^MG-\d{4}$/;

const clone = value => JSON.parse(JSON.stringify(value));

export function isValidGameState(state) {
  return Boolean(state) &&
    Array.isArray(state.players) && (state.players.length === 3 || state.players.length === 4) &&
    state.players.every(player => typeof player === 'string' && player.trim() !== '' && player.length <= 20) &&
    Boolean(state.settings) && typeof state.settings === 'object' && !Array.isArray(state.settings) &&
    Array.isArray(state.rounds) && state.rounds.length <= 500 &&
    state.rounds.every(round => round && Array.isArray(round.entries));
}

const CARD_CODE = /^(?:(?:A|[2-9]|10|J|Q|K)[SHDC]|JK)$/;
const isCardList = (list, max) => Array.isArray(list) && list.length <= max && list.every(code => typeof code === 'string' && CARD_CODE.test(code));

// Optional card fields on a round entry (v4a cards, v4f commitCards/committed).
// A hand is dealt from 3 decks: at most 3 of any card, and 2 of the round's opened card.
function withinCopies(entry, openCard) {
  const counts = {};
  [...(entry.cards || []), ...(entry.commitCards || [])].forEach(code => { counts[code] = (counts[code] || 0) + 1; });
  return Object.keys(counts).every(code => counts[code] <= (code === openCard ? 2 : 3));
}

export function isValidEntryCards(entry, openCard) {
  if (!entry || typeof entry !== 'object') return false;
  if (entry.cards !== undefined && !isCardList(entry.cards, 30)) return false;
  if (entry.commitCards !== undefined && !isCardList(entry.commitCards, 25)) return false;
  if (entry.committed !== undefined && typeof entry.committed !== 'boolean') return false;
  if (entry.commitCards !== undefined && entry.committed !== true) return false;
  return (entry.cards || []).length + (entry.commitCards || []).length <= 30 && withinCopies(entry, openCard);
}

export function hasValidCards(state) {
  return state.rounds.every(round => round.entries.every(entry => isValidEntryCards(entry, round.openCard)));
}

export function isValidArchivedGame(game) {
  return Boolean(game) && Number.isFinite(game.finishedAt) &&
    isValidGameState({ players: game.players, settings: {}, rounds: game.rounds }) &&
    game.rounds.length > 0;
}

export function generateCode(sessions, random = Math.random) {
  let code;
  do {
    code = `MG-${Math.floor(1000 + random() * 9000)}`;
  } while (sessions[code]);
  return code;
}

export function createSession() {
  return {
    players: [...DEFAULT_PLAYERS],
    settings: { ...DEFAULT_SETTINGS },
    rounds: [],
    games: [],
    undo: [],
    updatedAt: Date.now(),
    clients: []
  };
}

export function snapshot(session) {
  return clone({ players: session.players, settings: session.settings, rounds: session.rounds, games: session.games });
}

export function publicState(session) {
  return {
    players: session.players,
    settings: session.settings,
    rounds: session.rounds,
    games: session.games,
    canUndo: session.undo.length > 0
  };
}

function pushUndo(session) {
  session.undo.push(snapshot(session));
  if (session.undo.length > MAX_UNDO) session.undo.shift();
}

export function applyUpdate(session, state) {
  if (!isValidGameState(state) || !hasValidCards(state)) return false;
  pushUndo(session);
  const next = clone({ players: state.players, settings: state.settings, rounds: state.rounds });
  session.players = next.players;
  session.settings = next.settings;
  session.rounds = next.rounds;
  session.updatedAt = Date.now();
  return true;
}

export function applyUndo(session) {
  if (!session.undo.length) return false;
  const previous = session.undo.pop();
  session.players = previous.players;
  session.settings = previous.settings;
  session.rounds = previous.rounds;
  if (Array.isArray(previous.games)) session.games = previous.games;
  session.updatedAt = Date.now();
  return true;
}

// Archive the current game and start a fresh one with the same players.
export function finishGame(session, now = Date.now()) {
  if (!session.rounds.length) return false;
  pushUndo(session);
  const game = clone({ finishedAt: now, players: session.players, rounds: session.rounds });
  session.games = [...session.games, game].slice(-MAX_GAMES);
  session.rounds = [];
  session.updatedAt = now;
  return true;
}

export function deleteGame(session, index) {
  if (!Number.isInteger(index) || index < 0 || index >= session.games.length) return false;
  pushUndo(session);
  session.games = session.games.filter((_, i) => i !== index);
  session.updatedAt = Date.now();
  return true;
}

export function serializeSessions(sessions) {
  const output = {};
  for (const [code, session] of Object.entries(sessions)) {
    output[code] = {
      players: session.players,
      settings: session.settings,
      rounds: session.rounds,
      games: session.games,
      undo: session.undo,
      updatedAt: session.updatedAt
    };
  }
  return output;
}

export function saveSessions(filePath, sessions) {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  const tempPath = `${filePath}.tmp`;
  fs.writeFileSync(tempPath, JSON.stringify(serializeSessions(sessions), null, 2));
  fs.renameSync(tempPath, filePath);
}

export function loadSessions(filePath) {
  let raw;
  try {
    raw = JSON.parse(fs.readFileSync(filePath, 'utf8'));
  } catch {
    return {};
  }
  const sessions = {};
  if (!raw || typeof raw !== 'object') return sessions;
  for (const [code, stored] of Object.entries(raw)) {
    if (!CODE_PATTERN.test(code) || !isValidGameState(stored)) continue;
    sessions[code] = {
      players: stored.players,
      settings: stored.settings,
      rounds: stored.rounds,
      games: Array.isArray(stored.games) ? stored.games.filter(isValidArchivedGame).slice(-MAX_GAMES) : [],
      undo: Array.isArray(stored.undo) ? stored.undo.filter(isValidGameState).slice(-MAX_UNDO) : [],
      updatedAt: Number(stored.updatedAt) || Date.now(),
      clients: []
    };
  }
  return sessions;
}
