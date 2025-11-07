// server.js
const express = require('express');
const http = require('http');
const WebSocket = require('ws');
const { Client, LocalAuth } = require('whatsapp-web.js');
const qrcode = require('qrcode');
const path = require('path');

const app = express();
const server = http.createServer(app);
const wss = new WebSocket.Server({ server });

// Fluxo/estado
let automationFlow = null;
const conversationStates = new Map(); // chatId -> { currentNodeId, lastMessageTime, timeoutId, upsellTimeoutId, awaitingOption }
const INACTIVITY_TIMEOUT = 10 * 60 * 1000; // 10 minutos padrão (pode ajustar)

app.use(express.static(__dirname));
app.get('/', (req, res) => res.sendFile(path.join(__dirname, 'zap.html')));

let client = null;
let wsConnection = null;

function normalizeText(text = '') {
  return String(text || '')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .trim();
}

// Normaliza estrutura do fluxo recebido do front
function normalizeFlowStructure(flow) {
  if (!flow || typeof flow !== 'object') throw new Error('Fluxo inválido');

  const prepared = JSON.parse(JSON.stringify(flow));
  prepared.version = prepared.version || '1.0.0';
  prepared.nodes = prepared.nodes || {};
  prepared.inactivityMessage = prepared.inactivityMessage || 'Olá! Notamos que você não respondeu. Ainda está interessado em nossos serviços?';

  Object.entries(prepared.nodes).forEach(([id, node]) => {
    node.id = node.id || id;
    node.type = node.type || 'question';
    node.text = node.text || '';
    node.defaultReply = node.defaultReply || null; // mensagem quando resposta não bate
    node.upsellDelay = node.upsellDelay ? Number(node.upsellDelay) : null; // minutos
    node.upsellMessage = node.upsellMessage || null; // upsell por tempo
    node.options = Array.isArray(node.options) ? node.options : [];
    // cada opção pode ter: label, matchType, replyMessage, nextNodeId, followupTrigger, followupMessage
    node.options = node.options.map(opt => ({
      label: String(opt.label || ''),
      normalizedLabel: normalizeText(opt.label || ''),
      matchType: opt.matchType === 'contains' ? 'contains' : 'equals',
      replyMessage: opt.replyMessage ? String(opt.replyMessage) : null,
      nextNodeId: opt.nextNodeId || null,
      // NOVOS CAMPOS por opção:
      followupTrigger: opt.followupTrigger ? String(opt.followupTrigger) : null, // palavra-chave que cliente digita
      followupTriggerNormalized: opt.followupTrigger ? normalizeText(opt.followupTrigger) : null,
      followupMessage: opt.followupMessage ? String(opt.followupMessage) : null
    }));
  });

  if (!prepared.startNodeId || !prepared.nodes[prepared.startNodeId]) {
    // se não tiver startNodeId válido, tenta primeiro nó
    const keys = Object.keys(prepared.nodes);
    prepared.startNodeId = prepared.startNodeId || (keys.length ? keys[0] : null);
  }

  return prepared;
}

// Limpa timeouts e estados
function resetAutomationState() {
  conversationStates.forEach(s => {
    if (s.timeoutId) clearTimeout(s.timeoutId);
    if (s.upsellTimeoutId) clearTimeout(s.upsellTimeoutId);
  });
  conversationStates.clear();
}

function clearConversationTimeouts(chatId) {
  const state = conversationStates.get(chatId);
  if (!state) return;
  if (state.timeoutId) clearTimeout(state.timeoutId);
  if (state.upsellTimeoutId) clearTimeout(state.upsellTimeoutId);
  state.timeoutId = null;
  state.upsellTimeoutId = null;
}

// Timeout genérico de inatividade
function setConversationTimeout(chatId) {
  clearConversationTimeouts(chatId);
  const timeoutId = setTimeout(async () => {
    try {
      const state = conversationStates.get(chatId);
      if (!state || !client) return;
      const msg = automationFlow?.inactivityMessage || 'Olá! Notamos que você não respondeu. Ainda está interessado?';
      await client.sendMessage(chatId, msg);
      // renova último timestamp e o timeout
      state.lastMessageTime = Date.now();
      setConversationTimeout(chatId);
    } catch (err) {
      console.error('Erro timeout inatividade:', err);
    }
  }, INACTIVITY_TIMEOUT);

  const state = conversationStates.get(chatId);
  if (state) state.timeoutId = timeoutId;
}

