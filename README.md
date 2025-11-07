# 🍽️ Automação WhatsApp - Restaurante

Sistema de automação de mensagens WhatsApp para restaurantes. Permite enviar mensagens personalizadas para múltiplos clientes com intervalo de 10 segundos entre cada envio para evitar bloqueios.

## 📋 Pré-requisitos

- Node.js (versão 14 ou superior)
- npm (geralmente vem com Node.js)
- Navegador moderno (Chrome, Firefox, Edge)

## 🚀 Instalação

1. **Instale as dependências:**
```bash
npm install
```

## ▶️ Como Usar

1. **Inicie o servidor:**
```bash
npm start
```

2. **Abra o arquivo `zap.html` no navegador:**
   - Você pode abrir diretamente o arquivo HTML
   - Ou acesse `http://localhost:3000` se o servidor estiver rodando

3. **Conecte ao WhatsApp:**
   - Clique em "Conectar WhatsApp"
   - Escaneie o QR Code que aparecerá na tela com seu WhatsApp
   - Aguarde a confirmação de conexão

4. **Configure sua mensagem:**
   - Digite a mensagem que deseja enviar no campo de texto

5. **Adicione clientes:**
   - Digite o número do cliente no formato: `5511999999999`
     - `55` = código do Brasil
     - `11` = DDD
     - `999999999` = número do telefone
   - Clique em "Adicionar Cliente" ou pressione Enter

6. **Envie as mensagens:**
   - Clique em "Enviar Mensagens para Todos"
   - As mensagens serão enviadas automaticamente com intervalo de 10 segundos

## ⚠️ Importante

- **Intervalo de 10 segundos:** As mensagens são enviadas com 10 segundos de intervalo para evitar bloqueios do WhatsApp
- **Primeira conexão:** Na primeira vez, você precisará escanear o QR Code. Nas próximas vezes, a conexão será automática
- **Números válidos:** Certifique-se de que os números estão no formato correto com código do país e DDD
- **Uso responsável:** Use este sistema de forma responsável e respeite os termos de uso do WhatsApp

## 📝 Formato de Número

O número deve estar no formato internacional:
- Brasil: `55` + DDD + número
- Exemplo: `5511999999999` (São Paulo)
- Exemplo: `5521987654321` (Rio de Janeiro)

## 🔧 Solução de Problemas

- **Erro ao conectar:** Certifique-se de que o servidor está rodando na porta 3000
- **QR Code não aparece:** Verifique se o Node.js está instalado corretamente e todas as dependências foram instaladas
- **Mensagens não são enviadas:** Verifique se o WhatsApp está conectado e se os números estão no formato correto

## 📦 Dependências

- `express`: Servidor web
- `whatsapp-web.js`: Cliente WhatsApp Web
- `qrcode`: Geração de QR Code
- `ws`: WebSocket para comunicação em tempo real

## ⚖️ Licença

MIT
