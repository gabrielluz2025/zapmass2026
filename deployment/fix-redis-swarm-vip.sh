#!/usr/bin/env bash
# Recupera Redis no Docker Swarm quando overlay VIP/tasks.* retorna EHOSTUNREACH.
# Publica Redis no host :6379 e aponta serviços para host.docker.internal (ver docker-stack.yml).
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
cd "$ROOT"

echo "==> fix-redis-swarm-vip: redeploy stack com Redis no host"
chmod +x deployment/vps-deploy.sh
exec bash deployment/vps-deploy.sh
