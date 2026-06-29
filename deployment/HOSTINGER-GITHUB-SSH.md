# SSH: GitHub Actions → VPS Hostinger

Se o workflow **Build + deploy VPS** falha com `dial tcp ...:22: connection timed out`, o runner do GitHub **não alcança** a porta SSH. O `ufw` na VPS pode estar correto; o bloqueio costuma ser **firewall do painel Hostinger**.

## Checklist no hPanel

1. **VPS** → **Firewall** (ou Security / Network).
2. Regra **entrada** para **TCP 22** (SSH):
   - Origem: **qualquer** / `0.0.0.0/0` (e IPv6 `::/0` se existir).
   - **Não** restrinja SSH só ao seu IP fixo — os runners do GitHub usam IPs públicos variados.
3. Confirme o secret **`VPS_HOST`** no GitHub (Settings → Secrets → Actions):
   - IPv4 público da VPS, ex.: `2.24.210.220`
   - Sem espaços; se `sshd` usa outra porta, defina **`VPS_SSH_PORT`**.
4. Secret **`VPS_SSH_KEY`**: chave privada OpenSSH que autoriza o utilizador **`VPS_USER`** (ex. `root`) em `/root/.ssh/authorized_keys`.

## Testes

No seu PC (PowerShell):

```powershell
Test-NetConnection 2.24.210.220 -Port 22
```

Na VPS (já com SSH):

```bash
sudo ufw status
sudo systemctl status ssh
curl -s -o /dev/null -w "%{http_code}\n" http://127.0.0.1:3001/api/health
```

## Deploy manual (enquanto o Actions não liga)

Se `git pull` falhar com *local changes would be overwritten*, use o reset (o repositório na VPS prevalece):

```bash
cd /opt/zapmass && git fetch origin && git reset --hard origin/main && bash deployment/deploy-completo.sh
```

Ou só descartar o ficheiro alterado e puxar:

```bash
cd /opt/zapmass && git checkout -- deployment/vps-deploy.sh && git pull origin main && bash deployment/manual-pull-deploy.sh
```

## Deploy automático sem SSH do GitHub (recomendado na Hostinger)

Com firewall bloqueando porta 22 para runners do GitHub, instale o cron que puxa `origin/main` a cada 3 minutos:

```bash
cd /opt/zapmass && git pull origin main && sudo bash deployment/install-deploy-watch-cron.sh
```

Log: `/var/log/zapmass-watch-deploy.log`

Depois disso, pushes em `main` atualizam a VPS mesmo quando o workflow SSH falhar (o CI aguarda a versão em produção via HTTPS).

## Evolution: tag `v2.4.0` não existe no Docker Hub

Se `docker compose` falhar com `evoapicloud/evolution-api:v2.4.0: not found`:

```bash
cd /opt/zapmass
bash deployment/fix-evolution-image-vps.sh   # define v2.3.7
bash deployment/manual-pull-deploy.sh
```

Tags válidas: `v2.3.7` (recomendado). `2.4.0-rc2` exige licença gratuita na Evolution Foundation.

## Alternativa estável

[Self-hosted runner](https://docs.github.com/en/actions/hosting-your-own-runners/about-self-hosted-runners) na VPS — o runner liga **para fora** aos servidores da GitHub, sem depender de SSH entrada dos IPs do Actions.
