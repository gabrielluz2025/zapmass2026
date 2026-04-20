import express from 'express';
import { createServer } from 'http';
import { Server } from 'socket.io';
import cors from 'cors';
import qrcode from 'qrcode';

// 1. IMPORTAÇÃO WHATSAPP-WEB.JS (CommonJS para ESM)
import pkg from 'whatsapp-web.js';
const { Client, LocalAuth } = pkg;

const app = express();
const httpServer = createServer(app);
const PORT = 3001;

// 2. CONFIGURAÇÃO DE CORS PARA LOCALHOST
const corsOptions = {
  // Permite localhost:8000 (Vite) e localhost:3001
  origin: ["http://localhost:8000", "http://localhost:3001"],
  methods: ["GET", "POST"],
  credentials: true
};

app.use(cors(corsOptions));
app.use(express.json({ limit: '50mb' }));

const io = new Server(httpServer, {
  cors: corsOptions,
  transports: ['websocket', 'polling'],
  pingTimeout: 60000,
});

// Armazenamento de Sessões Ativas em Memória
const sessions = new Map();

// Helper: Delay Aleatório (Anti-Ban)
const wait = (min, max) => new Promise(resolve => setTimeout(resolve, Math.random() * (max - min) + min));

// 3. CLASSE DE GERENCIAMENTO DE SESSÃO
class WhatsAppSession {
  constructor(id) {
    this.id = id;
    this.client = null;
    this.status = 'CONNECTING';
    
    // Fila de Mensagens
    this.queue = [];
    this.isProcessingQueue = false;

    this.initialize();
  }

  initialize() {
    console.log(`[${this.id}] Inicializando cliente WhatsApp...`);

    this.client = new Client({
      authStrategy: new LocalAuth({ clientId: this.id }),
      puppeteer: {
        headless: true, // headless: false se quiser ver o Chrome abrindo
        args: [
          '--no-sandbox',
          '--disable-setuid-sandbox'
        ]
      }
    });

    this.attachEvents();
    this.client.initialize().catch(err => {
        console.error(`[${this.id}] Erro fatal na inicialização:`, err);
        this.emitStatus('DISCONNECTED');
    });
  }

  attachEvents() {
    // Evento: QR Code
    this.client.on('qr', async (qr) => {
      console.log(`[${this.id}] QR Code gerado.`);
      this.status = 'QR_READY';
      try {
        const qrImage = await qrcode.toDataURL(qr);
        io.emit('session-qr', { id: this.id, qr: qrImage });
        this.emitStatus('QR_READY');
      } catch (err) {
        console.error(`[${this.id}] Erro ao gerar imagem QR:`, err);
      }
    });

    // Evento: Pronto
    this.client.on('ready', () => {
      console.log(`[${this.id}] Cliente PRONTO e Conectado!`);
      this.status = 'CONNECTED';
      
      const info = this.client.info;
      const phone = info?.wid?.user;
      const name = info?.pushname || this.id;

      io.emit('session-ready', { id: this.id, phone, name });
      this.emitStatus('CONNECTED');
    });

    // Evento: Autenticado
    this.client.on('authenticated', () => {
      console.log(`[${this.id}] Autenticado com sucesso.`);
      this.status = 'AUTHENTICATED';
      this.emitStatus('AUTHENTICATED');
    });

    // Evento: Falha de Autenticação
    this.client.on('auth_failure', (msg) => {
      console.error(`[${this.id}] Falha na autenticação:`, msg);
      this.status = 'DISCONNECTED';
      this.emitStatus('DISCONNECTED');
    });

    // Evento: Desconectado
    this.client.on('disconnected', (reason) => {
      console.warn(`[${this.id}] Desconectado: ${reason}`);
      this.status = 'DISCONNECTED';
      this.emitStatus('DISCONNECTED');
      // Remove da lista global se cair
      sessions.delete(this.id);
    });

    // Evento: Mensagem Recebida
    this.client.on('message', async (msg) => {
        if (msg.isStatus) return; // Ignora status/stories

        try {
            const chat = await msg.getChat();
            const contact = await msg.getContact();

            console.log(`[${this.id}] Mensagem recebida de ${contact.pushname || contact.number}`);

            const payload = {
                conversationId: chat.id._serialized,
                connectionId: this.id,
                message: {
                    id: msg.id.id,
                    text: msg.body,
                    timestamp: new Date().toLocaleTimeString(),
                    sender: 'them',
                    status: 'read',
                    type: msg.type === 'image' ? 'image' : 'text'
                },
                contact: {
                    name: contact.name || contact.pushname || contact.number,
                    phone: contact.number,
                    profilePicUrl: await contact.getProfilePicUrl().catch(() => null)
                }
            };

            io.emit('new-message', payload);
        } catch (e) {
            console.error(`[${this.id}] Erro ao processar mensagem recebida:`, e);
        }
    });
  }

