#!/usr/bin/env bash
# Garante ADMIN_EMAILS, VITE_ADMIN_EMAILS e (opcional) ZAPMASS_ADMIN_UIDS no .env (idempotente).
# Se `git pull` disser "not on a branch":  bash deployment/ensure-git-main.sh
# Depois: cd /opt/zapmass && git pull && sudo bash deployment/apply-admin-emails.sh && bash deployment/manual-pull-deploy.sh
#
# Uso:
#   ADMIN_EMAIL=a@x.com,b@y.com bash deployment/apply-admin-emails.sh
#   ZAPMASS_ADMIN_UIDS=firebaseUid123 bash deployment/apply-admin-emails.sh
set -euo pipefail
ROOT="${ROOT:-/opt/zapmass}"
E="${ADMIN_EMAIL:-festaimportgabriel@gmail.com}"
UIDS="${ZAPMASS_ADMIN_UIDS:-}"
ENV="${ROOT}/.env"

if [ ! -d "$ROOT" ]; then
  echo "Erro: pasta $ROOT inexistente." >&2
  exit 1
fi
cd "$ROOT"

if [ ! -f "$ENV" ]; then
  umask 077
  : > "$ENV"
  echo "==> Criado $ENV"
fi

tmp="$(mktemp)"
grep -vE '^(ADMIN_EMAILS|VITE_ADMIN_EMAILS|ADMIN_UIDS|ZAPMASS_ADMIN_UIDS|VITE_ADMIN_UIDS|VITE_ZAPMASS_ADMIN_UIDS)=' "$ENV" > "$tmp" 2>/dev/null || : > "$tmp"
mv "$tmp" "$ENV"

{
  echo "ADMIN_EMAILS=${E}"
  echo "VITE_ADMIN_EMAILS=${E}"
  if [ -n "$UIDS" ]; then
    echo "ADMIN_UIDS=${UIDS}"
    echo "ZAPMASS_ADMIN_UIDS=${UIDS}"
    echo "VITE_ADMIN_UIDS=${UIDS}"
    echo "VITE_ZAPMASS_ADMIN_UIDS=${UIDS}"
  fi
} >> "$ENV"

echo "==> $ENV: ADMIN_EMAILS e VITE_ADMIN_EMAILS = ${E}"
if [ -n "$UIDS" ]; then
  echo "==> $ENV: ADMIN_UIDS / ZAPMASS_ADMIN_UIDS = ${UIDS}"
fi
echo "==> Rebuild para VITE_*; reinicie api para ADMIN_EMAILS/ADMIN_UIDS (runtime)."
