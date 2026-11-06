"""Fonctions d'aide communes aux tests."""

import io
from pathlib import Path

from openpyxl import Workbook

SAMPLES = Path(__file__).resolve().parents[2] / "tools" / "sample-data"
TEST_PASSWORD = "mot de passe de test 2026"


def upload(client, path: Path):
    with open(path, "rb") as f:
        r = client.post("/api/import", files={"file": (path.name, f)})
    assert r.status_code == 200, r.text
    return r.json()


def confirm(client, up, mapping=None, sheet=0, dry_run=False):
    mapping = mapping if mapping is not None else up["sheets"][sheet]["suggested_mapping"]
    r = client.post(
        "/api/import/confirm",
        json={
            "token": up["token"],
            "sheet": sheet,
            "mapping": mapping,
            "dry_run": dry_run,
        },
    )
    assert r.status_code == 200, r.text
    return r.json()


def employees(client):
    return {e["name"]: e for e in client.get("/api/employees").json()}


def xlsx_bytes(rows):
    wb = Workbook()
    for r in rows:
        wb.active.append(r)
    buf = io.BytesIO()
    wb.save(buf)
    return buf.getvalue()
