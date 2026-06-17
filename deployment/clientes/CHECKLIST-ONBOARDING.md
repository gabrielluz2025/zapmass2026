# Checklist — onboarding Plano B (ZapMass por cliente)

Use após pagamento ou trial aprovado. Tempo típico: **5–10 minutos**.

## Pré-requisitos na VPS (uma vez)

- [ ] Docker + Compose a correr (`cd /opt/zapmass && docker compose up -d`)
- [ ] Imagem `zapmass-zapmass:latest` construída (deploy manual ou Actions)
- [ ] `/opt/zapmass/secrets/firebase-admin.json` (chmod 600)
- [ ] Nginx + certbot instalados
- [ ] DNS wildcard `*.zap-mass.com` → IP da VPS (ou DNS do domínio do cliente)
- [ ] Rate limit Nginx: `sudo bash deployment/clientes/scripts/setup-nginx-rate-limit.sh`
- [ ] Cron backup: `sudo bash deployment/clientes/scripts/setup-backup-cron.sh`

## Novo cliente

1. **Definir slug** (ex.: `empresa-acme`, minúsculas, hífen).

2. **Provisionar** (escolha o tier):

```bash
cd /opt/zapmass

# Starter — até ~15 clientes numa VPS 8GB
sudo bash deployment/clientes/scripts/novo-cliente.sh empresa-acme

# Pro — mais RAM/CPU no container
sudo bash deployment/clientes/scripts/novo-cliente.sh empresa-acme --tier pro

# Domínio próprio do cliente
sudo bash deployment/clientes/scripts/novo-cliente.sh empresa-acme \
  --dominio whatsapp.empresa.com --tier pro
```

3. **Anotar** URL, porta, backup key e Postgres (`cliente.json`).

4. **Mercado Pago** (se esta instância cobra sozinha):

   Editar `/opt/zapmass/clientes/<slug>/.env`:

   - `MERCADOPAGO_ACCESS_TOKEN=...`
   - `MERCADOPAGO_BACK_URL=https://<dominio>`

   Reiniciar: `docker compose -f /opt/zapmass/clientes/<slug>/docker-compose.yml up -d --force-recreate`

5. **Validar**:

```bash
sudo bash deployment/clientes/scripts/monitor-clientes.sh
curl -sf https://<dominio>/api/health
```

6. **Entregar ao cliente**: URL HTTPS, instruções de login/cadastro, limite de canais do plano.

## Migrar cliente antigo (ex.: demo)

Se a pasta `clientes/<slug>/` existe mas **faltam** `.env` / `docker-compose.yml` (container legado):

```bash
sudo bash deployment/clientes/scripts/bootstrap-cliente-legado.sh demo --dominio zap-mass.com --port 3100
```

Cliente já com ficheiros Plano B:

```bash
sudo bash deployment/clientes/scripts/migrar-cliente-plano-b.sh demo --tier starter
# ou todos de uma vez:
sudo bash deployment/clientes/scripts/migrar-todos-plano-b.sh
```

## Tiers Plano B

| Tier | RAM container | CPU | Uso sugerido |
|------|---------------|-----|--------------|
| **starter** | 1536 MB | 1.0 | até ~2k contatos, 1–2 chips |
| **pro** | 2048 MB | 1.5 | disparos frequentes, 3–5 chips |
| **business** | 3072 MB | 2.0 | base grande, múltiplas campanhas |

## Operação diária

| Tarefa | Comando |
|--------|---------|
| Listar | `listar-clientes.sh` |
| Monitor | `monitor-clientes.sh` |
| Backup manual | `backup-cliente.sh <slug>` |
| Parar (inadimplente) | `parar-cliente.sh <slug>` |
| Atualizar versão | `atualizar-todos.sh` |
| Remover | `remover-cliente.sh <slug>` |

## Pós-pagamento automatizado (opcional)

Webhook Mercado Pago ou operador:

```bash
sudo bash deployment/clientes/scripts/provision-pos-pagamento.sh <slug> --tier pro
```

## Capacidade VPS (referência)

- **8 GB RAM**: ~12–15 clientes starter + stack principal
- **16 GB RAM**: ~25–30 clientes starter
- Cliente **business** ou disparo 5k+ contínuo: considerar VPS dedicada (`novo-cliente.sh` noutro host)
