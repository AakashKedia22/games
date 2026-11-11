import { DOUBLE_THRESHOLD, computeRounds, computeStandings, computeTotals } from './scoring';

export function computePlayerStats(rounds, players) {
  const list = rounds || [];
  const results = computeRounds(list);
  const stats = {};
  players.forEach(player => {
    stats[player] = {
      player, rounds: 0, total: 0, bandhs: 0, hathPoints: 0, jokerPoints: 0, best: null, worst: null, doublesTriggered: 0
    };
  });
  results.forEach((result, index) => {
    players.forEach(player => {
      const row = stats[player];
      const net = result.nets[player] ?? 0;
      const entry = list[index].entries.find(item => item.player === player);
      row.rounds += 1;
      row.total += net;
      row.hathPoints += (result.hath[player] ?? 0) * result.multiplier;
      row.jokerPoints += (result.joker[player] ?? 0) * result.multiplier;
      if (result.closer === player) row.bandhs += 1;
      row.best = row.best === null ? net : Math.max(row.best, net);
      row.worst = row.worst === null ? net : Math.min(row.worst, net);
      if (entry && Number(entry.joker) >= DOUBLE_THRESHOLD) row.doublesTriggered += 1;
    });
  });
  return players.map(player => stats[player]);
}

export function summarizeGame(game) {
  const totals = computeTotals(game.rounds, game.players);
  const standings = computeStandings(totals, game.players);
  return {
    finishedAt: game.finishedAt,
    players: game.players,
    roundCount: game.rounds.length,
    totals,
    standings,
    winners: standings.filter(row => row.rank === 1).map(row => row.player)
  };
}

export function computeAllTime(games) {
  const rows = {};
  (games || []).forEach(game => {
    const summary = summarizeGame(game);
    game.players.forEach(player => {
      if (!rows[player]) rows[player] = { player, games: 0, wins: 0, total: 0 };
      rows[player].games += 1;
      rows[player].total += summary.totals[player] || 0;
      if (summary.winners.includes(player)) rows[player].wins += 1;
    });
  });
  const list = Object.values(rows);
  list.sort((a, b) => b.total - a.total || b.wins - a.wins || a.player.localeCompare(b.player));
  return list.map(row => ({ ...row, rank: list.filter(other => other.total > row.total).length + 1 }));
}
