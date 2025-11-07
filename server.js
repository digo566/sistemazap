// server.js
const express = require('express');
const http = require('http');
const WebSocket = require('ws');
const { Client, LocalAuth } = require('whatsapp-web.js');
const qrcode = require('qrcode');
const path = require('path');
const fs = require('fs');

const app = express();
const server = http.createServer(app);
const wss = new WebSocket.Server({ server });

const FLOWS_DIR = path.join(__dirname, 'flows');
if (!fs.existsSync(FLOWS_DIR)) fs.mkdirSync(FLOWS_DIR, { recursive: true });

let automationFlow = null;
const conversationStates = new Map();
const INACTIVITY_TIMEOUT = 10 * 60 * 1000; // 10 minutos

app.use(express.static(__dirname));
app.get('/', (req, res) => res.sendFile(path.join(__dirname, 'zap.html')));

let client = null;

// util
function normalizeText(text = '') {
  return String(text || '')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .trim();
}

function timestampFilename() {
  const d = new Date();
  // format: flow-YYYY-MM-DDTHH-MM-SSZ.json (safe chars)
  const iso = d.toISOString().replace(/:/g, '-');
  return `flow-${iso}.json`;
}

// normaliza e protege a estrutura
function normalizeFlowStructure(flow) {
  const prepared = JSON.parse(JSON.stringify(flow || {}));
  prepared.version = prepared.version || '1.0.0';
  prepared.nodes = prepared.nodes || {};
  prepared.inactivityMessage = prepared.inactivityMessage || 'Olá! Notamos que você não respondeu. Ainda está interessado?';

  Object.entries(prepared.nodes).forEach(([id, node]) => {
    node.id = node.id || id;
    node.type = node.type || 'question';
    node.text = node.text || '';
    node.defaultReply = node.defaultReply || null;
    node.upsellDelay = node.upsellDelay ? Number(node.upsellDelay) : null;
    node.upsellMessage = node.upsellMessage || null;
    node.options = Array.isArray(node.options) ? node.options : [];
    node.options = node.options.map(opt => ({
      label: String(opt.label || ''),
      normalizedLabel: normalizeText(opt.label || ''),
      matchType: opt.matchType === 'contains' ? 'contains' : 'equals',
      replyMessage: opt.replyMessage ? String(opt.replyMessage) : null,
      nextNodeId: opt.nextNodeId || null,
      followupTrigger: opt.followupTrigger || null,
      followupTriggerNormalized: opt.followupTrigger ? normalizeText(opt.followupTrigger) : null,
      followupMessage: opt.followupMessage || null
    }));
  });

  // ensure startNodeId valid
  if (!prepared.startNodeId || !prepared.nodes[prepared.startNodeId]) {
    const keys = Object.keys(prepared.nodes);
    prepared.startNodeId = keys.length ? keys[0] : null;
  }
  return prepared;
}

// persist flow to disk (auto filename)
function saveFlowToDiskAuto(flowObj) {
  const filename = timestampFilename();
  const full = path.join(FLOWS_DIR, filename);
  fs.writeFileSync(full, JSON.stringify(flowObj, null, 2), 'utf8');
  return filename;
}

// load latest flow (optional)
function loadLatestFlowIfExists() {
  try {
    const files = fs.readdirSync(FLOWS_DIR)
      .filter(f => f.startsWith('flow-') && f.endsWith('.json'))
      .sort((a,b) => fs.statSync(path.join(FLOWS_DIR,b)).mtimeMs - fs.statSync(path.join(FLOWS_DIR,a)).mtimeMs);
    if (files.length === 0) return null;
    const latest = files[0];
    const raw = fs.readFileSync(path.join(FLOWS_DIR, latest), 'utf8');
    const parsed = JSON.parse(raw);
    console.log('Carregado fluxo salvo:', latest);
    return parsed;
  } catch (err) {
    console.warn('Nenhum fluxo salvo para carregar:', err.message || err);
    return null;
  }
}

// state timers cleanup
function resetAutomationState() {
  conversationStates.forEach(s => {
    if (s.timeoutId) clearTimeout(s.timeoutId);
    if (s.upsellTimeoutId) clearTimeout(s.upsellTimeoutId);
  });
  conversationStates.clear();
}

