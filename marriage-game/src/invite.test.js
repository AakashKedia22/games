import { buildInviteUrl, parseSessionCode } from './invite';

describe('session invite links', () => {
  test('parses a valid session code case-insensitively', () => {
    expect(parseSessionCode('?session=mg-1234')).toBe('MG-1234');
  });

  test('ignores absent or malformed session codes', () => {
    expect(parseSessionCode('')).toBeNull();
    expect(parseSessionCode('?session=MG-12')).toBeNull();
    expect(parseSessionCode('?session=MG-1234&session=MG-9999')).toBeNull();
  });

  test('builds a direct invite on the selected LAN IP and preserves the app port', () => {
    expect(buildInviteUrl({ hostname: 'localhost', port: '3000', protocol: 'http:', lanIp: '192.168.1.42', code: 'MG-1234' }))
      .toBe('http://192.168.1.42:3000/?session=MG-1234');
  });

  test('uses the current host when no LAN IP is available', () => {
    expect(buildInviteUrl({ hostname: '192.168.1.9', port: '3001', protocol: 'http:', code: 'MG-1234' }))
      .toBe('http://192.168.1.9:3001/?session=MG-1234');
  });

  test('uses the default port when the current origin omits it', () => {
    expect(buildInviteUrl({ hostname: 'marriage.local', port: '', protocol: 'https:', lanIp: null, code: 'MG-1234' }))
      .toBe('https://marriage.local/?session=MG-1234');
  });
});