// Timeout de upsell por tempo (por etapa)
function setNodeUpsellTimeout(chatId, node) {
  if (!node || !node.upsellDelay || !node.upsellMessage) return;
  const state = conversationStates.get(chatId);
  if (!state) return;

  // limpar anterior
  if (state.upsellTimeoutId) clearTimeout(state.upsellTimeoutId);

  const delayMs = Number(node.upsellDelay) * 60 * 1000;
  state.upsellTimeoutId = setTimeout(async () => {
    try {
      // garante que o estado ainda existe e o usuário não avançou
      const cur = conversationStates.get(chatId);
      if (!cur) return;
      await client.sendMessage(chatId, node.upsellMessage);
      // após upsell por tempo, resetar estado conforme solicitado
      clearConversationTimeouts(chatId);
      conversationStates.delete(chatId);
      console.log(`Upsell por tempo enviado para ${chatId} e estado resetado.`);
    } catch (err) {
      console.error('Erro ao enviar upsell por tempo:', err);
    }
  }, delayMs);
}

// Cria/Inicializa cliente WhatsApp
function createWhatsAppClient(ws) {
  if (client) {
    try { client.destroy(); } catch(e) {}
    client = null;
  }

  setTimeout(() => {
    client = new Client({
      authStrategy: new LocalAuth({ dataPath: './.wwebjs_auth' }),
      puppeteer: {
        headless: true,
        args: [
          '--no-sandbox',
          '--disable-setuid-sandbox',
          '--disable-dev-shm-usage',
        ]
      }
    });

    setupClientEvents(ws);
    client.initialize().catch(err => console.error('Erro init client:', err));
  }, 800);
}

