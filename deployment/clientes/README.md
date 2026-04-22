# ZapMass — provisionamento por cliente

Este directório contém scripts para criar, gerir e remover **instâncias isoladas do ZapMass**, uma por cliente, todas na mesma VPS.

Cada cliente tem:

- **Container Docker próprio** (`zapmass-cli-<slug>`), com os seus próprios ficheiros em `/app/data`.
- **Porta host dedicada** (3100+).
- **Subdomínio próprio** (`<slug>.zap-mass.com` por defeito; podes apontar um domínio personalizado do cliente).
- **Virtual-host Nginx + certificado Let’s Encrypt** automáticos.
- **Pasta de dados isolada** em `/opt/zapmass/clientes/<slug>/data`.

Ou seja: **zero contacto entre clientes**, seja em rede, ficheiros, sessões WhatsApp ou memória.

## Pré-requisitos na VPS

Normalmente já estão prontos depois do setup inicial do ZapMass:

- Docker + Docker Compose a correr.
- Nginx em `/etc/nginx/sites-available|enabled`.
- `certbot` com plugin Nginx (`apt install certbot python3-certbot-nginx`).
- A imagem `zapmass-zapmass:latest` construída pelo menos uma vez (o workflow de GitHub Actions já faz isto).

## Variáveis de ambiente opcionais

| Variável | Default | O que faz |
|---|---|---|
| `ZAPMASS_ROOT` | `/opt/zapmass` | Raiz do projeto na VPS |
| `ZAPMASS_DOMINIO_RAIZ` | `zap-mass.com` | Domínio raiz para gerar subdomínios |
| `ZAPMASS_CERTBOT_EMAIL` | `admin@<DOMINIO_RAIZ>` | E-mail para o Let’s Encrypt |

## Scripts disponíveis

Todos ficam em `/opt/zapmass/deployment/clientes/scripts/`. Correm com `sudo`.

### Criar um cliente novo

```bash
sudo bash /opt/zapmass/deployment/clientes/scripts/novo-cliente.sh acme
# usa acme.zap-mass.com

sudo bash /opt/zapmass/deployment/clientes/scripts/novo-cliente.sh acme --dominio whatsapp.acme.com
# com domínio próprio do cliente (DNS desse domínio tem de apontar para a VPS)

sudo bash /opt/zapmass/deployment/clientes/scripts/novo-cliente.sh teste --sem-ssl
# não tenta emitir HTTPS (útil para testes rápidos)
```

O script:

1. Valida o nome e gera um **slug** (`acme`, `cliente-x`, etc).
2. Escolhe uma **porta livre** (3100+).
3. Cria `/opt/zapmass/clientes/<slug>/` com `.env`, `docker-compose.yml` e `data/`.
4. Sobe o container e espera o `/api/health` responder `200`.
5. Cria o virtual-host Nginx e recarrega.
6. Pede um certificado Let’s Encrypt (a menos que uses `--sem-ssl`).
7. Imprime URL, porta, backup key.

### Listar clientes

```bash
sudo bash /opt/zapmass/deployment/clientes/scripts/listar-clientes.sh
```

Mostra slug, domínio, porta, status do container e resultado do health.

### Parar / iniciar um cliente

```bash
sudo bash /opt/zapmass/deployment/clientes/scripts/parar-cliente.sh acme
sudo bash /opt/zapmass/deployment/clientes/scripts/iniciar-cliente.sh acme
```

Útil para suspender acesso (cliente que atrasou pagamento, por exemplo), sem apagar nada.

### Backup de um cliente

```bash
sudo bash /opt/zapmass/deployment/clientes/scripts/backup-cliente.sh acme
# grava em /opt/zapmass/backups/acme-YYYYMMDD-HHMMSS.tar.gz
```

### Remover um cliente

```bash
sudo bash /opt/zapmass/deployment/clientes/scripts/remover-cliente.sh acme
# Para o container, remove Nginx e preserva os dados em "<slug>.removido-<timestamp>"

sudo bash /opt/zapmass/deployment/clientes/scripts/remover-cliente.sh acme --apagar-dados
# Remove tudo imediatamente.
```

### Atualizar todos os clientes para a versão mais recente

```bash
sudo bash /opt/zapmass/deployment/clientes/scripts/atualizar-todos.sh
```

Reconstrói a imagem `zapmass-zapmass:latest` e reinicia a instância principal + todos os containers de cliente com a imagem nova.

Este script é chamado **automaticamente** pelo workflow de GitHub Actions após cada deploy em `prod`, por isso normalmente **não precisas de o correr à mão**.

## Fluxo para vender

1. Cliente paga (ou entra em trial).
2. Defines um slug (ex: nome da empresa).
3. Se o cliente **vai usar subdomínio teu** (`acme.zap-mass.com`): não precisas de fazer nada no DNS — o registo `*.zap-mass.com` já aponta para a VPS (se não aponta, cria um `A *.zap-mass.com` → IP da VPS).
4. Se o cliente **quer domínio próprio** (`whatsapp.acme.com`): pedes ao cliente para criar um registo DNS `A` para o IP da VPS, e só depois corres `novo-cliente.sh acme --dominio whatsapp.acme.com`.
5. Corres o script, anotas a URL e entregas ao cliente.

Tempo total por cliente: 3–5 minutos.

## Dicas operacionais

- **Ver logs ao vivo de um cliente**: `docker compose -f /opt/zapmass/clientes/acme/docker-compose.yml logs -f`
- **Restart sem redeploy**: `docker compose -f /opt/zapmass/clientes/acme/docker-compose.yml restart`
- **Mudar domínio**: edita `.env` (`PUBLIC_URL`, `ALLOWED_ORIGINS`), renomeia o ficheiro em `sites-available`, reloads Nginx, e corre `certbot` manualmente para o novo domínio.
- **Escalar**: cada container usa ~250–400 MB de RAM em repouso. Numa VPS 8 GB dá para 15–20 clientes com folga; 16 GB leva-te a 30–40.

## Limites actuais

- A **instância principal** em `/opt/zapmass` (`https://zap-mass.com`) **continua a existir**. É o teu site de marketing/onboarding (onde os clientes criam conta). Os clientes pagantes usam as **instâncias dedicadas** em subdomínios.
- Se no futuro quiseres desligar a instância principal, basta `docker compose -f /opt/zapmass/docker-compose.yml down`. Os clientes em subdomínio continuam a funcionar.
