#!/usr/bin/env bash
# Repoe o ramo `main` a seguir a `origin/main` (apos deploy por commit o repo fica em detached HEAD
# e `git pull` pede "specify which branch"). Uso: cd /opt/zapmass && bash deployment/ensure-git-main.sh
set -euo pipefail
ROOT="${ROOT:-/opt/zapmass}"
cd "$ROOT"
if ! git rev-parse --git-dir >/dev/null 2>&1; then
  echo "Erro: $ROOT nao e um repositorio git." >&2
  exit 1
fi
git fetch origin
if git show-ref -q --verify refs/remotes/origin/main; then
  git checkout -B main origin/main
  echo "==> Agora em main @ $(git rev-parse --short HEAD) (rastreia origin/main)."
else
  echo "Erro: origin/main nao encontrado. Confira: git remote -v" >&2
  exit 1
fi
