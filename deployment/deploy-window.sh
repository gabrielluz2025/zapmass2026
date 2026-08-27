#!/usr/bin/env bash
# Janela segura de deploy automático — 02:00–05:59 America/Sao_Paulo.
# Evita restart da API em horário comercial (queda em massa de chips WhatsApp).
#
# Bypass: ZAPMASS_DEPLOY_FORCE=1 ou DEPLOY_FORCE=1
# Deploy manual imediato: workflow_dispatch no GitHub, ou manual-pull-deploy na VPS.

DEPLOY_WINDOW_TZ="${DEPLOY_WINDOW_TZ:-America/Sao_Paulo}"
DEPLOY_WINDOW_START_HOUR="${DEPLOY_WINDOW_START_HOUR:-2}"
DEPLOY_WINDOW_END_HOUR="${DEPLOY_WINDOW_END_HOUR:-6}"

deploy_window_label() {
  echo "${DEPLOY_WINDOW_START_HOUR}:00–$((DEPLOY_WINDOW_END_HOUR - 1)):59 ${DEPLOY_WINDOW_TZ}"
}

deploy_window_active() {
  if [ "${ZAPMASS_DEPLOY_FORCE:-0}" = "1" ] || [ "${DEPLOY_FORCE:-0}" = "1" ]; then
    return 0
  fi
  local h
  h=$(TZ="${DEPLOY_WINDOW_TZ}" date +%H)
  h=$((10#$h))
  [ "$h" -ge "${DEPLOY_WINDOW_START_HOUR}" ] && [ "$h" -lt "${DEPLOY_WINDOW_END_HOUR}" ]
}

# Eventos que respeitam a janela (automáticos).
deploy_window_should_gate_event() {
  local event="${1:-push}"
  case "$event" in
    workflow_dispatch|manual) return 1 ;;
    watch|schedule|push) return 0 ;;
    *) return 0 ;;
  esac
}

# Retorna 0 se pode deployar; 1 se deve adiar (sem erro fatal).
deploy_window_check_or_exit() {
  local event="${1:-push}"
  if ! deploy_window_should_gate_event "$event"; then
    return 0
  fi
  if deploy_window_active; then
    return 0
  fi
  echo "==> Fora da janela segura de deploy ($(deploy_window_label); agora: $(TZ="${DEPLOY_WINDOW_TZ}" date '+%H:%M %Z'))."
  echo "==> Código pendente — próximo ciclo na madrugada ou deploy manual."
  echo "==> Imediato: GitHub Actions → Run workflow, ou DEPLOY_FORCE=1 bash deployment/manual-pull-deploy.sh"
  return 1
}
