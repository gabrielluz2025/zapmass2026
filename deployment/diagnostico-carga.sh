#!/usr/bin/env bash
# Snapshot rápido de carga e consumidores (VPS com ZapMass/Docker).
# Uso: bash deployment/diagnostico-carga.sh   ou  ./deployment/diagnostico-carga.sh

set -euo pipefail

echo "========== Data/Hora =========="
date -Iseconds
uptime
echo

echo "========== Memória (RAM / swap) =========="
if command -v free >/dev/null; then
  free -h
else
  echo "comando 'free' não disponível"
fi
echo

echo "========== Disco (raiz e, se existir, /data) =========="
df -hT / 2>/dev/null | head -5
[ -d /data ] && df -hT /data 2>/dev/null | tail -1 || true
echo

echo "========== Top 12 processos por RAM =========="
ps aux --sort=-%mem 2>/dev/null | head -13 || true
echo

echo "========== Contagem aprox. (chromium, node) =========="
C=$(ps aux 2>/dev/null | grep -E '[c]hromium' | wc -l) || true
N=$(ps aux 2>/dev/null | grep -E '[n]ode' | wc -l) || true
echo "linhas de processo com chromium: $C  |  com node: $N"
echo

if command -v docker >/dev/null 2>&1; then
  echo "========== Docker: containers (status) =========="
  docker ps -a --format "table {{.Names}}\t{{.Status}}\t{{.Size}}" 2>/dev/null | head -30 || true
  echo
  echo "========== Docker stats (1 amostra, sem stream) =========="
  docker stats --no-stream 2>/dev/null || true
  echo
fi

if command -v ss >/dev/null 2>&1; then
  echo "========== Sockets (resumo) =========="
  ss -s 2>/dev/null || true
  echo
fi

echo "========== Load average / CPUs =========="
NPROC="$(nproc 2>/dev/null || echo "?")"
echo "CPUs: $NPROC"
if [ -r /proc/loadavg ]; then
  cat /proc/loadavg
fi
echo
echo "Fim. Revise: processos de Chromium acima, docker stats, RAM livre, disco cheio, load >> CPUs."
