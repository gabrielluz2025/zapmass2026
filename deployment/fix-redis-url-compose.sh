#!/usr/bin/env bash
# Corrige REDIS_URL legado do Swarm (host.docker.internal) para Docker Compose.
# Uso: cd /opt/zapmass && bash deployment/fix-redis-url-compose.sh
set -euo pipefail
cd /opt/zapmass

chmod +x deployment/fix-redis-url-all.sh
bash deployment/fix-redis-url-all.sh
