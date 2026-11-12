import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {
  MAX_GAMES, MAX_UNDO, applyUndo, applyUpdate, createSession, deleteGame, finishGame, generateCode,
  isValidArchivedGame, isValidEntryCards, isValidGameState, loadSessions, publicState, saveSessions
} from './sessions.mjs';

const SETTINGS = {};
const ROUND = { entries: [{ player: 'A', bandh: true, hath: 0, joker: 3 }, { player: 'B', bandh: false, hath: 5, joker: 0 }, { player: 'C', bandh: false, hath: 0, joker: 0 }] };
const state = rounds => ({ players: ['A', 'B', 'C'], settings: SETTINGS, rounds });

test('creates a session with defaults and nothing to undo', () => {
  const session = createSession();
  const view = publicState(session);
  assert.equal(view.players.length, 4);
  assert.deepEqual(view.settings, {});
  assert.deepEqual(view.rounds, []);
  assert.deepEqual(view.games, []);
  assert.equal(view.canUndo, false);
});

test('generateCode skips codes already in use', () => {
  const values = [0, 0.5];
  const code = generateCode({ 'MG-1000': {} }, () => values.shift());
  assert.equal(code, 'MG-5500');
});

test('applyUpdate stores state and applyUndo restores the previous state', () => {
  const session = createSession();
  assert.equal(applyUpdate(session, state([ROUND])), true);
  assert.deepEqual(session.rounds, [ROUND]);
  assert.equal(publicState(session).canUndo, true);
  assert.equal(applyUpdate(session, state([ROUND, ROUND])), true);
  assert.equal(applyUndo(session), true);
  assert.deepEqual(session.rounds, [ROUND]);
  assert.equal(applyUndo(session), true);
  assert.deepEqual(session.rounds, []);
  assert.equal(session.players.length, 4);
  assert.equal(applyUndo(session), false);
});

test('rejects invalid state without recording undo', () => {
  const session = createSession();
  assert.equal(applyUpdate(session, { players: ['A'], settings: {}, rounds: [] }), false);
  assert.equal(applyUpdate(session, { players: ['A', 'B', 'C'], settings: {}, rounds: 'x' }), false);
  assert.equal(applyUpdate(session, { players: ['A', 'B', 'C'], settings: {}, rounds: [{ winner: 'A' }] }), false);
  assert.equal(applyUpdate(session, { players: ['A', 'B', 'C', 'D', 'E'], settings: {}, rounds: [] }), false);
  assert.equal(session.undo.length, 0);
  assert.equal(isValidGameState(state([ROUND])), true);
});

test('caps undo history', () => {
  const session = createSession();
  for (let i = 0; i < MAX_UNDO + 5; i += 1) applyUpdate(session, state([ROUND]));
  assert.equal(session.undo.length, MAX_UNDO);
});

