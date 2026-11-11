import test from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import { resolveBuildFile } from './static.mjs';

const BUILD = path.resolve('/app/build');

test('serves files inside the build folder', () => {
  assert.equal(resolveBuildFile(BUILD, '/'), path.join(BUILD, 'index.html'));
  assert.equal(resolveBuildFile(BUILD, '/static/js/main.js?v=1'), path.join(BUILD, 'static', 'js', 'main.js'));
  assert.equal(resolveBuildFile(BUILD, '/favicon.ico#x'), path.join(BUILD, 'favicon.ico'));
  assert.equal(resolveBuildFile(BUILD, '/a/../index.html'), path.join(BUILD, 'index.html'));
});

test('never leaves the build folder', () => {
  for (const url of ['/../server.mjs', '/../../../../etc/hosts', '/%2e%2e/package.json', '/%2E%2E%2Fdata%2Fsessions.json',
    '/..%2f..%2fetc%2fhosts', '/static/../../server.mjs']) {
    const file = resolveBuildFile(BUILD, url);
    assert.ok(file === null || file.startsWith(BUILD + path.sep), `${url} -> ${file}`);
  }
  assert.equal(resolveBuildFile(BUILD, '/%E0%A4%A'), null);
  assert.equal(resolveBuildFile(BUILD, '/index.html%00.png'), null);
  assert.equal(resolveBuildFile('/app/build', '/../build-secrets/x'), path.join(BUILD, 'build-secrets', 'x'));
});
