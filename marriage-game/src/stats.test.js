import { computeAllTime, computePlayerStats, summarizeGame } from './stats';

const P4 = ['P1', 'P2', 'P3', 'P4'];
const round = (closer, hath, joker, players = P4) => ({
  entries: players.map((player, i) => ({ player, bandh: player === closer, hath: hath[i], joker: joker[i] }))
});
const EX3 = round('P1', [0, 0, 2, 12], [2, 5, 10, 25]);
const EX4 = round('P2', [5, 0, 15, 3], [1, 2, 3, 4]);
const R3 = round('P3', [15, 7, 0], [0, 30, 6], ['P1', 'P2', 'P3']);

test('player stats across a normal and a doubled round', () => {
  const stats = computePlayerStats([EX3, EX4], P4);
  expect(stats).toEqual([
    { player: 'P1', rounds: 2, total: -42, bandhs: 1, hathPoints: 4, jokerPoints: -46, best: -20, worst: -22, doublesTriggered: 0, packs: 0 },
    { player: 'P2', rounds: 2, total: 20, bandhs: 1, hathPoints: 46, jokerPoints: -26, best: 42, worst: -22, doublesTriggered: 0, packs: 0 },
    { player: 'P3', rounds: 2, total: -30, bandhs: 0, hathPoints: -32, jokerPoints: 2, best: -4, worst: -26, doublesTriggered: 0, packs: 0 },
    { player: 'P4', rounds: 2, total: 52, bandhs: 0, hathPoints: -18, jokerPoints: 70, best: 46, worst: 6, doublesTriggered: 1, packs: 0 }
  ]);
  stats.forEach(row => expect(row.hathPoints + row.jokerPoints).toBe(row.total));
});

test('player stats with no rounds', () => {
  expect(computePlayerStats([], ['A', 'B', 'C'])[0]).toEqual(
    { player: 'A', rounds: 0, total: 0, bandhs: 0, hathPoints: 0, jokerPoints: 0, best: null, worst: null, doublesTriggered: 0, packs: 0 }
  );
});

test('packs are counted per player', () => {
  const PK = round('P1', [0, 3, 0, 0], [2, 5, 10, 25]);
  PK.entries[2].packed = true;
  const stats = computePlayerStats([PK], P4);
  expect(stats.find(row => row.player === 'P3').packs).toBe(1);
  expect(stats.find(row => row.player === 'P3').hathPoints).toBe(-10);
  expect(stats.filter(row => row.player !== 'P3').every(row => row.packs === 0)).toBe(true);
});

test('summarizeGame finds the winner and shared wins', () => {
  const summary = summarizeGame({ finishedAt: 5, players: P4, rounds: [EX3, EX4] });
  expect(summary.totals).toEqual({ P1: -42, P2: 20, P3: -30, P4: 52 });
  expect(summary.winners).toEqual(['P4']);
  expect(summary.roundCount).toBe(2);
  const tied = summarizeGame({ finishedAt: 6, players: ['A', 'B', 'C'], rounds: [round('A', [0, 0, 0], [0, 0, 0], ['A', 'B', 'C'])] });
  expect(tied.winners).toEqual(['A', 'B', 'C']);
});

test('all-time leaderboard across games', () => {
  const games = [
    { finishedAt: 1, players: P4, rounds: [EX3, EX4] },
    { finishedAt: 2, players: ['P1', 'P2', 'P3'], rounds: [R3] }
  ];
  expect(computeAllTime(games)).toEqual([
    { player: 'P2', games: 2, wins: 1, total: 67, rank: 1 },
    { player: 'P4', games: 1, wins: 1, total: 52, rank: 2 },
    { player: 'P3', games: 2, wins: 0, total: -26, rank: 3 },
    { player: 'P1', games: 2, wins: 0, total: -93, rank: 4 }
  ]);
  expect(computeAllTime([])).toEqual([]);
});
