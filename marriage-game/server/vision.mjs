import { spawn } from 'node:child_process';
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';

export const MAX_PHOTO_BYTES = 25 * 1024 * 1024;
export const PENDING_MAX_AGE_MS = 24 * 60 * 60 * 1000;
const SAMPLE_ID = /^[a-f0-9]{16}-\d{1,3}$/;
const CARD_CODE = /^(?:(?:A|[2-9]|10|J|Q|K)[SHDC]|JK)$/;
const PHOTO_TYPES = { 'image/jpeg': '.jpg', 'image/jpg': '.jpg', 'image/png': '.png', 'image/webp': '.webp' };
export const NOT_SET_UP = 'Card recognition is not set up on this computer yet. See "Card recognition" in the README.';

export function isValidSampleId(id) {
  return typeof id === 'string' && SAMPLE_ID.test(id);
}

export function isValidCardCode(code) {
  return typeof code === 'string' && CARD_CODE.test(code);
}

export function photoExtension(contentType) {
  const type = String(contentType || '').split(';')[0].trim().toLowerCase();
  return PHOTO_TYPES[type] || null;
}

export function visionPaths(root) {
  return {
    python: path.join(root, 'vision', '.venv', 'bin', 'python'),
    script: path.join(root, 'vision', 'recognize.py'),
    model: path.join(root, 'vision', 'models', 'cards.onnx'),
    labels: path.join(root, 'vision', 'models', 'labels.json'),
    pending: path.join(root, 'data', 'vision', 'pending'),
    samples: path.join(root, 'data', 'vision', 'samples'),
    uploads: path.join(root, 'data', 'vision', 'uploads')
  };
}

// Keeps one Python worker (vision/recognize.py) running and matches its replies to requests.
export function createRecognizer(paths, { spawnFn = spawn, exists = fs.existsSync, timeoutMs = 60000 } = {}) {
  let worker = null;
  let ready = null;
  let buffer = '';
  const waiting = new Map();

  const available = () => [paths.python, paths.script, paths.model, paths.labels].every(file => exists(file));

  function failAll(error) {
    waiting.forEach(({ reject, timer }) => {
      clearTimeout(timer);
      reject(error);
    });
    waiting.clear();
  }

  function handleLine(line, markReady) {
    let message;
    try {
      message = JSON.parse(line);
    } catch {
      return;
    }
    if (message.ready) {
      markReady();
      return;
    }
    const entry = waiting.get(message.id);
    if (!entry) return;
    waiting.delete(message.id);
    clearTimeout(entry.timer);
    if (message.error) entry.reject(new Error(message.error));
    else entry.resolve(message.cards);
  }

  function start() {
    let markReady;
    let markFailed;
    ready = new Promise((resolve, reject) => {
      markReady = resolve;
      markFailed = reject;
    });
    ready.catch(() => {});
    buffer = '';
    worker = spawnFn(paths.python, [paths.script, paths.model, paths.labels, paths.pending], {
      cwd: path.dirname(paths.script),
      stdio: ['pipe', 'pipe', 'pipe']
    });
    worker.stdout.setEncoding('utf8');
    worker.stdout.on('data', chunk => {
      buffer += chunk;
      let newline;
      while ((newline = buffer.indexOf('\n')) >= 0) {
        const line = buffer.slice(0, newline);
        buffer = buffer.slice(newline + 1);
        handleLine(line, markReady);
      }
    });
    worker.stderr.on('data', chunk => console.error('[vision]', String(chunk).trim()));
    const child = worker;
    const stopped = (error) => {
      if (worker !== child) return; // already handled (error is followed by exit), or replaced by a newer worker
      markFailed(error);
      failAll(error);
      worker = null;
    };
    // A write to a dead worker emits 'error' on stdin; unhandled, it would crash the whole server.
    child.stdin.on('error', error => stopped(new Error(`Card recognition stopped unexpectedly (${error.message}).`)));
    child.on('exit', code => stopped(new Error(`Card recognition stopped unexpectedly (exit ${code}).`)));
    child.on('error', error => stopped(new Error(`Card recognition could not start: ${error.message}`)));
  }

  // A worker that never says "ready" (stuck loading the model) must not hang every request.
  function waitUntilReady() {
    let timer;
    const starting = worker;
    const timeout = new Promise((_, reject) => {
      timer = setTimeout(() => {
        if (worker === starting && starting) {
          worker = null;
          starting.kill();
        }
        reject(new Error('Card recognition did not start in time.'));
      }, timeoutMs);
    });
    return Promise.race([ready, timeout]).finally(() => clearTimeout(timer));
  }

  async function recognize(photoPath) {
    if (!available()) throw new Error(NOT_SET_UP);
    if (!worker) start();
    await waitUntilReady();
    const id = crypto.randomBytes(8).toString('hex');
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        waiting.delete(id);
        reject(new Error('Card recognition timed out.'));
      }, timeoutMs);
      waiting.set(id, { resolve, reject, timer });
      if (!worker) {
        waiting.delete(id);
        clearTimeout(timer);
        reject(new Error('Card recognition stopped unexpectedly.'));
        return;
      }
      worker.stdin.write(`${JSON.stringify({ id, path: photoPath })}\n`);
    });
  }

  function stop() {
    if (worker) worker.kill();
  }

  return { available, recognize, stop };
}

