export const PLAYER_COUNTS = [3, 4];
export const MAX_NAME_LENGTH = 20;
export const MAX_HATH = 15;
export const MAX_JOKER = 9999;
export const DOUBLE_THRESHOLD = 20;

// Keep in sync with DEFAULT_SETTINGS in server/sessions.mjs
export const DEFAULT_SETTINGS = Object.freeze({});

function isBlank(value) {
  return value === '' || value === null || value === undefined;
}

function entryNumber(value) {
  return isBlank(value) ? 0 : Number(value);
}

export function normalizeSettings() {
  return {};
}

export function validateRound(players, round) {
  if (!round || !Array.isArray(round.entries)) return 'Round data is missing.';
  const entries = players.map(player => round.entries.find(entry => entry.player === player));
  if (entries.some(entry => !entry)) return 'Every player needs an entry for this round.';
  const closers = entries.filter(entry => entry.bandh === true);
  if (closers.length !== 1) return 'Tick Bandh for exactly one player.';
  for (const entry of entries) {
    if (entry.bandh) continue;
    const hath = entryNumber(entry.hath);
    if (!Number.isInteger(hath) || hath < 0 || hath > MAX_HATH) {
      return `Hath points for ${entry.player} must be a whole number between 0 and ${MAX_HATH}.`;
    }
  }
  for (const entry of entries) {
    const joker = entryNumber(entry.joker);
    if (!Number.isInteger(joker) || joker < 0 || joker > MAX_JOKER) {
      return `Joker points for ${entry.player} must be a whole number between 0 and ${MAX_JOKER}.`;
    }
  }
  return null;
}

// A round where anyone entered 20 or more joker points doubles the next round.
export function triggersDouble(round) {
  if (!round || !Array.isArray(round.entries)) return false;
  return round.entries.some(entry => entryNumber(entry.joker) >= DOUBLE_THRESHOLD);
}

export function multiplierFor(rounds, index) {
  return index > 0 && triggersDouble(rounds[index - 1]) ? 2 : 1;
}

export function nextMultiplier(rounds) {
  return multiplierFor(rounds || [], (rounds || []).length);
}

// Hath: the Bandh closer collects every other player's hath (max 15 each); the others lose theirs.
// Joker: joker_i * N - T, i.e. the sum of (own joker - other joker) over every other player.
// Net: (hath + joker) * multiplier.
export function computeRound(round, multiplier = 1) {
  const entries = round && Array.isArray(round.entries) ? round.entries : [];
  const playerCount = entries.length;
  const totalJoker = entries.reduce((sum, entry) => sum + entryNumber(entry.joker), 0);
  const closer = entries.find(entry => entry.bandh === true);

  const hath = {};
  const joker = {};
  const nets = {};
  let collected = 0;
  entries.forEach(entry => {
    hath[entry.player] = 0;
    if (closer && entry !== closer) {
      const lost = Math.min(entryNumber(entry.hath), MAX_HATH);
      hath[entry.player] = lost === 0 ? 0 : -lost;
      collected += lost;
    }
    joker[entry.player] = entryNumber(entry.joker) * playerCount - totalJoker;
  });
  if (closer) hath[closer.player] = collected;
  entries.forEach(entry => {
    nets[entry.player] = (hath[entry.player] + joker[entry.player]) * multiplier;
  });

  return {
    hath,
    joker,
    nets,
    multiplier,
    totalJoker,
    closer: closer ? closer.player : null,
    triggersDouble: triggersDouble(round),
    valid: Boolean(closer)
  };
}

export function computeRounds(rounds) {
  const list = rounds || [];
  return list.map((round, index) => computeRound(round, multiplierFor(list, index)));
}

export function computeRunningTotals(rounds, players) {
  const running = {};
  players.forEach(player => { running[player] = 0; });
  return computeRounds(rounds).map(({ nets }) => {
    players.forEach(player => { running[player] += nets[player] || 0; });
    return { ...running };
  });
}

export function computeTotals(rounds, players) {
  const running = computeRunningTotals(rounds, players);
  if (running.length) return running[running.length - 1];
  return players.reduce((totals, player) => {
    totals[player] = 0;
    return totals;
  }, {});
}

export function computeStandings(totals, players) {
  const rows = players.map((player, index) => ({ player, total: (totals && totals[player]) || 0, index }));
  rows.sort((a, b) => b.total - a.total || a.index - b.index);
  return rows.map(row => ({
    player: row.player,
    total: row.total,
    rank: rows.filter(other => other.total > row.total).length + 1
  }));
}

export function formatPoints(points) {
  const value = Number(points) || 0;
  return value > 0 ? `+${value}` : String(value);
}

export function validateSetup(players) {
  const names = (players || []).map(name => String(isBlank(name) ? '' : name).trim());
  if (!PLAYER_COUNTS.includes(names.length)) return 'Marriage is played with 3 or 4 players.';
  if (names.some(name => !name)) return 'Every player needs a name.';
  if (names.some(name => name.length > MAX_NAME_LENGTH)) {
    return `Player names must be ${MAX_NAME_LENGTH} characters or fewer.`;
  }
  const lower = names.map(name => name.toLowerCase());
  if (new Set(lower).size !== lower.length) return 'Player names must be unique.';

  return null;
}
