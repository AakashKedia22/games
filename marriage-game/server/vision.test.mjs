import test from 'node:test';
import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import http from 'node:http';
import { PassThrough } from 'node:stream';
import {
  NOT_SET_UP, createRecognizer, isValidCardCode, isValidSampleId, photoExtension, prunePending,
  readBody, recognizePhoto, saveSamples, visionPaths
} from './vision.mjs';

// A stand-in for the Python worker: replies to each request line with `reply(request)`.
function fakeSpawn(reply, { ready = true } = {}) {
  const calls = [];
  const spawnFn = (command, args) => {
    const child = new EventEmitter();
    child.stdin = new PassThrough();
    child.stdout = new PassThrough();
    child.stderr = new PassThrough();
    child.kill = () => child.emit('exit', null);
    calls.push({ command, args });
    if (ready) setImmediate(() => child.stdout.write('{"ready": true}\n'));
    let buffer = '';
    child.stdin.on('data', chunk => {
      buffer += chunk;
      let newline;
      while ((newline = buffer.indexOf('\n')) >= 0) {
        const request = JSON.parse(buffer.slice(0, newline));
        buffer = buffer.slice(newline + 1);
        const answer = reply(request, child);
        if (answer) setImmediate(() => child.stdout.write(`${JSON.stringify(answer)}\n`));
      }
    });
    return child;
  };
  return { spawnFn, calls };
}

const PATHS = visionPaths('/app');
const always = () => true;

test('validators', () => {
  assert.equal(isValidSampleId('0123456789abcdef-12'), true);
  assert.equal(isValidSampleId('../../etc/passwd'), false);
  assert.equal(isValidSampleId('0123456789abcdef'), false);
  assert.equal(isValidCardCode('10H'), true);
  assert.equal(isValidCardCode('JK'), true);
  assert.equal(isValidCardCode('1H'), false);
  assert.equal(photoExtension('image/jpeg'), '.jpg');
  assert.equal(photoExtension('image/PNG; charset=binary'), '.png');
  assert.equal(photoExtension('image/heic'), null);
  assert.equal(visionPaths('/app').model, path.join('/app', 'vision', 'models', 'cards.onnx'));
  assert.equal(visionPaths('/app').detector, path.join('/app', 'vision', 'models', 'corners.onnx'));
});

test('recognize sends the photo path and resolves with the cards', async () => {
  const cards = [{ id: 'x-0', code: '7D', confidence: 0.9 }];
  const { spawnFn, calls } = fakeSpawn(request => ({ id: request.id, cards }));
  const recognizer = createRecognizer(PATHS, { spawnFn, exists: always });
  assert.deepEqual(await recognizer.recognize('/tmp/photo.jpg'), { cards, ignoredAtEdge: 0 });
  assert.deepEqual(await recognizer.recognize('/tmp/photo2.jpg'), { cards, ignoredAtEdge: 0 });
  assert.equal(calls.length, 1, 'the worker is started once and reused');
  assert.deepEqual(calls[0].args, [PATHS.script, PATHS.detector, PATHS.model, PATHS.labels, PATHS.pending]);
  recognizer.stop();
});

test('a missing detector model means card recognition is not set up', async () => {
  const recognizer = createRecognizer(PATHS, { spawnFn: fakeSpawn(() => null).spawnFn, exists: file => file !== PATHS.detector });
  assert.equal(recognizer.available(), false);
  await assert.rejects(recognizer.recognize('/tmp/a.jpg'), { message: NOT_SET_UP });
});

test('worker errors, exits and timeouts reject the request', async () => {
  const failing = createRecognizer(PATHS, { spawnFn: fakeSpawn(request => ({ id: request.id, error: 'Could not read the photo.' })).spawnFn, exists: always });
  await assert.rejects(failing.recognize('/tmp/a.jpg'), /Could not read the photo/);

  const crashing = createRecognizer(PATHS, { spawnFn: fakeSpawn((request, child) => { setImmediate(() => child.emit('exit', 1)); }).spawnFn, exists: always });
  await assert.rejects(crashing.recognize('/tmp/a.jpg'), /stopped unexpectedly \(exit 1\)/);

  const silent = createRecognizer(PATHS, { spawnFn: fakeSpawn(() => null).spawnFn, exists: always, timeoutMs: 20 });
  await assert.rejects(silent.recognize('/tmp/a.jpg'), /timed out/);
  silent.stop();
});

