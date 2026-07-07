#!/usr/bin/env bash
# =============================================================================
# ZAPMASS — Recuperação de WAL corrompido do Postgres principal
# =============================================================================
# Sintoma: "PANIC: could not locate a valid checkpoint record"
#          ou "invalid page in block" nos logs do container postgres.
#
# USO (cole na VPS):
#   cd /opt/zapmass && bash deployment/recover-postgres-wal.sh
#
# O script:
#   1. Para o container postgres
#   2. Roda pg_resetwal -f no volume do Postgres
#   3. Sobe o postgres novamente
#   4. Valida que o serviço ficou healthy
#
# ATENÇÃO: pg_resetwal descarta transações não confirmadas. Dados já persistidos
#          ficam intactos. Faça backup antes se possível (backup-postgres-main.sh).
# =============================================================================
set -euo pipefail

ROOT="${ROOT:-/opt/zapmass}"
cd "$ROOT"

log()  { echo ""; echo "==> $*"; }
die()  { echo "ERRO: $*" >&2; exit 1; }
ok()   { echo "OK: $*"; }

log "1/4 — Verificar logs do Postgres"
if ! docker compose logs --tail=50 postgres 2>/dev/null | grep -qiE 'checkpoint record|invalid page|PANIC|WAL'; then
  echo "Nenhum erro de WAL encontrado nos últimos 50 linhas de log."
  echo "Se o problema persistir, verifique: docker compose logs --tail=100 postgres"
  read -rp "Continuar mesmo assim? (s/N) " _ans
  [[ "${_ans,,}" == "s" ]] || { echo "Abortado."; exit 0; }
fi

log "2/4 — Backup rápido (recomendado)"
if [ -f deployment/backup-postgres-main.sh ]; then
  echo "Tentando backup antes do reset..."
  bash deployment/backup-postgres-main.sh 2>/dev/null && ok "Backup feito." || echo "AVISO: backup falhou — continuando sem backup."
else
  echo "Script de backup não encontrado; continuando sem backup."
fi

log "3/4 — Parar Postgres e executar pg_resetwal"
docker compose stop postgres 2>/dev/null || true
sleep 3

# Detectar volume e imagem usados pelo Postgres
_PG_VOL="$(docker volume ls -q 2>/dev/null | grep -E 'zapmass.?postgres' | head -1 || true)"
if [ -z "${_PG_VOL}" ]; then
  # Fallback: nome padrão do docker-compose.yml
  _PG_VOL="zapmass_zapmass-postgres"
fi

_PG_IMG="$(docker compose images postgres 2>/dev/null | awk 'NR>1{print $2":"$3}' | head -1 || true)"
if [ -z "${_PG_IMG}" ] || [ "${_PG_IMG}" = ":" ]; then
  _PG_IMG="postgres:15-alpine"
fi

echo "Volume : ${_PG_VOL}"
echo "Imagem : ${_PG_IMG}"

docker run --rm -u 70 \
  -v "${_PG_VOL}:/var/lib/postgresql/data" \
  "${_PG_IMG}" \
  pg_resetwal -f /var/lib/postgresql/data \
  && ok "pg_resetwal executado com sucesso." \
  || die "pg_resetwal falhou — verifique o volume e a imagem acima."

log "4/4 — Reiniciar Postgres e validar"
docker compose up -d postgres
echo "Aguardando Postgres iniciar (30s)..."
sleep 30

_healthy=0
for _i in 1 2 3; do
  if docker compose ps postgres 2>/dev/null | grep -qE 'healthy|Up'; then
    _healthy=1
    break
  fi
  echo "  aguardando mais 10s..."
  sleep 10
done

if [ "${_healthy}" -eq 1 ]; then
  echo ""
  echo "╔══════════════════════════════════════════════════════════════╗"
  echo "║  Postgres recuperado com sucesso!                            ║"
  echo "║  Para subir toda a stack: docker compose up -d              ║"
  echo "╚══════════════════════════════════════════════════════════════╝"
else
  echo ""
  echo "╔══════════════════════════════════════════════════════════════╗"
  echo "║  AVISO: Postgres ainda não respondeu como healthy.           ║"
  echo "║  Verifique: docker compose logs --tail=50 postgres           ║"
  echo "╚══════════════════════════════════════════════════════════════╝"
  exit 1
fi
