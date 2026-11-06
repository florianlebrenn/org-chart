"""Confidentialité : les colonnes non retenues ne sont ni importées, ni conservées, ni renvoyées.

Le fichier fictif `collaborateurs_avec_colonnes_sensibles.xlsx` contient des colonnes RH en trop
(matricule, date de naissance, salaire, n° de sécurité sociale, commentaire) dont toutes les valeurs
commencent par « CONFIDENTIEL ». Aucune de ces valeurs ne doit apparaître nulle part.
"""

from pathlib import Path

import main
from helpers import SAMPLES, TEST_PASSWORD

FILE = SAMPLES / "collaborateurs_avec_colonnes_sensibles.xlsx"
SECRET = "CONFIDENTIEL"
SENSITIVE_HEADERS = [
    "Matricule",
    "Date de naissance",
    "Salaire brut annuel",
    "N° de sécurité sociale",
    "Commentaire RH",
]


def upload(client):
    with open(FILE, "rb") as f:
        r = client.post("/api/import", files={"file": (FILE.name, f)})
    assert r.status_code == 200
    return r.json()


def test_upload_returns_no_cell_value(client):
    up = upload(client)
    assert SECRET not in str(up)
    assert "preview" not in up["sheets"][0]
    # les colonnes sensibles ne sont proposées pour aucun champ
    assert set(up["sheets"][0]["suggested_mapping"]) == {"first_name", "last_name", "title", "site", "email", "phone"}


def test_preview_only_shows_retained_columns(client):
    up = upload(client)
    mapping = up["sheets"][0]["suggested_mapping"]
    r = client.post("/api/import/preview", json={"token": up["token"], "mapping": mapping}).json()
    assert SECRET not in str(r["rows"]) and SECRET not in str(r["columns"])
    assert [c["field"] for c in r["columns"]] == ["first_name", "last_name", "title", "site", "email", "phone"]
    assert all(len(row) == 6 for row in r["rows"])
    assert r["ignored_headers"] == SENSITIVE_HEADERS
    # un champ inconnu (« salaire ») est ignoré, même s'il pointe vers une vraie colonne
    r = client.post(
        "/api/import/preview", json={"token": up["token"], "mapping": {**mapping, "salary": 6, "x": 7}}
    ).json()
    assert SECRET not in str(r)


def test_nothing_sensitive_is_stored_anywhere(client, tmp_path):
    up = upload(client)
    mapping = up["sheets"][0]["suggested_mapping"]
    body = {"token": up["token"], "mapping": {**mapping, "salary": 6, "notes": 10}}
    dry = client.post("/api/import/confirm", json={**body, "dry_run": True}).json()
    assert SECRET not in str(dry)
    res = client.post("/api/import/confirm", json={**body, "dry_run": False}).json()
    assert res["applied"] and res["total"] == 48 and SECRET not in str(res)

    # tout ce que l'API peut renvoyer
    for url in ("/api/employees", "/api/org", "/api/sites", "/api/import/last", "/api/export/mermaid"):
        assert SECRET not in client.get(url).text, url
    doc = client.post("/api/backup", json={"password": TEST_PASSWORD}).json()
    import crypto

    backup = crypto.decrypt_backup(doc, TEST_PASSWORD)
    assert SECRET not in str(backup)
    assert SECRET.encode() not in client.get("/api/export/pdf").content
    # le mapping mémorisé ne retient que les en-têtes des colonnes utilisées
    saved = str(backup["settings"]["import_mapping"])
    assert not any(h in saved for h in SENSITIVE_HEADERS)

    # rien sur le disque : base SQLite et tout fichier du dossier de données
    data_dir = Path(main.db.db_path()).parent
    for f in data_dir.rglob("*"):
        if f.is_file():
            assert SECRET.encode() not in f.read_bytes(), f
    assert not (data_dir / "imports").exists()

    # le fichier complet est oublié après la confirmation
    r = client.post("/api/import/preview", json=body)
    assert r.status_code == 404


def test_schema_has_only_known_columns(client):
    with main.db.connect() as conn:
        cols = {r["name"] for r in conn.execute("PRAGMA table_info(employees)")}
    assert cols == {"id", "name", "name_key", "title", "email", "phone", "photo", "site_id", "manager_id", "sort_order"}


def test_cancel_forgets_file(client):
    up = upload(client)
    assert client.delete(f"/api/import/{up['token']}").json() == {"status": "ok"}
    r = client.post("/api/import/preview", json={"token": up["token"], "mapping": {"name": 1}})
    assert r.status_code == 404


def test_pending_imports_are_bounded_and_expire(monkeypatch):
    p = main.PendingImports()
    tokens = [p.put({"filename": "f", "sheets": []}) for _ in range(main.MAX_PENDING + 3)]
    assert len(p) == main.MAX_PENDING
    monkeypatch.setattr(main.time, "time", lambda: 10**12)
    p.put({"filename": "g", "sheets": []})
    assert len(p) == 1 and tokens
