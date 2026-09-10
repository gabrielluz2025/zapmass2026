#!/usr/bin/env bash
# Entrada do cron semanal: checklist Go ↔ settings + log rotativo.
# Não usar FIX=1 por padrão (só diagnóstico). Auto-correção leve:
#   ZAPMASS_GO_DRIFT_AUTO_FIX=1 no install ou na linha do cron.
set -uo pipefail

ROOT="${ZAPMASS_ROOT:-/opt/zapmass}"
CHECK="${ROOT}/deployment/vps-monthly-go-drift-check.sh"
LOG="${ZAPMASS_GO_DRIFT_LOG:-/var/log/zapmass-go-drift-weekly.log}"
MAX_LOG_KB="${ZAPMASS_GO_DRIFT_LOG_MAX_KB:-512}"

if [ ! -f "${CHECK}" ]; then
  echo "$(date -Is) ERRO: ${CHECK} não encontrado" >>"${LOG}" 2>&1 || true
  exit 1
fi

# Trunca log se crescer demais (mantém últimas ~512 KB).
if [ -f "${LOG}" ]; then
  _size_kb="$(du -k "${LOG}" 2>/dev/null | awk '{print $1}' || echo 0)"
  if [ "${_size_kb:-0}" -gt "${MAX_LOG_KB}" ] 2>/dev/null; then
    tail -c "$((MAX_LOG_KB * 1024))" "${LOG}" >"${LOG}.tmp" 2>/dev/null \
      && mv "${LOG}.tmp" "${LOG}" 2>/dev/null || true
  fi
fi

{
  echo ""
  echo "======== ZapMass Go drift semanal — $(date -Is) ========"
  cd "${ROOT}"
  _rc=0
  bash "${CHECK}" || _rc=$?
  if [ "${_rc}" -ne 0 ] && [ "${ZAPMASS_GO_DRIFT_AUTO_FIX:-0}" = "1" ]; then
    echo "==> ZAPMASS_GO_DRIFT_AUTO_FIX=1 — FIX=1 (limpeza leve)"
    FIX=1 bash "${CHECK}" || true
  fi
  echo "======== fim (exit=${_rc}) ========"
} >>"${LOG}" 2>&1

exit "${_rc:-0}"
