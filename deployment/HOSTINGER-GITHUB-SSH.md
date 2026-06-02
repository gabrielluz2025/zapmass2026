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

```bash
cd /opt/zapmass && bash deployment/manual-pull-deploy.sh
```

## Alternativa estável

[Self-hosted runner](https://docs.github.com/en/actions/hosting-your-own-runners/about-self-hosted-runners) na VPS — o runner liga **para fora** aos servidores da GitHub, sem depender de SSH entrada dos IPs do Actions.
