import { csvEscape, csvFileName, gameToCsv, standingsText, whatsappUrl } from './export';

const P4 = ['P1', 'P2', 'P3', 'P4'];
const round = (closer, hath, joker, players = P4) => ({
  entries: players.map((player, i) => ({ player, bandh: player === closer, hath: hath[i], joker: joker[i] }))
});
const EX3 = round('P1', [0, 0, 2, 12], [2, 5, 10, 25]);
const EX4 = round('P2', [5, 0, 15, 3], [1, 2, 3, 4]);

test('csvEscape quotes and guards formulas', () => {
  expect(csvEscape(-42)).toBe('-42');
  expect(csvEscape('Aakash')).toBe('Aakash');
  expect(csvEscape('a,b')).toBe('"a,b"');
  expect(csvEscape('say "hi"')).toBe('"say ""hi"""');
  expect(csvEscape('=SUM(A1)')).toBe("'=SUM(A1)");
  expect(csvEscape('')).toBe('');
});

test('gameToCsv writes one row per round plus totals', () => {
  expect(gameToCsv(P4, [EX3, EX4])).toBe([
    'Round,Bandh,Multiplier,Packed,Committed,P1 Hath,P1 Joker,P1 Points,P1 Total,P2 Hath,P2 Joker,P2 Points,P2 Total,P3 Hath,P3 Joker,P3 Points,P3 Total,P4 Hath,P4 Joker,P4 Points,P4 Total',
    '1,P1,1,,,14,-34,-20,-20,0,-22,-22,-22,-2,-2,-4,-4,-12,58,46,46',
    '2,P2,2,,,-5,-6,-22,-42,23,-2,42,20,-15,2,-26,-30,-3,6,6,52',
    'Total,,,,,,,,-42,,,,20,,,,-30,,,,52',
    ''
  ].join('\n'));
});

test('gameToCsv lists packed players in one column', () => {
  const PK = round('P1', [0, 3, 0, 0], [2, 5, 10, 25]);
  PK.entries[2].packed = true;
  expect(gameToCsv(P4, [PK]).split('\n')[1]).toBe('1,P1,1,P3,,13,-34,-21,-21,-3,-22,-25,-25,-10,-2,-12,-12,0,58,58,58');
  PK.entries[1].packed = true;
  expect(gameToCsv(P4, [PK]).split('\n')[1]).toMatch(/^1,P1,1,P2; P3,,20,/);
});

test('gameToCsv lists the players who ticked Committed in one column', () => {
  const CM = round('P1', [0, 0, 2, 12], [2, 5, 10, 25]);
  CM.entries[0].committed = true;
  CM.entries[2].committed = true;
  expect(gameToCsv(P4, [CM]).split('\n')[1]).toMatch(/^1,P1,1,,P1; P3,/);
});

test('standingsText lists ranks', () => {
  expect(standingsText(P4, [EX3, EX4], 'MG-1234')).toBe(
    'Marriage Score Card · MG-1234\nAfter 2 rounds\n1. P4 +52\n2. P2 +20\n3. P3 -30\n4. P1 -42'
  );
  expect(standingsText(P4, [EX3], 'MG-1234').split('\n')[1]).toBe('After 1 round');
  expect(standingsText(P4, [], 'MG-1234')).toBe('Marriage Score Card · MG-1234\nNo rounds played yet');
});

test('whatsappUrl and csvFileName', () => {
  expect(whatsappUrl('a b\nc')).toBe('https://wa.me/?text=a%20b%0Ac');
  expect(csvFileName(new Date(2026, 10, 9, 21, 30))).toBe('marriage-2026-11-09.csv');
});
