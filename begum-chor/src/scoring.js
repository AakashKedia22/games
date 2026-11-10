export function getAdjustment({ noHands = false, committed = false } = {}) {
  if (noHands && committed) return -15;
  if (noHands) return -5;
  if (committed) return 25;
  return 0;
}

export function getResolvedScore(roundScore) {
  if (typeof roundScore.noHands !== 'boolean' && typeof roundScore.committed !== 'boolean') {
    return Number(roundScore.score) || 0;
  }
  return (Number(roundScore.score) || 0) + getAdjustment(roundScore);
}

export function validateRound(players, roundScores) {
  const values = players.map(player => roundScores[player]);
  if (values.some(value => value === undefined || value === '' || !Number.isInteger(Number(value)) || Number(value) < 0 || Number(value) > 25)) {
    return 'Enter a whole-number share between 0 and 25 for every player.';
  }

  const shareSum = values.reduce((sum, value) => sum + Number(value), 0);
  if (shareSum !== 25) {
    return `The sum of shares must be exactly 25. Current sum: ${shareSum}`;
  }

  if (!values.some(value => Number(value) >= 12)) {
    return 'Kaali Begam share must be at least 12.';
  }

  return null;
}

export function computeTotals(scores, players) {
  return players.reduce((totals, player) => {
    totals[player] = scores.reduce((total, round) => {
      const entry = round.find(score => score.player === player);
      return total + (entry ? getResolvedScore(entry) : 0);
    }, 0);
    return totals;
  }, {});
}
