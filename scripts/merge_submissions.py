#!/usr/bin/env python3
"""
Merge flow del administrador. (Spec 8)

Parsea emails con bloques POOL_SUBMISSION_V1 ... END_POOL_SUBMISSION, valida
contra el catalogo oficial, aplica la politica de duplicados y deadline, y
genera participants.json. Las submissions malformadas se mueven a rejected/.

Uso:
    python merge_submissions.py --inbox ./emails/ \\
        --catalog ../public/data/catalog.json \\
        --out ../public/data/participants.json

El administrador revisa el diff resultante y hace commit. GitHub Pages publica.
"""

from __future__ import annotations

import argparse
import json
import re
import shutil
from datetime import datetime, timezone
from pathlib import Path

BEGIN = "POOL_SUBMISSION_V1"
END = "END_POOL_SUBMISSION"
NAME_RE = re.compile(r"^[a-zA-Z0-9_\-]+$")
BLOCK_RE = re.compile(rf"{BEGIN}\s*\n(.*?)\n\s*{END}", re.DOTALL)


def parse_block(body: str) -> dict | None:
    """Extrae el primer bloque valido del cuerpo del email. None si no hay."""
    m = BLOCK_RE.search(body)
    if not m:
        return None
    nickname, pool_name, submitted_at = None, None, None
    predictions: list[str] = []
    in_predictions = False
    for raw in m.group(1).splitlines():
        line = raw.rstrip()
        if line.startswith("nickname:"):
            nickname = line.split(":", 1)[1].strip()
        elif line.startswith("pool_name:"):
            pool_name = line.split(":", 1)[1].strip()
        elif line.startswith("submitted_at:"):
            submitted_at = line.split(":", 1)[1].strip()
        elif line.strip() == "predictions:":
            in_predictions = True
        elif in_predictions and line.strip().startswith("-"):
            predictions.append(line.strip()[1:].strip())
    return {
        "nickname": nickname,
        "pool_name": pool_name or None,
        "submitted_at": submitted_at,
        "predictions": predictions,
    }


def validate(sub: dict, valid_ids: set[str]) -> list[str]:
    """Reglas de validacion del cliente, re-aplicadas en el servidor. (Spec 5.2)"""
    errors: list[str] = []
    nick = sub.get("nickname") or ""
    if not (2 <= len(nick) <= 30) or not NAME_RE.match(nick):
        errors.append("nickname invalido")
    pool = sub.get("pool_name")
    if pool and (len(pool) > 40 or not NAME_RE.match(pool)):
        errors.append("pool_name invalido")
    preds = sub.get("predictions") or []
    if not preds:
        errors.append("sin predicciones")
    unknown = [p for p in preds if p not in valid_ids]
    if unknown:
        errors.append(f"IDs desconocidos: {unknown}")
    return errors


def is_after_deadline(submitted_at: str | None, closes_at: str) -> bool:
    """True si la submission llega tras el cierre. (Spec 5.4)

    NOTA: submitted_at es generado por el cliente y NO es autoritativo. (Spec 5.2)
    El admin debe basar el rechazo definitivo en la fecha de recepcion real del
    email; aqui se usa submitted_at como verificacion informativa.
    """
    if not submitted_at:
        return False
    try:
        ts = datetime.fromisoformat(submitted_at)
        deadline = datetime.fromisoformat(closes_at)
        return ts > deadline
    except ValueError:
        return False


def reject(path: Path, rejected_dir: Path, reason: str) -> None:
    rejected_dir.mkdir(parents=True, exist_ok=True)
    shutil.move(str(path), str(rejected_dir / path.name))
    with (rejected_dir / "rejected.log").open("a", encoding="utf-8") as log:
        log.write(f"{datetime.now(timezone.utc).isoformat()}\t{path.name}\t{reason}\n")


def main() -> None:
    ap = argparse.ArgumentParser(description="Merge de submissions POOL_SUBMISSION_V1.")
    ap.add_argument("--inbox", required=True, type=Path)
    ap.add_argument("--catalog", default=Path("../data/catalog.json"), type=Path)
    ap.add_argument("--out", default=Path("../data/participants.json"), type=Path)
    args = ap.parse_args()

    catalog = json.loads(args.catalog.read_text(encoding="utf-8"))
    valid_ids = {o["id"] for o in catalog["options"]}
    closes_at = catalog["closes_at"]
    rejected_dir = args.inbox / "rejected"

    # Politica de duplicados: clave (nickname, pool_name); el primero valido gana. (Spec 8)
    merged: dict[tuple[str, str | None], dict] = {}

    emails = sorted(p for p in args.inbox.glob("*.eml")) + sorted(
        p for p in args.inbox.glob("*.txt")
    )
    for path in emails:
        body = path.read_text(encoding="utf-8", errors="replace")
        sub = parse_block(body)
        if sub is None:
            reject(path, rejected_dir, "sin bloque POOL_SUBMISSION_V1")
            continue
        errors = validate(sub, valid_ids)
        if errors:
            reject(path, rejected_dir, "; ".join(errors))
            continue
        if is_after_deadline(sub["submitted_at"], closes_at):
            reject(path, rejected_dir, "fuera de plazo (submitted_at > closes_at)")
            continue
        key = (sub["nickname"], sub["pool_name"])
        if key in merged:
            reject(path, rejected_dir, "duplicado (gana la primera submission valida)")
            continue
        merged[key] = sub

    out = {
        "generated_at": datetime.now(timezone.utc).isoformat(),
        "participants": list(merged.values()),
    }
    args.out.write_text(json.dumps(out, indent=2, ensure_ascii=False) + "\n", encoding="utf-8")
    print(f"{len(merged)} participantes -> {args.out}")
    print("Revisa el diff y haz commit. GitHub Pages publicara automaticamente.")


if __name__ == "__main__":
    main()
