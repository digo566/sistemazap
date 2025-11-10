const express = require('express');
const http = require('http');
const WebSocket = require('ws');
const { Client, LocalAuth } = require('whatsapp-web.js');
const qrcode = require('qrcode');
const path = require('path');

const app = express();
const server = http.createServer(app);
const wss = new WebSocket.Server({ server });

const clients = {};  // Armazenar clientes por ID de sessão

// Rota raiz - servir o arquivo HTML
app.get('/', (req, res) => {
    res.sendFile(path.join(__dirname, 'zap.html'));
});

// Função para criar cliente WhatsApp por sessão
function createWhatsAppClient(sessionId, ws) {
    // Verificar se já existe um cliente para essa sessão
    if (clients[sessionId]) {
        // Cliente já existe para essa sessão, não cria novamente
        return;
    }

    // Criar um novo cliente WhatsApp
    const client = new Client({
        authStrategy: new LocalAuth({
            dataPath: `./.wwebjs_auth/${sessionId}`
        }),
        puppeteer: {
            headless: true,
            args: [
                '--no-sandbox', '--disable-setuid-sandbox', '--disable-dev-shm-usage',
                '--disable-accelerated-2d-canvas', '--no-first-run', '--no-zygote', '--disable-gpu',
                '--disable-web-security', '--disable-features=IsolateOrigins,site-per-process',
                '--disable-blink-features=AutomationControlled', '--window-size=1920,1080', '--disable-extensions', '--disable-default-apps'
            ],
            ignoreHTTPSErrors: true,
            timeout: 120000,
            handleSIGINT: false,
            handleSIGTERM: false,
            handleSIGHUP: false
        },
    });

    // Armazenar o cliente criado para essa sessão
    clients[sessionId] = client;

    // Configurar eventos do cliente
    setupClientEvents(sessionId, ws, client);

    client.initialize().catch(error => {
        console.error('Erro ao inicializar cliente:', error);
        if (ws && ws.readyState === WebSocket.OPEN) {
            ws.send(JSON.stringify({
                type: 'error',
                message: 'Erro ao inicializar WhatsApp. Tente limpar o cache e reiniciar.'
            }));
        }
    });
}

// Função para configurar eventos do cliente WhatsApp
function setupClientEvents(sessionId, ws, client) {
    client.on('qr', async (qr) => {
        console.log(`QR Code gerado para a sessão ${sessionId}`);
        try {
            const qrImage = await qrcode.toDataURL(qr);
            if (ws && ws.readyState === WebSocket.OPEN) {
                ws.send(JSON.stringify({ type: 'qr', qr: qrImage }));
            }
        } catch (err) {
            console.error(`Erro ao gerar QR Code para a sessão ${sessionId}:`, err);
        }
    });

    client.on('ready', async () => {
        console.log(`WhatsApp conectado para a sessão ${sessionId}!`);
        if (ws && ws.readyState === WebSocket.OPEN) {
            ws.send(JSON.stringify({ type: 'ready' }));

            try {
                const contacts = await client.getContacts();
                const validContacts = contacts.filter(contact => contact.isUser && !contact.isGroup);
                const formattedContacts = validContacts.map(contact => ({
                    id: contact.id._serialized,
                    name: contact.pushname || contact.name || 'Sem nome',
                    number: contact.number || contact.id._serialized.replace('@c.us', '')
                }));

                if (ws && ws.readyState === WebSocket.OPEN) {
                    ws.send(JSON.stringify({ type: 'contacts', contacts: formattedContacts }));
                }
            } catch (error) {
                console.error(`Erro ao buscar contatos para a sessão ${sessionId}:`, error);
                if (ws && ws.readyState === WebSocket.OPEN) {
                    ws.send(JSON.stringify({ type: 'error', message: 'Erro ao buscar contatos: ' + error.message }));
                }
            }
        }
    });

    client.on('authenticated', () => {
        console.log(`Autenticado para a sessão ${sessionId}!`);
    });

    client.on('auth_failure', (msg) => {
        console.error(`Falha na autenticação para a sessão ${sessionId}:`, msg);
        if (ws && ws.readyState === WebSocket.OPEN) {
            ws.send(JSON.stringify({
                type: 'error',
                message: 'Falha na autenticação: ' + msg
            }));
        }
    });

    client.on('disconnected', async (reason) => {
        console.log(`Desconectado para a sessão ${sessionId}:`, reason);
        if (ws && ws.readyState === WebSocket.OPEN) {
            ws.send(JSON.stringify({
                type: 'error',
                message: 'Desconectado: ' + reason
            }));
        }

        // Tentar reconectar após 5 segundos
        setTimeout(() => {
            console.log(`Tentando reconectar para a sessão ${sessionId}...`);
            createWhatsAppClient(sessionId, ws);
        }, 5000);
    });
}

// WebSocket connection
wss.on('connection', (ws) => {
    console.log('Cliente WebSocket conectado');
    let sessionId = null;

    ws.on('message', async (message) => {
        try {
            const data = JSON.parse(message);

            if (data.action === 'connect') {
                // Gerar uma ID única para a sessão do usuário
                sessionId = data.sessionId || Date.now().toString();

                // Criar cliente WhatsApp para a sessão
                createWhatsAppClient(sessionId, ws);

            } else if (data.action === 'disconnect') {
                // Destruir o cliente para essa sessão
                if (sessionId && clients[sessionId]) {
                    await clients[sessionId].destroy();
                    delete clients[sessionId];
                }
            }
        } catch (error) {
            console.error('Erro ao processar mensagem:', error);
            if (ws.readyState === WebSocket.OPEN) {
                ws.send(JSON.stringify({ type: 'error', message: error.message }));
            }
        }
    });

    ws.on('close', () => {
        console.log('Cliente WebSocket desconectado');
        if (sessionId && clients[sessionId]) {
            delete clients[sessionId];
        }
    });
});

// Função para enviar mensagens com intervalo
async function sendMessagesToClients(clientsList, message, ws) {
    if (!ws || !ws.readyState === WebSocket.OPEN) return;

    const sessionClient = clients[clientsList];
    if (!sessionClient || !sessionClient.info) {
        ws.send(JSON.stringify({ type: 'error', message: 'WhatsApp não está conectado' }));
        return;
    }

    const total = clientsList.length;
    let sent = 0;

    for (const clientNumber of clientsList) {
        try {
            const number = clientNumber.includes('@c.us') ? clientNumber : `${clientNumber}@c.us`;
            await sessionClient.sendMessage(number, message);
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

const PORT = process.env.PORT || 3000;
const HOST = process.env.HOST || '0.0.0.0';

server.listen(PORT, HOST, () => {
    const localIP = getLocalIP();
    console.log(`Servidor rodando!`);
    console.log(`📍 Local:     http://localhost:${PORT}`);
    console.log(`🌐 Rede:      http://${localIP}:${PORT}`);
});

function getLocalIP() {
    const os = require('os');
    const interfaces = os.networkInterfaces();
    for (const name of Object.keys(interfaces)) {
        for (const iface of interfaces[name]) {
            if (iface.family === 'IPv4' && !iface.internal) {
                return iface.address;
            }
        }
    }
    return 'localhost';
}
