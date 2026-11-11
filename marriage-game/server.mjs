import http from 'http';
import { WebSocketServer } from 'ws';
import fs from 'fs';
import os from 'os';
import path from 'path';
import { fileURLToPath } from 'url';
import { pickLanAddresses } from './server/net.mjs';
import { resolveBuildFile } from './server/static.mjs';
import {
  applyUndo, applyUpdate, createSession, deleteGame, finishGame, generateCode, loadSessions, publicState, saveSessions
} from './server/sessions.mjs';
import { MAX_PHOTO_BYTES, createRecognizer, readBody, recognizePhoto, saveSamples, visionPaths } from './server/vision.mjs';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const PORT = process.env.PORT || 3001;
const DATA_FILE = process.env.DATA_FILE || path.join(__dirname, 'data', 'sessions.json');
const sessions = loadSessions(DATA_FILE);
const VISION = visionPaths(__dirname);
const recognizer = createRecognizer(VISION);

function sendJson(res, status, body) {
  const headers = { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' };
  if (status === 413) headers.Connection = 'close'; // the rest of the oversized upload is not read
  res.writeHead(status, headers);
  res.end(JSON.stringify(body));
}

function persist() {
  try {
    saveSessions(DATA_FILE, sessions);
  } catch (error) {
    console.error('Could not save sessions:', error.message);
  }
}

function send(ws, payload) {
  if (ws.readyState === 1) ws.send(JSON.stringify(payload));
}

function broadcast(session) {
  const message = { type: 'session_update', ...publicState(session) };
  session.clients.forEach(client => send(client, message));
}

function detach(ws) {
  if (ws.sessionId && sessions[ws.sessionId]) {
    sessions[ws.sessionId].clients = sessions[ws.sessionId].clients.filter(client => client !== ws);
  }
  ws.sessionId = null;
}

const wss = new WebSocketServer({ noServer: true });

const server = http.createServer((req, res) => {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

  if (req.method === 'OPTIONS') {
    res.writeHead(204);
    res.end();
    return;
  }

  const buildPath = path.join(__dirname, 'build');
  const requestPath = req.url.split('?')[0];
  if (requestPath === '/health') {
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ ok: true }));
    return;
  }
  if (requestPath === '/api/vision' && req.method === 'GET') {
    sendJson(res, 200, { available: recognizer.available() });
    return;
  }
  if (requestPath === '/api/recognize' && req.method === 'POST') {
    readBody(req, MAX_PHOTO_BYTES)
      .then(photo => recognizePhoto(recognizer, VISION, photo, req.headers['content-type']))
      .catch(error => ({ status: error.status || 400, body: { error: error.message } }))
      .then(({ status, body }) => sendJson(res, status, body));
    return;
  }
  if (requestPath === '/api/training-samples' && req.method === 'POST') {
    readBody(req, 1024 * 1024)
      .then(raw => ({ status: 200, body: { saved: saveSamples(VISION, JSON.parse(raw.toString('utf8') || '{}').samples) } }))
      .catch(error => ({ status: error.status || 400, body: { error: 'Could not save the samples.' } }))
      .then(({ status, body }) => sendJson(res, status, body));
    return;
  }
  if (requestPath === '/api/info') {
    const addresses = pickLanAddresses(os.networkInterfaces());
    const port = server.address()?.port || Number(PORT);
    res.writeHead(200, {
      'Content-Type': 'application/json',
      'Cache-Control': 'no-store'
    });
    res.end(JSON.stringify({
      ip: addresses[0] || null,
      addresses,
      port,
      hostname: os.hostname(),
      urls: addresses.map(address => `http://${address}:${port}`)
    }));
    return;
  }
  if (fs.existsSync(buildPath)) {
    const filePath = resolveBuildFile(buildPath, req.url);
    if (filePath && fs.existsSync(filePath) && fs.statSync(filePath).isFile()) {
      const ext = path.extname(filePath);
      const mimeTypes = {
        '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css',
        '.json': 'application/json', '.png': 'image/png', '.jpg': 'image/jpg',
        '.svg': 'image/svg+xml', '.ico': 'image/x-icon',
      };
      res.writeHead(200, { 'Content-Type': mimeTypes[ext] || 'text/plain' });
      res.end(fs.readFileSync(filePath));
      return;
    }
    res.writeHead(200, { 'Content-Type': 'text/html' });
    res.end(fs.readFileSync(path.join(buildPath, 'index.html')));
  } else {
    res.writeHead(200, { 'Content-Type': 'text/plain' });
    res.end('Marriage Server (build not found, run npm run build)');
  }
});