test('not set up: recognize refuses and the HTTP helper answers 503', async () => {
  const recognizer = createRecognizer(PATHS, { spawnFn: fakeSpawn(() => null).spawnFn, exists: () => false });
  assert.equal(recognizer.available(), false);
  await assert.rejects(recognizer.recognize('/tmp/a.jpg'), { message: NOT_SET_UP });
  const reply = await recognizePhoto(recognizer, PATHS, Buffer.from('x'), 'image/jpeg');
  assert.deepEqual(reply, { status: 503, body: { error: NOT_SET_UP } });
});

test('recognizePhoto stores the upload only while recognising', async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'vision-'));
  try {
    const paths = { ...visionPaths(dir) };
    let seen = null;
    const recognizer = {
      available: () => true,
      recognize: async file => { seen = file; assert.equal(fs.readFileSync(file, 'utf8'), 'jpeg-bytes'); return [{ id: 'a-0', code: 'AS' }]; }
    };
    assert.deepEqual(await recognizePhoto(recognizer, paths, Buffer.from('jpeg-bytes'), 'image/jpeg'),
      { status: 200, body: { cards: [{ id: 'a-0', code: 'AS' }], ignoredAtEdge: 0 } });
    assert.match(seen, /\.jpg$/);
    assert.equal(fs.existsSync(seen), false);
    assert.equal((await recognizePhoto(recognizer, paths, Buffer.from('x'), 'image/heic')).status, 415);
    assert.equal((await recognizePhoto(recognizer, paths, Buffer.alloc(0), 'image/png')).status, 400);
    const broken = { available: () => true, recognize: async () => { throw new Error('boom'); } };
    assert.deepEqual(await recognizePhoto(broken, paths, Buffer.from('x'), 'image/png'), { status: 500, body: { error: 'boom' } });
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test('saveSamples moves confirmed crops into per-card folders', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'vision-'));
  try {
    const paths = visionPaths(dir);
    fs.mkdirSync(paths.pending, { recursive: true });
    fs.writeFileSync(path.join(paths.pending, '0123456789abcdef-0.jpg'), 'a');
    fs.writeFileSync(path.join(paths.pending, '0123456789abcdef-1.jpg'), 'b');
    const saved = saveSamples(paths, [
      { id: '0123456789abcdef-0', code: '7D' },
      { id: '0123456789abcdef-1', code: 'bad' },
      { id: '../x', code: 'AS' },
      { id: 'fedcba9876543210-0', code: 'AS' }
    ]);
    assert.equal(saved, 1);
    assert.equal(fs.readFileSync(path.join(paths.samples, '7D', '0123456789abcdef-0.jpg'), 'utf8'), 'a');
    assert.equal(fs.existsSync(path.join(paths.pending, '0123456789abcdef-1.jpg')), true);
    assert.equal(saveSamples(paths, 'nope'), 0);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test('prunePending removes crops older than a day', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'vision-'));
  try {
    fs.writeFileSync(path.join(dir, 'old.jpg'), 'x');
    fs.writeFileSync(path.join(dir, 'new.jpg'), 'x');
    const day = 24 * 60 * 60 * 1000;
    fs.utimesSync(path.join(dir, 'old.jpg'), new Date(Date.now() - 2 * day), new Date(Date.now() - 2 * day));
    assert.equal(prunePending(dir), 1);
    assert.deepEqual(fs.readdirSync(dir), ['new.jpg']);
    assert.equal(prunePending(path.join(dir, 'missing')), 0);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test('a crashed worker is restarted for the next request', async () => {
  let starts = 0;
  const { spawnFn } = fakeSpawn((request, child) => {
    if (starts === 1) { setImmediate(() => child.emit('exit', 1)); return null; }
    return { id: request.id, cards: [] };
  });
  const recognizer = createRecognizer(PATHS, { spawnFn: (...args) => { starts += 1; return spawnFn(...args); }, exists: always });
  await assert.rejects(recognizer.recognize('/tmp/a.jpg'), /stopped unexpectedly \(exit 1\)/);
  assert.deepEqual(await recognizer.recognize('/tmp/b.jpg'), { cards: [], ignoredAtEdge: 0 });
  assert.equal(starts, 2);
  recognizer.stop();
});

test('an error followed by an exit does not fail the replacement worker', async () => {
  const workers = [];
  const { spawnFn } = fakeSpawn(request => ({ id: request.id, cards: [{ id: 'ok' }] }));
  const recognizer = createRecognizer(PATHS, { spawnFn: (...args) => { const child = spawnFn(...args); workers.push(child); return child; }, exists: always });
  await recognizer.recognize('/tmp/a.jpg');
  workers[0].emit('error', new Error('boom'));
  const next = recognizer.recognize('/tmp/b.jpg'); // starts worker 2
  workers[0].emit('exit', 1); // late exit of worker 1
  assert.deepEqual(await next, { cards: [{ id: 'ok' }], ignoredAtEdge: 0 });
  recognizer.stop();
});

test('the edge count from the worker is passed on', async () => {
  const { spawnFn } = fakeSpawn(request => ({ id: request.id, cards: [], ignoredAtEdge: 2 }));
  const recognizer = createRecognizer(PATHS, { spawnFn, exists: always });
  assert.deepEqual(await recognizer.recognize('/tmp/a.jpg'), { cards: [], ignoredAtEdge: 2 });
  recognizer.stop();
});

test('a timed-out photo kills the stuck worker, fails the others, and the next photo gets a fresh worker', async () => {
  let starts = 0;
  const killed = [];
  const { spawnFn } = fakeSpawn(request => (starts === 1 ? null : { id: request.id, cards: [] }));
  const recognizer = createRecognizer(PATHS, {
    spawnFn: (...args) => {
      starts += 1;
      const child = spawnFn(...args);
      const kill = child.kill;
      child.kill = () => { killed.push(starts); kill(); };
      return child;
    },
    exists: always,
    timeoutMs: 30
  });
  const first = recognizer.recognize('/tmp/a.jpg');
  const second = recognizer.recognize('/tmp/b.jpg');
  await assert.rejects(first, /timed out/);
  await assert.rejects(second, /restarted/);
  assert.equal(killed.length, 1);
  assert.deepEqual(await recognizer.recognize('/tmp/c.jpg'), { cards: [], ignoredAtEdge: 0 });
  assert.equal(starts, 2);
  recognizer.stop();
});

test('output flushed by a killed worker does not corrupt the replacement worker', async () => {
  const workers = [];
  const { spawnFn } = fakeSpawn(request => (workers.length === 1 ? null : { id: request.id, cards: [] }));
  const recognizer = createRecognizer(PATHS, {
    spawnFn: (...args) => { const child = spawnFn(...args); workers.push(child); return child; },
    exists: always,
    timeoutMs: 30
  });
  await assert.rejects(recognizer.recognize('/tmp/a.jpg'), /timed out/);
  const next = recognizer.recognize('/tmp/b.jpg'); // starts worker 2
  workers[0].stdout.write('{"id": "half a li'); // the killed worker's last, unfinished line
  assert.deepEqual(await next, { cards: [], ignoredAtEdge: 0 });
  recognizer.stop();
});

test('a write error on the worker stdin rejects instead of crashing the server', async () => {
  const { spawnFn } = fakeSpawn((request, child) => { setImmediate(() => child.stdin.emit('error', new Error('EPIPE'))); return null; });
  const recognizer = createRecognizer(PATHS, { spawnFn, exists: always });
  await assert.rejects(recognizer.recognize('/tmp/a.jpg'), /EPIPE/);
});

test('a worker that never becomes ready times out and is killed', async () => {
  let killed = false;
  const { spawnFn } = fakeSpawn(() => null, { ready: false });
  const recognizer = createRecognizer(PATHS, {
    spawnFn: (...args) => { const child = spawnFn(...args); child.kill = () => { killed = true; }; return child; },
    exists: always, timeoutMs: 20
  });
  await assert.rejects(recognizer.recognize('/tmp/a.jpg'), /did not start in time/);
  assert.equal(killed, true);
});

test('replies split across chunks and concurrent requests are matched by id', async () => {
  const { spawnFn } = fakeSpawn(() => null);
  const recognizer = createRecognizer(PATHS, {
    spawnFn: (...args) => {
      const child = spawnFn(...args);
      const ids = [];
      child.stdin.on('data', chunk => String(chunk).split('\n').filter(Boolean).forEach(line => {
        ids.push(JSON.parse(line).id);
        if (ids.length === 2) { // answer in reverse order, each reply split mid-line
          ids.reverse().forEach((id, n) => {
            const line = `${JSON.stringify({ id, cards: [{ id: `c${n}` }] })}\n`;
            setTimeout(() => child.stdout.write(line.slice(0, 7)), n * 10);
            setTimeout(() => child.stdout.write(line.slice(7)), n * 10 + 5);
          });
        }
      }));
      return child;
    },
    exists: always
  });
  const [first, second] = await Promise.all([recognizer.recognize('/tmp/1.jpg'), recognizer.recognize('/tmp/2.jpg')]);
  assert.deepEqual(first.cards, [{ id: 'c1' }]);
  assert.deepEqual(second.cards, [{ id: 'c0' }]);
  recognizer.stop();
});

test('prunePending survives a file that disappears while scanning', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'vision-'));
  try {
    fs.writeFileSync(path.join(dir, 'a.jpg'), 'x');
    fs.symlinkSync(path.join(dir, 'nowhere'), path.join(dir, 'dangling.jpg')); // statSync throws ENOENT
    assert.equal(prunePending(dir, 0, Date.now() + 1000), 1);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test('saveSamples ignores malformed entries and cannot escape the sample folders', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'vision-'));
  try {
    const paths = visionPaths(dir);
    fs.mkdirSync(paths.pending, { recursive: true });
    fs.writeFileSync(path.join(paths.pending, '0123456789abcdef-0.jpg'), 'a');
    const hostile = [null, 5, 'x', {}, { id: '0123456789abcdef-0', code: '../../x' }, { id: '0123456789abcdef-0', code: 'AS\n' },
      { id: '0123456789abcdef-0\n', code: 'AS' }, { id: '0123456789abcdef-0', code: ['AS'] }];
    assert.equal(saveSamples(paths, hostile), 0);
    assert.equal(saveSamples(paths, { samples: [] }), 0);
    assert.equal(saveSamples(paths, null), 0);
    assert.equal(fs.existsSync(paths.samples), false);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test('readBody answers 413 for oversized uploads without dropping the connection', async () => {
  const server = http.createServer((req, res) => {
    readBody(req, 10)
      .then(body => ({ status: 200, text: String(body.length) }))
      .catch(error => ({ status: error.status || 400, text: error.message }))
      .then(({ status, text }) => { res.writeHead(status, { Connection: 'close' }); res.end(text); });
  });
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  const { port } = server.address();
  const send = body => new Promise((resolve, reject) => {
    const req = http.request({ port, host: '127.0.0.1', method: 'POST' }, res => {
      let text = '';
      res.on('data', chunk => { text += chunk; });
      res.on('end', () => resolve({ status: res.statusCode, text }));
    });
    req.on('error', reject);
    req.end(body);
  });
  try {
    assert.deepEqual(await send(Buffer.alloc(10)), { status: 200, text: '10' });
    assert.equal((await send(Buffer.alloc(11))).status, 413);
    assert.equal((await send(Buffer.alloc(200000))).status, 413);
  } finally {
    server.closeAllConnections?.();
    await new Promise(resolve => server.close(resolve));
  }
});
