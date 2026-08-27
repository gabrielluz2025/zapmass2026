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
# Se git pull falhar por "local changes would be overwritten":
cd /opt/zapmass
bash deployment/ensure-git-main.sh   # alinha com origin/main (descarta edits locais rastreados)
git log -1 --oneline                 # deve mostrar commit com homolog (ex.: e9c1f4c)

sudo bash deployment/setup-homolog.sh
```

O `setup-homolog.sh` também chama `ensure-git-main.sh` automaticamente.

```bash
# 1. DNS: registro A homolog.zap-mass.com → IP da VPS
```

O script cria `homolog/.env`, bases Postgres, Nginx + SSL e sobe os containers.

## Fluxo de trabalho

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
git fetch && git checkout develop && git pull
bash deployment/vps-deploy-homolog.sh
```

Ou: **GitHub Actions → Deploy homolog (develop) → Run workflow**

## Chips WhatsApp

- Use **números de teste** exclusivos em homolog
- Nunca conecte chips de clientes em homolog
- Evolution Go homolog é separado — reconnect de teste não afeta produção

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
| `deployment/vps-deploy-homolog.sh` | Deploy sem tocar produção |
| `.github/workflows/deploy-homolog.yml` | CI branch `develop` |

## Troubleshooting

```bash
# Logs
docker compose -f docker-compose.homolog.yml logs -f zapmass-homolog

# Health local
curl -s http://127.0.0.1:3200/api/health | jq

# Recriar só API homolog
docker compose -f docker-compose.homolog.yml up -d --build zapmass-homolog
```
