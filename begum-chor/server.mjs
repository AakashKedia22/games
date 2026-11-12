import http from 'http';
import { WebSocketServer } from 'ws';
import fs from 'fs';
import os from 'os';
import path from 'path';
import { fileURLToPath } from 'url';
import { pickLanAddresses } from './server/net.mjs';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const PORT = process.env.PORT || 3001;
const sessions = {};

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
    let filePath = path.join(buildPath, req.url === '/' ? 'index.html' : req.url.split('?')[0]);
    if (fs.existsSync(filePath) && fs.statSync(filePath).isFile()) {
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
    res.end('Begam Chor Server (build not found, run npm run build)');
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
    try {
      const msg = JSON.parse(data);

      switch (msg.type) {
        case 'create_session': {
          let code;
          do {
            code = `BC-${Math.floor(1000 + Math.random() * 9000)}`;
          } while (sessions[code]);

          const defaultPlayers = ['Aakash', 'Shreya', 'Aryan', 'Paa', 'Maa'];
          const session = {
            players: defaultPlayers,
            scores: [defaultPlayers.map(p => ({ player: p, score: 0 }))],
            clients: []
          };
          sessions[code] = session;
          ws.sessionId = code;
          session.clients.push(ws);

          ws.send(JSON.stringify({
            type: 'session_created',
            sessionId: code,
            players: session.players,
            scores: session.scores
          }));
          break;
        }

        case 'join_session': {
          const session = sessions[msg.sessionId];
          if (!session) {
            ws.send(JSON.stringify({ type: 'error', message: 'Session not found. Check the code and try again.' }));
            return;
          }

          ws.sessionId = msg.sessionId;
          session.clients.push(ws);

          ws.send(JSON.stringify({
            type: 'session_joined',
            sessionId: msg.sessionId,
            players: session.players,
            scores: session.scores
          }));
          break;
        }

        case 'update_scores': {
          const session = sessions[msg.sessionId];
          if (!session) return;

          session.players = msg.players;
          session.scores = msg.scores;

          const broadcast = JSON.stringify({ type: 'session_update', players: msg.players, scores: msg.scores });
          session.clients.forEach(client => {
            if (client.readyState === 1) {
              client.send(broadcast);
            }
          });
          break;
        }
      }
    } catch (e) {
      console.error('Invalid message:', e);
    }
  });

  ws.on('close', () => {
    if (ws.sessionId && sessions[ws.sessionId]) {
      sessions[ws.sessionId].clients = sessions[ws.sessionId].clients.filter(c => c !== ws);
    }
  });
});

server.listen(PORT, '0.0.0.0', () => {
  const port = server.address().port;
  const addresses = pickLanAddresses(os.networkInterfaces());
  console.log(`Begam Chor server running:`);
  console.log(`  Local:   http://localhost:${port}`);
  addresses.forEach(address => console.log(`  Network: http://${address}:${port}`));
  if (!addresses.length) console.log('  Network: no private IPv4 address detected');
});
