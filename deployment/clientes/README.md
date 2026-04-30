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
- **Firebase Admin**: colocar o service account em `/opt/zapmass/secrets/firebase-admin.json` (chmod 600). Sem ele, o trial de 1h e os webhooks de pagamento retornam `503 Firebase Admin nao configurado no servidor.` (ver secção abaixo).

## Credenciais Firebase Admin (obrigatório)

O back-end precisa de uma Service Account do Firebase para:

- Validar o ID token enviado pelo frontend ao ativar o **teste grátis de 1h**.
- Escrever em `userSubscriptions/<uid>` no Firestore.
- Processar webhooks de pagamento (Mercado Pago, InfinitePay).
- Autenticar o painel admin.

Passos (uma única vez — partilhado por todas as instâncias):

1. **Firebase Console** → engrenagem → **Project settings** → aba **Service accounts** → botão **Generate new private key**. Faz download do `.json`.
2. Na VPS, cria a pasta e copia o ficheiro:
   ```bash
   sudo mkdir -p /opt/zapmass/secrets
   sudo chmod 750 /opt/zapmass/secrets
   # copia o JSON (por scp ou cola o conteudo com nano)
   sudo nano /opt/zapmass/secrets/firebase-admin.json
   sudo chmod 600 /opt/zapmass/secrets/firebase-admin.json
   ```
3. Reinicia a instância principal:
   ```bash
   cd /opt/zapmass && docker compose up -d
   ```
4. Para **clientes já provisionados antes desta funcionalidade** (ex: `demo`), corre uma vez:
   ```bash
   sudo bash /opt/zapmass/deployment/clientes/scripts/aplicar-firebase-admin.sh
   ```
   O script adiciona o bind-mount `/opt/zapmass/secrets:/run/secrets:ro` e a variável `FIREBASE_SERVICE_ACCOUNT_PATH` aos `docker-compose.yml` e `.env` de cada cliente, e reinicia cada container. É idempotente.

Clientes criados a partir de agora já vêm configurados automaticamente pelo `novo-cliente.sh`.

## Bundle WhatsApp Web (`WWEBJS_WEB_VERSION_URL`)

O servidor pode fixar o HTML do WhatsApp Web usado pelo `whatsapp-web.js` (via `webVersionCache`), para reduzir erros relacionados com `getChat`, LIDs ou `markedUnread` quando o WA Web muda em produção.

- **Valor recomendado no repositório:** `deployment/wwebjs-default-bundle.env` — altere apenas esse ficheiro para mudar o URL em massa conforme novas versões [wa-version](https://github.com/wppconnect-team/wa-version/tree/main/html).
- **Novos clientes:** o `.env` gerado já inclui esta variável (template).
- **Instalações antigas** (`.env` raiz em `/opt/zapmass` sem a linha, ou containers de cliente antigos):

  ```bash
  sudo bash /opt/zapmass/deployment/clientes/scripts/aplicar-wwebjs-bundle.sh
  ```

  O script lê `wwebjs-default-bundle.env`, acrescenta ao `.env` onde faltar e reinicia os clientes modificados.

- **Docker Swarm:** o mesmo URL deve estar no `.env` da VPS; `deployment/vps-deploy.sh` exporta‑no para `docker-stack.yml`.

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
