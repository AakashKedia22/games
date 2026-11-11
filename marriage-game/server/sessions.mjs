import fs from 'node:fs';
import path from 'node:path';

export const DEFAULT_PLAYERS = ['Aakash', 'Shreya', 'Aryan', 'Paa'];
// Keep in sync with DEFAULT_SETTINGS in src/scoring.js
export const DEFAULT_SETTINGS = {};
export const MAX_UNDO = 20;
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
    undo: [],
    updatedAt: Date.now(),
    clients: []
  };
}

export function snapshot(session) {
  return clone({ players: session.players, settings: session.settings, rounds: session.rounds });
}

export function publicState(session) {
  return {
    players: session.players,
    settings: session.settings,
    rounds: session.rounds,
    canUndo: session.undo.length > 0
  };
}

export function applyUpdate(session, state) {
  if (!isValidGameState(state)) return false;
  session.undo.push(snapshot(session));
  if (session.undo.length > MAX_UNDO) session.undo.shift();
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
      undo: Array.isArray(stored.undo) ? stored.undo.filter(isValidGameState).slice(-MAX_UNDO) : [],
      updatedAt: Number(stored.updatedAt) || Date.now(),
      clients: []
    };
  }
  return sessions;
}