export function readBody(req, limit) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    let size = 0;
    if (Number(req.headers && req.headers['content-length']) > limit) {
      reject(Object.assign(new Error('The photo is too large.'), { status: 413 }));
      return;
    }
    req.on('data', chunk => {
      size += chunk.length;
      if (size > limit) {
        // Stop buffering but keep the socket so the 413 reply can reach the client;
        // the route closes the connection after replying.
        if (chunks.length) chunks.length = 0;
        if (size - chunk.length <= limit) reject(Object.assign(new Error('The photo is too large.'), { status: 413 }));
        return;
      }
      chunks.push(chunk);
    });
    req.on('end', () => resolve(Buffer.concat(chunks)));
    req.on('error', reject);
  });
}

// Recognise the cards in one uploaded photo. Returns { status, body } for the HTTP reply.
export async function recognizePhoto(recognizer, paths, photo, contentType) {
  if (!recognizer.available()) return { status: 503, body: { error: NOT_SET_UP } };
  const extension = photoExtension(contentType);
  if (!extension) return { status: 415, body: { error: 'Send the photo as JPEG, PNG or WebP.' } };
  if (!photo.length) return { status: 400, body: { error: 'The photo is empty.' } };
  fs.mkdirSync(paths.uploads, { recursive: true });
  const file = path.join(paths.uploads, `${crypto.randomBytes(8).toString('hex')}${extension}`);
  fs.writeFileSync(file, photo);
  try {
    const cards = await recognizer.recognize(file);
    return { status: 200, body: { cards } };
  } catch (error) {
    return { status: 500, body: { error: error.message } };
  } finally {
    fs.rmSync(file, { force: true });
    prunePending(paths.pending);
  }
}

// Keep confirmed crops as training samples: data/vision/samples/<code>/<id>.jpg.
export function saveSamples(paths, samples) {
  let saved = 0;
  (Array.isArray(samples) ? samples : []).forEach(sample => {
    if (!sample || !isValidSampleId(sample.id) || !isValidCardCode(sample.code)) return;
    const source = path.join(paths.pending, `${sample.id}.jpg`);
    if (!fs.existsSync(source)) return;
    const folder = path.join(paths.samples, sample.code);
    fs.mkdirSync(folder, { recursive: true });
    fs.renameSync(source, path.join(folder, `${sample.id}.jpg`));
    saved += 1;
  });
  return saved;
}

export function prunePending(dir, maxAgeMs = PENDING_MAX_AGE_MS, now = Date.now()) {
  if (!fs.existsSync(dir)) return 0;
  let removed = 0;
  fs.readdirSync(dir).forEach(name => {
    const file = path.join(dir, name);
    try {
      if (now - fs.statSync(file).mtimeMs > maxAgeMs) {
        fs.rmSync(file, { force: true });
        removed += 1;
      }
    } catch {
      // Gone already (a crop was just kept as a sample): nothing to prune.
    }
  });
  return removed;
}
