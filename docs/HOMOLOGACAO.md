# Homologação ZapMass (mesma VPS)

Ambiente isolado para testar features antes de produção, sem derrubar chips de clientes.

| | Produção | Homologação |
|---|----------|-------------|
| URL | https://zap-mass.com | https://homolog.zap-mass.com |
| Branch Git | `main` | `develop` |
| Deploy | Madrugada BRT ou Run workflow | Push em `develop` (qualquer hora) |
| Porta local | 3100 (demo) / 3001 (stack) | 3200 |
| Evolution Go | :8081 (prod) | :8082 (dedicado) |
| Postgres | `zapmass_cli_demo` | `zapmass_homolog` |
| Redis | DB 2+ | DB **14** (reservado) |
| MP | Token produção | Sandbox `TEST-` |
| Assinatura | Enforced | Desligada |

## Setup inicial (uma vez na VPS)

```bash
# Se git checkout develop falhar por "local changes would be overwritten":
cd /opt/zapmass
bash deployment/ensure-git-develop.sh   # alinha com origin/develop (descarta edits locais rastreados)
git log -1 --oneline

sudo bash deployment/setup-homolog.sh
```

O `setup-homolog.sh` também chama `ensure-git-main.sh` automaticamente.

```bash
# 1. DNS: registro A homolog.zap-mass.com → IP da VPS
```

O script cria `homolog/.env`, bases Postgres, Nginx + SSL e sobe os containers.

## Fluxo de trabalho

Documento completo: **[FLUXO-MELHORIAS.md](./FLUXO-MELHORIAS.md)** (develop → homolog → main → produção).

```
feature/minha-feature → PR → develop → deploy automático homolog
                                    ↓ (testes OK)
                              PR → main → deploy produção (madrugada)
```

Criar branch `develop` (primeira vez):

```bash
git checkout -b develop
git push -u origin develop
```

## Deploy manual homolog

```bash
cd /opt/zapmass
bash deployment/vps-deploy-homolog.sh   # já chama ensure-git-develop antes do build
```

Ou: **GitHub Actions → Deploy homolog (develop) → Run workflow**

## Chips WhatsApp

- Use **números de teste** exclusivos em homolog
- Nunca conecte chips de clientes em homolog
- Evolution Go homolog é separado — reconnect de teste não afeta produção

### Licença Evolution Go (porta :8082)

Instância homolog é **nova** — a licença da prod (:8081) **não** vale aqui. Se `/instance/all` retornar `LICENSE_REQUIRED` ou HTTP 503:

```bash
# No PC (túnel SSH):
ssh -L 8082:127.0.0.1:8082 root@IP_DA_VPS

# Browser:
http://127.0.0.1:8082/manager/login
```

Depois de ativar:

```bash
# Evolution Go usa GET /instance/all (não fetchInstances da Evolution API Node)
KEY="$(grep EVOLUTION_GO_KEY_HOMOLOG homolog/.env | cut -d= -f2-)"
curl -s -H "apikey: ${KEY}" http://127.0.0.1:8082/license/status
curl -s -H "apikey: ${KEY}" http://127.0.0.1:8082/instance/all
```

Após `register/auto` na Foundation, a `api_key` retornada deve ir em `homolog/.env` como `EVOLUTION_GO_KEY_HOMOLOG` — o Evolution Go valida no boot via `GLOBAL_API_KEY` (`✓ GLOBAL_API_KEY accepted`).

**OAuth Google/GitHub com erro?** O servidor `license.evolutionfoundation.com.br` costuma falhar no OAuth — **não use** Google/GitHub. Opções:

1. **Magic Link** — na página de registro, só preencha nome + e-mail e confirme o link recebido.
2. **Auto-ativação** (se prod `:8081` já licenciada com o mesmo e-mail):

```bash
cd /opt/zapmass
bash deployment/activate-homolog-evolution-license.sh festaimportgabriel@gmail.com
```

Adicione em `homolog/.env`: `EVOLUTION_OPERATOR_EMAIL=seu@email.com` e recrie `evolution-go-homolog`.

## Mercado Pago

Configure no `homolog/.env`:

```env
HOMOLOG_MERCADOPAGO_ACCESS_TOKEN=TEST-...
HOMOLOG_MERCADOPAGO_BACK_URL=https://homolog.zap-mass.com
```

## Checklist antes de promover develop → main

- [ ] Typecheck + testes verdes no CI homolog
- [ ] Feature testada em https://homolog.zap-mass.com
- [ ] Chip de teste conectou/desconectou sem erro
- [ ] Migration Postgres rodou (se houver)
- [ ] Nenhum token `APP_USR-` de produção no `.env` de homolog

## Arquivos principais

| Arquivo | Função |
|---------|--------|
| `docker-compose.homolog.yml` | Stack API + Evolution Go homolog |
| `homolog/.env` | Secrets e URLs (não commitar) |
| `deployment/setup-homolog.sh` | Instalação inicial |
| `deployment/ensure-git-develop.sh` | Alinha VPS com `origin/develop` |
| `deployment/vps-deploy-homolog.sh` | Deploy sem tocar produção |
| `.github/workflows/deploy-homolog.yml` | CI branch `develop` |

## Troubleshooting

### Evolution Go homolog: `too many clients already`

Postgres compartilhado entre prod + clientes + homolog. Limpeza imediata:

```bash
cd /opt/zapmass
bash deployment/fix-postgres-connections.sh
bash deployment/recover-homolog-evolution-go.sh
```

Para aplicar `max_connections=300` permanente (reinicia Postgres ~5s):

```bash
git pull && bash deployment/ensure-git-main.sh
bash deployment/fix-postgres-connections.sh --restart-postgres
bash deployment/recover-homolog-evolution-go.sh
```

```bash
# Logs
docker compose -f docker-compose.homolog.yml logs -f zapmass-homolog

# Health local
curl -s http://127.0.0.1:3200/api/health | jq

# Recriar só API homolog
docker compose -f docker-compose.homolog.yml up -d --build zapmass-homolog
```
