#!/usr/bin/env python3
"""Limpa export Google Contacts CSV → CSV pronto para ZapMass."""
from __future__ import annotations

import csv
import re
import sys
from pathlib import Path

NOTES_CITY_RE = re.compile(r"cidade\s*:\s*(.+)", re.I | re.S)


def looks_like_scientific(raw: str) -> bool:
    s = (raw or "").strip()
    return bool(re.search(r"[Ee][+\-]?\d+", s))


def parse_phone(raw: str) -> tuple[str, bool]:
    """Retorna (digits, from_scientific)."""
    s = (raw or "").strip().strip('"').replace(" ", "")
    if not s:
        return "", False
    sci = looks_like_scientific(s)
    if sci:
        try:
            val = float(s.replace(",", "."))
            digits = str(int(round(val)))
            return digits, True
        except Exception:
            return re.sub(r"\D", "", s), True
    return re.sub(r"\D", "", s), False


def normalize_br_phone(digits: str) -> str:
    d = re.sub(r"\D", "", digits or "")
    if not d:
        return ""
    if d.startswith("55") and len(d) >= 12:
        return d[:13] if len(d) > 13 else d
    if len(d) in (10, 11):
        return "55" + d
    if len(d) > 13 and d.startswith("55"):
        return d[:13]
    if len(d) >= 12:
        return ("55" + d.lstrip("0"))[:13]
    return d if len(d) >= 10 else ""


def is_plausible_br_mobile(n: str) -> bool:
    d = re.sub(r"\D", "", n or "")
    if not d.startswith("55"):
        return False
    if len(d) not in (12, 13):
        return False
    # rejeita lixo de notação científica (muitos zeros no fim)
    if d.endswith("0000") or d.endswith("00000"):
        return False
    local = d[4:]  # após 55 + DDD
    if len(d) == 13 and not local.startswith("9"):
        # celular BR com 9 dígitos após DDD costuma começar com 9
        pass
    return True


def from_notes(notes: str) -> tuple[str, str]:
    notes = (notes or "").replace("\r", "\n").strip()
    m = NOTES_CITY_RE.search(notes)
    if not m:
        return "", ""
    rest = m.group(1).strip().split("\n", 1)[0].strip()
    # "CIDADE - NOME"
    parts = re.split(r"\s+-\s+", rest, maxsplit=1)
    if len(parts) == 2 and parts[1].strip(" -"):
        return parts[0].strip(" -"), parts[1].strip(" -")
    # "CIDADE-NOME" (hífen sem espaço) — tenta separar cidade conhecida curta
    m2 = re.match(r"^([A-ZÁÉÍÓÚÂÊÔÃÕÇ ]{3,}?)[-–]([A-Za-zÁÉÍÓÚÂÊÔÃÕÇ].+)$", rest)
    if m2:
        return m2.group(1).strip(" -"), m2.group(2).strip(" -")
    return rest.strip(" -"), ""


def person_name(row: dict, name_from_notes: str) -> str:
    if name_from_notes:
        return re.sub(r"\s+", " ", name_from_notes).strip()
    bits = []
    for k in ("First Name", "Middle Name", "Last Name", "Nickname"):
        v = (row.get(k) or "").strip()
        if not v:
            continue
        if re.fullmatch(r"[\d\W]+", v):
            continue
        if re.fullmatch(r"\d+", v):
            continue
        bits.append(v)
    return re.sub(r"\s+", " ", " ".join(bits)).strip()


def pick_phone(row: dict) -> str:
    scored: list[tuple[int, str]] = []
    for k in ("Phone 1 - Value", "Phone 2 - Value", "First Name", "Last Name"):
        raw = row.get(k) or ""
        digits, from_sci = parse_phone(raw)
        if len(digits) < 10:
            continue
        n = normalize_br_phone(digits)
        if not n or not is_plausible_br_mobile(n):
            continue
        score = 20
        if from_sci:
            score -= 15  # preferir texto puro
        if k.startswith("Phone"):
            score += 2
        if k == "First Name" and re.fullmatch(r"\d+", (raw or "").strip()):
            score += 8  # telefone colado no primeiro nome (comum neste arquivo)
        if len(n) == 13:
            score += 3
        scored.append((score, n))
    if not scored:
        return ""
    scored.sort(key=lambda x: (-x[0], -len(x[1])))
    return scored[0][1]


def phone_key(n: str) -> str:
    d = re.sub(r"\D", "", n)
    if d.startswith("55") and len(d) == 13 and d[4] == "9":
        # 55+DDD+9XXXXXXXX → também considera sem o 9
        return d
    return d


def main() -> int:
    src = Path(sys.argv[1] if len(sys.argv) > 1 else r"C:\Users\xgame\Downloads\contacts.csv")
    out = Path(
        sys.argv[2]
        if len(sys.argv) > 2
        else str(Path.home() / "OneDrive" / "Desktop" / "zapmass_deputado_marcos_da_rosa.csv")
    )
    list_name = sys.argv[3] if len(sys.argv) > 3 else "Deputado Marcos da Rosa"

    with src.open(encoding="utf-8-sig", newline="") as f:
        rows = list(csv.DictReader(f))

    seen: set[str] = set()
    out_rows: list[dict] = []
    skipped_phone = 0
    skipped_dup = 0
    skipped_sci = 0

    for row in rows:
        phone = pick_phone(row)
        if not phone:
            # conta quantos eram só científicos inviáveis
            raws = [(row.get("Phone 1 - Value") or ""), (row.get("Phone 2 - Value") or "")]
            if any(looks_like_scientific(x) for x in raws) and not any(
                re.fullmatch(r"\d{10,13}", (row.get("First Name") or "").strip()) for _ in [0]
            ):
                skipped_sci += 1
            skipped_phone += 1
            continue
        key = phone_key(phone)
        if key in seen:
            skipped_dup += 1
            continue
        seen.add(key)

        city, name_notes = from_notes(row.get("Notes") or "")
        name = person_name(row, name_notes) or "Sem Nome"
        city = re.sub(r"\s+", " ", city).strip(" -")

        out_rows.append(
            {
                "nome": name,
                "telefone": phone,
                "cidade": city,
                "tags": "Importado;Deputado Marcos da Rosa",
                "notas": f"Lista: {list_name}",
            }
        )

    out.parent.mkdir(parents=True, exist_ok=True)
    with out.open("w", encoding="utf-8-sig", newline="") as f:
        w = csv.DictWriter(f, fieldnames=["nome", "telefone", "cidade", "tags", "notas"])
        w.writeheader()
        w.writerows(out_rows)

    print(f"source_rows={len(rows)}")
    print(f"exported={len(out_rows)}")
    print(f"skipped_phone={skipped_phone}")
    print(f"skipped_sci_garbage={skipped_sci}")
    print(f"skipped_dup={skipped_dup}")
    print(f"out={out}")
    for i in range(min(5, len(out_rows))):
        print(f"sample{i+1}=", out_rows[i])
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
