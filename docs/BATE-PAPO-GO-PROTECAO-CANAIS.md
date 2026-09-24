# Bate-papo (Evolution Go) — como não derrubar canais

Referência operacional e de código. Leitura complementar: `docs/ESTUDO-BATE-PAPO-EXPERIENCIA.md`, `deployment/check-evolution-go-chat-campaign.sh`.

## Por que o chip cai

No **Evolution Go**, “puxar histórico do celular” (HistorySync) usa **`POST /instance/restart/{chip}`**. Isso **fecha e reabre** a sessão WhatsApp — igual a um reconnect agressivo. Vários restarts em paralelo ou em sequência (vários chips, F5, recovery automático + campanha) geravam **LoggedOut**, QR em massa e conflito com **disparo de campanha**.

Mensagens **novas** no bate-papo vêm de **webhook** (`Message`, `SendMessage`, `HistorySync` em lote). **Não** é obrigatório restart para conversar; restart só hidrata threads antigas/vazias.

## Camadas de proteção (ordem lógica)

| Camada | O quê | Onde |
|--------|--------|------|
| Default env Go | `EVOLUTION_SYNC_FULL_HISTORY` **off** → sem restart automático por env | `shared/chatSyncConfig.ts` |
| Orquestrador | Fila **única por tenant**, coalesce 8s, retry 90s se bloqueado | `server/goInboxSyncOrchestrator.ts` |
| Campanha ativa | Sem restart em massa; fila pós-campanha (~3 min) | `ownerHasBlockingActiveCampaign`, `goHistorySyncOps.ts` |
| Aquecimento | Só arquivo Postgres, sem restart | `getAutoWarmupState` |
| Proteção de chip | Perfil quiet/storm/ban → `fullHistory: false` | `server/chipProtectionService.ts` |
| 1 restart / tenant | `GO_HISTORY_SYNC_MAX_CONCURRENT_PER_OWNER` (default **1**) | `evolutionService.ts` |
| 1 chip / ciclo phone sync | Não percorre todos os chips abertos numa passada | `syncGoInboxFromPhoneForOwner` |
| Cooldown | 3 min (auto) / 90s (botão Atualizar) | `requestGoInboxHistorySync` |
| Sessão nova | 10 min após `open` antes de HistorySync automático | handler `CONNECTION_UPDATE` |
| Pós-deploy | Janela de graça + auto-reconnect mais lento | `shared/deployGrace.ts` |
| Restart “nosso” | Hold 5 min — não conta em **reconnect_storm** | `isHistorySyncRestartHoldActive` |
| UI | Não dispara full se `inbox-sync-policy.phoneFullBlocked` | `WaWebChatApp.tsx` |

## Fluxos que disparam restart (audit)

| Entrada | Comportamento seguro |
|---------|----------------------|
| Socket `request-conversations-sync` `{ full: false }` | Só RAM/arquivo — **sem** restart |
| Socket `{ full: true }` (Atualizar / celular) | Orquestrador → **1 chip**, `userInitiated` |
| `reemitConversationsForOwner` (RAM vazia / threads sparse) | Enfileira `phone_full` — **não** restart direto |
| Thread vazia ao abrir histórico | Enfileira orquestrador (`thread_sparse`) |
| Chip `open` + `syncProfile.fullHistory` | `ensureEvolutionFullHistorySync` (respeita campanha + 10 min) |
| `syncConnectionsForOwner` (legado full) | Go: delega a `syncGoInboxFromPhoneForOwner` se perfil permitir |
| Auto-reconnect / QR / count:0 | Restart **operacional** (não é sync de inbox) — holds anti-ban |

## Variáveis úteis (.env)

- `EVOLUTION_SYNC_FULL_HISTORY=0` — mantém Go sem HistorySync automático por env (recomendado produção).
- `GO_HISTORY_SYNC_MAX_CONCURRENT_PER_OWNER=1` — máximo de restarts simultâneos por conta.
- `GO_INBOX_SYNC_COALESCE_MS` / `GO_INBOX_SYNC_BLOCKED_RETRY_MS` — fila do orquestrador.
- `GO_HISTORY_SYNC_POST_CAMPAIGN_DELAY_MS` — atraso após campanha (default 180s).
- `WA_FULL_INBOX_SYNC=0` — no Go, inbox vem de webhook; findChats em massa fica off.

**Não** rodar em produção sem necessidade: `deployment/enable-evolution-full-history.sh`, `vps-sync-full-history-safe.sh` (restart em todos os chips).

## Diagnóstico na VPS

```bash
bash deployment/check-evolution-go-chat-campaign.sh
# HistorySync restart (logs): inflight bloqueado — ideal 0–1
docker compose logs zapmass --tail 200 | grep -i 'history sync\|inbox history sync'
```

Métricas admin: restarts inbox (1h), fila orquestrador via `inbox-sync-policy` no socket.

## O que a UI deve fazer

1. Preferir **sync leve** ao focar aba / reconectar socket.
2. **Full** (celular) só quando o usuário pede ou 1×/dia — e respeitar bloqueio de campanha/proteção.
3. Com campanha **RUNNING**, orientar: pausar ou aguardar fila pós-campanha.
4. Vários chips: sync pesado é **serializado** (um canal por vez).

## Release 2.3.189

Correções: `userInitiated` só no botão (automático respeita env + perfil); orquestrador bloqueia `chip_protection`; phone sync **um chip por ciclo**.

## Release 2.3.190

UI: faixa «modo proteção» na inbox; sync pesado **round-robin** entre chips abertos.