function clearConversationTimeouts(chatId) {
  const s = conversationStates.get(chatId);
  if (!s) return;
  if (s.timeoutId) clearTimeout(s.timeoutId);
  if (s.upsellTimeoutId) clearTimeout(s.upsellTimeoutId);
  s.timeoutId = null;
  s.upsellTimeoutId = null;
}

function setConversationTimeout(chatId) {
  clearConversationTimeouts(chatId);
  const t = setTimeout(async () => {
    try {
      const st = conversationStates.get(chatId);
      if (!st || !client) return;
      const msg = automationFlow?.inactivityMessage || 'Olá! Notamos que você não respondeu. Ainda está interessado?';
      await client.sendMessage(chatId, msg);
      st.lastMessageTime = Date.now();
      setConversationTimeout(chatId);
    } catch (err) {
      console.error('Erro inatividade:', err);
    }
  }, INACTIVITY_TIMEOUT);
  const s = conversationStates.get(chatId);
  if (s) s.timeoutId = t;
}

function setNodeUpsellTimeout(chatId, node) {
  const s = conversationStates.get(chatId);
  if (!s || !node || !node.upsellDelay || !node.upsellMessage) return;
  if (s.upsellTimeoutId) clearTimeout(s.upsellTimeoutId);
  const delayMs = Number(node.upsellDelay) * 60 * 1000;
  s.upsellTimeoutId = setTimeout(async () => {
    try {
      const cur = conversationStates.get(chatId);
      if (!cur) return;
      await client.sendMessage(chatId, node.upsellMessage);
      clearConversationTimeouts(chatId);
      conversationStates.delete(chatId);
      console.log(`Upsell por tempo enviado para ${chatId} (node ${node.id}) e estado resetado`);
    } catch (err) { console.error('Erro upsell por tempo:', err); }
  }, delayMs);
}

// WhatsApp client creation
function createWhatsAppClient(ws) {
  if (client) {
    try { client.destroy(); } catch(e){}
    client = null;
  }
  setTimeout(() => {
    client = new Client({
      authStrategy: new LocalAuth({ dataPath: './.wwebjs_auth' }),
      puppeteer: { headless: true, args: ['--no-sandbox','--disable-setuid-sandbox'] }
    });
    setupClientEvents(ws);
    client.initialize().catch(err => console.error('Erro init client:', err));
  }, 800);
}

