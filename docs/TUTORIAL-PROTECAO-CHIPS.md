# Tutorial: Proteção de chips (anti-banimento)

Este guia explica **por que chips caem sem campanha**, o que o ZapMass faz para reduzir o risco e como usar o **Modo chip quieto**.

---

## 1. Por que o WhatsApp derruba chips “do nada”?

Mesmo sem disparo manual, o backend pode gerar **atividade intensa** que o WhatsApp interpreta como automação ou sessão suspeita:

| Fonte | O que faz | Risco |
|-------|-----------|-------|
| **Sync da inbox** ao conectar/login/deploy | Baixa centenas de conversas + milhares de mensagens (`findChats` + `findMessages`) | **Alto** |
| **syncFullHistory** na Evolution | Pede histórico completo do celular no servidor | **Alto** |
| **Jornada de nutrição** (scheduler 30s) | Envia mensagens automáticas para inscritos | **Alto** |
| **Auto-aquecimento** | Mensagens periódicas entre chips | **Alto** |
| **Campanhas ativas** | Fila BullMQ de envios | **Alto** |
| **Health check + reconnect** | Reabre sessão após queda | Médio |

O banimento confirmado no código ocorre quando a Evolution envia `CONNECTION_UPDATE` com `loggedOut` / HTTP 401 — o chip entra em **quarentena 24h**.

---

## 2. O que foi implementado

### Modo chip quieto (por workspace)

Configuração salva em `tenant_dispatch_settings` (`chipQuietMode: true`).

Quando **ativado**:

1. **Jornada de nutrição** — scheduler ignora enrollments desse tenant; auto-inscrição de leads quentes bloqueada.
2. **Auto-aquecimento** — não inicia/retoma; se já estiver ativo, é **parado** ao ativar o modo.
3. **Sync leve** — ao conectar chip ou sync no login:
   - Não chama `syncFullHistory` na Evolution
   - Prefetch reduzido: ~12 conversas × 25 mensagens (em vez de 120 × 200)

Quando **desativado**, volta ao perfil normal (respeitando variáveis de ambiente da VPS).

### Painel na aba Conexões

Em **Conexões → Proteção de chips** você vê:

- Toggle do modo quieto
- Alertas (jornada pendente, aquecimento, campanhas)
- Perfil de sync atual
- Recomendações

### API

- `GET /api/chip-protection` — snapshot de riscos e configuração
- `PATCH /api/chip-protection` — `{ "chipQuietMode": true|false }`

---

## 3. Como usar (passo a passo)

### Cenário A: Chips caindo sem disparo

1. Abra **Conexões** no ZapMass.
2. Expanda **Proteção de chips**.
3. Clique em **Ativar** (Modo chip quieto).
4. Confirme que:
   - Jornada mostra “Pausada pelo modo quieto” (se havia pendências)
   - Auto-aquecimento está parado
5. Reconecte o chip se necessário — o sync será **leve**.

### Cenário B: Voltar a operar campanhas

1. **Desative** o modo chip quieto.
2. Verifique se não há campanha/jornada/aquecimento indesejados no painel.
3. Ajuste delays e limites diários em **Configurações → Disparo**.

### Cenário C: Proteção global na VPS (recomendado)

Adicione no `.env` do backend (Docker/systemd):

```env
# Sync conservador para todos os tenants (mesmo sem modo quieto)
EVOLUTION_SYNC_FULL_HISTORY=0
WA_FULL_INBOX_SYNC=0
EVOLUTION_SYNC_MSG_PREFETCH=50
EVOLUTION_SYNC_SPARSE_CONV_LIMIT=15
WA_FULL_SYNC_COOLDOWN_HOURS=168
```

Reinicie o backend após alterar.

---

## 4. Checklist operacional

- [ ] Modo chip quieto **ON** quando chips só precisam ficar conectados (inbox passivo)
- [ ] Jornada de nutrição **desligada** se não estiver em uso
- [ ] Auto-aquecimento **parado** fora de período de warmup planejado
- [ ] Nenhuma campanha em execução acidental
- [ ] Env vars de sync conservador na VPS
- [ ] Evitar reconectar vários chips ao mesmo tempo após deploy

---

## 5. Arquivos principais (referência técnica)

| Arquivo | Função |
|---------|--------|
| `shared/chipProtection.ts` | Perfis de sync normal vs quiet |
| `server/chipProtectionService.ts` | Lógica, snapshot, toggle |
| `server/chipProtectionRoutes.ts` | API REST |
| `server/tenantSettings.ts` | Persistência `chipQuietMode` |
| `server/evolutionService.ts` | Sync ao abrir conexão / login |
| `server/evolutionChat.ts` | Limites de prefetch por perfil |
| `server/nurture/nurtureScheduler.ts` | Pausa envios da jornada |
| `server/whatsappService.ts` | Bloqueia auto-aquecimento |
| `src/components/connections/ChipProtectionPanel.tsx` | UI |

---

## 6. Limitações

- O modo quieto **não impede** campanhas já iniciadas manualmente — pause-as na UI.
- Mensagens **inbound** (cliente escrevendo) e respostas manuais continuam normais.
- Reply flow / bot de suporte, se configurados, podem continuar enviando — revise esses módulos separadamente.
- A proteção reduz risco; **não garante** zero banimento (política do WhatsApp é opaca).

---

## 7. Resumo em uma frase

**Ative o Modo chip quieto** quando quiser manter números conectados sem stress: sync mínimo, zero automação de envio em background.
