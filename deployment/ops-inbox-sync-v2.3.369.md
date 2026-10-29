# Ops — duplicata "gêmea" + Sincronizar do celular (v2.3.369)

## Depois do deploy
1. Deploy na madrugada BRT (02–06h) ou **Run workflow** manual. Conferir `gh run list`.
2. **Hard refresh** (Ctrl+Shift+R) — o navegador guarda a lista velha em memória; a v2.3.369 também limpa gêmeas no cliente.
3. (Opcional, se ainda aparecer duplicata) dedupe da RAM: `POST /api/admin/dedupe-inbox-ram?dryRun=1` com `{ "tenantUid": "<uid>" }`, depois sem `dryRun`. Para diagnosticar: `INBOX_DEBUG_DUPES=1` no env da API mostra `[inbox-dedupe] emit` com `merged` (id descartado → canônico).
4. Se continuar com 2 linhas de **chips diferentes**: isso é esperado (identidade = chip + telefone). Use o filtro de canal.

## Sincronizar do celular (Evolution Go)
- O banner "Modo proteção" aparece no Go **por padrão** (`EVOLUTION_SYNC_FULL_HISTORY` não definido ⇒ `fullHistory=false`). Ele só bloqueia o sync **automático**.
- Clique manual (botão **Atualizar** da lista ou **Sincronizar do celular** na conversa) = `request-conversations-sync {full:true}` → orquestrador `userInitiated` → `/instance/restart` do chip (1 chip por vez, cooldown 90 s) → webhooks `HistorySync` + `OfflineSyncCompleted` → arquivo PG.
- Continua bloqueando (fila, sem restart): campanha `RUNNING` do tenant e aquecimento ativo. Roda sozinho quando terminar.
- Esperar 1–3 min após o clique (chip reconecta e o celular envia o histórico). A barra "Importação do celular em andamento…" indica progresso.

## Env (só se quiser sync automático também)
| Var | Efeito |
| --- | --- |
| `EVOLUTION_SYNC_FULL_HISTORY=1` | Libera restart/HistorySync **automático** no Go (remove o banner de proteção). Temporário: ligar, esperar a importação, desligar. |
| `WA_FULL_INBOX_SYNC=1` | findChats/prefetch no connect (motor Evolution API/Baileys; no Go o inbox vem por webhook — não é necessário para o botão manual). |
| `INBOX_DEBUG_DUPES=1` | Log de debug do dedupe por emit. |

Não é preciso ligar `WA_FULL_INBOX_SYNC` nem `EVOLUTION_SYNC_FULL_HISTORY` para o botão manual funcionar nesta versão.