  emitStatus(status) {
    io.emit('connections-update', Array.from(sessions.values()).map(s => ({
        id: s.id,
        name: s.id,
        status: s.status,
        phoneNumber: s.client?.info?.wid?.user || null,
        queueSize: s.queue.length,
        messagesSentToday: 0,
        signalStrength: 'STRONG',
        lastActivity: new Date().toLocaleTimeString()
    })));
  }

  // --- SISTEMA DE FILA ---
  addToQueue(number, message, type = 'text') {
    this.queue.push({ number, message, type });
    this.processQueue();
  }

  async processQueue() {
    if (this.isProcessingQueue) return;
    this.isProcessingQueue = true;

    console.log(`[${this.id}] Processando fila. Itens: ${this.queue.length}`);

    while (this.queue.length > 0) {
      const item = this.queue.shift();
      
      try {
        const chatId = item.number.includes('@c.us') ? item.number : `${item.number}@c.us`;
        
        await this.client.sendMessage(chatId, item.message);
        console.log(`[${this.id}] Mensagem enviada para ${item.number}`);

        io.emit('msg-sent-success', { connectionId: this.id, to: item.number });

      } catch (error) {
        console.error(`[${this.id}] Falha ao enviar para ${item.number}:`, error.message);
        io.emit('msg-sent-failed', { connectionId: this.id, to: item.number, error: error.message });
      }

      // Delay Inteligente (3s a 7s)
      if (this.queue.length > 0) {
        const delay = Math.floor(Math.random() * (7000 - 3000 + 1) + 3000);
        await wait(3000, 7000);
      }
    }

    this.isProcessingQueue = false;
    this.emitStatus(this.status); 
  }

  async logout() {
    try {
        await this.client.logout();
        await this.client.destroy();
    } catch (e) {
        console.error(`[${this.id}] Erro ao fazer logout:`, e);
    }
  }
}

// 4. API & SOCKET EVENTS

app.get('/', (req, res) => {
  res.send('ZapMass Backend (Local) is Running 🚀');
});

io.on('connection', (socket) => {
  console.log('🔗 Frontend conectado (Local):', socket.id);

  // Enviar estado atual das sessões ao conectar
  const currentSessions = Array.from(sessions.values()).map(s => ({
    id: s.id,
    name: s.id,
    status: s.status,
    phoneNumber: s.client?.info?.wid?.user || null,
    queueSize: s.queue.length,
    messagesSentToday: 0,
    signalStrength: 'STRONG',
    lastActivity: 'Sincronizado'
  }));
  socket.emit('all-sessions', currentSessions);

  // Criar Nova Sessão
  socket.on('create-session', ({ id }) => {
    if (sessions.has(id)) {
        console.log(`Sessão ${id} já existe. Ignorando.`);
        return;
    }
    const session = new WhatsAppSession(id);
    sessions.set(id, session);
  });

  // Deletar Sessão
  socket.on('delete-session', async ({ id }) => {
    if (sessions.has(id)) {
        console.log(`Removendo sessão ${id}...`);
        const session = sessions.get(id);
        await session.logout();
        sessions.delete(id);
        
        // Atualiza lista
        io.emit('connections-update', Array.from(sessions.values()).map(s => ({
            id: s.id,
            status: 'DISCONNECTED'
        })));
    }
  });

  // Enviar Mensagem Única (Chat)
  socket.on('send-message', ({ conversationId, text }) => {
    const session = sessions.values().next().value;
    if (session && session.status === 'CONNECTED') {
        session.client.sendMessage(conversationId, text);
    }
  });

  // Iniciar Campanha (Disparo em Massa)
  socket.on('start-campaign', ({ sessionId, numbers, message }) => {
    const session = sessions.get(sessionId);
    
    if (!session || session.status !== 'CONNECTED') {
        console.error(`Tentativa de campanha em sessão inválida: ${sessionId}`);
        socket.emit('campaign-error', { error: 'Sessão não conectada.' });
        return;
    }

    console.log(`Iniciando campanha na sessão ${sessionId} para ${numbers.length} números.`);
    
    socket.emit('campaign-started', { total: numbers.length });

    numbers.forEach(num => {
        session.addToQueue(num, message);
    });
  });

  socket.on('disconnect', () => {
    console.log('Frontend desconectado:', socket.id);
  });
});

httpServer.listen(PORT, () => {
  console.log(`\n==================================================`);
  console.log(`🚀 ZAPMASS SERVER (LOCAL) RODANDO NA PORTA ${PORT}`);
  console.log(`📡 WebSocket ativo em: http://localhost:${PORT}`);
  console.log(`==================================================\n`);
});