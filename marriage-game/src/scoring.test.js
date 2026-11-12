import {
  computeRound, computeRounds, computeRunningTotals, computeStandings, computeTotals, formatPoints,
  multiplierFor, nextMultiplier, triggersDouble, validateRound, validateSetup
} from './scoring';

const P4 = ['P1', 'P2', 'P3', 'P4'];
const round = (closer, hath, joker, players = P4) => ({
  entries: players.map((player, i) => ({ player, bandh: player === closer, hath: hath[i], joker: joker[i] }))
});
const sum = obj => Object.values(obj).reduce((a, b) => a + b, 0);

// Example 1 (user's hath example)
const EX1 = round('P1', [0, 0, 2, 12], [0, 0, 0, 0]);
// Example 2 (user's joker example)
const EX2 = round('P1', [0, 0, 0, 0], [2, 5, 10, 25]);
// Example 3: both together
const EX3 = round('P1', [0, 0, 2, 12], [2, 5, 10, 25]);
// Example 4: follows EX3, so it is doubled
const EX4 = round('P2', [5, 0, 15, 3], [1, 2, 3, 4]);

describe('hath', () => {
  test('closer collects the others, others lose theirs', () => {
    expect(computeRound(EX1).hath).toEqual({ P1: 14, P2: 0, P3: -2, P4: -12 });
    expect(computeRound(EX1).nets).toEqual({ P1: 14, P2: 0, P3: -2, P4: -12 });
  });
  test("closer's own hath is ignored", () => {
    const r = round('P1', [40, 1, 1, 1], [0, 0, 0, 0]);
    expect(computeRound(r).hath).toEqual({ P1: 3, P2: -1, P3: -1, P4: -1 });
    expect(validateRound(P4, r)).toBeNull();
  });
  test('hath is capped at 15 even if validation is bypassed', () => {
    expect(computeRound(round('P1', [0, 20, 0, 0], [0, 0, 0, 0])).hath).toEqual({ P1: 15, P2: -15, P3: 0, P4: 0 });
  });
});

describe('joker', () => {
  test("matches the user's pairwise example", () => {
    expect(computeRound(EX2).joker).toEqual({ P1: -34, P2: -22, P3: -2, P4: 58 });
  });
  test('equals the pairwise sum for every player', () => {
    const jokers = [2, 5, 10, 25];
    const result = computeRound(EX2).joker;
    P4.forEach((player, i) => {
      const pairwise = jokers.reduce((acc, other, j) => (j === i ? acc : acc + (jokers[i] - other)), 0);
      expect(result[player]).toBe(pairwise);
    });
  });
});

describe('round total', () => {
  test('adds hath and joker', () => {
    expect(computeRound(EX3).nets).toEqual({ P1: -20, P2: -22, P3: -4, P4: 46 });
  });
  test('3-player game', () => {
    const r = round('C', [15, 7, 0], [0, 30, 6], ['A', 'B', 'C']);
    const result = computeRound(r);
    expect(result.hath).toEqual({ A: -15, B: -7, C: 22 });
    expect(result.joker).toEqual({ A: -36, B: 54, C: -18 });
    expect(result.nets).toEqual({ A: -51, B: 47, C: 4 });
  });
});

describe('double round', () => {
  test('joker of 20 or more doubles the next round; 19 does not', () => {
    expect(triggersDouble(round('P1', [0, 0, 0, 0], [19, 0, 0, 0]))).toBe(false);
    expect(triggersDouble(round('P1', [0, 0, 0, 0], [20, 0, 0, 0]))).toBe(true);
    expect(triggersDouble(round('P1', [0, 0, 0, 0], [21, 0, 0, 0]))).toBe(true);
    expect(triggersDouble(EX3)).toBe(true);
  });
  test('the round after EX3 is doubled for all players', () => {
    const results = computeRounds([EX3, EX4]);
    expect(results[0].multiplier).toBe(1);
    expect(results[1].multiplier).toBe(2);
    expect(results[1].hath).toEqual({ P1: -5, P2: 23, P3: -15, P4: -3 });
    expect(results[1].joker).toEqual({ P1: -6, P2: -2, P3: 2, P4: 6 });
    expect(results[1].nets).toEqual({ P1: -22, P2: 42, P3: -26, P4: 6 });
  });
  test('running totals across a doubled round', () => {
    expect(computeTotals([EX3, EX4], P4)).toEqual({ P1: -42, P2: 20, P3: -30, P4: 52 });
    expect(computeRunningTotals([EX3, EX4], P4)).toHaveLength(2);
  });
  test('next multiplier and multiplierFor', () => {
    expect(nextMultiplier([])).toBe(1);
    expect(nextMultiplier([EX3])).toBe(2);
    expect(nextMultiplier([EX3, EX4])).toBe(1);
    expect(multiplierFor([EX3, EX4], 0)).toBe(1);
    expect(multiplierFor([EX3, EX4], 1)).toBe(2);
  });
  test('a doubled round can trigger the next double', () => {
    const r2 = round('P2', [0, 0, 0, 0], [30, 0, 0, 0]);
    const r3 = round('P3', [0, 0, 0, 0], [0, 0, 0, 0]);
    expect(computeRounds([EX3, r2, r3]).map(r => r.multiplier)).toEqual([1, 2, 2]);
  });
});