test('saves and loads sessions without clients', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'marriage-'));
  try {
    const file = path.join(dir, 'nested', 'sessions.json');
    const session = createSession();
    session.clients.push({ fake: true });
    applyUpdate(session, state([ROUND]));
    saveSessions(file, { 'MG-1234': session });
    const raw = JSON.parse(fs.readFileSync(file, 'utf8'));
    assert.equal('clients' in raw['MG-1234'], false);
    const loaded = loadSessions(file);
    assert.deepEqual(loaded['MG-1234'].rounds, [ROUND]);
    assert.deepEqual(loaded['MG-1234'].clients, []);
    assert.equal(publicState(loaded['MG-1234']).canUndo, true);

    fs.writeFileSync(file, JSON.stringify({ 'XX-1': state([]), 'MG-1111': { players: 'bad' } }));
    assert.deepEqual(loadSessions(file), {});
    assert.deepEqual(loadSessions(path.join(dir, 'missing.json')), {});
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test('finishGame archives the current game and undo brings it back', () => {
  const session = createSession();
  applyUpdate(session, state([ROUND, ROUND]));
  assert.equal(finishGame(session, 1700000000000), true);
  assert.deepEqual(session.rounds, []);
  assert.equal(session.games.length, 1);
  assert.deepEqual(session.games[0], { finishedAt: 1700000000000, players: ['A', 'B', 'C'], rounds: [ROUND, ROUND] });
  assert.deepEqual(publicState(session).games, session.games);
  assert.equal(applyUndo(session), true);
  assert.deepEqual(session.games, []);
  assert.deepEqual(session.rounds, [ROUND, ROUND]);
});

test('finishGame refuses an empty game without recording undo', () => {
  const session = createSession();
  assert.equal(finishGame(session), false);
  assert.equal(session.undo.length, 0);
  assert.deepEqual(session.games, []);
});

test('applyUpdate keeps archived games', () => {
  const session = createSession();
  applyUpdate(session, state([ROUND]));
  finishGame(session, 1);
  applyUpdate(session, state([ROUND]));
  assert.equal(session.games.length, 1);
  assert.deepEqual(session.rounds, [ROUND]);
});

test('deleteGame removes one archived game and is undoable', () => {
  const session = createSession();
  applyUpdate(session, state([ROUND]));
  finishGame(session, 1);
  applyUpdate(session, state([ROUND, ROUND]));
  finishGame(session, 2);
  assert.equal(deleteGame(session, 5), false);
  assert.equal(deleteGame(session, -1), false);
  assert.equal(deleteGame(session, '0'), false);
  assert.equal(deleteGame(session, 0), true);
  assert.deepEqual(session.games.map(game => game.finishedAt), [2]);
  assert.equal(applyUndo(session), true);
  assert.deepEqual(session.games.map(game => game.finishedAt), [1, 2]);
});

test('archived games are capped', () => {
  const session = createSession();
  for (let i = 0; i < MAX_GAMES + 3; i += 1) {
    applyUpdate(session, state([ROUND]));
    finishGame(session, i);
  }
  assert.equal(session.games.length, MAX_GAMES);
  assert.equal(session.games[0].finishedAt, 3);
});

test('saves and loads archived games, dropping invalid ones', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'marriage-'));
  try {
    const file = path.join(dir, 'sessions.json');
    const session = createSession();
    applyUpdate(session, state([ROUND]));
    finishGame(session, 42);
    session.games.push({ finishedAt: 'x', players: ['A'], rounds: [] });
    saveSessions(file, { 'MG-2222': session });
    const loaded = loadSessions(file);
    assert.deepEqual(loaded['MG-2222'].games, [{ finishedAt: 42, players: ['A', 'B', 'C'], rounds: [ROUND] }]);
    assert.equal(isValidArchivedGame({ finishedAt: 1, players: ['A', 'B', 'C'], rounds: [] }), false);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test('a packed round is valid and keeps the packed flag', () => {
  const PACKED = { entries: [{ player: 'A', bandh: true, hath: 0, joker: 0 }, { player: 'B', bandh: false, packed: true, hath: 10, joker: 3 }, { player: 'C', bandh: false, hath: 2, joker: 0 }] };
  assert.equal(isValidGameState(state([PACKED, ROUND])), true);
  const session = createSession();
  assert.equal(applyUpdate(session, state([PACKED])), true);
  assert.equal(session.rounds[0].entries[1].packed, true);
});

// v4f: commit cards. FIVE is 15 cards; THIRTY is 30 cards (copies are not checked by the server).
const FIVE_CODES = ['2S', '3S', '4S', '9H', '10H', 'JH', '2C', '3C', '4C', '10D', 'JD', 'QD', '9C', '10C', 'JC'];
const THIRTY = [...FIVE_CODES, ...FIVE_CODES].slice(0, 30);
const withEntry = entry => ({ players: ['A', 'B', 'C'], settings: SETTINGS, rounds: [{ entries: [entry, ROUND.entries[1], ROUND.entries[2]] }] });

test('applyUpdate accepts v4f committed, legacy and un-ticked card fields and keeps them', () => {
  const committed = { player: 'A', bandh: true, hath: 0, joker: 10, committed: true, commitCards: FIVE_CODES, cards: FIVE_CODES };
  const legacy = { player: 'A', bandh: false, hath: 0, joker: 0, cards: THIRTY };
  const unticked = { player: 'A', bandh: false, hath: 0, joker: 0, committed: false, cards: THIRTY };
  for (const entry of [committed, legacy, unticked]) {
    const session = createSession();
    assert.equal(applyUpdate(session, withEntry(entry)), true);
    assert.deepEqual(session.rounds[0].entries[0], entry);
  }
});

test('applyUpdate rejects bad card fields without recording undo', () => {
  const bad = [
    { player: 'A', cards: [...THIRTY, '2S'] },
    { player: 'A', bandh: true, committed: true, commitCards: ['ZZ'], cards: FIVE_CODES },
    { player: 'A', bandh: true, committed: 'yes', commitCards: FIVE_CODES, cards: FIVE_CODES },
    { player: 'A', bandh: true, committed: false, commitCards: FIVE_CODES, cards: FIVE_CODES },
    { player: 'A', bandh: true, committed: true, commitCards: [...FIVE_CODES, '2S'], cards: FIVE_CODES.slice(0, 15) }
  ];
  for (const entry of bad) {
    const session = createSession();
    assert.equal(applyUpdate(session, withEntry(entry)), false);
    assert.deepEqual(session.undo, []);
    assert.deepEqual(session.rounds, []);
  }
});

test('loadSessions keeps a session whose card fields are malformed', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'marriage-'));
  try {
    const file = path.join(dir, 'sessions.json');
    const stored = { players: ['A', 'B', 'C'], settings: SETTINGS, rounds: [{ entries: [{ player: 'A', cards: 'oops' }] }], games: [], undo: [], updatedAt: 1 };
    fs.writeFileSync(file, JSON.stringify({ 'MG-3333': stored }));
    assert.deepEqual(loadSessions(file)['MG-3333'].rounds, stored.rounds);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test('isValidEntryCards checks the card fields of one entry', () => {
  assert.equal(isValidEntryCards({ player: 'A', cards: THIRTY }), true);
  assert.equal(isValidEntryCards({ player: 'A', committed: true, commitCards: FIVE_CODES, cards: FIVE_CODES }), true);
  assert.equal(isValidEntryCards({ player: 'A', committed: false, cards: THIRTY }), true);
  assert.equal(isValidEntryCards({ player: 'A', cards: [...THIRTY, '2S'] }), false);
  assert.equal(isValidEntryCards({ player: 'A', committed: true, commitCards: ['ZZ'] }), false);
  assert.equal(isValidEntryCards({ player: 'A', committed: 'yes' }), false);
  assert.equal(isValidEntryCards({ player: 'A', commitCards: FIVE_CODES }), false);
  assert.equal(isValidEntryCards({ player: 'A', committed: true, commitCards: [...THIRTY.slice(0, 26)] }), false);
  assert.equal(isValidEntryCards(null), false);
});
