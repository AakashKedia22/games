import { isCompleteHath, stepValue } from './entry';

test('stepValue clamps to the range', () => {
  expect(stepValue('', 1, 0, 15)).toBe('1');
  expect(stepValue('15', 1, 0, 15)).toBe('15');
  expect(stepValue('0', -1, 0, 15)).toBe('0');
  expect(stepValue('', -1, 0, 15)).toBe('0');
  expect(stepValue('7', -1, 0)).toBe('6');
  expect(stepValue('99', 1, 0)).toBe('100');
});

test('isCompleteHath', () => {
  expect(isCompleteHath('')).toBe(false);
  expect(isCompleteHath('1')).toBe(false);
  expect(isCompleteHath('0')).toBe(true);
  expect(isCompleteHath('2')).toBe(true);
  expect(isCompleteHath('9')).toBe(true);
  expect(isCompleteHath('10')).toBe(true);
  expect(isCompleteHath('15')).toBe(true);
});