function setupClientEvents(ws) {
  if (!client) return;

  client.on('qr', async qr => {
    try {
      const q = await qrcode.toDataURL(qr);
      if (ws && ws.readyState === WebSocket.OPEN) ws.send(JSON.stringify({ type: 'qr', qr: q }));
    } catch (err) { console.error('Erro QR:', err); }
  });

  client.on('ready', async () => {
    console.log('WhatsApp pronto');
    if (ws && ws.readyState === WebSocket.OPEN) ws.send(JSON.stringify({ type: 'ready' }));
    try {
      const contacts = await client.getContacts();
      const valid = contacts.filter(c => c.isUser && c.number && !c.isGroup);
      if (ws && ws.readyState === WebSocket.OPEN) ws.send(JSON.stringify({ type: 'contacts', contacts: valid }));
    } catch (err) { console.error('Erro buscar contatos:', err); }
  });

  client.on('authenticated', () => console.log('Autenticado'));
  client.on('auth_failure', (msg) => {
    console.error('Auth failure', msg);
    if (ws && ws.readyState === WebSocket.OPEN) ws.send(JSON.stringify({ type: 'error', message: 'Falha na autenticação: ' + msg }));
  });

  client.on('disconnected', reason => {
    console.log('Desconectado', reason);
    if (ws && ws.readyState === WebSocket.OPEN) ws.send(JSON.stringify({ type: 'error', message: 'Desconectado: ' + reason }));
    resetAutomationState();
  });

  // message handling
  client.on('message', async messageEvent => {
    try {
      if (!automationFlow || !automationFlow.startNodeId) return;
      if (!messageEvent || messageEvent.fromMe) return;

      const chatId = messageEvent.from;
      if (!chatId) return;

      let inputText = '';
      if (messageEvent.type === 'chat' || messageEvent.body) inputText = messageEvent.body || '';
      else if (messageEvent.message && messageEvent.message.conversation) inputText = messageEvent.message.conversation || '';
      inputText = inputText.trim();
      if (!inputText) return;

      const normalizedInput = normalizeText(inputText);
      let state = conversationStates.get(chatId);

      if (!state) {
        const startNode = automationFlow.nodes[automationFlow.startNodeId];
        if (!startNode) return;
        conversationStates.set(chatId, {
          currentNodeId: startNode.id,
          lastMessageTime: Date.now(),
          timeoutId: null,
          upsellTimeoutId: null,
          awaitingOption: null
        });
        await client.sendMessage(chatId, startNode.text);
        setConversationTimeout(chatId);
        setNodeUpsellTimeout(chatId, startNode);
        return;
      }

      // if awaiting option followupTrigger exists, check it first
      if (state.awaitingOption && state.awaitingOption.followupTriggerNormalized) {
        if (normalizedInput === state.awaitingOption.followupTriggerNormalized &&
            normalizedInput !== state.awaitingOption.expectedReplyNormalized) {
          if (state.awaitingOption.followupMessage) {
            await client.sendMessage(chatId, state.awaitingOption.followupMessage);
            // keep conversation where it is (you requested not to reset here)
          }
        }
      }

      // renew inactivity timeout
      state.lastMessageTime = Date.now();
      setConversationTimeout(chatId);

      const node = automationFlow.nodes[state.currentNodeId];
      if (!node) {
        clearConversationTimeouts(chatId);
        conversationStates.delete(chatId);
        return;
      }

      // try to match an option
      let matched = null;
      for (const opt of node.options) {
        if (!opt.normalizedLabel) continue;
        if (opt.matchType === 'contains') {
          if (normalizedInput.includes(opt.normalizedLabel)) { matched = opt; break; }
        } else {
          if (normalizedInput === opt.normalizedLabel) { matched = opt; break; }
        }
      }

      if (!matched) {
        // send defaultReply or repeat question
        if (node.defaultReply) await client.sendMessage(chatId, node.defaultReply);
        else if (node.text) await client.sendMessage(chatId, node.text);
        setNodeUpsellTimeout(chatId, node);
        return;
      }

      // matched option: send replyMessage if exists
      if (matched.replyMessage) {
        await client.sendMessage(chatId, matched.replyMessage);
      }

      // register awaitingOption for followupTrigger logic
      state.awaitingOption = {
        expectedReplyNormalized: matched.replyMessage ? normalizeText(matched.replyMessage) : null,
        followupTriggerNormalized: matched.followupTriggerNormalized || null,
        followupMessage: matched.followupMessage || null
      };

      // schedule upsell by time for this node if configured
      if (node.upsellDelay && node.upsellMessage) setNodeUpsellTimeout(chatId, node);

      // next node behavior: if matched.nextNodeId exists and valid, go to it
      if (matched.nextNodeId && automationFlow.nodes[matched.nextNodeId]) {
        const nextNode = automationFlow.nodes[matched.nextNodeId];
        state.currentNodeId = nextNode.id;
        // clear awaitingOption on move
        state.awaitingOption = null;
        await client.sendMessage(chatId, nextNode.text);
        setNodeUpsellTimeout(chatId, nextNode);
      } else {
        // end conversation: clear timeouts and delete state
        clearConversationTimeouts(chatId);
        conversationStates.delete(chatId);
      }

    } catch (err) {
      console.error('Erro ao processar mensagem:', err);
    }
  });
}