function setupClientEvents(ws) {
  if (!client) return;

  client.on('qr', async qr => {
    try {
      const qrImage = await qrcode.toDataURL(qr);
      if (ws && ws.readyState === WebSocket.OPEN) ws.send(JSON.stringify({ type: 'qr', qr: qrImage }));
    } catch (err) {
      console.error('Erro QR:', err);
    }
  });

  client.on('ready', async () => {
    console.log('WhatsApp pronto');
    if (ws && ws.readyState === WebSocket.OPEN) ws.send(JSON.stringify({ type: 'ready' }));
    // opcional: enviar lista de contatos para a UI
    try {
      const contacts = await client.getContacts();
      const validContacts = contacts.filter(c => c.isUser && c.number && !c.isGroup);
      if (ws && ws.readyState === WebSocket.OPEN) ws.send(JSON.stringify({ type: 'contacts', contacts: validContacts }));
    } catch (err) {
      console.error('Erro ao buscar contatos ao conectar:', err);
    }
  });

  client.on('authenticated', () => console.log('Autenticado'));
  client.on('auth_failure', msg => {
    console.error('Auth failure:', msg);
    if (ws && ws.readyState === WebSocket.OPEN) ws.send(JSON.stringify({ type: 'error', message: 'Falha na autenticação: ' + msg }));
  });

  client.on('disconnected', reason => {
    console.log('Desconectado:', reason);
    if (ws && ws.readyState === WebSocket.OPEN) ws.send(JSON.stringify({ type: 'error', message: 'Desconectado: ' + reason }));
    resetAutomationState();
  });

  // Mensagens recebidas
  client.on('message', async (messageEvent) => {
    try {
      if (!automationFlow || !automationFlow.startNodeId) return;
      if (!messageEvent || messageEvent.fromMe) return;

      const chatId = messageEvent.from;
      if (!chatId || (!chatId.endsWith('@c.us') && !chatId.endsWith('@s.whatsapp.net'))) return;

      // extrair texto
      let inputText = '';
      if (messageEvent.type === 'chat' || messageEvent.body) inputText = messageEvent.body || '';
      else if (messageEvent.message && messageEvent.message.conversation) inputText = messageEvent.message.conversation || '';
      inputText = inputText.trim();
      if (!inputText) return;

      const normalizedInput = normalizeText(inputText);

      let state = conversationStates.get(chatId);

      // se não existe estado, inicia a conversa com startNode
      if (!state) {
        const startNode = automationFlow.nodes[automationFlow.startNodeId];
        if (!startNode) return;
        conversationStates.set(chatId, {
          currentNodeId: startNode.id,
          lastMessageTime: Date.now(),
          timeoutId: null,
          upsellTimeoutId: null,
          awaitingOption: null // { expectedReplyNormalized, optionIndex, followupTriggerNormalized, followupMessage }
        });
        await client.sendMessage(chatId, startNode.text);
        setConversationTimeout(chatId);
        setNodeUpsellTimeout(chatId, startNode);
        return;
      }

      // se houver awaitingOption configurado (ex.: após enviar resposta automática) e a entrada do usuário
      if (state.awaitingOption && state.awaitingOption.followupTriggerNormalized) {
        // se o usuário digitou a palavra-chave de followup e NÃO escreveu exatamente a resposta automática esperada
        if (normalizedInput === state.awaitingOption.followupTriggerNormalized &&
            normalizedInput !== state.awaitingOption.expectedReplyNormalized) {
          // enviar a mensagem alternativa configurada
          if (state.awaitingOption.followupMessage) {
            await client.sendMessage(chatId, state.awaitingOption.followupMessage);
            // Não resetamos estado aqui (mantemos o usuário na mesma etapa) — se quiser resetar, descomente abaixo:
            // clearConversationTimeouts(chatId);
            // conversationStates.delete(chatId);
            // return;
          }
        }
      }

      // renovar timeouts de inatividade
      state.lastMessageTime = Date.now();
      setConversationTimeout(chatId);

      const node = automationFlow.nodes[state.currentNodeId];
      if (!node) {
        clearConversationTimeouts(chatId);
        conversationStates.delete(chatId);
        return;
      }

      // tenta bater com alguma opção na etapa atual
      let matchedOption = null;
      for (const opt of node.options) {
        if (!opt.normalizedLabel) continue;
        if (opt.matchType === 'contains') {
          if (normalizedInput.includes(opt.normalizedLabel)) { matchedOption = opt; break; }
        } else {
          if (normalizedInput === opt.normalizedLabel) { matchedOption = opt; break; }
        }
      }

      // se não tiver correspondência, envia defaultReply (ou repete texto)
      if (!matchedOption) {
        if (node.defaultReply) await client.sendMessage(chatId, node.defaultReply);
        else if (node.text) await client.sendMessage(chatId, node.text);
        // re-agenda o upsell por tempo para essa etapa (se existir)
        setNodeUpsellTimeout(chatId, node);
        return;
      }

      // correspondeu a uma opção
      // envia replyMessage se houver
      if (matchedOption.replyMessage) {
        await client.sendMessage(chatId, matchedOption.replyMessage);
      }

      // ao enviar a resposta automática da opção, registramos awaitingOption
      // expectedReplyNormalized = normalize(replyMessage) (o que o bot acabou de enviar)
      state.awaitingOption = {
        expectedReplyNormalized: matchedOption.replyMessage ? normalizeText(matchedOption.replyMessage) : null,
        optionLabelNormalized: matchedOption.normalizedLabel || null,
        followupTriggerNormalized: matchedOption.followupTriggerNormalized || null,
        followupMessage: matchedOption.followupMessage || null
      };

      // se o usuário respondeu diferente do upsellTrigger da etapa (lógica de upsell por tempo)
      if (node.upsellDelay && node.upsellMessage) {
        // agenda upsell por tempo para a próxima resposta (se aplicável)
        setNodeUpsellTimeout(chatId, node);
      }

      // avança para próximo nó, se existir
      if (matchedOption.nextNodeId && automationFlow.nodes[matchedOption.nextNodeId]) {
        const nextNode = automationFlow.nodes[matchedOption.nextNodeId];
        state.currentNodeId = nextNode.id;
        // limpar awaitingOption ao mudar de nó (opcional)
        state.awaitingOption = null;
        await client.sendMessage(chatId, nextNode.text);
        // agenda upsell por tempo no nextNode
        setNodeUpsellTimeout(chatId, nextNode);
      } else {
        // sem próximo nó: finaliza conversa (limpa timeouts)
        clearConversationTimeouts(chatId);
        conversationStates.delete(chatId);
      }

    } catch (err) {
      console.error('Erro ao processar mensagem:', err);
    }
  });
}

