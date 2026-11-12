export function stepValue(value, delta, min = 0, max) {
  const current = value === '' || value === undefined ? 0 : Number(value);
  let next = (Number.isFinite(current) ? current : 0) + delta;
  if (next < min) next = min;
  if (max !== undefined && next > max) next = max;
  return String(next);
}

// Hath tops out at 15, so "1" may still grow into 10-15; anything else is final.
export function isCompleteHath(value) {
  if (!value) return false;
  return value === '0' || value.length >= 2 || Number(value) >= 2;
}
