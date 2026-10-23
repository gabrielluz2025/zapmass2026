#!/usr/bin/env bash
# Infere VITE_API_ORIGIN no deploy SOMENTE com ZAPMASS_CROSS_HOST_API=1 (API/callback no apex, painel em app).
# Preferência: callback OAuth no mesmo host do painel (sem VITE_API_ORIGIN). Ver server/deploy/inferViteApiOrigin.ts
set -euo pipefail

_truthy() {
  case "$(echo "${1:-}" | tr '[:upper:]' '[:lower:]')" in
    1 | true | yes | on) return 0 ;;
    *) return 1 ;;
  esac
}

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
  if ! _truthy "${ZAPMASS_CROSS_HOST_API:-}"; then
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
