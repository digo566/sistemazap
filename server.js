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
function createWhatsAppClient(sessionId) {
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
        const qrImage = await qrcode.toDataURL(qr);
        console.log(`QR Code gerado para a sessão ${sessionId}`);
        // Enviar QR Code para o frontend via WebSocket
    });

    client.on('ready', () => {
        console.log(`WhatsApp conectado para a sessão ${sessionId}!`);
    });

    client.on('disconnected', (reason) => {
        console.log(`Desconectado para a sessão ${sessionId}:`, reason);
        // Reconectar automaticamente após a desconexão
        setTimeout(() => {
            console.log(`Tentando reconectar para a sessão ${sessionId}...`);
            createWhatsAppClient(sessionId);  // Reconectar cliente
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
            createWhatsAppClient(sessionId);

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

// Função para enviar mensagens com intervalo
async function sendMessagesToClients(sessionId, clientsList, message, ws) {
    if (!clients[sessionId]) {
        ws.send(JSON.stringify({ type: 'error', message: 'WhatsApp não está conectado' }));
        return;
    }

    const client = clients[sessionId];
    const total = clientsList.length;
    let sent = 0;

    for (const clientNumber of clientsList) {
        try {
            const number = clientNumber.includes('@c.us') ? clientNumber : `${clientNumber}@c.us`;
            await client.sendMessage(number, message);
            sent++;

            if (ws && ws.readyState === WebSocket.OPEN) {
                ws.send(JSON.stringify({
                    type: 'messageStatus',
                    status: sent < total ? 'sending' : 'completed',
                    sent: sent,
                    total: total
                }));
            }

            if (sent < total) {
                await new Promise(resolve => setTimeout(resolve, 10000));  // Espera de 10 segundos entre envios
            }
        } catch (error) {
            console.error(`Erro ao enviar para ${clientNumber}:`, error);
            if (ws && ws.readyState === WebSocket.OPEN) {
                ws.send(JSON.stringify({
                    type: 'messageStatus',
                    status: 'error',
                    message: `Erro ao enviar para ${clientNumber}: ${error.message}`
                }));
            }
        }
    }

    if (ws && ws.readyState === WebSocket.OPEN) {
        ws.send(JSON.stringify({
            type: 'messageStatus',
            status: 'completed',
            sent: sent,
            total: total
        }));
    }
}

server.listen(3000, () => {
    console.log('Servidor rodando na porta 3000');
});
