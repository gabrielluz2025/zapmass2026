<div align="center">
<img width="1200" height="475" alt="GHBanner" src="https://github.com/user-attachments/assets/0aa67016-6eaf-458a-adb2-6e31a0763ed6" />
</div>

# ZapMass Sender

> Plataforma de **disparo em massa**, **base de contatos**, **campanhas multi-etapa** e **atendimento (pipeline)** no WhatsApp, com múltiplos canais, Firebase e API Node (Socket.IO).

[![Version](https://img.shields.io/badge/version-2.0.0-blue.svg)](VERSION)

**Nota:** Os badges e tabelas abaixo descrevem **objetivos de arquitetura e melhorias** implementadas ou em evolução no código (health checks, filas, circuit breaker, métricas, etc.). Valores de uptime ou percentagens de mercado **não são garantias contratuais** — dependem da tua infraestrutura, dos chips e da política do WhatsApp.

---

## ✨ **Capacidades (visão geral)**

- **Resiliência:** health check, circuit breaker, backoff, persistência de fila e sessão (conforme configuração).
- **Operação:** vários canais, campanhas, relatórios, aquecimento, integração Mercado Pago, multi-workspace.
- **Observabilidade:** métricas no servidor, logs estruturados (ver `server/`).
- **Roadmap / evolução:** ver `docs/historico/` e issues do repositório para itens em curso.

---

## 📊 **Performance (referência)**

| Aspeto | Nota |
|--------|------|
| Desempenho | Depende de **RAM/CPU da VPS**, latência e tamanho da base de contactos. |
| Estabilidade | O código inclui caminhos de **recuperação** e **limites**; monitoriza logs e `/api/health`. |
| WhatsApp | O risco de restrições depende do **uso responsável** (ritmo, conteúdo, aquecimento). |

---

## 🏗️ **Estrutura do Projeto**

```
zapmass-sender/
├── shared/           # Constantes partilhadas entre cliente e servidor (ex.: defaults de preços por tier)
├── src/              # Frontend (React + Vite + Tailwind)
│   ├── components/   # Componentes UI
│   ├── context/      # State management
│   └── services/     # Firebase + Socket.IO
├── server/           # Backend (Express + Socket.IO + WhatsApp)
│   ├── server.ts           # API REST + Socket handlers
│   ├── whatsappService.ts  # Core WhatsApp (20 melhorias)
│   ├── advancedFeatures.ts # Recursos avançados
│   ├── backup.ts           # Sistema de backup
│   └── types.ts            # TypeScript types
├── data/             # Dados persistentes
│   ├── connections.json         # Canais configurados
│   ├── message_queue.json       # Fila persistente
│   ├── dead_letter_queue.json   # Mensagens falhadas
│   ├── .wwebjs_auth/            # Sessões WhatsApp
│   └── .wwebjs_cache/           # Cache WhatsApp Web
├── VERSION                    # Versão do sistema
├── INICIAR.bat                # Windows: menu (ZapMass, Evolution, aquecimento)
├── EVOLUTION_API_SETUP.md     # Guia ativo: Evolution API
├── GUIA_DE_TESTE.md           # Guia ativo: testes
├── RUNBOOK_PRODUCAO.md        # Guia ativo: produção / Swarm
└── docs/
    ├── TUTORIAL-USUARIO-ZAPMASS.md  # Texto do tutorial na app
    └── historico/             # Changelogs, hotfixes, runbooks, scaling Swarm/K3s
```

---

## 🚀 **Instalação & Uso**

### Pré-requisitos
- Node.js v20+
- npm v10+
- Windows 10/11 ou Linux

### Instalação

```bash
# 1. Clonar repositório
git clone https://github.com/seu-usuario/zapmass-sender.git
cd zapmass-sender

# 2. Instalar dependências
npm install

# 3. Configurar Firebase (opcional)
# Editar src/services/firebase.ts com suas credenciais

# 4. Rodar sistema
npm run dev
```

**Windows:** na pasta do projeto podes usar `INICIAR.bat` (menu: só ZapMass, Evolution em Docker + ZapMass, aquecimento headful, etc.).

### Acessar

- **Frontend:** http://localhost:8000
- **Backend API:** http://localhost:3001
- **Health Check:** http://localhost:3001/api/health

---

## ⚙️ **Configuração Avançada**

### Variáveis de Ambiente (.env)

```bash
# Servidor
PORT=3001
NODE_ENV=development

# Diretórios
DATA_DIR=data
AUTH_DIR=data/.wwebjs_auth
BACKUP_DIR=backups

# Backup Automático
BACKUP_ON_START=true
BACKUP_INTERVAL_MINUTES=60
BACKUP_API_KEY=sua_chave_secreta

# Rate Limiting
RATE_LIMIT_PER_HOUR=100

# Circuit Breaker
CIRCUIT_BREAKER_THRESHOLD=5
CIRCUIT_BREAKER_TIMEOUT=300000

# Webhook (Slack/Discord/Email)
WEBHOOK_URL=https://hooks.slack.com/services/YOUR/WEBHOOK

# Cache
CONTACT_CACHE_TTL=86400000

# Warmup
WARMUP_ENABLED=true
```

### Cobrança — Mercado Pago e planos por quantidade de canais

O checkout e os webhooks de pagamento usam **somente Mercado Pago** (gateway Infinite Pay não faz parte do produto).

No checkout atual o valor cobrado segue **tiers de 1 a 5 canais** (mensal ou anual). A landing e o painel podem consultar os valores efetivos em **`GET /api/billing/mercadopago/prices`** (público); alterações por ambiente aplicam-se ao mesmo tempo no servidor e na UI.

| Variável | Uso |
|----------|-----|
| `MERCADOPAGO_ACCESS_TOKEN` | Token da API Mercado Pago (obrigatório para checkout em produção). Alternativa: ficheiro via `MERCADOPAGO_ACCESS_TOKEN_FILE` ou secret montado em `/run/secrets/` (ver `server/mercadoPagoAccess.ts`). |
| `MERCADOPAGO_BACK_URL` | URL base do site após o checkout (ex.: `https://app.seudominio.com`). |

**Overrides opcionais dos tiers (BRL, número decimal)** — se definidas e válidas, substituem os defaults em `shared/channelTierPricing.ts`:

| Variável | Descrição |
|----------|-----------|
| `MERCADOPAGO_CHANNEL_TIER_1` … `MERCADOPAGO_CHANNEL_TIER_5` | Preço **mensal** do plano com exatamente *n* canais. |
| `MERCADOPAGO_CHANNEL_TIER_1_ANNUAL` … `MERCADOPAGO_CHANNEL_TIER_5_ANNUAL` | Preço **anual** (total do período) com *n* canais. |

**Plano “flat” legado** — usado apenas em fluxos que **não** enviam quantidade de canais (ex.: alguns caminhos antigos / log no arranque):

| Variável | Descrição |
|----------|-----------|
| `MERCADOPAGO_PRICE_MONTHLY` | Preço mensal quando o fluxo não usa tiers (fallback em alguns caminhos / validação no arranque). |
| `MERCADOPAGO_PRICE_ANNUAL` | Preço anual no mesmo modo legado. |

Recomendação em deploy: mantenha `MERCADOPAGO_PRICE_*` válidos mesmo usando só tiers, para evitar erro no log de arranque do servidor.

---

## Módulos principais no código

- **Servidor:** health checks, métricas Prometheus, limites de taxa, webhooks Mercado Pago, control plane de sessão (API + worker), backups.
- **Cliente:** campanhas, contactos, chat/pipeline, relatórios, assinatura, administração (conforme permissões), integração Firebase.
- **Heurísticas:** delays, filas, circuit breaker e outras proteções — ver `server/whatsappService.ts` e documentação em `docs/historico/` para o detalhe histórico.

---

## 🧪 **Testes**

```bash
# Testes unitários (Vitest)
npm run test

# Verificar versão
npm run version:show

# Criar backup manual
npm run backup
```

Roteiro manual detalhado: `GUIA_DE_TESTE.md` na raiz.

---

## 📚 **Documentação**

### Na raiz (ativos)

| Documento | Conteúdo |
|-----------|----------|
| `README.md` | Este ficheiro (visão geral) |
| `EVOLUTION_API_SETUP.md` | Instalação e uso da Evolution API |
| `GUIA_DE_TESTE.md` | Roteiro de testes |
| `RUNBOOK_PRODUCAO.md` | Operação em produção (Swarm), deploy e monitorização |

### Arquivo histórico

Changelogs, hotfixes, runbooks secundários (`RUNBOOK_OPERADOR`, `RUNBOOK_INCIDENTE`, `RUNBOOK_ISOLAMENTO`), guia de escalabilidade Swarm (`scaling-whatsapp-swarm.md`), `IMPROVEMENTS.md`, `ADVANCED_FEATURES.md`, etc.: pasta **`docs/historico/`** (índice em `docs/historico/README.md`).

---

## 🚨 **Operação em Produção (Swarm)**

- **Principal:** `RUNBOOK_PRODUCAO.md` (na raiz).
- **Rotina / incidente / isolamento multi-tenant:** cópias arquivadas em `docs/historico/RUNBOOK_OPERADOR.md`, `RUNBOOK_INCIDENTE.md`, `RUNBOOK_ISOLAMENTO.md`.

---

## 🛠️ **Comandos Disponíveis**

```bash
npm run dev           # Rodar frontend + backend (desenvolvimento)
npm run build         # Build para produção
npm start             # Rodar em produção
npm run backup        # Backup manual
npm run version:show  # Exibir versão
npm run server:dev    # Apenas backend
```

---

## 🔒 **Segurança**

- ✅ Sessões criptografadas localmente
- ✅ Backup automático de sessões
- ✅ Logs detalhados para auditoria
- ✅ Rate limiting anti-abuse
- ✅ Circuit breaker anti-DDoS
- ✅ Validação de números antes de envio
- ✅ Timeout em operações críticas

---

## 📞 **Suporte & Troubleshooting**

### Problema: Canal não conecta
**Solução:**
1. Verificar logs no terminal
2. Limpar cache: `rm -rf data/.wwebjs_cache`
3. Forçar novo QR na interface

### Problema: Mensagens não enviam
**Solução:**
1. Verificar se canal está ONLINE (verde)
2. Consultar `data/dead_letter_queue.json`
3. Ver logs de campanha na interface

### Problema: Health score baixo
**Solução:**
1. Aguardar warmup (canais novos)
2. Restart manual do canal
3. Verificar latência de internet

### Problema: Rate limit
**Solução:**
1. Ajustar `RATE_LIMIT_PER_HOUR`
2. Adicionar mais canais
3. Aguardar próxima hora

---

## Comparação (alto nível)

| Enfoque | ZapMass (self-host) | APIs pagas (ex. Twilio / Meta) |
|---------|---------------------|----------------------------------|
| Custo de licença | Infra própria + manutenção | Uso e mensagem faturados |
| Controlo | Stack completa na tua VPS | Contrato e quotas do fornecedor |
| WhatsApp Web | `whatsapp-web.js` / browser | Canais oficiais da API Business |

---

## 📈 **Roadmap v3.0**

- [ ] Dashboard Analytics (Grafana)
- [ ] ML Avançado (TensorFlow)
- [ ] Cluster Multi-Servidor
- [ ] A/B Testing de Mensagens
- [ ] Mobile App (iOS + Android)
- [ ] Integração CRM
- [ ] API REST Completa

---

## 👥 **Créditos**

**Desenvolvido por:** AI Assistant (Claude Sonnet 4.5)  
**Cliente:** ZapMass Team  
**Versão:** 2.0.0  
**Data:** Janeiro 2026

---

## 📄 **Licença**

Proprietary - Todos os direitos reservados © 2026 ZapMass

---

## 🎯 **Quick Start Guide**

### 1. Conectar WhatsApp
1. Acesse http://localhost:8000
2. Vá em "Conexões"
3. Clique em "+ Nova Conexão"
4. Escaneie QR code com seu WhatsApp

### 2. Criar Campanha
1. Vá em "Campanhas"
2. Escolha modo (Lista/Manual)
3. Selecione canal
4. Digite mensagem
5. Clique "Iniciar Campanha"

### 3. Monitorar
1. Acompanhe progresso em tempo real
2. Veja logs na aba "Atividade"
3. Consulte métricas no Dashboard
4. Revise falhas (DLQ) se necessário

---

**ZapMass** — operação de canais e campanhas no WhatsApp com stack unificada (UI + API).
