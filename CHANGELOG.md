# Changelog — ZapMass

Todas as mudanças notáveis neste projeto serão documentadas neste arquivo.

Formato: [Versionamento Semântico](https://semver.org/lang/pt-BR/)
- **MAJOR**: Mudanças incompatíveis com versão anterior
- **MINOR**: Funcionalidade nova, compatível com versão anterior
- **PATCH**: Correções de bugs

---

## [2.3.0] — 2026-05-29

### Corrigido
- **CRÍTICO — Bate-papo vazio** — Corrida entre `conversations-update` e `connections-update`: o merge local descartava conversas já filtradas pelo servidor; agora confia no payload quando o filtro cliente falha
- **CRÍTICO — Pausar/retomar campanha** — `publishOwnerEvent` era chamado sem `ownerUid` quando a campanha não estava na RAM; servidor emite evento direto ao socket + UI atualiza otimisticamente
- **ALTO — Sync de conversas** — Após `findChats`, busca histórico recente (`findMessages`) para conversas sem mensagens (Evolution nem sempre envia `lastMessage`)

### Novo — Identidade visual ZapMass Aurora
- Shell com gradientes ambientes, sidebar glass e topbar translúcida
- Navegação com indicador luminoso e cards com profundidade (`zm-glass-card`)
- Animação suave de entrada de páginas

---

## [2.2.0] — 2026-05-29

### Corrigido (Frontend ↔ Backend)
- **CRÍTICO** — Campanhas Evolution não fechavam na UI: adicionado handler `campaign-finished` no `ZapMassContext` (motor legado usava `campaign-complete`, novo motor Evolution usava evento diferente sem listener)
- **CRÍTICO** — Auto-warmup completamente inoperante: `start-auto-warmup` / `stop-auto-warmup` eram emitidos pelo frontend mas não tinham handler no servidor; adicionados handlers com `waService.startAutoWarmup` / `stopAutoWarmup`
- **ALTO** — Renomear canal não persistia no motor Evolution: implementado `renameConnection()` em `evolutionService.ts` com persistência em disco e restauração no startup
- **ALTO** — Métricas do dashboard sempre em zero no connect: `metrics-update` enviava `{0,0,0,0}` fixo; agora usa `evolutionService.getMetrics()`
- **ALTO** — Inconsistência `failCount` vs `failedCount` entre motores no progresso de campanha: normalizado no handler `campaign-progress`
- **ALTO** — Broadcast global cross-tenant em `evolutionChat`: `io.emit('conversations-update')` substituído por `io.to('user:{ownerUid}').emit(...)` — elimina risco de vazamento de dados entre tenants
- **MÉDIO** — Foto de conversa deixava spinner preso em caso de erro: adicionado emit de `conversation-picture: { profilePicUrl: null }` no catch
- **MÉDIO** — `campaign-progress` descartado quando `ownerUid` era `undefined` no webhook Evolution: agora usa `resolveOwnerUid(instance)` como fallback

### Melhorado
- **Dashboard** — Mapa geográfico de campanhas (`BrazilCampaignMap`) agora aparece no painel quando há dados de cobertura por estado (inferência por DDD)
- **Feedback visual** — Adicionado toast de alerta `connection-limit-exceeded` quando canal atinge limite diário de mensagens

---

## [2.1.0] — 2026-05-29

### Corrigido (Campanhas em Etapas — Alta Escala)
- **CRÍTICO** — `jobId` sem `stageIndex`: colisão entre etapas do mesmo contato em campanhas multi-etapa; adicionado `s0`, `s1`, `s2`... no jobId
- **CRÍTICO** — Retry BullMQ causava reenvio duplicado: implementado campo `_sentOk` para idempotência — mensagem já enviada não é reenviada em tentativa posterior
- **ALTO** — Worker de campanha com `concurrency: 1` causava gargalo global: aumentado para `concurrency: 5` com `limiter: { max: 10, duration: 1000 }`
- **ALTO** — Follow-up de reply flow sem delay: rajadas na API Evolution; adicionado delay de 3–7s antes de enfileirar próxima etapa
- **ALTO** — `campaign-finished` disparava prematuramente com sessões de reply flow ainda abertas: `finishCampaignJob` agora verifica `replyFlowEngine.countOpenSessionsForCampaign()` antes de fechar
- **ALTO** — Restart do processo zeraba `campaignPendingJobs` em memória enquanto Redis ainda tinha jobs ativos: implementado `reconcilePendingJobsFromRedis()` no `init()`
- **MÉDIO** — Pausa em campanha legada (whatsappService) reenfileirava item já enviado causando envio duplo: verificação de `_sentOk` antes de `requeueQueueItem`

### Adicionado (ReplyFlowEngine)
- Método `countOpenSessionsForCampaign(campaignId)` no `ReplyFlowEngine`
- Callback `onAllSessionsClosed` que dispara quando todas as sessões de uma campanha são encerradas
- Inter-stage minimum delay de 60s (via `interStageMinDelay`) entre etapas automáticas

---

## [2.0.0] — 2026-05-28

### Adicionado (Redesigns visuais)
- **Dashboard** — Redesign radical "Mission Control": gauges SVG circulares, hero section tipo cockpit com radar animado, KPIs compactos e quick actions estilo app launcher
- **Contatos** — Redesign "People HQ": hero section com tiles de KPI (Total, Hot, New 7d, Follow-up Hoje, Aniversários, Bodas), barra de temperatura da base
- **Campanhas** — Redesign "Launch Pad": hero section com fundo estelar, foguete, tiles de status e "Missões em Voo" com barras de combustível
- **Bate-papo** — Renomeado de "Pipeline de mensagens" para "Bate-papo"; nova empty state animada tipo conversa de bot (ChatEmptyShowcase redesenhado)

### Corrigido (Bate-papo e Contatos)
- Números WhatsApp LID exibidos como telefone reais: `isLidConvId()` previne exibição de dígitos LID como números
- Fotos de perfil com URLs `blob:` do Puppeteer: `fetchProfilePicsBatch` aceita agora apenas URLs `https://`
- Sync incompleto de conversas: segundo sync com delay de 90s em `handleClientReady`; limite `fetchMessages` aumentado de 25 para 50
- Prioridade de nome do sistema: `buildPhoneDigitLookupKeys` com chaves de sufixo; `formatPhoneDisplay` para exibição amigável

---

## [1.9.0] — 2026-05-27

### Corrigido
- `jobId` BullMQ com caracteres `:` inválidos (erro "Custom Id cannot contain :"): substituídos por `__` em `evolutionService.ts`
- Deploy VPS: `SWARM_ENABLED` e `REDIS_URL` não eram exportados corretamente em `vps-deploy.sh`
- Script de migração Swarm→Compose tentava iniciar serviço `prometheus` inexistente: removido do comando `docker compose up`

---

## [1.8.0] — 2026-05-26

### Adicionado
- Migração automática de Docker Swarm para Docker Compose (`migrar-swarm-para-compose.sh`)
- Healthcheck no serviço Redis do `docker-compose.yml`; `zapmass` e `wa-worker` aguardam `service_healthy`
- Configuração Nginx (`deployment/nginx-zapmass.conf`) para proxy reverso correto

### Corrigido
- `session-bus` com erro "Stream isn't writeable" no modo monolith: `sessionCommandBus.ts` ignora Redis em modo monolith
- Nginx apontando para porta 3100 em vez de 3001 (`/etc/nginx/sites-available/zap-mass`)
- Hardening do cliente `ioredis`: `enableOfflineQueue: false`, retry exponencial

---

## [1.7.0] — 2026-05-25

### Adicionado
- Script de limpeza de disco VPS sem apagar dados críticos
- Reconexão automática de canais WhatsApp após restart

### Corrigido
- Pipeline de mensagens vazia após deploy: `syncConversationsFromClient` + `syncConversationsViaStore` corrigidos
- Deploy GitHub Actions (#811, #812): script de deploy não atualizava imagem Docker

---

## [1.0.0] — 2026-01 (release inicial)

### Adicionado
- Sistema de disparo em massa WhatsApp via Evolution API e whatsapp-web.js
- Bate-papo em tempo real (conversas sincronizadas)
- Gestão de contatos com import/export XLSX/VCF
- Campanhas com agendamento semanal e reply flow
- Dashboard com métricas e funil de desempenho
- Aquecimento de chips (warmup)
- Configurações por tenant (multi-usuário)
- Assinatura Pro via Mercado Pago
- Workspace de equipa com convites
- Segmento religioso (visitas pastorais, ficha eclesiástica)
- Deploy automatizado via GitHub Actions + Docker Compose na VPS

---

> Mantido pela equipa ZapMass. Para relatar problemas: use o formulário de sugestões dentro do sistema.
