#!/usr/bin/env bash
# Diagnóstico Bate-papo + Campanhas com Evolution Go (VPS).
# Uso: cd /opt/zapmass && bash deployment/check-evolution-go-chat-campaign.sh
set -euo pipefail
ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ROOT"
ENV_FILE="${ENV_FILE:-.env}"

GO_KEY="$(grep -E '^EVOLUTION_GO_KEY=' "$ENV_FILE" 2>/dev/null | tail -1 | cut -d= -f2- | tr -d '\"'"'"'' || true)"
GO_KEY="${GO_KEY:-$(grep -E '^EVOLUTION_API_KEY=' "$ENV_FILE" 2>/dev/null | tail -1 | cut -d= -f2- | tr -d '\"'"'"'' || echo zapmass-secure-key-2026)}"
ENGINE="$(grep -E '^ZAPMASS_WHATSAPP_ENGINE=' "$ENV_FILE" 2>/dev/null | tail -1 | cut -d= -f2- | tr -d '\"'"'"'' || echo evolution-go)"
SKIP_SEND_TEST="${SKIP_SEND_TEST:-0}"
LOG_LINES="${LOG_LINES:-500}"

fail=0
ok() { echo "OK: $*"; }
warn() { echo "AVISO: $*" >&2; }
bad() { echo "ERRO: $*" >&2; fail=1; }
section() { echo ""; echo "==> $*"; }

section "Evolution Go — Bate-papo + Campanhas"
echo "    engine=${ENGINE}"

if [ "$ENGINE" != "evolution-go" ] && [ "$ENGINE" != "go" ]; then
  warn "ZAPMASS_WHATSAPP_ENGINE=${ENGINE} — script pensado para evolution-go"
fi

section "1/5 Infraestrutura (health base)"
bash deployment/check-evolution-go-health.sh || fail=1

section "2/5 Instância Go (token, webhook, chip online)"
INST_JSON="$(curl -sf -H "apikey: ${GO_KEY}" "http://127.0.0.1:8081/instance/all" 2>/dev/null || echo '{}')"
TOKEN="$(echo "$INST_JSON" | grep -oE '"token"[[:space:]]*:[[:space:]]*"[^"]+"' | head -1 | sed 's/.*"\([^"]*\)"$/\1/' || true)"
CONN_NAME="$(echo "$INST_JSON" | grep -oE '"name"[[:space:]]*:[[:space:]]*"[^"]+"' | head -1 | sed 's/.*"\([^"]*\)"$/\1/' || true)"
JID="$(echo "$INST_JSON" | grep -oE '"jid"[[:space:]]*:[[:space:]]*"[^"]+"' | head -1 | sed 's/.*"\([^"]*\)"$/\1/' || true)"
WEBHOOK="$(echo "$INST_JSON" | grep -oE '"webhook"[[:space:]]*:[[:space:]]*"[^"]+"' | head -1 | sed 's/.*"\([^"]*\)"$/\1/' || true)"
CONNECTED="$(echo "$INST_JSON" | grep -oE '"connected"[[:space:]]*:[[:space:]]*true' | head -1 || true)"

echo "    chip: ${CONN_NAME:-?}"
echo "    jid:  ${JID:-?}"
echo "    webhook: ${WEBHOOK:-vazio}"

if [ -n "$CONNECTED" ]; then
  ok "Chip conectado no Go"
else
  bad "Nenhum chip connected=true — campanhas e bate-papo ficam limitados"
fi

if echo "${WEBHOOK:-}" | grep -q 'webhook/evolution'; then
  ok "Webhook apontando para ZapMass"
else
  bad "Webhook não configurado — mensagens não chegam ao bate-papo"
fi

if [ -z "$TOKEN" ]; then
  bad "Token da instância não encontrado em /instance/all"
fi

section "3/5 Pipeline webhook → ZapMass (logs recentes)"
WH_COUNT="$(docker compose logs zapmass --tail "$LOG_LINES" 2>/dev/null | grep -ciE 'MESSAGES_UPSERT|handleWebhookMessage|message-received|Webhook Go aplicado' || true)"
CONN_COUNT="$(docker compose logs zapmass --tail "$LOG_LINES" 2>/dev/null | grep -ciE 'Status atualizado.*ONLINE|CONNECTION_UPDATE' || true)"
WH_FAIL="$(docker compose logs zapmass --tail "$LOG_LINES" 2>/dev/null | grep -ciE 'MESSAGES_UPSERT descartado|ensureGoInstanceWebhook falhou' || true)"

