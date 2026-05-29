#!/usr/bin/env bash
# limpar-disco-vps.sh — limpeza segura de disco na VPS
# O que REMOVE: imagens Docker sem uso, cache de build, containers parados,
#                logs de containers, journal do sistema, cache apt, tmp antigo
# O que PRESERVA: volumes Docker (dados), containers em execucao, codigo em /opt/zapmass

set -euo pipefail

RED='\033[0;31m'; GREEN='\033[0;32m'; YELLOW='\033[1;33m'; CYAN='\033[0;36m'; NC='\033[0m'

log()  { echo -e "${CYAN}[limpar]${NC} $*"; }
ok()   { echo -e "${GREEN}[ok]${NC}    $*"; }
warn() { echo -e "${YELLOW}[aviso]${NC} $*"; }

disco_livre() {
  df -h / | awk 'NR==2{print $4}'
}

echo ""
echo -e "${CYAN}============================================${NC}"
echo -e "${CYAN}   LIMPEZA SEGURA DE DISCO — VPS ZapMass   ${NC}"
echo -e "${CYAN}============================================${NC}"
echo ""
log "Espaço livre ANTES: $(disco_livre)"
echo ""

# ─── 1. Containers parados ────────────────────────────────────────────────────
log "1/7 Removendo containers parados..."
STOPPED=$(docker ps -aq --filter status=exited --filter status=dead 2>/dev/null | wc -l)
if [ "$STOPPED" -gt 0 ]; then
  docker rm $(docker ps -aq --filter status=exited --filter status=dead) 2>/dev/null || true
  ok "  $STOPPED container(s) removido(s)"
else
  ok "  Nenhum container parado"
fi

# ─── 2. Imagens sem uso (dangling = sem tag) ─────────────────────────────────
log "2/7 Removendo imagens sem tag (dangling)..."
DANGLING=$(docker images -f dangling=true -q 2>/dev/null | wc -l)
if [ "$DANGLING" -gt 0 ]; then
  docker rmi $(docker images -f dangling=true -q) 2>/dev/null || true
  ok "  $DANGLING imagem(ns) dangling removida(s)"
else
  ok "  Nenhuma imagem dangling"
fi

# ─── 3. Imagens antigas do zapmass (mantém só a mais recente) ─────────────────
log "3/7 Removendo versões antigas da imagem zapmass..."
# Lista IDs de imagens zapmass, pulando a mais recente (head -1 = mais nova)
OLD_ZAPMASS=$(docker images zapmass --format "{{.ID}}" 2>/dev/null | tail -n +2)
if [ -n "$OLD_ZAPMASS" ]; then
  echo "$OLD_ZAPMASS" | xargs docker rmi -f 2>/dev/null || true
  ok "  Imagens antigas zapmass removidas"
else
  ok "  Só 1 versão da imagem zapmass (nada a remover)"
fi

# ─── 4. Cache de build Docker ────────────────────────────────────────────────
log "4/7 Limpando cache de build Docker (pode ser grande!)..."
CACHE_SIZE=$(docker system df --format "{{.BuildCache}}" 2>/dev/null | head -1 || echo "?")
docker builder prune -af 2>/dev/null || true
ok "  Cache de build limpo (era: $CACHE_SIZE)"

# ─── 5. Redes Docker não utilizadas ─────────────────────────────────────────
log "5/7 Removendo redes Docker não utilizadas..."
docker network prune -f 2>/dev/null || true
ok "  Redes sem uso removidas"

# ─── 6. Logs de containers (truncar arquivos > 50 MB) ────────────────────────
log "6/7 Truncando logs grandes de containers..."
LOGS_CLEANED=0
while IFS= read -r logfile; do
  SIZE=$(stat -c%s "$logfile" 2>/dev/null || echo 0)
  if [ "$SIZE" -gt 52428800 ]; then  # > 50 MB
    NOME=$(basename "$(dirname "$logfile")")
    warn "  Truncando $NOME ($(numfmt --to=iec "$SIZE"))"
    truncate -s 0 "$logfile"
    LOGS_CLEANED=$((LOGS_CLEANED + 1))
  fi
done < <(find /var/lib/docker/containers -name "*.log" 2>/dev/null)
if [ "$LOGS_CLEANED" -gt 0 ]; then
  ok "  $LOGS_CLEANED arquivo(s) de log truncado(s)"
else
  ok "  Nenhum log grande encontrado"
fi

# ─── 7. Limpeza do sistema ───────────────────────────────────────────────────
log "7/7 Limpeza do sistema operacional..."

# Journal do systemd — mantém só últimos 3 dias / máx 200 MB
if command -v journalctl &>/dev/null; then
  journalctl --vacuum-time=3d --vacuum-size=200M 2>/dev/null || true
  ok "  Journal systemd compactado"
fi

# Cache APT
if command -v apt-get &>/dev/null; then
  apt-get clean -qq 2>/dev/null || true
  apt-get autoremove -y -qq 2>/dev/null || true
  ok "  Cache apt limpo"
fi

# Arquivos temporários antigos (> 7 dias)
find /tmp -maxdepth 1 -mtime +7 -exec rm -rf {} + 2>/dev/null || true
find /var/tmp -maxdepth 1 -mtime +7 -exec rm -rf {} + 2>/dev/null || true
ok "  Arquivos /tmp antigos removidos"

# Thumbnails e caches de usuário (root)
rm -rf /root/.cache/pip 2>/dev/null || true
rm -rf /root/.cache/npm 2>/dev/null || true
ok "  Cache pip/npm de root removido"

echo ""
echo -e "${GREEN}============================================${NC}"
echo -e "${GREEN}   LIMPEZA CONCLUÍDA                        ${NC}"
echo -e "${GREEN}============================================${NC}"
log "Espaço livre DEPOIS: $(disco_livre)"
echo ""
log "Para ver o que ainda ocupa mais espaço:"
echo "  docker system df"
echo "  du -sh /var/lib/docker/volumes/*"
echo "  du -sh /opt/zapmass"
echo ""