server.on('upgrade', (request, socket, head) => {
  wss.handleUpgrade(request, socket, head, (ws) => {
    wss.emit('connection', ws, request);
  });
});

wss.on('connection', (ws) => {
  ws.sessionId = null;

  ws.on('message', (data) => {
    let msg;
    try {
      msg = JSON.parse(data);
    } catch (error) {
      console.error('Invalid message:', error);
      return;
    }

    switch (msg.type) {
      case 'create_session': {
        detach(ws);
        const code = generateCode(sessions);
        const session = createSession();
        sessions[code] = session;
        ws.sessionId = code;
        session.clients.push(ws);
        persist();
        send(ws, { type: 'session_created', sessionId: code, ...publicState(session) });
        break;
      }
      case 'join_session': {
        const code = String(msg.sessionId || '').trim().toUpperCase();
        const session = sessions[code];
        if (!session) {
          send(ws, { type: 'error', message: 'Session not found. Check the code and try again.' });
          return;
        }
        detach(ws);
        ws.sessionId = code;
        session.clients.push(ws);
        send(ws, { type: 'session_joined', sessionId: code, ...publicState(session) });
        break;
      }
      case 'update_game': {
        const session = sessions[msg.sessionId];
        if (!session) {
          send(ws, { type: 'error', message: 'Session not found. Check the code and try again.' });
          return;
        }
        if (!applyUpdate(session, msg)) {
          send(ws, { type: 'update_rejected', message: 'The server rejected that change. Refresh and try again.' });
          return;
        }
        persist();
        broadcast(session);
        break;
      }
      case 'undo': {
        const session = sessions[msg.sessionId];
        if (!session) {
          send(ws, { type: 'error', message: 'Session not found. Check the code and try again.' });
          return;
        }
        if (!applyUndo(session)) {
          send(ws, { type: 'update_rejected', message: 'Nothing to undo.' });
          return;
        }
        persist();
        broadcast(session);
        break;
      }
      case 'finish_game':
      case 'delete_game': {
        const session = sessions[msg.sessionId];
        if (!session) {
          send(ws, { type: 'error', message: 'Session not found. Check the code and try again.' });
          return;
        }
        const changed = msg.type === 'finish_game' ? finishGame(session) : deleteGame(session, msg.index);
        if (!changed) {
          send(ws, {
            type: 'update_rejected',
            message: msg.type === 'finish_game'
              ? 'Play at least one round before finishing the game.'
              : 'That game could not be deleted. Refresh and try again.'
          });
          return;
        }
        persist();
        broadcast(session);
        break;
      }
      default:
        break;
    }
  });

  ws.on('close', () => detach(ws));
});

server.listen(PORT, '0.0.0.0', () => {
  const port = server.address().port;
  const addresses = pickLanAddresses(os.networkInterfaces());
  console.log('Marriage server running:');
  console.log(`  Local:   http://localhost:${port}`);
  addresses.forEach(address => console.log(`  Network: http://${address}:${port}`));
  if (!addresses.length) console.log('  Network: no private IPv4 address detected');
  console.log(`  Data:    ${DATA_FILE}`);
  console.log(`  Cards:   ${recognizer.available() ? 'photo recognition ready' : 'photo recognition not set up (see README)'}`);
});
