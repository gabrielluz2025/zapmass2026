# Migração Evolution API → Evolution Go

Guia operacional para o ZapMass migrar do motor **Node/Baileys** (`evoapicloud/evolution-api:v2.3.7`) para **Go/whatsmeow** (`evoapicloud/evolution-go`).

## Resumo executivo

| Item | Detalhe |
|------|---------|
| Tipo de migração | **Troca de motor**, não upgrade in-place |
| Sessões WhatsApp | **Re-QR obrigatório** em todos os chips |
| Campanhas | Suportadas via adapter (`sendText`, `sendMedia`) |
| Inbox sync pesado | **Parcial** — `findChats`/`findMessages` não existem no Go |
| Licença | Foundation obrigatória no Go (e recomendada na API 2.4+) |
| Rollback | Manter container `evolution` até estabilizar 7–14 dias |

## Arquitetura no ZapMass

```
ZapMass (evolutionService.ts)
    └── createEvolutionHttpClient()
            ├── evolution-api  → pass-through (axios → evolution:8080)
            └── evolution-go   → goRouteAdapter (paths v2 → Go)
```

Variável principal:

```env
ZAPMASS_WHATSAPP_ENGINE=evolution-go   # padrão produção (desde cutover)
# ZAPMASS_WHATSAPP_ENGINE=evolution-api  # rollback Node/Baileys
```

## Fase 0 — Preparação

1. Conta/licença [Evolution Foundation](https://evolutionfoundation.com.br)
2. Janela de manutenção para re-QR (2–4 h)
3. Pausar campanhas ativas
4. Backup: volume `zapmass-evolution`, Postgres `evolution_db`

## Fase 1 — Ambiente paralelo (sem cutover)

Na VPS:

```bash
cd /opt/zapmass
bash deployment/setup-evolution-go-parallel.sh
```

Isso sobe `evolution-go` na porta **8081** (profile Docker `evolution-go`).

1. Abrir `http://127.0.0.1:8081/manager` (ou túnel SSH)
2. Ativar licença Foundation
3. Verificar paridade (admin logado):

```http
GET /api/admin/evolution-engine
GET /api/admin/evolution-engine?probeGo=1
```

## Fase 2 — Piloto (1 chip)

No `.env`:

```env
ZAPMASS_WHATSAPP_ENGINE=evolution-go
EVOLUTION_GO_URL=http://evolution-go:8080
EVOLUTION_GO_KEY=sua-GLOBAL_API_KEY
```

```bash
docker compose up -d --build zapmass
```

1. Criar/reconectar **um chip de teste** (novo QR)
2. Campanha pequena (10 contatos)
3. Monitorar 48–72 h: quedas, ACK, circuit breaker

## Fase 3 — Cutover produção (automático)

Na VPS:

```bash
cd /opt/zapmass
bash deployment/cutover-evolution-go.sh
```

Ou após `git pull` + deploy CI (stack já sobe `evolution-go` com `EVOLUTION_NODE_REPLICAS=0`):

1. Ativar licença em `http://127.0.0.1:8081/manager`
2. Pausar campanhas
3. Re-parear chips um a um (QR)
4. Usar **Trocar chips** na campanha se canal cair

## Fase 4 — Rollback

```env
ZAPMASS_WHATSAPP_ENGINE=evolution-api
EVOLUTION_API_URL=http://evolution:8080
```

```bash
docker compose up -d evolution zapmass
# Re-QR novamente (sessões Go não voltam para Baileys)
```

## Matriz de paridade (resumo)

| Área | Evolution API | Evolution Go |
|------|---------------|--------------|
| Campanhas texto/mídia | ✅ | ✅ adapter |
| QR / status / reconnect | ✅ | ✅ adapter |
| Webhook campanhas | ✅ | ⚠️ parcial |
| Sync inbox findChats | ✅ | ❌ webhooks only |
| Token auth | Global apikey + path | **Token por chip** |
| Sessão portável | Baileys volume | ❌ whatsmeow novo |

Matriz completa em código: `server/evolutionProvider/parityMatrix.ts`

## Diferença crítica: auth Go

Evolution Go usa:

- **GLOBAL_API_KEY** — criar/deletar instâncias (`/instance/create`)
- **Token por instância** — enviar mensagens (`/send/text`)

O ZapMass gera e persiste `evolutionGoToken` em `data/connections_settings.json` por chip.

## Arquivos relevantes

| Arquivo | Função |
|---------|--------|
| `server/evolutionEngineConfig.ts` | Config motor + URLs |
| `server/evolutionProvider/goRouteAdapter.ts` | Tradução HTTP v2→Go |
| `server/evolutionProvider/createEvolutionHttpClient.ts` | Cliente axios |
| `server/evolutionEngineRoutes.ts` | API admin paridade |
| `docker-compose.yml` | Serviço `evolution-go` (profile) |
| `deployment/setup-evolution-go-parallel.sh` | Bootstrap paralelo |

## Alternativa: Evolution API 2.4.x primeiro

Se o objetivo é passkey/fixes WhatsApp **sem** trocar motor:

```env
EVOLUTION_IMAGE=evoapicloud/evolution-api:2.4.0-rc2
```

Sessões Baileys têm mais chance de sobreviver ao restart. Depois planejar Go com menos pressão.

## Checklist go-live

- [ ] Licença Go ativa (sem 503)
- [ ] `/api/admin/evolution-engine` → `campaignReady: true`
- [ ] Chip piloto 48 h estável
- [ ] Campanha piloto 100% ACK OK
- [ ] Equipe avisada sobre re-QR
- [ ] Rollback documentado e testado
