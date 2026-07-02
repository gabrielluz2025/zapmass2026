#!/usr/bin/env bash
# backup-postgres-main.sh
# Backup diário dos dois bancos Postgres do ZapMass (zapmass_db + evolution_db).
# Retenção automática de 7 dias.
#
# USO MANUAL: sudo bash /opt/zapmass/deployment/backup-postgres-main.sh
# INSTALAÇÃO DO CRON: sudo bash /opt/zapmass/deployment/install-backup-cron.sh
#
# Configuração (via variáveis de ambiente ou .env):
#   BACKUP_DIR        destino dos backups (padrão: /opt/zapmass/backups/postgres)
#   BACKUP_RETENTION  dias de retenção (padrão: 7)
#   POSTGRES_PASSWORD senha do Postgres (lido do .env se existir)

set -euo pipefail

ZAPMASS_DIR="${ZAPMASS_DIR:-/opt/zapmass}"
BACKUP_DIR="${BACKUP_DIR:-${ZAPMASS_DIR}/backups/postgres}"
BACKUP_RETENTION="${BACKUP_RETENTION:-7}"
LOG_FILE="/var/log/zapmass-backup.log"

# ── Cores ──────────────────────────────────────────────────────────────────────
RED='\033[0;31m'; GREEN='\033[0;32m'; YELLOW='\033[1;33m'; BLUE='\033[0;34m'; NC='\033[0m'
log()  { echo -e "${BLUE}[$(date '+%Y-%m-%d %H:%M:%S')] INFO${NC}  $*" | tee -a "$LOG_FILE"; }
ok()   { echo -e "${GREEN}[$(date '+%Y-%m-%d %H:%M:%S')] OK${NC}    $*" | tee -a "$LOG_FILE"; }
warn() { echo -e "${YELLOW}[$(date '+%Y-%m-%d %H:%M:%S')] WARN${NC}  $*" | tee -a "$LOG_FILE"; }
err()  { echo -e "${RED}[$(date '+%Y-%m-%d %H:%M:%S')] ERRO${NC}  $*" | tee -a "$LOG_FILE" >&2; }

# ── Carrega senha do .env se disponível ────────────────────────────────────────
ENV_FILE="${ZAPMASS_DIR}/.env"
if [ -f "$ENV_FILE" ]; then
    POSTGRES_PASSWORD_ENV=$(grep -E '^POSTGRES_PASSWORD=' "$ENV_FILE" 2>/dev/null | head -1 | cut -d= -f2- | tr -d '"' | tr -d "'" || true)
    if [ -n "${POSTGRES_PASSWORD_ENV:-}" ]; then
        export PGPASSWORD="$POSTGRES_PASSWORD_ENV"
    fi
fi
# Fallback para padrão do docker-compose
export PGPASSWORD="${PGPASSWORD:-${POSTGRES_PASSWORD:-evolution-secure-pass-2026}}"

# ── Prepara destino ────────────────────────────────────────────────────────────
mkdir -p "$BACKUP_DIR"
touch "$LOG_FILE" 2>/dev/null || true

TS="$(date +%Y%m%d-%H%M%S)"
ERRORS=0

# ── Verifica se o container Postgres está rodando ─────────────────────────────
PG_CONTAINER=$(docker ps --filter "name=zapmass-postgres" --filter "status=running" --format "{{.Names}}" 2>/dev/null | head -1 || true)
if [ -z "$PG_CONTAINER" ]; then
    err "Container Postgres não encontrado ou não está rodando. Backup abortado."
    exit 1
fi
log "Container Postgres: ${PG_CONTAINER}"

# ── Função de dump de banco ───────────────────────────────────────────────────
dump_db() {
    local DB="$1"
    local FILE="${BACKUP_DIR}/${DB}-${TS}.sql.gz"
    log "Iniciando backup de '${DB}'..."
    if docker exec "$PG_CONTAINER" \
        pg_dump -U postgres -d "$DB" --no-password \
        2>>"$LOG_FILE" \
        | gzip > "$FILE"; then
        SIZE=$(du -sh "$FILE" 2>/dev/null | cut -f1)
        ok "Backup de '${DB}' concluído: ${FILE} (${SIZE})"
    else
        err "Falha no backup de '${DB}'."
        ERRORS=$((ERRORS + 1))
        rm -f "$FILE"
    fi
}

# ── Executa backups ────────────────────────────────────────────────────────────
dump_db "zapmass_db"
dump_db "evolution_db"

# ── Limpa backups antigos (> BACKUP_RETENTION dias) ───────────────────────────
log "Removendo backups com mais de ${BACKUP_RETENTION} dias..."
REMOVED=0
while IFS= read -r -d '' OLD_FILE; do
    rm -f "$OLD_FILE"
    REMOVED=$((REMOVED + 1))
done < <(find "$BACKUP_DIR" -name "*.sql.gz" -mtime "+${BACKUP_RETENTION}" -print0 2>/dev/null)
[ "$REMOVED" -gt 0 ] && ok "Removidos ${REMOVED} backup(s) antigo(s)." || log "Nenhum backup antigo para remover."

# ── Resumo ─────────────────────────────────────────────────────────────────────
echo "" >> "$LOG_FILE"
log "──────────────────────────────────────────"
log "Backups disponíveis em ${BACKUP_DIR}:"
ls -lh "$BACKUP_DIR"/*.sql.gz 2>/dev/null | awk '{print "  " $5 "  " $9}' | tee -a "$LOG_FILE" || true
log "──────────────────────────────────────────"

if [ "$ERRORS" -gt 0 ]; then
    err "Backup concluído COM ${ERRORS} ERRO(S). Verifique o log: ${LOG_FILE}"
    exit 1
else
    ok "Backup concluído com sucesso. Retenção: ${BACKUP_RETENTION} dias."
fi
