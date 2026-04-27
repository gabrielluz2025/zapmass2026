#!/usr/bin/env bash
# Cria ficheiro de swap em VPS sem swap (ou com swap insuficiente). Idempotente.
# Uso: sudo deployment/ensure-swap.sh
# Configurável: SWAP_SIZE_MB=4096 (default) SWAPFILE=/swapfile
set -euo pipefail

SWAPFILE="${SWAPFILE:-/swapfile}"
SWAP_MB="${SWAP_SIZE_MB:-4096}"

if [ "$(id -u)" -ne 0 ]; then
  echo "Erro: execute com root, ex.: sudo $0" >&2
  exit 1
fi

if ! [[ "$SWAP_MB" =~ ^[0-9]+$ ]] || [ "$SWAP_MB" -lt 256 ]; then
  echo "Erro: SWAP_SIZE_MB inválido: ${SWAP_MB}" >&2
  exit 1
fi

min_kb=$((SWAP_MB * 1024))
total_kb="$(awk '/^SwapTotal:/{print $2}' /proc/meminfo)"
if [ "${total_kb:-0}" -ge "$min_kb" ]; then
  echo "==> [swap] SwapTotal ${total_kb} kB >= alvo ${min_kb} kB — nada a fazer."
  exit 0
fi

if [ -f "$SWAPFILE" ]; then
  if grep -qF "$SWAPFILE" /proc/swaps 2>/dev/null; then
    now_kb=$(awk '/^SwapTotal:/{print $2}' /proc/meminfo)
    if [ "${now_kb:-0}" -ge "$min_kb" ]; then
      echo "==> [swap] ${SWAPFILE} já ativo e total OK (${now_kb} kB)."
      exit 0
    fi
    echo "==> [swap] Existe ${SWAPFILE} mas o total ainda < ${min_kb} kB; ajuste manual se precisar de mais."
    exit 0
  fi
  echo "==> [swap] A ativar ${SWAPFILE} existente…"
  chmod 600 "$SWAPFILE"
  mkswap -f "$SWAPFILE" 2>/dev/null || mkswap "$SWAPFILE"
  swapon "$SWAPFILE"
else
  echo "==> [swap] A criar ${SWAPFILE} (${SWAP_MB} MiB)…"
  if fallocate -l "${SWAP_MB}M" "$SWAPFILE" 2>/dev/null; then
    :
  else
    dd if=/dev/zero of="$SWAPFILE" bs=1M count="$SWAP_MB" status=progress
  fi
  chmod 600 "$SWAPFILE"
  mkswap "$SWAPFILE"
  swapon "$SWAPFILE"
fi

if ! grep -qF "$SWAPFILE" /etc/fstab; then
  echo "$SWAPFILE none swap sw 0 0" >> /etc/fstab
  echo "==> [swap] Entrada adicionada ao /etc/fstab."
fi

total_kb_after="$(awk '/^SwapTotal:/{print $2}' /proc/meminfo)"
echo "==> [swap] SwapTotal agora: ${total_kb_after} kB (alvo mín. ${min_kb} kB)."