describe('zero-sum invariant', () => {
  test('random rounds always sum to zero', () => {
    let seed = 7;
    const rand = n => { seed = (seed * 1103515245 + 12345) % 2147483648; return seed % n; };
    for (let t = 0; t < 300; t += 1) {
      const players = rand(2) === 0 ? ['A', 'B', 'C'] : ['A', 'B', 'C', 'D'];
      const closer = players[rand(players.length)];
      const r = round(closer, players.map(() => rand(16)), players.map(() => rand(60)), players);
      const result = computeRound(r, rand(2) + 1);
      expect(sum(result.nets)).toBe(0);
      expect(sum(result.hath)).toBe(0);
      expect(sum(result.joker)).toBe(0);
    }
  });
});

describe('validateRound', () => {
  test('accepts a good round and blanks as 0', () => {
    expect(validateRound(P4, EX3)).toBeNull();
    expect(validateRound(P4, round('P1', ['', '', '', ''], ['', '', '', '']))).toBeNull();
  });
  test('requires exactly one bandh', () => {
    expect(validateRound(P4, round(null, [0, 0, 0, 0], [0, 0, 0, 0]))).toMatch(/exactly one/);
    const two = round('P1', [0, 0, 0, 0], [0, 0, 0, 0]);
    two.entries[1].bandh = true;
    expect(validateRound(P4, two)).toMatch(/exactly one/);
  });
  test('rejects hath over 15 and bad jokers', () => {
    expect(validateRound(P4, round('P1', [0, 16, 0, 0], [0, 0, 0, 0]))).toMatch(/Hath points for P2/);
    expect(validateRound(P4, round('P1', [0, 0, 0, 0], [0, -1, 0, 0]))).toMatch(/Joker points for P2/);
    expect(validateRound(P4, round('P1', [0, 0, 0, 0], [0, 2.5, 0, 0]))).toMatch(/Joker points for P2/);
  });
  test('needs an entry for every player', () => {
    expect(validateRound([...P4, 'P5'], EX3)).toMatch(/Every player/);
  });
});

describe('pack', () => {
  const PK = round('P1', [0, 3, 0, 0], [2, 5, 10, 25]);
  PK.entries[2].packed = true;
  test('a packed player pays 10 Hath and keeps Joker points', () => {
    const result = computeRound(PK);
    expect(result.hath).toEqual({ P1: 13, P2: -3, P3: -10, P4: 0 });
    expect(result.joker).toEqual({ P1: -34, P2: -22, P3: -2, P4: 58 });
    expect(result.nets).toEqual({ P1: -21, P2: -25, P3: -12, P4: 58 });
    expect(sum(result.nets)).toBe(0);
    expect(result.packed).toEqual(['P3']);
  });
  test('a typed Hath is ignored for a packed player', () => {
    const typed = round('P1', [0, 3, 15, 0], [2, 5, 10, 25]);
    typed.entries[2].packed = true;
    expect(computeRound(typed).hath.P3).toBe(-10);
  });
  test('the pack payment is doubled in a double round', () => {
    expect(computeRound(PK, 2).nets.P3).toBe(-24);
  });
  test('a packed player can be entered with any Hath', () => {
    PK.entries[2].hath = 99;
    expect(validateRound(P4, PK)).toBeNull();
    PK.entries[2].hath = 0;
  });
  test('a packed player cannot close the Bandh', () => {
    const r = round('P1', [0, 0, 0, 0], [0, 0, 0, 0]);
    r.entries[0].packed = true;
    expect(validateRound(P4, r)).toMatch(/cannot close/);
  });
  test('old rounds have no packed players', () => {
    expect(computeRound(EX1).packed).toEqual([]);
  });
});

describe('setup and formatting', () => {
  test('only 3 or 4 players', () => {
    expect(validateSetup(['A', 'B', 'C'])).toBeNull();
    expect(validateSetup(['A', 'B', 'C', 'D'])).toBeNull();
    expect(validateSetup(['A', 'B'])).toMatch(/3 or 4/);
    expect(validateSetup(['A', 'B', 'C', 'D', 'E'])).toMatch(/3 or 4/);
    expect(validateSetup(['A', 'a', 'C'])).toMatch(/unique/);
  });
  test('standings and formatting', () => {
    expect(computeStandings({ A: 5, B: 5, C: -10 }, ['A', 'B', 'C']).map(r => r.rank)).toEqual([1, 1, 3]);
    expect(formatPoints(14)).toBe('+14');
    expect(formatPoints(-2)).toBe('-2');
    expect(formatPoints(0)).toBe('0');
  });
});

test('a closer who did not tick Committed cannot submit; a ticked or legacy closer can', () => {
  const P3 = ['P1', 'P2', 'P3'];
  const unticked = round('P1', [0, 0, 2], [0, 0, 0], P3);
  unticked.entries[0].committed = false;
  expect(validateRound(P3, unticked)).toBe('P1 did not tick Committed, so they cannot close the Bandh.');
  unticked.entries[0].committed = true;
  expect(validateRound(P3, unticked)).toBeNull();
  delete unticked.entries[0].committed;
  expect(validateRound(P3, unticked)).toBeNull();
});

test('computeRound lists the players who ticked Committed', () => {
  const CM = round('P1', [0, 0, 2, 12], [2, 5, 10, 25]);
  CM.entries[0].committed = true;
  CM.entries[2].committed = true;
  CM.entries[1].committed = false;
  expect(computeRound(CM).committed).toEqual(['P1', 'P3']);
  expect(computeRound(EX3).committed).toEqual([]);
});
