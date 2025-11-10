const express = require('express');
const http = require('http');
const WebSocket = require('ws');
const { Client, LocalAuth } = require('whatsapp-web.js');
const qrcode = require('qrcode');
const path = require('path');

const app = express();
const server = http.createServer(app);
const wss = new WebSocket.Server({ server });

// Armazenar o cliente WhatsApp
let clients = {};

// Rota raiz - servir o arquivo HTML
app.get('/', (req, res) => {
  res.sendFile(path.join(__dirname, 'zap.html'));
});

// Função para criar cliente WhatsApp
function createWhatsAppClient(sessionId, ws) {
  // Verificar se já existe um cliente para essa sessão
  if (clients[sessionId]) return;  // Se já existir, não cria novamente

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

  // Armazenar o cliente para essa sessão
  clients[sessionId] = client;

  client.on('qr', async (qr) => {
    console.log(`QR Code gerado para a sessão ${sessionId}`);
    try {
      const qrImage = await qrcode.toDataURL(qr);  // Gera o QR Code em base64
      // Envia o QR Code via WebSocket
      ws.send(JSON.stringify({ type: 'qr', qr: qrImage }));
    } catch (err) {
      console.error(`Erro ao gerar QR Code para a sessão ${sessionId}:`, err);
    }
  });

  client.on('ready', () => {
    console.log(`WhatsApp conectado para a sessão ${sessionId}!`);
    ws.send(JSON.stringify({ type: 'ready' }));
  });

  client.on('disconnected', (reason) => {
    console.log(`Desconectado para a sessão ${sessionId}:`, reason);
    // Reconectar automaticamente após a desconexão
    setTimeout(() => {
      console.log(`Tentando reconectar para a sessão ${sessionId}...`);
      createWhatsAppClient(sessionId, ws);  // Reconectar cliente
    }, 5000);
  });

  client.initialize();
}

// WebSocket connection
wss.on('connection', (ws) => {
  console.log('Cliente WebSocket conectado');
  let sessionId = null;

  ws.on('message', async (message) => {
    const data = JSON.parse(message);

    // Gerar uma ID única para a sessão do usuário
    if (data.action === 'connect') {
      sessionId = data.sessionId || Date.now().toString();
      console.log(`Nova conexão para a sessão ${sessionId}`);

      // Criar ou conectar o cliente WhatsApp
      createWhatsAppClient(sessionId, ws);

      // Enviar mensagem inicial ou status para o frontend (QR Code, etc.)
      ws.send(JSON.stringify({ type: 'connected', sessionId: sessionId }));
    } else if (data.action === 'disconnect') {
      // Desconectar o cliente WhatsApp para essa sessão
      if (sessionId && clients[sessionId]) {
        await clients[sessionId].destroy();
        delete clients[sessionId];
      }
    }
  });

  ws.on('close', () => {
    console.log('Cliente WebSocket desconectado');
    // O cliente WhatsApp permanece ativo, mesmo com a desconexão da WebSocket
  });
});

server.listen(3000, () => {
  console.log('Servidor rodando na porta 3000');
});


