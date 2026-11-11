import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {
  MAX_UNDO, applyUndo, applyUpdate, createSession, generateCode,
  isValidGameState, loadSessions, publicState, saveSessions
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