// rota WebSocket (UI <-> servidor)
wss.on('connection', ws => {
  wsConnection = ws;
  ws.on('message', async raw => {
    try {
      const data = JSON.parse(raw);

      if (data.action === 'connect') {
        if (!client) createWhatsAppClient(ws);
        else {
          // se já existe client mas não pronto, tenta reinicializar
          if (!client.info) {
            try { await client.destroy(); } catch(e) {}
            client = null;
            createWhatsAppClient(ws);
          } else {
            if (ws.readyState === WebSocket.OPEN) ws.send(JSON.stringify({ type: 'ready' }));
          }
        }
      }

      else if (data.action === 'publishFlow') {
        try {
          const prepared = normalizeFlowStructure(data.flow);
          automationFlow = prepared;
          resetAutomationState();
          if (ws.readyState === WebSocket.OPEN) ws.send(JSON.stringify({ type: 'flowPublished', message: 'Automação publicada' }));
        } catch (err) {
          console.error('Erro publishFlow:', err);
          if (ws.readyState === WebSocket.OPEN) ws.send(JSON.stringify({ type: 'flowError', message: err.message }));
        }
      }

      else if (data.action === 'sendMessages') {
        // disparo em massa (somente para contatos que já conversaram)
        // data.message = texto, data.delaySeconds = 5 (opcional)
        if (!client || !client.info) {
          ws.send(JSON.stringify({ type: 'error', message: 'WhatsApp não conectado' }));
          return;
        }

        const message = String(data.message || '');
        const delaySec = Number(data.delaySeconds || 5);
        // buscar chats ativos (quem já conversou)
        try {
          const chats = await client.getChats();
          // filtrar chats que são usuários (não grupos) e que possuem mensagens
          const activeChats = chats.filter(c => {
            try {
              // alguns objetos de chat tem isGroup, t é seguro checar
              if (c.isGroup) return false;
              // tentar deduzir se há mensagens - propriedade msgs ou lastMessage
              if (c.msgs && c.msgs.length > 0) return true;
              if (c.lastMessage) return true;
              // se não der pra saber, ignorar (evita enviar pra contatos nunca contatados)
              return false;
            } catch (e) {
              return false;
            }
          });

          const total = activeChats.length;
          let sent = 0;

          if (total === 0) {
            ws.send(JSON.stringify({ type: 'broadcastStatus', status: 'empty', message: 'Nenhum contato com histórico de conversa encontrado.' }));
            return;
          }

          ws.send(JSON.stringify({ type: 'broadcastStatus', status: 'start', total }));

          for (const [i, chat] of activeChats.entries()) {
            try {
              const id = (chat.id && (chat.id._serialized || chat.id)) || null;
              if (!id) continue;
              // enviar mensagem
              await client.sendMessage(id, message);
              sent++;
              ws.send(JSON.stringify({ type: 'broadcastStatus', status: 'sending', sent, total, to: id }));
              console.log(`Enviado ${sent}/${total} para ${id}`);
              // delay entre envios
              if (i < activeChats.length - 1) {
                await new Promise(r => setTimeout(r, delaySec * 1000));
              }
            } catch (err) {
              console.error('Erro ao enviar broadcast para:', chat.id, err);
              ws.send(JSON.stringify({ type: 'broadcastStatus', status: 'error', message: err.message, to: (chat.id && chat.id._serialized) || chat.id }));
            }
          }

          ws.send(JSON.stringify({ type: 'broadcastStatus', status: 'completed', sent, total }));
        } catch (err) {
          console.error('Erro broadcast:', err);
          ws.send(JSON.stringify({ type: 'error', message: 'Falha no envio em massa: ' + err.message }));
        }
      }

    } catch (err) {
      console.error('Erro ao processar mensagem do WS:', err);
      if (ws && ws.readyState === WebSocket.OPEN) ws.send(JSON.stringify({ type: 'error', message: err.message }));
    }
  });

  ws.on('close', () => {
    wsConnection = null;
  });
});

const PORT = process.env.PORT || 3000;
server.listen(PORT, () => {
  console.log(`Servidor rodando em http://localhost:${PORT}`);
});

