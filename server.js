const express = require('express');
const http = require('http');
const WebSocket = require('ws');
const { Client, LocalAuth } = require('whatsapp-web.js');
const qrcode = require('qrcode');
const path = require('path');

const app = express();
const server = http.createServer(app);
const wss = new WebSocket.Server({ server });

let clients = {};

// Rota raiz - servir o arquivo HTML
app.get('/', (req, res) => {
  res.sendFile(path.join(__dirname, 'zap.html'));
});

function createWhatsAppClient(sessionId, ws) {
  if (clients[sessionId]) return;

  const client = new Client({
    authStrategy: new LocalAuth({
      dataPath: `./.wwebjs_auth/${sessionId}`
    }),
    puppeteer: {
      headless: true,
      args: ['--no-sandbox', '--disable-setuid-sandbox'],
      ignoreHTTPSErrors: true,
    },
  });

  clients[sessionId] = client;

  client.on('qr', async (qr) => {
    const qrImage = await qrcode.toDataURL(qr);
    ws.send(JSON.stringify({ type: 'qr', qr: qrImage, sessionId: sessionId }));
  });

  client.on('ready', () => {
    ws.send(JSON.stringify({ type: 'ready' }));
  });

  client.on('disconnected', () => {
    setTimeout(() => {
      createWhatsAppClient(sessionId, ws);
    }, 5000);
  });

  client.initialize();
}

// WebSocket connection
wss.on('connection', (ws) => {
  let sessionId = null;

  ws.on('message', async (message) => {
    const data = JSON.parse(message);
    
    if (data.action === 'connect') {
      sessionId = data.sessionId || Date.now().toString();
      createWhatsAppClient(sessionId, ws);
      ws.send(JSON.stringify({ type: 'connected', sessionId: sessionId }));
    }
  });

  ws.on('close', () => {
    if (sessionId && clients[sessionId]) {
      clients[sessionId].destroy();
      delete clients[sessionId];
    }
  });
});

server.listen(3000, () => {
  console.log('Servidor rodando na porta 3000');
});