// websocket handling
wss.on('connection', ws => {
  ws.on('message', async raw => {
    try {
      const data = JSON.parse(raw);

      if (data.action === 'connect') {
        if (!client) createWhatsAppClient(ws);
        else {
          if (ws.readyState === WebSocket.OPEN) ws.send(JSON.stringify({ type: 'ready' }));
        }
      }

      else if (data.action === 'publishFlow') {
        try {
          // normalize, assign to automationFlow and persist to disk automatically
          const prepared = normalizeFlowStructure(data.flow || {});
          automationFlow = prepared;
          resetAutomationState();

          // save to disk with auto filename and return filename to UI
          const savedName = saveFlowToDiskAuto(prepared);
          if (ws.readyState === WebSocket.OPEN) {
            ws.send(JSON.stringify({ type: 'flowPublished', message: 'Automação publicada', filename: savedName, flow: prepared }));
          }
          console.log('Fluxo publicado e salvo como', savedName);
        } catch (err) {
          console.error('Erro ao publicar fluxo:', err);
          if (ws.readyState === WebSocket.OPEN) ws.send(JSON.stringify({ type: 'flowError', message: err.message }));
        }
      }

      else if (data.action === 'sendMessages') {
        // broadcast to active chats (only those with conversation history)
        if (!client || !client.info) { ws.send(JSON.stringify({ type: 'error', message: 'WhatsApp não conectado' })); return; }
        const message = String(data.message || '');
        const delaySec = Number(data.delaySeconds || 5);

        try {
          const chats = await client.getChats();
          const active = chats.filter(c => !c.isGroup && ((c.msgs && c.msgs.length>0) || c.lastMessage));
          const total = active.length;
          if (total === 0) { ws.send(JSON.stringify({ type: 'broadcastStatus', status: 'empty', message: 'Nenhum contato ativo com histórico.' })); return; }

          ws.send(JSON.stringify({ type: 'broadcastStatus', status: 'start', total }));
          let sent = 0;
          for (let i = 0; i < active.length; i++) {
            const chat = active[i];
            try {
              const id = (chat.id && (chat.id._serialized || chat.id)) || null;
              if (!id) continue;
              await client.sendMessage(id, message);
              sent++;
              ws.send(JSON.stringify({ type: 'broadcastStatus', status: 'sending', sent, total, to: id }));
              console.log(`Broadcast: ${sent}/${total} -> ${id}`);
              if (i < active.length - 1) await new Promise(r => setTimeout(r, delaySec * 1000));
            } catch (err) {
              console.error('Erro ao enviar broadcast para', chat.id, err);
              ws.send(JSON.stringify({ type: 'broadcastStatus', status: 'error', message: err.message, to: (chat.id && chat.id._serialized) || chat.id }));
            }
          }
          ws.send(JSON.stringify({ type: 'broadcastStatus', status: 'completed', sent, total }));
        } catch (err) {
          console.error('Erro broadcast:', err);
          ws.send(JSON.stringify({ type: 'error', message: 'Falha broadcast: ' + err.message }));
        }
      }

      // optional: allow requesting list of saved flows on server
      else if (data.action === 'listSavedFlows') {
        try {
          const files = fs.readdirSync(FLOWS_DIR).filter(f => f.endsWith('.json')).sort().reverse();
          ws.send(JSON.stringify({ type: 'savedFlows', files }));
        } catch (err) {
          ws.send(JSON.stringify({ type: 'error', message: 'Erro listar flows: ' + err.message }));
        }
      }

      // optional: load a specific saved flow from server disk (by filename)
      else if (data.action === 'loadSavedFlow' && data.filename) {
        try {
          const full = path.join(FLOWS_DIR, String(data.filename));
          if (!fs.existsSync(full)) throw new Error('Arquivo não encontrado');
          const raw = fs.readFileSync(full, 'utf8');
          const parsed = JSON.parse(raw);
          automationFlow = normalizeFlowStructure(parsed);
          resetAutomationState();
          if (ws.readyState === WebSocket.OPEN) ws.send(JSON.stringify({ type: 'flowLoaded', filename: data.filename, flow: automationFlow }));
        } catch (err) {
          ws.send(JSON.stringify({ type: 'error', message: 'Erro ao carregar flow: ' + err.message }));
        }
      }

    } catch (err) {
      console.error('WS process message error:', err);
      if (ws && ws.readyState === WebSocket.OPEN) ws.send(JSON.stringify({ type: 'error', message: err.message }));
    }
  });

  ws.on('close', () => { /* nothing */ });
});

// on server start, try load latest saved flow (optional convenience)
const latest = loadLatestFlowIfExists();
if (latest) {
  automationFlow = normalizeFlowStructure(latest);
}

const PORT = process.env.PORT || 3000;
server.listen(PORT, () => console.log(`Servidor rodando em http://localhost:${PORT}`));
