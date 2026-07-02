#!/usr/bin/env bash
# backup-postgres.sh — Backup diário do PostgreSQL (zapmass)
#
# Uso:
#   ./backup-postgres.sh                  # executa manualmente
#   crontab -e → 0 3 * * * /opt/zapmass/deployment/backup-postgres.sh
#
# Variáveis de ambiente (lidas do .env do projeto automaticamente):
#   ZAPMASS_DATABASE_URL   — PostgreSQL connection string
#   BACKUP_RETENTION_DAYS  — dias de retenção (padrão: 7)
#   BACKUP_DIR             — diretório de backup (padrão: /opt/zapmass/backups)

set -euo pipefail

# ── Configuração ──────────────────────────────────────────────────────────────
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
ENV_FILE="$(dirname "$SCRIPT_DIR")/.env"

# Carrega .env se existir
if [[ -f "$ENV_FILE" ]]; then
  set -o allexport
  # shellcheck disable=SC1090
  source <(grep -v '^\s*#' "$ENV_FILE" | grep '=')
  set +o allexport
fi

BACKUP_DIR="${BACKUP_DIR:-/opt/zapmass/backups}"
RETENTION_DAYS="${BACKUP_RETENTION_DAYS:-7}"
DB_URL="${ZAPMASS_DATABASE_URL:-}"
TIMESTAMP=$(date +"%Y%m%d_%H%M%S")
BACKUP_FILE="$BACKUP_DIR/zapmass_${TIMESTAMP}.sql.gz"
LOG_FILE="$BACKUP_DIR/backup.log"

# ── Validação ─────────────────────────────────────────────────────────────────
if [[ -z "$DB_URL" ]]; then
  echo "[$(date -u +%FT%TZ)] ERROR: ZAPMASS_DATABASE_URL não definida. Backup abortado." | tee -a "$LOG_FILE"
  exit 1
fi

mkdir -p "$BACKUP_DIR"
chmod 700 "$BACKUP_DIR"

# ── Backup ────────────────────────────────────────────────────────────────────
echo "[$(date -u +%FT%TZ)] Iniciando backup → $BACKUP_FILE" | tee -a "$LOG_FILE"

if docker exec zapmass-postgres pg_dump "$DB_URL" 2>>"$LOG_FILE" | gzip > "$BACKUP_FILE"; then
  SIZE=$(du -sh "$BACKUP_FILE" | cut -f1)
  echo "[$(date -u +%FT%TZ)] Backup concluído. Tamanho: $SIZE → $BACKUP_FILE" | tee -a "$LOG_FILE"
else
  # Tenta via pg_dump local se docker falhar
  if command -v pg_dump &>/dev/null; then
    pg_dump "$DB_URL" 2>>"$LOG_FILE" | gzip > "$BACKUP_FILE"
    SIZE=$(du -sh "$BACKUP_FILE" | cut -f1)
    echo "[$(date -u +%FT%TZ)] Backup (local pg_dump) concluído. Tamanho: $SIZE" | tee -a "$LOG_FILE"
  else
    echo "[$(date -u +%FT%TZ)] ERROR: pg_dump falhou e não há pg_dump local." | tee -a "$LOG_FILE"
    rm -f "$BACKUP_FILE"
    exit 1
  fi
fi

# ── Retenção ──────────────────────────────────────────────────────────────────
DELETED=$(find "$BACKUP_DIR" -name "zapmass_*.sql.gz" -mtime +"$RETENTION_DAYS" -print -delete | wc -l)
if [[ "$DELETED" -gt 0 ]]; then
  echo "[$(date -u +%FT%TZ)] Removidos $DELETED backups antigos (>${RETENTION_DAYS} dias)." | tee -a "$LOG_FILE"
fi

echo "[$(date -u +%FT%TZ)] OK." | tee -a "$LOG_FILE"