echo "    eventos webhook/chat nos últimos ${LOG_LINES} linhas: ${WH_COUNT:-0}"
echo "    updates conexão: ${CONN_COUNT:-0}"
echo "    falhas webhook/descartes: ${WH_FAIL:-0}"

if [ "${WH_COUNT:-0}" -gt 0 ]; then
  ok "ZapMass processou eventos de chat/webhook recentemente"
elif [ -n "$CONNECTED" ]; then
  warn "Sem eventos de chat nos logs — normal se ninguém mandou mensagem após o deploy; envie um WA de teste"
fi

if [ "${WH_FAIL:-0}" -gt 5 ]; then
  bad "Muitos webhooks descartados/falhas (${WH_FAIL}) — verifique token/ownerUid da instância"
fi

section "4/5 Envio (campanha / sendText via Go)"
if [ "$SKIP_SEND_TEST" = "1" ]; then
  warn "SKIP_SEND_TEST=1 — pulando teste de envio"
elif [ -z "$TOKEN" ] || [ -z "$JID" ]; then
  warn "Sem token/jid — pulando teste send/text"
else
  # Número do próprio chip (antes do :device)
  PHONE="$(echo "$JID" | cut -d: -f1 | cut -d@ -f1 | tr -cd '0-9')"
  if [ -n "$PHONE" ]; then
    SEND_JSON="$(curl -sf -X POST "http://127.0.0.1:8081/send/text" \
      -H "apikey: ${TOKEN}" \
      -H "Content-Type: application/json" \
      -d "{\"number\":\"${PHONE}\",\"text\":\"[ZapMass] teste diagnóstico $(date +%H:%M)\",\"delay\":800}" 2>/dev/null || echo '{"error":"request failed"}')"
    echo "    send/text → ${SEND_JSON}" | head -c 300
    echo ""
    if echo "$SEND_JSON" | grep -qiE '"message"[[:space:]]*:[[:space:]]*"success"|"id"|messageId'; then
      ok "Go aceitou send/text (campanhas usam o mesmo endpoint)"
    elif echo "$SEND_JSON" | grep -qi 'error'; then
      bad "send/text falhou — campanhas também falharão"
    else
      warn "Resposta send/text ambígua — confira manualmente"
    fi
  else
    warn "Não foi possível extrair número do JID para teste"
  fi
fi

section "5/5 Fila de campanhas (BullMQ / Redis)"
if docker compose exec -T redis redis-cli ping 2>/dev/null | grep -q PONG; then
  for q in campaign-messages campaign-messages-delayed; do
    QLEN="$(docker compose exec -T redis redis-cli LLEN "bull:${q}:wait" 2>/dev/null | tr -d '\r' || echo 0)"
    ACTIVE="$(docker compose exec -T redis redis-cli LLEN "bull:${q}:active" 2>/dev/null | tr -d '\r' || echo 0)"
    echo "    fila ${q}: wait=${QLEN:-0} active=${ACTIVE:-0}"
  done
  CAMP_LOG="$(docker compose logs zapmass --tail "$LOG_LINES" 2>/dev/null | grep -ciE 'processCampaignJob|Mensagem aceita|campaign-paused|all_channels_down' || true)"
  echo "    linhas campanha nos logs: ${CAMP_LOG:-0}"
  if [ "${CAMP_LOG:-0}" -gt 0 ]; then
    ok "Worker de campanhas ativo nos logs"
  else
    warn "Nenhuma atividade de campanha recente nos logs (normal se não disparou campanha)"
  fi
  ok "Redis acessível"
else
  warn "Redis indisponível para inspecionar filas"
fi

section "Resumo — o que esperar na UI"
echo "  Bate-papo (Evolution Go):"
echo "    • Conversas entram via WEBHOOK (Message/SendMessage) — não há findChats histórico"
echo "    • Após deploy, inbox começa vazia até chegar mensagem nova ou sync offline do Go"
echo "    • Botão 'Atualizar' full NÃO importa histórico antigo do celular"
echo "  Campanhas:"
echo "    • Disparo usa POST /send/text e /send/media com token do chip"
echo "    • Chip precisa status ONLINE; retome campanhas pausadas manualmente se necessário"
echo ""

if [ "$fail" -eq 0 ]; then
  echo "==> Resultado: Evolution Go OK para bate-papo (webhook) e campanhas (send)"
  exit 0
fi
echo "==> Resultado: corrija os ERROs acima antes de confiar na produção"
exit 1
