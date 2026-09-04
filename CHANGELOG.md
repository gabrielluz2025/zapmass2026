# Changelog — ZapMass

Todas as mudanças notáveis neste projeto serão documentadas neste arquivo.

Formato: [Versionamento Semântico](https://semver.org/lang/pt-BR/)
- **MAJOR**: Mudanças incompatíveis com versão anterior
- **MINOR**: Funcionalidade nova, compatível com versão anterior
- **PATCH**: Correções de bugs

## [2.3.75] - 2026-09-04
### Corrigido
- **Editar campanha não trocava canal/pool**: chips offline estavam travados e o passo só avançava com canal online. Agora dá para trocar pool ou chips mesmo com canal restaurado offline.
### Melhorado
- **Incluir chip num pool existente**: campanhas ativas daquele pool passam a dividir a fila com o canal novo (jobs pendentes são remapeados).

## [2.3.74] - 2026-09-04
### Corrigido
- **Bate-papo zerava quando a API caía**: se os canais ficavam sem dono no boot, o prune apagava todas as conversas e gravava `conversations_cache.json` vazio. Agora o prune não zera a inbox, a gravação é atômica e o SIGTERM faz flush.
### Melhorado
- **Botão Respostas**: no Evolution Go não lê o celular; varre o arquivo Postgres e os destinos de campanha das últimas 72h, além do bate-papo em memória.

## [2.3.73] - 2026-09-04
### Corrigido
- **Canais restaurados sumiam no restart**: a reconciliação do boot apagava todo `conn_*` sem nome amigável, mesmo com dono no Postgres, e gravava `connections_settings.json` vazio. Agora só remove órfão de verdade (sem `ownerUid`) e recusa sobrescrever o arquivo com `{}`.

## [2.3.72] - 2026-09-04
### Corrigido
- **API em crash loop após deploy**: `connections_settings.json` truncado fazia o boot chamar `log()` antes do Socket.IO existir (`Cannot access 'io' before initialization`). Agora o JSON inválido não derruba o processo, tenta recuperar/.bak, e a gravação é atômica (tmp+rename).

## [2.3.71] - 2026-09-04
### Corrigido
- **Canal `conn_*` Offline com “Tentando reconectar…”**: o canal ainda não tinha número (nunca pareado). O GET do QR no Evolution Go voltava 400 e o ZapMass abortava — o QR não aparecia e, depois do timeout, o canal podia ser apagado. Agora o QR leva o UUID certo, o 400 não cancela o connect e o Conectar mostra “Gerando QR”.

## [2.3.70] - 2026-09-04
### Corrigido
- **Buscar respostas no chip**: o botão Respostas usava a janela do último close (às vezes minutos) e só olhava o histórico em RAM — dava “nenhuma pendente” mesmo com conversas. Agora varre 72h, puxa o arquivo/inbox e o toast diz se já tinha sido processada.
- **Conectar não religava o canal**: clique em Conectar podia ficar preso no hold de logout e só tentava restart em background, sem QR. Agora limpa o hold, tenta restaurar a sessão e, se não voltar, gera o QR.
### Melhorado
- **Contagem de disparo vs aquecimento**: o card de conexões mostra separado (hoje, semana e total) — o limite diário da campanha não mistura mais com o aquecimento.

## [2.3.69] - 2026-09-04
### Corrigido
- **Mesmo contato recebia o disparo/confirmação várias vezes**: após deploy o watchdog via só os 400 primeiros jobs da fila, achava a campanha vazia (0% com jobs só atrasados) e reenfileirava tudo — cada chip (Disparo 01, 02, 03…) mandava de novo. Agora a fila é contada inteira, jobId é estável por contato e o SAIR não gera segunda confirmação no replay.

## [2.3.68] - 2026-09-04
### Corrigido
- **Resposta do gatilho SAIR era substituída pelo texto genérico da LGPD**: o opt-out global rodava antes do fluxo por respostas e enviava “Sua solicitação foi processada…”. Agora o texto configurado no gatilho da campanha é o que o contato recebe.

## [2.3.67] - 2026-09-04
### Corrigido
- **Campanha caía no anti-ban no 1º job e não disparava**: logout/apagar canal gerava 401 (`loggedOut`) e o tenant ficava 48h em cooldown — a campanha inteira pausava mesmo com chips online. Agora o lock só pausa se nenhum canal estiver disponível; exclusão/logout não conta como ban; campanhas já travadas retomam no próximo tick.

## [2.3.66] - 2026-09-04
### Corrigido
- **Prospecção com fluxo por respostas era recusada no disparo**: o servidor exigia 2 passos do plano semanal mesmo quando o wizard usa Lead Quente / nurture. Agora, com fluxo por respostas, só o lembrete dos silenciosos é necessário — o plano semanal vem do nurture.

## [2.3.65] - 2026-09-04
### Corrigido
- **Apagar canal com UUID inválido no Evolution**: o Go rejeitava o identificador e o ZapMass abortava a exclusão. Agora o canal é removido localmente mesmo se o Evolution não reconhecer o ID.
- **Campanha de prospecção grande não abria / não iniciava**: a lista da API deixava de enviar dezenas de milhares de telefones no JSON; o enfileiramento passou a usar lotes (addBulk); o snapshot pesado vai para arquivo. O botão Confirmar e a tela de detalhes deixam de travar.

## [2.3.64] - 2026-09-03
### Corrigido
- **Prospecção em base grande travava o disparo**: o modal de pré-voo recomeçava a verificação do motor e dos canais a cada re-render (lista enorme de destinatários). Agora a checagem roda uma vez ao abrir e o botão Confirmar não fica bloqueado no loop de “Verificando…”.
- **Limite 24h no cliente**: bases com mais de 1.500 contatos não enviam a lista inteira no pré-disparo (o servidor aplica o cap no envio). Evita POST gigante e tela piscando.

## [2.3.63] - 2026-09-03
### Melhorado
- **Notificações discretas**: toasts movidos para canto inferior direito, duração reduzida para 4-6s, tamanho compacto (320px max) e mensagens curtas — não ocupam mais metade da tela.
- **Aquecimento sem trava para chips em quarentena/anti-ban**: chips em cooldown pós-ban e em quarentena agora participam normalmente do aquecimento. O warmup ajuda na recuperação do chip — não faz sentido bloquear.

## [2.3.62] - 2026-09-03
### Corrigido
- **CRÍTICO — Aquecimento parava por causa de campanhas**: `recordConnectionDispatch` (campanhas e mensagens manuais) contaminava o contador diário do aquecimento. Agora `warmupSent`/`warmupReceived` são campos separados — campanhas NÃO afetam o limite de aquecimento.
- **Limites diários de aquecimento ampliados para 24h**: Novato 20→150 / Morno 50→300 / Quente 120→600 / Premium 250→1200 (suportam operação contínua 24h com 2–5 chips).

## [2.3.61] - 2026-09-03
### Corrigido
- **"too many clients" recorrente — solução permanente**: Postgres agora mata conexões ociosas automaticamente via `idle_session_timeout=300s` + `tcp_keepalives`. Cron de limpeza preventiva instalado a cada 10 minutos pela VPS.

## [2.3.60] - 2026-09-03
### Adicionado
- **Botão "Respostas" no card de conexão**: reprocessa mensagens recebidas enquanto o chip estava offline — aplica opt-in/opt-out e inscreve leads quentes automaticamente ao reconectar.

## [2.3.59] - 2026-09-03
### Corrigido / Adicionado
- **Canais bônus além de 5**: limite de canais manual agora vai até 20 (antes era fixo em 5 para todos). Contas com `manualExtraChannelSlots` ou `includedChannels` definidos pelo admin podem ter até 20 chips simultâneos.
- Admin UI: campo "Canais do plano" aceita até 20; nova seção "Canais bônus extras" para definir slots adicionais.
- Backend e frontend sincronizados: `MAX_CHANNELS_MANUAL_GRANT = 20`, `manualGrantedExtraSlots` sem cap artificial de 3.

## [2.3.58] - 2026-09-03
### Adicionado
- **Fluxo por gatilho na Prospecção de base**: agora é possível escolher o modo "Fluxo por respostas" também em campanhas de prospecção — permita rotear contatos por palavra-chave ("quero" → Lead Quente, "sair" → Lista Negra) diretamente na abertura da campanha.
- `CampaignFlowModePicker`: novo prop `hiddenModes` para ocultar modos não suportados (ex.: sem "Sequential" na prospecção).
- `CampaignProspectingSetup`: novo prop `hideResponderSteps` — quando o fluxo de respostas está ativo, o "Plano semanal" é gerenciado automaticamente pelo nurture, exibindo mensagem informativa no lugar dos passos manuais.
- Validação do wizard ajustada: no modo reply + prospecção não exige preenchimento dos `responderSteps` manualmente.

---

---

## [2.3.57] — 2026-09-03

### Corrigido
- **LID/reply flow**: `resolvePhoneDigitsFromEvolutionMessage` agora tenta resolver telefone via `waJidAlt` no chatStore quando `remoteJid` é `@lid` sem campos `senderPn`/`remoteJidAlt` — evita descartar respostas de campanha de contatos com JID privado
- **fix-evolution-go-now.sh**: corrige bug de sintaxe `_i: command not found` no loop que aguarda a porta do Evolution Go ficar disponível

---

## [2.3.56] — 2026-09-03

### Hotfix crítico — Evolution Go offline + "too many clients" Postgres

- **fix CRÍTICO:** `fix-postgres-connections.sh` não para mais o Evolution Go de **produção** por padrão — apenas homolog. Flag `--stop-prod-evolution` para opt-in explícito + `ensure_prod_evolution_running` reconecta prod no final.
- **fix CRÍTICO:** `evolutionOpenState.ts` — parser restaurado com PascalCase (`Connected`, `LoggedIn`, `Online`), envelopes `instance`/`data` aninhados. Previne false-negative que causava loop de reconexão.
- **fix:** `unlock-campaign-protection.sh` usa schema/tabela corretos (`zapmass.tenant_dispatch_settings`, user `postgres`, db `zapmass_db`).
- **fix:** `vps-deploy.sh` restaura instalação do watchdog do Evolution Go (cron 2min) e `restart=always` em containers avulsos, nos modos Swarm e Compose.
- **test:** 15 testes cobrem todos os formatos do parser de estado Go.

---

## [2.3.55] — 2026-09-03

### Campanhas — Fluxo por respostas: opt-out real + UX melhorada

- **feat:** Opt-out via "Fluxo por respostas" agora persiste na lista negra real (tabela `contact_opt_outs`, cancela jobs BullMQ e nurture enrollments).
- **feat:** `CampaignFlowModePicker` mostra exemplos "quero → Lead Quente" e "sair → Lista Negra" para facilitar descoberta.
- **feat:** Seletor de ação nos menus de resposta redesenhado em cards visuais (Sem ação / Lead Quente / Lista Negra).
- **fix:** `onMarketingConsent(opt_out)` agora chama `processContactOptOut` idêntico ao fluxo inbound — comportamento consistente.

---

## [2.3.54] — 2026-09-02

### Auditoria completa — bugs críticos Evolution + segurança + chat

- **Go HistorySync:** lock `inflight` só libera em `OfflineSyncCompleted` (ou TTL 3 min) — evita tempestade de reconnect.
- **Go ACKs:** webhook `Receipt` mapeado para `MESSAGES_UPDATE` (READ / DELIVERY_ACK) — ticks de entrega/leitura voltam a funcionar.
- **HistorySync stubs:** mescla `Conversations` + `Data` em vez de descartar stubs já coletados.
- **Timers HistorySync:** idle timer por chip (antes um timer global cancelava sync de outros chips).
- **Segurança:** `send-message` exige conversationId string; reconnect BullMQ com rate-limit 6/min; default motor `evolution-go`.
- **Chat:** loading de histórico por conversa; mídia sem race; menus resetam ao trocar chat; teste de campanha com timeout/cleanup.

---

## [2.3.53] — 2026-09-02

### Auditoria chat-v2 — correções críticas e altas

- **Crítico:** Modo foco sem saída — botão ◧/◨ agora visível no header; atalho `Esc` fecha foco, busca e preview de mídia.
- **Crítico:** `historyImporting` podia ficar preso para sempre — agora é zerado ao desconectar o socket e ao `socket === null`.
- **Crítico:** Emit duplicado de sync full no boot — removida linha `requestSync({ full: true })` extra (o `runResync` já emitia).
- **Alto:** Histórico inicial marcava conversa como "inicializada" antes do `await`; agora só é marcada após sucesso permitindo retry.
- **Médio:** `openChatByPhoneDigits` mutava array com `.sort()` — corrigido para `[...candidates].sort()`.
- **Médio:** `pinnedIds.includes` O(n) por linha virtualizada — substituído por `Set` via `useMemo`.
- **UX:** Botões Vídeo/Telefone sem ação agora aparecem desabilitados com tooltip "em breve" em vez de enganar o usuário.

---

## [2.3.52] — 2026-09-02

### Bate-papo Go — anti-tempestade de reconnect

- **Atualizar:** um único pedido de sync (antes emitia duplicado no socket).
- **Cooldown force:** mínimo 90s por chip mesmo no botão Atualizar (Evolution Go retornava HTTP 500 em rajada).
- **Escalonamento:** reconnects espaçados 2,5s entre chips; lock in-flight por chip e por tenant.

---

## [2.3.51] — 2026-09-02

### Bate-papo Evolution Go — sync real do celular

- **Atualizar conversas:** botão de sync no Go agora dispara reconnect controlado → webhooks `HistorySync` importam conversas do celular (antes só recarregava o arquivo local).
- **Cooldown:** 3 min entre reconnects por chip para evitar tempestade de reconexão.

---

## [2.3.50] — 2026-09-01

### Bate-papo Go + wizard de campanha

- **HistorySync Go:** `ensureEvolutionFullHistorySync` sinaliza importação ao conectar chip (webhook).
- **Sync manual:** full sync no Go também dispara ensure + hidratação do arquivo.
- **UI:** pills de canal só com 3+ chips (alinhado ao rail).
- **Wizard:** limite diário só conta chips online **com número pareado**.

---

## [2.3.49] — 2026-09-01

### Bate-papo: sync do celular, de-para e visual WA Web

- **HistorySync (Evolution Go):** stubs de conversa + mensagens; evento `history-sync-status` na UI.
- **Inbox persistente:** hidratação do arquivo Postgres ao reabrir aba / sync no modo Go.
- **ID canônico:** servidor usa `{chip}:{digits}@s.whatsapp.net`; collapse LID/telefone antes do emit.
- **Go:** `loadChatHistory` não chama `findMessages` (só arquivo + RAM).
- **UI:** avatars locais, skeleton na importação, empty states honestos, botões Nova conversa/Opções, painel único de contexto.

---

## [2.3.48] — 2026-09-01

### Fix: Desconectar não religa o chip sozinho (Online fantasma)

Após logout manual, o health/auto-reconnect chamava `restart`/`connect` no Evolution Go e o canal voltava **Online sem número** (sem ler QR).

- Logout manual segura o chip por 30 min: sem auto-reconnect.
- Sem número pareado, o servidor não promove o canal para Online.
- UI deixa de mostrar “Online” quando não há telefone.

---

## [2.3.47] — 2026-09-01

### Fix: CI (typecheck) da prospecção v2.3.46

- Tipos `prospecting` em `ZapMassContext` / `types.ts` (startCampaign e scheduleCampaign).
- Ajuste em `nurtureRepository` e `evolutionService` para passar `npm run typecheck` no Actions.

---

## [2.3.46] — 2026-09-01

### Feature: campanha Prospecção da base (produção e homologação)

Novo preset no assistente de campanhas para disparar a **base inteira** (exceto opt-out), com fluxo automático:

- **Onda 0:** mensagem inicial para todos.
- **Quem responde:** entra em jornada nurture semanal dedicada à campanha.
- **Quem não responde:** recebe lembrete semanal só dos silenciosos, até N semanas configuráveis.

Inclui painel na ficha da campanha (enviados / responderam / silenciosos / próxima onda) e job no servidor (`prospectingSilentBumpJob`) para os lembretes.

---

## [2.3.45] — 2026-09-01

### Fix: watchdog reiniciava o Evolution Go saudável e derrubava os chips

O healthcheck do Docker já trata `401` em `/instance/all` como “online” (sem API key). O watchdog fazia `curl -f` em `/`, que devolve `404`, e interpretava isso como queda — restart a cada ~2 minutos depois dos 90s de graça.

- Probe alinhado ao compose: `/instance/all` com HTTP 200/401/403 = vivo.
- Evita loop de restart que disparava anti-ban e toast de queda na aba Conexões.

---

## [2.3.44] — 2026-09-01

### Fix: toast `invalid UUID format: invalid UUID length: 20` na aba Conexões

O Evolution Go exige UUID no header `instanceId`. O ZapMass às vezes enviava o id do canal (`conn_<timestamp>_n`, 20 caracteres) quando o UUID interno ainda não estava em cache — o Go recusava e o erro aparecia no painel mesmo com o chip Online.

- Adapter não envia mais `conn_*` como UUID (connect/delete/proxy).
- UUID é resolvido pela lista `/instance/all` antes do connect.
- Mensagem amigável no toast se o erro antigo ainda aparecer.

---

## [2.3.43] — 2026-09-01

### Fix crítico: deploy de homologação parava o Evolution Go de produção

`fix-postgres-connections.sh` fazia `docker stop zapmass-evolution-go` (produção) para liberar slots no Postgres. O deploy homolog chama esse script com `--aggressive`, então **todos os chips de produção caíam** sempre que homolog subia.

- Agora só para o Evolution Go de **homologação**.
- Produção só para com `--stop-prod-evolution` (emergência explícita).
- Ao terminar, o script **sobe de volta** o Evolution Go de produção se estiver parado.

---

## [2.3.42] — 2026-09-01

### Fix: disparo recusava chips visivelmente online ("Evolution sem conexão ativa")

A tela de Conexões marca o chip **Online** pelo webhook `Connected`, mas o início da campanha ignorava esse estado e consultava de novo o Evolution Go. O payload Go usa `Connected`/`LoggedIn` (PascalCase) e envelopes `status: "success"` — o parser lia `"success"` como se fosse o estado da sessão e concluía que nenhum chip estava ativo.

- Parser agora ignora envelopes HTTP e reconhece `Connected` / `LoggedIn` / `online`.
- Se o webhook já disse `open`, o disparo não descarta o chip só porque o probe HTTP falhou ou veio ambíguo.
- Lista `/instance/all` também casa instância pelo UUID Go, não só pelo nome `conn_*`.

---

## [2.3.41] — 2026-09-01

### Feature: bônus de canais configurável pelo admin (acima do teto de 5)

- Novo campo `adminBonusChannelSlots` na assinatura do usuário — soma permanente acima do teto padrão de 5 canais do produto.
- Painel Admin → Centro de acessos → aba **Ações** do usuário: campo **Bônus de canais (admin)** (0–100).
- Exemplo: plano 5 + bônus 10 = até 15 canais WhatsApp para aquele cliente.
- Limite padrão do produto (5) permanece inalterado para todos os demais usuários.

---

## [2.3.40] — 2026-08-29

### Fix crítico: conexões continuavam oscilando após v2.3.39 (2 causas raiz adicionais)

**Causa 4 — `reconcileConnectionHealth` rebaixava chip por probe único transitório**
O reconcile fazia um único probe HTTP com `skipCache:true` para chips `open`. Se o Evolution Go retornasse `connecting` ou `close` por motivo transitório (keep-alive do WA, janela pós-`/instance/connect`, OfflineSyncCompleted), o chip era imediatamente rebaixado → auto-reconnect disparava → chip reconectava → UI mostrava "caindo e voltando". Fix: implementado double-probe com 8s de intervalo. Só rebaixa se DOIS probes consecutivos concordam; se o segundo retornar `open`, descarta o false-close.

**Causa 5 — `ensureGoInstanceWebhook` chamava `POST /instance/connect` em chips já conectados**
A cada hydrate (debounce 30s/chip), `ensureGoInstanceWebhook` chamava `POST /instance/connect` mesmo para chips com `status === 'open'`. No Evolution Go, esse endpoint pode causar uma transição breve para `connecting` antes de retornar ao estado `open`. Nessa janela transitória, o probe do reconcile capturava `connecting` e desencadeava o ciclo de oscilação. Fix: `ensureGoInstanceWebhook` retorna imediatamente se `memStatus === 'open'`.

---

## [2.3.39] — 2026-08-29

### Fix crítico: conexões caindo e voltando em loop (3 causas raiz)

**Causa 1 — Go adapter: evento `Connected` mapeava para `close`**
O adaptador do Evolution Go convertia o evento `Connected` para estado `close` quando `row.status` não era exatamente `'open'`. Como `Connected` semanticamente significa "chip conectado", o estado correto é sempre `open`. Isso causava: webhook Connected → close → auto-reconnect → reconnect → Connected → loop.

**Causa 2 — `reconcileConnectionHealth` usava cache de probe obsoleto para derrubar chips `open`**
O reconcile rodava a cada 120s e lia o cache de último probe (TTL 12s). Se um probe anterior tinha retornado `close` (erro transitório, Evolution Go lento), o cache era usado para marcar o chip como `close` sem nova verificação HTTP — disparando auto-reconnect desnecessário. Fix: para chips com `memState === 'open'`, o reconcile agora sempre faz um probe fresco; em erro de rede/timeout, confia na RAM (não baixa o estado).

**Causa 3 — `isConnectionOpen` chamava `applyConnectionStateUpdate('close')` por falha isolada**
Durante o dispatch de campanhas, `isConnectionOpen` fazia um probe HTTP. Se o Evolution Go estivesse sobrecarregado por 1 segundo, o probe falhava → chip marcado `close` → auto-reconnect disparado. Fix: `isConnectionOpen` não altera mais o estado do chip para `close`; a transição `open→close` fica exclusivamente sob responsabilidade dos webhooks `CONNECTION_UPDATE` e do `reconcileConnectionHealth`.

---

## [2.3.38] — 2026-08-28

### Fix: boot replay — respostas perdidas durante downtime do ZapMass

Quando o servidor ZapMass caía enquanto o chip WhatsApp permanecia `open`, os webhooks de respostas dos contatos não eram reenviados pela Evolution. Ao voltar, nenhum replay era disparado pois o chip nunca ficou `close`.

Corrigido com dois mecanismos:
- **Heartbeat Redis** (`zapmass:server:last_heartbeat`): atualizado a cada 5 min; TTL 48h para sobreviver restarts
- **Boot replay**: ao inicializar, lê o último heartbeat e para cada chip `open` durante o downtime (cujo `lastClosedAt` é anterior ao heartbeat), executa `replayMissedInboundForConnection` com janela a partir do último heartbeat − 10 min
- Chips que sofreram reconexão (própria queda do WA) já eram cobertos pelo replay de reconexão — não há duplicidade

---

## [2.3.37] — 2026-08-28

### Feature: Edição de campanhas existentes

Adicionado botão **Editar** (ícone de lápis) nos cards de campanhas pausadas, agendadas e em rascunho. Ao clicar, o wizard de campanha abre em modo edição com todos os campos pré-preenchidos:

- Nome, mensagens, fluxos de resposta (reply flow com etapas, tokens e opções condicionais)
- Modo de canais: chip individual ou pool (com o pool original pré-selecionado)
- Pesos de canais, delay e pausas humanizadas
- Ao confirmar, salva via `PATCH /api/campaigns/:id` e remapeia os jobs pendentes para os novos chips via `POST /api/campaigns/:id/channels`
- Aviso na etapa de público indicando que a audiência é preservada a menos que seja alterada explicitamente

---

## [2.3.36] — 2026-08-28

### Fix: healthcheck do Evolution Go homolog

Aplicado o mesmo fix do v2.3.35 ao `docker-compose.homolog.yml`: healthcheck agora aponta para `/instance/all` e aceita 200 ou 401 como "healthy". O container `zapmass-evolution-go-homolog` estava preso em `health: starting` pelo mesmo motivo.

---

## [2.3.35] — 2026-08-28

### Fix: healthcheck do Evolution Go preso em `health: starting`

O healthcheck usava `GET /` que retorna 404, fazendo o container ficar em `starting` permanentemente mesmo estando 100% funcional. Evolution Go exige autenticação em todos os endpoints — `GET /instance/all` retorna 200 (autenticado) ou 401 (sem auth), ambos indicam que o servidor está online. Agora o healthcheck verifica `/instance/all` e aceita 200 ou 401 como "healthy". `start_period` aumentado para 90s.

---

## [2.3.34] — 2026-08-28

### Fix: polling de QR e probe de estado não paravam em erro 400 (chip inválido)

- `isConnectionOpen`: captura exceções de rede/4xx e cacheia o resultado como `false` por 30s — sem isso, chip deletado causava flood de requisições ao Evolution Go (sem cache de falha)
- `fetchConnectQr`: ao receber 400 do Evolution Go para `GET /instance/connect/{id}`, o polling é abortado imediatamente — sem isso, o poll continuava indefinidamente repetindo a chamada a cada 2s

---

## [2.3.33] — 2026-08-28

### Fix: Pool não fazia rodízio ao retomar campanha — tudo indo para um só chip

**3 bugs corrigidos que causavam o comportamento de "só o Comercial 04 envia":**

**BUG-A — resumeCampaign não redistribuía jobs:**
Quando uma campanha era iniciada com apenas 1 chip ativo (ex.: Comercial 04), todos os jobs ficavam com `connectionId=conn04`. Ao conectar mais chips e clicar em "Retomar", os jobs não eram redistribuídos. Agora `resumeCampaign` chama `refreshCampaignPoolOnResume` que detecta novos chips disponíveis via probe HTTP, reconfigura o pool no Redis e redistribui os jobs pendentes via `updateCampaignChannels`.

**BUG-B — isCampaignChannelUsable rejeitava chips saudáveis com RAM desatualizada:**
A verificação de saúde do chip antes do envio lia apenas o estado em RAM (`connections.get(id)?.status`). Após o loop de hydrate (corrigido em v2.3.32) a RAM podia estar temporariamente desatualizada, fazendo conn02 e conn03 parecerem offline mesmo estando online. Todos os jobs para esses chips faziam failover para conn04. Agora aceita chips com prova HTTP positiva nos últimos 60s (`lastConnectionStateCheck`).

**BUG-C — Pool config expirava após 24h:**
`POOL_TTL_SECS` no Redis era de 24h. Campanhas longas ou pausadas por mais de 1 dia perdiam a configuração do pool, impossibilitando failover correto. Agora o TTL é de 7 dias.

---

## [2.3.32] — 2026-08-28

### Fix: loop de sync/hydrate 4×/segundo — sobrecarga no Evolution Go

**Problema:** browser com chip offline reconectava Socket.IO repetidamente, disparando `hydrateInstancesFromEvolution` + `ensureGoInstanceWebhook` 4+ vezes por segundo, gerando flood de `GET /instance/all` e `POST /instance/connect` no Evolution Go e causando reinicializações em cadeia dos containers.

**Correções:**
- `hydrateInstancesFromEvolution` agora tem debounce de 2s: chamadas simultâneas ou em rápida sequência reutilizam o mesmo Promise em andamento.
- `ensureGoInstanceWebhook` agora tem debounce de 30s por instância: o webhook não é re-registrado no mesmo chip antes de 30 segundos.
- Essas duas proteções reduzem a carga de ~4 req/s para no máximo 1 req/2s no hydrate e 1 req/30s por chip no webhook.

---

## [2.3.31] — 2026-08-28

### Fix: bugs críticos no Pool de chips — disparos travados/saindo do pool

**Varredura de 20 bugs no sistema de pool. Corrigidos os 5 mais críticos:**

1. **BUG-03 — Circuit OPEN sem failover continuava enviando** (`evolutionService.ts`): quando um chip era isolado pelo circuit breaker e não havia alternativo no pool, o código **continuava** para o envio, gerando mais falhas e risco de ban no WhatsApp. **Corrigido:** aborta com delay de 5 minutos.

2. **BUG-01 — Limite diário não usava o pool** (`evolutionService.ts`): ao atingir `dailyLimit`, buscava qualquer chip do tenant (fora do pool) ou adormecia até meia-noite. **Corrigido:** agora tenta primeiro redirecionar para outro chip do pool da campanha com cota disponível; só depois faz fallback genérico ou adia.

3. **BUG-02 — Cap de tier não usava o pool** (`evolutionService.ts`): chip novo atingia o cap de ramp-up e adormecia até amanhã mesmo com chips maduros no pool. **Corrigido:** tenta redirecionar para chip do pool sem cap antes de adiar.

4. **BUG-04 — `preferCurrent: true` no failover devolvia chip problemático** (`pickHealthyFailoverChannel`): em estado de RAM stale, o failover podia retornar o mesmo chip com circuit OPEN. **Corrigido:** `preferCurrent: false`.

5. **BUG-13 — Redirect de limite ignorava `alternateChannelIds`** e saía do pool. **Corrigido:** pool da campanha é verificado primeiro.

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
