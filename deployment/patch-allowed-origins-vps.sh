#!/usr/bin/env bash
# Acrescenta origens em ALLOWED_ORIGINS no .env da VPS (idempotente).
set -euo pipefail
ROOT="${ROOT:-/opt/zapmass}"
cd "$ROOT"
[ -f .env ] || { echo "Sem .env em $ROOT"; exit 1; }

ORIGINS=(
  "https://zap-mass.com"
  "https://www.zap-mass.com"
  "https://zap.mass.com"
  "https://www.zap.mass.com"
  "http://2.24.210.220:3001"
  "http://2.24.210.220"
)

current="$(grep -E '^ALLOWED_ORIGINS=' .env | head -1 | cut -d= -f2- | tr -d '"' || true)"
merged="$current"
for o in "${ORIGINS[@]}"; do
  case ",$merged," in
    *,"$o",*) ;;
    *)
      if [ -z "$merged" ]; then merged="$o"; else merged="$merged,$o"; fi
      ;;
  esac
done

tmp="$(mktemp)"
grep -vE '^ALLOWED_ORIGINS=' .env > "$tmp" || : > "$tmp"
echo "ALLOWED_ORIGINS=$merged" >> "$tmp"
mv "$tmp" .env
echo "==> ALLOWED_ORIGINS atualizado:"
grep '^ALLOWED_ORIGINS=' .env
