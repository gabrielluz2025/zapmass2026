# Operação 100% na VPS (sem usar o notebook como servidor)

## O que já é na VPS

Quando você abre o ZapMass pelo **domínio HTTPS da VPS** (ex.: `https://zap-mass.com`):

| Recurso | Onde roda |
|---------|-----------|
| Interface (React) | VPS (Docker + Nginx) |
| API + Socket.IO | VPS |
| Campanhas, filas, fluxo por resposta | VPS (Redis + workers) |
| WhatsApp (Evolution Go) | VPS |
| Contatos, campanhas, relatórios (dados) | Postgres na VPS |

O **notebook** só executa o **navegador**. Fechar o PC **não interrompe** disparos já na fila.

## O que **não** usar no dia a dia

- `npm run dev` / `npm run client:dev` no OneDrive — só para **desenvolvimento**.
- Abrir `http://localhost:5173` ou `:8000` pensando que é produção.
- `VITE_API_ORIGIN=http://localhost:3001` no build de produção.

## Garantir modo VPS no servidor

SSH na VPS:

```bash
cd /opt/zapmass && bash deployment/ensure-vps-only-mode.sh
```

Se aparecer aviso (Firebase/dual ou `vpsOnly=false`):

```bash
cd /opt/zapmass && APPLY=1 bash deployment/ensure-vps-only-mode.sh
```

Isso ajusta `.env`, faz rebuild e redeploy. Alternativa completa:

```bash
cd /opt/zapmass && bash deployment/vps-pure-no-firebase.sh
```

Deploy manual após `git pull`:

```bash
cd /opt/zapmass && git pull origin main && bash deployment/manual-pull-deploy.sh
```

## Como confirmar no painel

1. **Configurações → Conta → Versão no servidor**  
   Deve mostrar **Modo: 100% VPS (auth + dados)** quando `vpsOnly=true`.

2. **DevTools → Network**  
   Chamadas `/api/...` e WebSocket na **mesma origem** do site (seu domínio), não `localhost`.

3. **URL na barra**  
   Domínio da VPS = backend na VPS. `localhost` = ambiente local.

## O que ainda fica no browser (leve)

- Preferências de inbox (pin, arquivo, snooze) — `localStorage`.
- Mini-CRM do chat — `localStorage`.
- **Agendar mensagem no Bate-papo** — envia só se a **aba estiver aberta** no horário (não usa CPU do notebook para fila; ainda não está na fila do servidor).

Campanhas agendadas e aquecimento **já** rodam na VPS com o runner de campanhas.

## Variáveis esperadas no `.env` da VPS

```env
ZAPMASS_AUTH_PROVIDER=vps
ZAPMASS_DATA_PROVIDER=vps
VITE_USE_VPS_AUTH=true
VITE_USE_VPS_DATA=true
ZAPMASS_ENFORCE_VPS_ONLY=1
```

Ver também: [MIGRACAO-VPS.md](./MIGRACAO-VPS.md), `deployment/vps-pure-no-firebase.sh`.
