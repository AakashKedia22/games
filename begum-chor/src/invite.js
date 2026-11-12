export function parseSessionCode(search) {
  const params = new URLSearchParams(search || '');
  const values = params.getAll('session');
  if (values.length !== 1) return null;
  const code = values[0].trim().toUpperCase();
  return /^BC-\d{4}$/.test(code) ? code : null;
}

export function buildInviteUrl({ hostname, port, protocol = 'http:', lanIp, code }) {
  const url = new URL(`${protocol}//${lanIp || hostname}`);
  if (port) url.port = String(port);
  url.pathname = '/';
  url.search = '';
  url.searchParams.set('session', code);
  return url.toString();
}
