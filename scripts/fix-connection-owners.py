#!/usr/bin/env python3
"""
Corrige ownerUid errado em connections_settings.json (VPS Plano B).
Resolve nomes Unicode estilizados (ex.: 𝙿𝚊𝚝𝚛í𝚌𝚒𝚊 → patricia).

Uso:
  python3 scripts/fix-connection-owners.py /opt/zapmass/clientes/demo/data
  python3 scripts/fix-connection-owners.py /opt/zapmass/clientes/demo/data --apply
"""
from __future__ import annotations

import json
import re
import shutil
import subprocess
import sys
import unicodedata
from datetime import datetime, timezone
from pathlib import Path


def normalize_label(value: str) -> str:
    s = unicodedata.normalize("NFKC", value or "")
    s = unicodedata.normalize("NFD", s)
    s = "".join(c for c in s if unicodedata.category(c) != "Mn")
    s = re.sub(r"[^\w\s@._-]", " ", s, flags=re.UNICODE)
    s = re.sub(r"\s+", " ", s).strip().lower()
    return s


def score_user(email: str, display: str, label: str) -> int:
    lab = normalize_label(label)
    if not lab:
        return 0
    email_l = email.lower()
    disp = normalize_label(display or "")
    local = normalize_label(email_l.split("@", 1)[0])

    score = 0
    if len(disp) >= 3 and disp in lab:
        score += 80
    first = disp.split(" ", 1)[0] if disp else ""
    if len(first) >= 3 and first in lab:
        score += 45
    if len(local) >= 4 and local in lab:
        score += 50
    if re.search(r"patr[ií]cia|marcondes", lab) and "paty.contact" in email_l:
        score += 120
    if re.search(r"sylvester|stallone", lab) and "sylvesterstallone" in email_l:
        score += 120
    if re.fullmatch(r"gabriel", lab.strip()) and "festaimportgabriel" in email_l:
        score += 100
    if re.fullmatch(r"zap-?mass", lab.strip()) and "festaimportgabriel" in email_l:
        score += 90
    if re.search(r"jeisi|marchiore", lab) and "festaimportgabriel" in email_l:
        score += 90
    return score


def load_users() -> list[dict]:
    cmd = [
        "docker",
        "exec",
        "zapmass-postgres-1",
        "psql",
        "-U",
        "postgres",
        "-d",
        "zapmass_db",
        "-tAc",
        "SELECT id::text || '|' || email || '|' || COALESCE(display_name,'') FROM zapmass.users WHERE disabled_at IS NULL ORDER BY email;",
    ]
    out = subprocess.check_output(cmd, text=True, stderr=subprocess.STDOUT)
    users = []
    for line in out.strip().splitlines():
        parts = line.split("|", 2)
        if len(parts) != 3:
            continue
        users.append({"id": parts[0].strip(), "email": parts[1].strip(), "display": parts[2].strip()})
    return users


def best_owner(label: str, users: list[dict]) -> tuple[dict | None, int]:
    best_u = None
    best_s = 0
    for u in users:
        s = score_user(u["email"], u["display"], label)
        if s > best_s:
            best_s = s
            best_u = u
    if not best_u or best_s < 50:
        return None, 0
    return best_u, best_s


def is_orphan_offline(conn_id: str, label: str) -> bool:
    return label == conn_id and re.fullmatch(r"conn_\d+_\d+", conn_id or "") is not None


def main() -> int:
    if len(sys.argv) < 2:
        print("Uso: fix-connection-owners.py <data_dir> [--apply]", file=sys.stderr)
        return 1

    data_dir = Path(sys.argv[1]).resolve()
    apply = "--apply" in sys.argv[2:]
    settings_file = data_dir / "connections_settings.json"
    if not settings_file.is_file():
        print(f"Nao encontrado: {settings_file}", file=sys.stderr)
        return 1

    users = load_users()
    if not users:
        print("Nenhum utilizador no Postgres.", file=sys.stderr)
        return 1

    settings = json.loads(settings_file.read_text(encoding="utf-8"))
    actions: list[str] = []

    for conn_id, row in sorted(settings.items()):
        if not isinstance(row, dict):
            continue
        label = str(row.get("friendlyName") or conn_id).strip()
        current = str(row.get("ownerUid") or "").strip()
        owner_u, score = best_owner(label, users)

        if owner_u and current and current == owner_u["id"]:
            continue

        if owner_u:
            current_u = next((u for u in users if u["id"] == current), None)
            current_score = score_user(current_u["email"], current_u["display"], label) if current_u else 0
            if current_score >= score:
                continue
            actions.append(
                f"ATRIBUIR {conn_id}\n"
                f"  label: {label!r} -> {normalize_label(label)!r}\n"
                f"  {current or '(sem)'} -> {owner_u['id']} ({owner_u['email']}) score={score}"
            )
            if apply:
                row["ownerUid"] = owner_u["id"]
                row["createdByUid"] = owner_u["id"]
                if label != conn_id:
                    row["friendlyName"] = label
                settings[conn_id] = row
            continue

        if is_orphan_offline(conn_id, label):
            actions.append(f"REMOVER {conn_id} (orfao offline)")
            if apply:
                del settings[conn_id]

    mode = "APLICAR" if apply else "simulacao"
    print(f"\n=== fix-connection-owners ({mode}) ===\n")
    if not actions:
        print("Nada a alterar.")
        return 0

    for a in actions:
        print(a)
        print()

    if not apply:
        print("Use --apply para gravar.")
        return 0

    stamp = datetime.now(timezone.utc).strftime("%Y%m%dT%H%M%SZ")
    backup = settings_file.with_suffix(settings_file.suffix + f".{stamp}.bak")
    shutil.copy2(settings_file, backup)
    settings_file.write_text(json.dumps(settings, indent=2, ensure_ascii=False) + "\n", encoding="utf-8")
    print(f"Backup: {backup}")
    print(f"Gravado: {settings_file}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
