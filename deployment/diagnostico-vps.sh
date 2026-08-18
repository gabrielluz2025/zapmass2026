#!/bin/bash
# Script de diagnóstico do ZapMass na VPS
# Uso: bash deployment/diagnostico-vps.sh

set -e

echo "=========================================="
echo "🔍 RAIO-X DO SISTEMA ZAPMASS"
echo "=========================================="
echo ""

echo "📅 Data/Hora: $(date)"
echo "🖥️  Hostname: $(hostname)"
echo "🌐 IP: $(curl -s ifconfig.me || echo 'N/A')"
echo ""

echo "=========================================="
echo "🐳 DOCKER CONTAINERS"
echo "=========================================="
docker ps -a --format "table {{.Names}}\t{{.Status}}\t{{.Ports}}" 2>/dev/null || echo "Docker não disponível"
echo ""

echo "=========================================="
echo "💾 USO DE DISCO"
echo "=========================================="
df -h
echo ""

echo "=========================================="
echo "🧠 USO DE MEMÓRIA E CPU"
echo "=========================================="
free -h
echo ""
echo "Load average:"
uptime
echo ""

echo "=========================================="
echo "📊 STATUS DOS SERVIÇOS ZAPMASS"
echo "=========================================="
if docker ps &>/dev/null; then
    echo "--- Evolution API ---"
    docker logs evolution 2>&1 | tail -20 || echo "Container evolution não encontrado"
    echo ""
    echo "--- ZapMass Server ---"
    docker logs zapmass 2>&1 | tail -30 || echo "Container zapmass não encontrado"
    echo ""
    echo "--- Redis ---"
    docker logs redis 2>&1 | tail -10 || echo "Container redis não encontrado"
    echo ""
    echo "--- PostgreSQL ---"
    docker logs postgres 2>&1 | tail -10 || echo "Container postgres não encontrado"
else
    echo "Docker não está rodando"
fi
echo ""

echo "=========================================="
echo "🔗 CONEXÕES WHATSAPP"
echo "=========================================="
if docker ps | grep -q zapmass; then
    docker exec zapmass sh -c "node -e \"
    const fs = require('fs');
    const dataDir = '/app/data';
    try {
      if (fs.existsSync(dataDir)) {
        const files = fs.readdirSync(dataDir).filter(f => f.startsWith('wwebjs_auth') || f.startsWith('evolution'));
        console.log('Sessões encontradas:', files.length);
        files.forEach(f => console.log('  -', f));
      } else {
        console.log('Diretório data não encontrado');
      }
    } catch(e) {
      console.log('Erro ao listar sessões:', e.message);
    }
    \"" 2>/dev/null || echo "Não foi possível verificar sessões"
else
    echo "Container zapmass não está rodando"
fi
echo ""

echo "=========================================="
echo "📝 ÚLTIMOS ERROS NOS LOGS"
echo "=========================================="
if docker ps | grep -q zapmass; then
    echo "--- Erros no ZapMass ---"
    docker logs zapmass 2>&1 | grep -i "error\|erro\|falhou\|failed" | tail -10 || echo "Nenhum erro encontrado"
else
    echo "Container zapmass não está rodando"
fi
echo ""

echo "=========================================="
echo "🌐 STATUS DA EVOLUTION API"
echo "=========================================="
if command -v curl &>/dev/null; then
    EVO_URL="${EVOLUTION_API_URL:-http://localhost:8080}"
    echo "Tentando conectar em: $EVO_URL"
    curl -s "$EVO_URL" 2>&1 | head -5 || echo "Evolution API não responde"
else
    echo "curl não disponível"
fi
echo ""

echo "=========================================="
echo "✅ DIAGNÓSTICO CONCLUÍDO"
echo "=========================================="
