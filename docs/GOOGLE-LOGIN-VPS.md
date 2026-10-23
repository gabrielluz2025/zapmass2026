# Login com Google na VPS (sem Firebase)

O ZapMass em modo **VPS** pode autenticar gestores com **OAuth 2.0 / OpenID Connect** direto no Google. A sessão é a mesma do login por e-mail (JWT + cookie de refresh no Postgres).

## 1. Google Cloud Console

1. Acesse [Google Cloud Console](https://console.cloud.google.com/) → **APIs e serviços** → **Credenciais**.
2. Crie um **ID do cliente OAuth 2.0** do tipo **Aplicativo da Web**.
3. **Origens JavaScript autorizadas** (onde o usuário abre o site):
   - `https://zap-mass.com`
   - `https://www.zap-mass.com`
   - `https://app.zap-mass.com` (se o painel abrir neste subdomínio)
   - Em desenvolvimento: `http://localhost:8000` (ou a porta do Vite)
4. **URIs de redirecionamento autorizados** (callback no **backend**):
   - Produção (mesmo host da API): `https://zap-mass.com/api/auth/google/callback`
   - Se o site abrir também em **www** ou **app**, cadastre **os dois** (devem bater com `GOOGLE_OAUTH_REDIRECT_URI` no `.env` — use um só como valor oficial, tipicamente **sem** www):
     - `https://zap-mass.com/api/auth/google/callback`
     - `https://www.zap-mass.com/api/auth/google/callback`
     - `https://app.zap-mass.com/api/auth/google/callback` (opcional se o callback OAuth também passar pelo subdomínio app)
   - Se a API estiver noutro host: `https://api.seudominio.com/api/auth/google/callback`
   - Dev local (API na 3001): `http://localhost:3001/api/auth/google/callback`

   **Importante:** o valor de `GOOGLE_OAUTH_REDIRECT_URI` no servidor tem de ser **idêntico** (incluindo `http`/`https` e presença de `www`) ao URI que o Google recebe no parâmetro `redirect_uri`. Erro `redirect_uri_mismatch` = divergência aqui.

   **Apex vs www vs app:** inclua `app.zap-mass.com` no `server_name` do nginx (ver `deployment/nginx-zapmass.conf`). Defina `PUBLIC_APP_URL` para a URL canónica do painel (ex.: `https://app.zap-mass.com`). O callback OAuth pode ficar no apex (`GOOGLE_OAUTH_REDIRECT_URI=https://zap-mass.com/api/auth/google/callback`); após o login o utilizador volta ao `returnTo` (ex.: app). Cookies de sessão usam `Domain=.zap-mass.com` e `SameSite=None; Secure` em produção para o `POST /api/auth/refresh` funcionar quando o SPA e a API estão em hosts diferentes (ex.: app → apex). Inclua **todas** as origens do browser em `ALLOWED_ORIGINS`.
5. Copie **Client ID** e **Client secret** (nunca commite no repositório).

Não é necessário Firebase Authentication nem Identity Toolkit para este fluxo.

### Erro comum: secret = Client ID

No painel Google existem **dois campos distintos**:

| Campo no GCP | Vai para o `.env` | Formato típico |
|--------------|-------------------|----------------|
| ID do cliente | `GOOGLE_OAUTH_CLIENT_ID` | `123456789-abc.apps.googleusercontent.com` |
| Chave secreta do cliente | `GOOGLE_OAUTH_CLIENT_SECRET` | `GOCSPX-xxxxxxxx` |

Se `GOOGLE_OAUTH_CLIENT_SECRET` for **igual** ao Client ID, ou contiver `.apps.googleusercontent.com`, o login Google fica **desligado** (o servidor rejeita a config) e a troca de token no Google falha com `invalid_client`.

Corrija no `.env`, rode `bash deployment/vps-check-env.sh` e redeploy.

## 2. Variáveis na VPS (`.env`)

**Recomendado:** script interativo na VPS (não ecoa o secret):

```bash
cd /opt/zapmass
git pull origin main
bash deployment/google-oauth-configurar.sh
```

Exemplo manual (substitua pelos valores reais do GCP — **não** use o Client ID no lugar do secret):

```env
# Ativa o botão «Continuar com Google» no front
ZAPMASS_GOOGLE_LOGIN=1

GOOGLE_OAUTH_CLIENT_ID=123456789012-abcdefghijklmnop.apps.googleusercontent.com
GOOGLE_OAUTH_CLIENT_SECRET=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t-real
# Deve ser idêntico a um URI autorizado no Google Cloud
GOOGLE_OAUTH_REDIRECT_URI=https://zap-mass.com/api/auth/google/callback

# Opcional: para onde redirecionar após login (origem do app). Se omitido, usa o primeiro ALLOWED_ORIGINS.
# GOOGLE_OAUTH_APP_REDIRECT_URI=https://zap-mass.com/
```

Garanta também **`ALLOWED_ORIGINS`** com as origens do navegador (ex.: `https://app.zap-mass.com,https://zap-mass.com,https://www.zap-mass.com`).

Se o front em **app** chamar a API no **apex**, defina no build `VITE_API_ORIGIN=https://zap-mass.com` (ver `env.production.template`) **ou** sirva API e SPA no mesmo host (nginx em app).

Reinicie o container/serviço Node após alterar o `.env` (ou use o deploy oferecido pelo script).

## 3. Fluxo resumido

1. Utilizador clica **Continuar com Google** → `GET /api/auth/google/start` (state + PKCE em cookies HttpOnly).
2. Google devolve para `GET /api/auth/google/callback`.
3. Servidor troca o `code`, valida o **ID token** (JWKS Google, `email_verified`).
4. Cria ou **vincula** utilizador em `zapmass.users` (`google_sub`) e emite sessão VPS.
5. Redirect para o front com `?google_login=1`; o app renova o access token via `/api/auth/refresh`.

## 4. Política de contas

- Só aceita e-mail com **`email_verified`** no token Google.
- E-mail já existente (senha): **liga** `google_sub` à mesma conta (mesmo tenant).
- Conta nova: equivalente ao registo por e-mail (sem senha obrigatória).
- **Funcionários** continuam só com login staff (sem Google na v1).

## 5. Verificação

```bash
curl -s https://zap-mass.com/api/auth/config | jq '.googleLoginEnabled'
```

Deve retornar `true` quando env e Postgres estão corretos.

Ver o `redirect_uri` que o servidor envia ao Google (deve coincidir com o GCP):

```bash
curl -sI 'https://zap-mass.com/api/auth/google/start' | grep -i location
# Na URL decodificada, confira redirect_uri=https%3A%2F%2Fzap-mass.com%2Fapi%2Fauth%2Fgoogle%2Fcallback
```

Se o login Google concluir no Google mas a landing mostrar *«Não foi possível concluir o login com Google»* **sem** `?google_error=` na URL (só `?google_login=1`), o callback provavelmente OK mas o **`POST /api/auth/refresh`** falhou (cookie de sessão). Causas comuns: apex/www diferentes, ou secret `GOCSPX-` errado (aí costuma falhar antes, com `google_error=failed`). Veja logs: `docker logs … 2>&1 | grep 'auth/google/callback'`.

## 6. Migração

A coluna `google_sub` é aplicada pela migration `021_google_sub.sql` no arranque do servidor (Postgres ZapMass).
