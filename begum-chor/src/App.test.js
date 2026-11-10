import {
  computeTotals,
  getAdjustment,
  getResolvedScore,
  validateRound
} from './scoring';

describe('round scoring', () => {
  test.each([
    [false, false, 0],
    [true, false, -5],
    [true, true, -15],
    [false, true, 25]
  ])('calculates adjustment for noHands=%s and committed=%s', (noHands, committed, expected) => {
    expect(getAdjustment({ noHands, committed })).toBe(expected);
  });

  test('adds the checkbox adjustment to the entered share', () => {
    expect(getResolvedScore({ score: 3, noHands: true, committed: true })).toBe(-12);
    expect(getResolvedScore({ score: 3, noHands: false, committed: true })).toBe(28);
  });

  test('keeps legacy round scores unchanged', () => {
    expect(getResolvedScore({ score: -5 })).toBe(-5);
  });

  test('validates base shares, total and Kaali Begam share', () => {
    expect(validateRound(['A', 'B', 'C'], { A: '13', B: '6', C: '6' })).toBeNull();
    expect(validateRound(['A', 'B', 'C'], { A: '13', B: '6', C: '5' })).toMatch(/exactly 25/i);
    expect(validateRound(['A', 'B', 'C'], { A: '11', B: '7', C: '7' })).toMatch(/12/i);
    expect(validateRound(['A', 'B', 'C'], { A: '-5', B: '15', C: '15' })).toMatch(/0 and 25/i);
  });

  test('computes totals from resolved points and ignores missing legacy players', () => {
    const scores = [
      [{ player: 'A', score: 3, noHands: true, committed: false }, { player: 'B', score: 22, noHands: false, committed: false }],
      [{ player: 'A', score: 4 }, { player: 'B', score: -5 }]
    ];
    expect(computeTotals(scores, ['A', 'B'])).toEqual({ A: 2, B: 17 });
  });
});
