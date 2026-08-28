# Changelog — ZapMass

Todas as mudanças notáveis neste projeto serão documentadas neste arquivo.

Formato: [Versionamento Semântico](https://semver.org/lang/pt-BR/)
- **MAJOR**: Mudanças incompatíveis com versão anterior
- **MINOR**: Funcionalidade nova, compatível com versão anterior
- **PATCH**: Correções de bugs

---

---

## [2.3.30] — 2026-08-28

### Fix: flood de 30+ req/s em /instance/all derrubando Evolution Go

**Root cause confirmado nos logs:** 30 requisições `GET /instance/all` no mesmo segundo — todos os chips verificando status simultaneamente sem compartilhar o resultado, causando carga explosiva no Evolution Go logo após o restart.

**Correções:**
- `probeGoConnectionStateFromInstanceList`: adicionado cache compartilhado de 5s com deduplicação de request em-voo (`_instanceListInflight`). N chips verificando status no mesmo segundo fazem **1 único HTTP** para `/instance/all` e compartilham o resultado.
- `filterActiveConnections`: stagger de 50ms entre probes de chips no Evolution Go evita bursts simultâneos.
- `watchdog-evolution-go.sh`: adicionado check de uptime — não reinicia containers que iniciaram há menos de 90s, prevenindo loop de restarts durante o período de inicialização.

---

## [2.3.29] — 2026-08-28

### Fix: causa raiz do crash recorrente do Evolution Go (produção + homologação)

**Varredura minuciosa identificou 4 causas raiz:**

1. **Tempestade de `/instance/connect` com `immediate:true` no boot** (`goRouteAdapter.ts`): ao iniciar o ZapMass, `hydrateInstancesFromEvolution` chamava `ensureGoInstanceWebhook` em todos os chips, que enviava `POST /instance/connect` com `immediate:true` para o Evolution Go. Em sistemas com vários chips conectados, isso forçava N reconexões WhatsApp simultâneas, sobrecarregando e crashando o Evolution Go. **Corrigido:** `immediate:true` agora só é enviado quando explicitamente solicitado (`forceReconnect:true` no body), o que só ocorre em operações reais de connect (Forçar QR, auto-reconnect, logout+reconnect). O re-registro de webhook no boot não força mais reconexão.

2. **Hydrate duplo no boot** (`evolutionService.ts`): `hydrateInstancesFromEvolution` era chamado 2 vezes consecutivas no startup, dobrando a tempestade descrita acima. **Corrigido:** segunda chamada removida.

3. **Poll de status a cada 2s sem backoff** (`watchConnectionUntilOpen`): chips em estado "connecting" causavam até 30 req/min cada no Evolution Go. Com 5+ chips conectando simultaneamente, a carga HTTP era suficiente para derrubar o motor. **Corrigido:** backoff crescente: 2s → 3s → 4s → ... → máx 10s, reduzindo para ~8 req/min.

4. **"Fora do ar" com 1 falha de rede** (`assertEvolutionGoLicensed`): qualquer blip DNS ou restart momentâneo do container disparava o erro para o usuário antes do motor ter chance de subir. **Corrigido:** aguarda 2s e tenta 1 vez novamente antes de declarar unreachable.

---

## [2.3.28] — 2026-08-28

### Fix: Evolution Go cai e não sobe automaticamente na produção

**Root cause:** O container `zapmass-evolution-go` foi criado com política `restart: unless-stopped` antes da correção em `docker-compose.yml` (que mudou para `restart: always`). Como o `docker compose up -d --build` só recria serviços que mudaram de imagem, o container antigo manteve a política desatualizada — ao cair, Docker não reiniciava.

**Correções:**
- `deployment/watchdog-evolution-go.sh`: novo script que monitora `zapmass-evolution-go` e `zapmass-evolution-go-homolog`, reinicia via `docker start` ou `docker compose up` se cair.
- `deployment/install-evolution-go-watchdog.sh`: instala o watchdog no cron do sistema a cada **2 minutos**.
- `deployment/vps-deploy.sh`: após o deploy, aplica `restart: always` nos containers existentes via `docker update` (sem recriar) e instala o watchdog automaticamente.

---

## [2.3.27] — 2026-08-28

### Fix: aba de acompanhamento do disparo e fluxo por resposta

**Bugs corrigidos:**

1. **Status `WAITING_REPLY` sobrescrito por `RUNNING`** (`ZapMassContext.tsx`): eventos tardios de `campaign-progress` (socket) forçavam o status de volta para `RUNNING`, mesmo quando a campanha já havia transitado para `WAITING_REPLY`. A tela mostrava "Aguardando respostas" por um frame e depois voltava para "Em andamento". Corrigido: evento `campaign-progress` agora preserva `WAITING_REPLY` se for o status atual.

2. **Sem polling de logs durante `RUNNING`** (`CampaignDetails.tsx`): logs persistidos, relatório por contato e respostas inbound só eram sincronizados após a campanha concluir ou entrar em `WAITING_REPLY`. Em disparos grandes o relatório ficava incompleto durante o envio. Corrigido: polling a cada 30s durante `RUNNING` (12s nas outras fases).

3. **Banner do fluxo por resposta estático** (`CampaignDetails.tsx`): o banner sempre exibia "etapa 1 enviada. Etapa 2 dispara ao receber resposta" mesmo em campanhas com 3+ etapas ou sem etapas adicionais. Agora exibe o total de etapas configuradas, quantas respostas já foram recebidas e quantas aguardam resposta.

---

## [2.3.26] — 2026-08-28

### Fix: disparo por fluxo (replyFlow) bloqueado por guards de proteção

**Root cause:** Mensagens de continuação de fluxo por resposta (`replyFlowResponse: true`) passavam pelos mesmos guards de chip protection, sleep mode, tier daily cap e limite diário do canal que mensagens outbound regulares. Como resultado:
- Um contato que respondia a uma campanha de fluxo durante a noite (modo silêncio ativo) recebia a próxima etapa somente às 8h da manhã.
- Se o chip atingia o cap diário do tier, as respostas de fluxo ficavam presas na fila.
- Se havia proteção anti-ban ativa, as respostas eram atrasadas ou pausadas indefinidamente.
- Se a campanha estava manualmente pausada, as etapas de fluxo nunca avançavam.

**Correção:** Adicionados guards `!item.replyFlowResponse` em todos os pontos de bloqueio:
1. `runCampaignDispatchGuard` — chip protection guard
2. `pausedCampaigns` — pause manual
3. Tier daily cap (ramp-up)
4. Sleep mode noturno (20h–8h)
5. Limite diário de mensagens por canal

`replyFlowResponse` é resposta direta a um contato que já interagiu — deve ser enviada imediatamente independente de horário, caps ou proteções.

---

## [2.3.25] — 2026-08-28

### Fix: crash unhandledRejection em campaign_logs por violação de FK

**Root cause:** Quando um job BullMQ tentava registrar o log de envio de uma campanha inexistente/deletada no banco, o `INSERT` em `campaign_logs` lançava `error code 23503` (foreign key violation). Sem try/catch, o erro virava `unhandledRejection` e derrubava o processo Node.js.

**Correção:**

- **`server/repositories/campaignsRepository.ts`** (`addCampaignLog`): Captura `pg.code === '23503'` e loga aviso silencioso em vez de relançar — impede crash do worker sem perder rastreabilidade.

**Produção:** Evolution Go estava com `ENOTFOUND evolution-go` — container fora da rede Docker. Reiniciar com `docker compose restart evolution-go`.

---

## [2.3.24] — 2026-08-28

### Fix: crash do homolog por import inexistente em chipProtectionRoutes

**Root cause:** O endpoint `POST /api/chip-protection/reset-circuit` importava `listConnectionsForOwner` de `evolutionService.ts`, mas essa função não existe — o nome correto é `getConnectionsForTenant`. Isso causava crash do processo Node.js na inicialização (SyntaxError de módulo ESM), derrubando o homolog com 502 Bad Gateway.

**Correção:**

- **`server/chipProtectionRoutes.ts`**: Substituído import `listConnectionsForOwner` por `getConnectionsForTenant` (função síncrona correta).

---

## [2.3.23] — 2026-08-28

### Fix: proteção de chips travava campanhas após reinstalação do Evolution Go

**Root cause:** Quando o Evolution Go reiniciava/caía várias vezes durante troubleshooting, o sistema de proteção detectava `reconnect_storm` e ativava um lock de **6 horas** bloqueando todos os disparos. O botão "Encerrar cooldown" só aparecia para `ban_cooldown`, deixando o usuário sem saída na UI para `reconnect_storm`.

**Correções:**

- **`ChipProtectionPanel.tsx`**: Botão **"Liberar proteção agora"** agora aparece para **qualquer** motivo de lock (`ban_cooldown` ou `reconnect_storm`), não apenas ban. Adicionado texto explicativo para cada motivo.
- **`chipCircuitBreaker.ts`**: Novos métodos `resetChip(chipId)` e `resetMany(chipIds[])` para limpar contadores Redis de falhas.
- **`chipProtectionRoutes.ts`**: Novo endpoint `POST /api/chip-protection/reset-circuit` que zera o circuit breaker de todos os chips do tenant. Ideal para usar após resolver problema de infraestrutura.
- **`chipProtectionApi.ts`**: Novo método `resetChipCircuitBreaker()` no serviço frontend.
- **`ChipProtectionPanel.tsx`**: Botão **"Resetar circuit breaker"** aparece na UI quando algum chip está com estado `OPEN` no Redis.
- **`deployment/unlock-campaign-protection.sh`**: Script de emergência para liberar o lock e zerar o Redis diretamente na VPS sem precisar de deploy.

---

## [2.3.22] — 2026-08-28

### Fix crítico: disparos de campanhas não enviavam mensagens (Evolution Go)

**Root causes corrigidos:**

- **`getConnectionState`**: `skipCache:true` agora bypassa também a RAM — evitava probe HTTP real no Evolution Go
- **`filterActiveConnections`**: no Evolution Go sempre faz probe HTTP antes de aprovar um chip para campanha (RAM era stale após restart do container)
- **`goRouteAdapter` — status**: aceita `connected/CONNECTED/online/available` além de `open` — whatsmeow pode reportar estado em formatos diferentes
- **`goRouteAdapter` — sendMedia**: traduz campos Evolution API v2 → Evolution Go (`mediaType`, `mimeType`, `url`/`base64`)
- **`goRouteAdapter` — sendText response**: detecta `QUEUED/SENT` além de `PENDING` como sucesso; usa sentinel `go-queued` quando Go não retorna id
- **`attemptEvolutionSendText`**: aceita `QUEUED/SENT/DELIVERED` como status de sucesso
- **`startCampaign`**: verifica saúde do Evolution Go (licença + rede) antes de enfileirar jobs — erro mostrado imediatamente ao invés de jobs falhando silenciosamente

---

## [2.3.21] — 2026-08-28

### Fix: deploy VPS travado em commit antigo + .env syntax error

- **ensure-git-main.sh**: fetch com refspec explícito `+refs/heads/main:refs/remotes/origin/main` — garante que origin/main seja atualizado corretamente
- **deploy-completo.sh**: "Já em produção" agora verifica se COMMIT local == origin/main antes de pular deploy — impede falso-positivo (ex.: local=b627148, API=b627148, mas origin=v2.3.20)
- **fix-evolution-go-vps.sh**: `source .env` substituído por parser seguro linha-a-linha — tolerante a erros de sintaxe no .env
- **emergency-update-vps.sh**: script novo para forçar atualização sem depender do .env, reiniciar evolution-go (prod + homolog) e build em um só comando

---

## [2.3.20] — 2026-08-28

### Fix crítico: Evolution Go ENOTFOUND + licença — produção e homologação

- **Root cause corrigido**: `probeEvolutionGoLicenseActive` não distinguia container offline (ENOTFOUND) de licença inválida — agora retorna `unreachable: true` para erros de rede
- **Mensagem de erro correta**: container offline mostra "Motor WhatsApp fora do ar, execute docker compose restart" em vez de "licença inativa"
- **Docker Compose**: `restart: always` (era `unless-stopped`) + `healthcheck` adicionado ao `evolution-go` e `evolution-go-homolog`
- **depends_on** do zapmass: evolution-go marcado como `required: false` — ZapMass sobe mesmo com Evolution Go fora
- **createConnectionInternal**: erro de rede → mensagem amigável em vez de ENOTFOUND cru
- **Script novo**: `deployment/fix-evolution-go-vps.sh` — diagnóstico e recuperação automática na VPS
- **isEvolutionGoNetworkError**: nova função para detectar ENOTFOUND/ECONNREFUSED/EAI_AGAIN
- **EVOLUTION_GO_UNREACHABLE_HINT**: nova constante com instrução de recuperação

---

## [2.3.19] — 2026-08-28

### Regra de versionamento automático

- **Regra permanente criada**: bump de versão + changelog obrigatório em todo release (homolog e produção)
- Arquivo `VERSION` na raiz do projeto atualizado junto com cada release
- Regra salva em `.cursor/rules/versioning.mdc` para garantir aplicação automática

---

## [2.3.18] — 2026-08-27

### Chat redesenhado — layout idêntico ao WhatsApp Desktop

- **Avatares circulares** (border-radius 50%) em toda a inbox e header do chat — exato WA Desktop
- **Linhas de conversa** 72px de altura, padding 12px — medidas precisas do WA Desktop
- **Selecionado** = `#2a3942`, **hover** = `#1e2a31` (sem verde), sem accent bar lateral
- **Filter pills** estilo WA Desktop: fundo `#2a3942` inativo / verde `#00a884` ativo
- **Header da inbox** com botões Nova Conversa (PenSquare) e Opções (⋮)
- **Header do chat** com ícones Vídeo e Ligação antes do botão Buscar
- **Nova aba "Campanhas"** na inbox ao lado de Tudo / Não lidas / Quentes
- **Separador** entre linhas começa após o avatar (73px), igual ao WA Desktop

---

## [2.3.17] — 2026-08-27

### Bate-papo redesenhado — visual WhatsApp Web + mídias funcionando

- **Fotos/vídeos/áudios** aparecem diretamente ao receber — URL CDN do WhatsApp agora incluída no webhook (`skipMedia=false`)
- **Placeholder de imagem/vídeo** redesenhado: quadrado cinza 260×200 com ícone centralizado, igual ao WhatsApp Web
- **Layout geral** do bate-papo alinhado ao WA Web: cores, tipografia, espaçamentos
- **Banner de homologação** não sobrepõe mais a TopBar
- **Aba "Quentes"** filtra corretamente após aplicar tag
- **Fotos de perfil** carregam mais rápido (prefetch aumentado para 24 itens)
- **ChangelogPanel**: badges de ambiente (Homolog / Produção) + alerta de versões pendentes

---

## [2.3.16] — 2026-07-14

### Corrigido — Segurança: conversas misturadas entre usuários
- **Cliente:** removido fallback que aceitava inbox inteira sem filtro de tenant (`conversationInboxTrim`)
- **Redis bridge:** não emite mais `conversations-update` sem re-filtro por socket
- **Webhook:** descarta `MESSAGES_UPSERT` de canais sem `ownerUid` ou instância estranha ao container
- **claim-connection:** só vincula canais órfãos (`tryClaimUnownedLegacyConnection`), bloqueia roubo de chip
- **Evolution hydrate:** ignora instâncias de outros clientes no shard compartilhado (sem settings local)
- **Boot:** remove conversas em cache sem `ownerUid` resolvível
- **Relatório campanha:** filtra conversas por tenant/canal permitido
- Script ops: `deployment/audit-conversation-isolation.sh`

---

## [2.3.15] — 2026-07-14

### Corrigido — CI/CD GitHub Actions (deploy vermelho)
- Testes `dashboardLocalStats` e `channelDispatchInsights` usavam data local (UTC) em vez de `brazilDayKey()` — falhavam entre 21h–23h59 UTC
- Workflow: `TZ=America/Sao_Paulo` no job de build; removido `FORCE_JAVASCRIPT_ACTIONS_TO_NODE24`

---

## [2.3.14] — 2026-07-14

### Adicionado — Evolution sharding (Fase A)
- **2ª instância Evolution** (`evolution-2`) no `docker-compose.yml` (profile `evolution-shard`)
- **Roteamento automático** no `novo-cliente.sh`: novos clientes vão para o shard com menos carga
- **Defaults conservadores** no template Plano B: `CAMPAIGN_WORKER_CONCURRENCY=4`, `EVOLUTION_WEBHOOK_WORKER_CONCURRENCY=4`
- Scripts ops: `deployment/setup-evolution-shard.sh`, `deployment/evolution-shard-status.sh`
- Teste staging: `deployment/test-evolution-shard-staging.sh` (+ `rodar-staging-shard-vps.ps1` no PC)
- Coluna **EVOLUTION** no `monitor-clientes.sh`

---

## [2.3.13] — 2026-07-13

### Corrigido — Redis OOM e loop do worker BullMQ
- **Retenção agressiva** de jobs BullMQ (`removeOnComplete`/`removeOnFail` + trim periódico a cada 30 min)
- **Resiliência** quando Redis atinge `maxmemory`: backoff exponencial, debounce na reconexão, sem crash em `unhandledRejection`
- **Redis** padrão `2gb` via `REDIS_MAXMEMORY` (mantém `noeviction` — seguro para filas)
- **`/api/health/deep`** expõe métricas da fila `campaign-messages`
- Script ops `deployment/trim-redis-bullmq.sh` para diagnóstico na VPS

---

## [2.3.7] — 2026-05-29

### Corrigido — Teste grátis de 1 hora
- **API idempotente** — segundo clique ou auto-start enquanto o trial já está activo deixa de mostrar erro
- **Gate instantâneo** — após activar trial, o painel abre sem esperar o Firestore (estado optimista)
- Mensagens claras: trial já usado, funcionário de equipa, ou falha de rede

---

## [2.3.6] — 2026-05-29

### Corrigido — Entrada de cliente novo
- **Cadastro por e-mail** na landing não bloqueia mais quando o Firebase impede verificação de e-mail (proteção contra enumeração)
- **Teste grátis automático** ao clicar «Começar grátis» / «Inscrever-se» (Google, Facebook ou e-mail)
- Mensagens mais claras se o servidor ainda não tiver Firebase Admin ou a sessão expirar ao ativar trial

---

## [2.3.5] — 2026-05-29

### Corrigido — Lista estilo WhatsApp
- **Horários** — contatos da agenda sem mensagem não recebem mais o horário do sync; exibição via timestamp real (Hoje, Ontem, dd/mm)
- **Layout** — lista com 2 linhas como WhatsApp Web (nome + horário / preview da última mensagem), sem telefone no meio
- **Fotos** — servidor espelha fotos do CDN WhatsApp em data URL (evita bloqueio no browser); busca por scroll na lista visível

---

## [2.3.4] — 2026-05-29

### Corrigido — Conversas completas + fotos
- **findChats paginado** (até 30 páginas) + **findContacts** como fallback — traz todas as conversas do celular por chip
- **Fotos de perfil** — busca com JID completo (`@s.whatsapp.net` e `@lid`), batch após sync e fetch para todas as conversas na lista
- **Importação** — não descarta mais chats válidos só por falta de `messages[]` no payload da Evolution
- Contador do seletor alinhado à lista filtrada (sem inflar com duplicatas)

---

## [2.3.3] — 2026-05-29

### Corrigido — Multi-canal (crítico)
- **Corrida de sync paralelo** — vários chips sincronizando `findChats` ao mesmo tempo corrompiam a lista em RAM
- **Lock de store** — mutações em `evolutionChat` serializadas; emit único após todos os canais
- **Prune por canal** — limpeza de lixo não remove mais conversas de outros chips
- **Deduplicação por id** — evita lista com contador 4 mas só 3 linhas (virtualizer com key duplicada)

---

## [2.3.2] — 2026-05-29

### Corrigido — Bate-papo multi-canal
- **Todas as conversas visíveis** — findChats com preview mas sem `messages[]` deixava de aparecer na aba Todas
- **Sync de todos os chips** — `syncConnectionsForOwner` roda `findChats` em paralelo em cada canal CONNECTED
- **Auto-sync ao abrir Bate-papo** — dispara `request-conversations-sync` quando canais conectados mudam
- **Seletor de canal** — lista só chips online; contagem alinhada ao total exibido

---

## [2.3.1] — 2026-05-29

### Corrigido — Bate-papo
- **Invalid Date** na lista — normalização de timestamp Evolution (s/ms) e formatação segura no cliente
- **Conversas lixo** (`0`, `+0`, JID inválido) — filtradas no sync e removidas da RAM
- **Aba Todas** — mostra só conversas reais do celular; vazias/disparo nos filtros dedicados
- **Visual Pipeline** — paleta dark alinhada ao tema Aurora (verde ZapMass)

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
