# Ops — inbox sem duplicata (v2.3.368)

Depois do deploy (madrugada BRT ou **Run workflow** manual):

1. **Subir a API** — no boot a RAM já se limpa sozinha (cache `conversations_cache.json` e restauração do PG passam por `canonicalizeInboxList`). Procure no log: `Inbox canonicalizada no boot`.
2. **Dedupe da RAM sob demanda** (admin, Bearer de admin). Primeiro só medir:
   `POST /api/admin/dedupe-inbox-ram?dryRun=1` com body `{ "tenantUid": "<uid ou uuid>" }`
   e depois aplicar sem `dryRun`. A resposta traz `before`, `after`, `merged`, `junkRemoved`, `removedIds`.
3. **Dedupe do Postgres** (`wa_inbox_conversations` + nomes lixo em `wa_chat_threads`), no container da API:
   - `docker exec -w /app zapmass-zapmass-1 npm run dedupe:inbox -- --tenant <uuid>`  (dry-run)
   - `docker exec -w /app zapmass-zapmass-1 npm run dedupe:inbox -- --apply --tenant <uuid>`
4. **Mandar uma mensagem recebida** (do celular para o chip, de um contato que já tem ficha) e, em seguida, rodar na VPS:
   `cd /opt/zapmass && bash deployment/pg-chat-archive-counts.sh`
   — `wa_chat_threads` e `wa_chat_messages` devem crescer. Se continuarem 0, procurar `[chatArchive] falha ao gravar delta` / `[ChatArchive/PG] batch falhou` no log da API.
5. **Hard refresh** no navegador (Ctrl+Shift+R) — o cliente guarda a lista antiga em memória; sem recarregar, fichas velhas podem continuar na tela até o próximo `conversations-update`.

Esperado: um único "Gabriel Luz Novo" por chip (histórico de campanha + diagnóstico + Video na mesma conversa), sem ficha "0".

Obs.: o mesmo telefone em **chips diferentes** continua sendo uma conversa por chip (identidade = chip + telefone).
