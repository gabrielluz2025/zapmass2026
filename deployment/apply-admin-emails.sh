#!/usr/bin/env bash
# Garante ADMIN_EMAILS e VITE_ADMIN_EMAILS no .env (idempotente).
# Na VPS, apos git pull:  cd /opt/zapmass && sudo bash deployment/apply-admin-emails.sh
# Opcional: ADMIN_EMAIL=outro@dominio.com bash deployment/apply-admin-emails.sh
set -euo pipefail
ROOT="${ROOT:-/opt/zapmass}"
E="${ADMIN_EMAIL:-festaimportgabriel@gmail.com}"
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
grep -vE '^(ADMIN_EMAILS|VITE_ADMIN_EMAILS)=' "$ENV" > "$tmp" 2>/dev/null || : > "$tmp"
mv "$tmp" "$ENV"

{
  echo "ADMIN_EMAILS=${E}"
  echo "VITE_ADMIN_EMAILS=${E}"
} >> "$ENV"

echo "==> $ENV: ADMIN_EMAILS e VITE_ADMIN_EMAILS = ${E}"
echo "==> Correr deploy (rebuild) para o Vite incorporar VITE_ADMIN_EMAILS no bundle."
