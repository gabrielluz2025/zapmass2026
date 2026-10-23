#!/usr/bin/env bash
# Infere VITE_API_ORIGIN no deploy quando o SPA (PUBLIC_APP_URL) e o callback OAuth estão em hosts diferentes.
# Ex.: app.zap-mass.com (front) + https://zap-mass.com/api/auth/google/callback → VITE_API_ORIGIN=https://zap-mass.com
set -euo pipefail

_host_from_url() {
  local u="${1:-}"
  u="${u//$'\r'/}"
  case "$u" in
    http://*|https://*) ;;
    *) u="https://${u}" ;;
  esac
  echo "$u" | sed -E 's|^https?://([^/:]+).*|\1|' | tr '[:upper:]' '[:lower:]'
}

infer_vite_api_origin_if_needed() {
  if [ -n "${VITE_API_ORIGIN:-}" ]; then
    return 0
  fi
  local pub="${PUBLIC_APP_URL:-}"
  local red="${GOOGLE_OAUTH_REDIRECT_URI:-}"
  if [ -z "$pub" ] || [ -z "$red" ]; then
    return 0
  fi
  local pub_host red_host
  pub_host="$(_host_from_url "$pub")"
  red_host="$(_host_from_url "$red")"
  if [ -z "$pub_host" ] || [ -z "$red_host" ] || [ "$pub_host" = "$red_host" ]; then
    return 0
  fi
  export VITE_API_ORIGIN="https://${red_host}"
  echo "==> VITE_API_ORIGIN inferido para build: ${VITE_API_ORIGIN} (painel em ${pub_host}, OAuth/API em ${red_host})"
}

if [[ "${BASH_SOURCE[0]}" == "${0}" ]]; then
  infer_vite_api_origin_if_needed
  echo "VITE_API_ORIGIN=${VITE_API_ORIGIN:-}"
fi
