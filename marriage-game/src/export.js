import { computeRounds, computeRunningTotals, computeStandings, computeTotals, formatPoints } from './scoring';

export function csvEscape(value) {
  if (typeof value === 'number') return String(value);
  let text = String(value ?? '');
  if (/^[=+\-@]/.test(text)) text = `'${text}`;
  return /[",\n\r]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text;
}

export function gameToCsv(players, rounds) {
  const results = computeRounds(rounds);
  const running = computeRunningTotals(rounds, players);
  const totals = computeTotals(rounds, players);
  const header = ['Round', 'Bandh', 'Multiplier'];
  players.forEach(player => header.push(`${player} Hath`, `${player} Joker`, `${player} Points`, `${player} Total`));
  const lines = [header];
  results.forEach((result, index) => {
    const row = [index + 1, result.closer ?? '', result.multiplier];
    players.forEach(player => {
      row.push(result.hath[player] ?? 0, result.joker[player] ?? 0, result.nets[player] ?? 0, running[index][player] ?? 0);
    });
    lines.push(row);
  });
  const totalRow = ['Total', '', ''];
  players.forEach(player => totalRow.push('', '', '', totals[player] ?? 0));
  lines.push(totalRow);
  return lines.map(line => line.map(csvEscape).join(',')).join('\n') + '\n';
}

export function standingsText(players, rounds, sessionId) {
  const count = (rounds || []).length;
  const lines = [`Marriage Score Card · ${sessionId}`];
  if (!count) {
    lines.push('No rounds played yet');
    return lines.join('\n');
  }
  lines.push(`After ${count} ${count === 1 ? 'round' : 'rounds'}`);
  computeStandings(computeTotals(rounds, players), players).forEach(row => {
    lines.push(`${row.rank}. ${row.player} ${formatPoints(row.total)}`);
  });
  return lines.join('\n');
}

export function whatsappUrl(text) {
  return `https://wa.me/?text=${encodeURIComponent(text)}`;
}

export function csvFileName(date) {
  const d = date instanceof Date ? date : new Date(date);
  const pad = number => String(number).padStart(2, '0');
  return `marriage-${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}.csv`;
}
