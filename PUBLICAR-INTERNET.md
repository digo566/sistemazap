# 🌐 Como Publicar na Internet

## Opções Gratuitas (Recomendadas)

### 1. Railway.app (Mais Fácil) ⭐

1. **Crie uma conta:** https://railway.app
2. **Conecte seu GitHub:**
   - Faça upload do código para GitHub
   - No Railway, clique em "New Project" > "Deploy from GitHub repo"
   - Selecione seu repositório
3. **Configure:**
   - Railway detecta automaticamente Node.js
   - Adicione variável de ambiente: `PORT` (Railway define automaticamente)
4. **Deploy:**
   - Railway faz deploy automático
   - Você receberá uma URL como: `https://seu-app.railway.app`
5. **Atualize o HTML:**
   - Modifique `zap.html` para usar a URL do Railway no WebSocket
   - Exemplo: `ws://seu-app.railway.app` ou `wss://seu-app.railway.app` (com SSL)

---

### 2. Render.com

1. **Crie conta:** https://render.com
2. **New Web Service:**
   - Conecte seu repositório GitHub
3. **Configure:**
   - **Name:** Seu nome do app
   - **Environment:** Node
   - **Build Command:** `npm install`
   - **Start Command:** `node server.js`
   - **Plan:** Free
4. **Deploy:**
   - Render faz deploy automático
   - URL: `https://seu-app.onrender.com`

---

### 3. Heroku

1. **Instale Heroku CLI:** https://devcenter.heroku.com/articles/heroku-cli
2. **Crie `Procfile`:**
   ```
   web: node server.js
   ```
3. **No terminal:**
   ```bash
   heroku login
   heroku create seu-app-nome
   git init
   git add .
   git commit -m "Initial commit"
   git push heroku main
   ```

---

## ⚠️ IMPORTANTE - Configurações Necessárias

### 1. Modificar zap.html para usar HTTPS/WSS

Quando publicar na internet, você precisa usar `wss://` (WebSocket seguro) em vez de `ws://`:

```javascript
// Antes (local):
ws = new WebSocket('ws://localhost:3000');

// Depois (internet):
ws = new WebSocket('wss://seu-app.railway.app');
```

### 2. Adicionar Suporte a HTTPS no Servidor

Para produção, você precisa de SSL. As plataformas acima (Railway, Render) já fornecem HTTPS automaticamente.

### 3. Variáveis de Ambiente

Crie um arquivo `.env` (não commite no Git):

```
PORT=3000
NODE_ENV=production
```

Adicione ao `.gitignore`:
```
.env
.wwebjs_auth/
node_modules/
```

---

## 🔒 Segurança

### Adicionar Autenticação (Recomendado)

Se for publicar na internet, adicione login/senha:

1. **Instale dependências:**
   ```bash
   npm install express-session passport passport-local
   ```

2. **Crie middleware de autenticação**

3. **Proteja as rotas**

---

## 📝 Checklist de Deploy

- [ ] Código no GitHub
- [ ] `.env` configurado (se necessário)
- [ ] `zap.html` atualizado com URL correta
- [ ] WebSocket usando `wss://` (HTTPS)
- [ ] Testado localmente
- [ ] Deploy realizado
- [ ] Testado na URL pública
- [ ] Firewall/segurança configurado

---

## 🚀 Deploy Rápido (Railway - 5 minutos)

1. **GitHub:**
   ```bash
   git init
   git add .
   git commit -m "Initial commit"
   git remote add origin SEU_REPOSITORIO
   git push -u origin main
   ```

2. **Railway:**
   - Acesse https://railway.app
   - New Project > GitHub
   - Selecione repositório
   - Pronto! URL gerada automaticamente

3. **Atualizar HTML:**
   - Copie a URL do Railway
   - Substitua `ws://localhost:3000` por `wss://SUA_URL_RAILWAY`

---

## 💡 Dicas

- **Railway:** Melhor para iniciantes, deploy automático
- **Render:** Alternativa gratuita, fácil de usar
- **Heroku:** Mais configuração, mas muito popular
- **VPS:** Mais controle, mas requer conhecimento técnico

---

## ❓ Problemas Comuns

### "WebSocket não conecta"
- Use `wss://` em vez de `ws://` para HTTPS
- Verifique se a URL está correta

### "Conexão recusada"
- Servidor está rodando?
- Porta configurada corretamente?

### "Erro 404"
- Verifique se o arquivo HTML está sendo servido
- Configure rota raiz no Express

