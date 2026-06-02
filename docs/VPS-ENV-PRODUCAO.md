# `.env` na VPS (produção)

Scripts em `deployment/`:

| Script | Uso |
|--------|-----|
| `vps-check-env.sh` | Lista o que falta |
| `vps-env-bootstrap.sh` | Origens + Firebase Web API Key (público) |
| `vps-env-secrets.sh` | Mercado Pago + Resend (tokens seus) |
| `manual-pull-deploy.sh` | Deploy após ajustar `.env` |

## Ordem na VPS

```bash
cd /opt/zapmass
git pull origin main   # ou só: bash deployment/manual-pull-deploy.sh
bash deployment/vps-env-bootstrap.sh
```

### Firebase Admin (ficheiro)

1. [Firebase Console](https://console.firebase.google.com) → projeto **zapflow25**
2. Project settings → Service accounts → **Generate new private key**
3. Na VPS:

```bash
nano /opt/zapmass/secrets/firebase-admin.json   # colar JSON
chmod 600 /opt/zapmass/secrets/firebase-admin.json
```

### Mercado Pago + Resend

```bash
MERCADOPAGO_ACCESS_TOKEN='APP_USR-...' \
MERCADOPAGO_WEBHOOK_SECRET='...' \
RESEND_API_KEY='re_...' \
EMAIL_FROM='ZapMass <no-reply@zap-mass.com>' \
EMAIL_REPLY_TO='suporte@zap-mass.com' \
bash deployment/vps-env-secrets.sh
```

### Deploy

```bash
bash deployment/manual-pull-deploy.sh
bash deployment/vps-check-env.sh
```

## GitHub Actions

- Secret `VPS_HOST` = `2.24.210.220`
- Firewall Hostinger **zapmass-web** → TCP 22/80/443/3001 → **Sincronizar**
- Run **#882** (`7003179`): deploy automático **sucesso**
