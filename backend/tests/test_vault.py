"""Coffre : mot de passe obligatoire, sessions, verrouillage, clé de secours, chiffrement au repos."""

import io
import json
import sqlite3
import time
import zipfile

import crypto
import db
import main
import pytest
import vault
from helpers import SAMPLES, TEST_PASSWORD, confirm, upload

NEW_PASSWORD = "un tout autre mot de passe"


def test_real_kdf_parameters():
    assert crypto.ITERATIONS == 600_000 and crypto.KDF_NAME == "PBKDF2-SHA256"


def test_first_launch_requires_a_password(raw_client):
    assert raw_client.get("/api/vault/status").json()["state"] == "setup"
    assert raw_client.get("/api/employees").json() == {"detail": "Application verrouillée.", "locked": True}
    assert raw_client.get("/api/health").json() == {"status": "ok", "vault": "setup"}
    r = raw_client.post("/api/vault/setup", json={"password": "court"})
    assert r.status_code == 400 and "12 caractères" in r.json()["detail"]
    assert raw_client.post("/api/vault/setup", json={"password": "aaaaaaaaaaaaaaaa"}).status_code == 400

    r = raw_client.post("/api/vault/setup", json={"password": TEST_PASSWORD})
    assert r.status_code == 200
    rk = r.json()["recovery_key"]
    assert len(rk) == 39 and rk.count("-") == 7
    cookie = r.headers["set-cookie"].lower()
    assert "httponly" in cookie and "samesite=strict" in cookie and "path=/api" in cookie
    assert raw_client.get("/api/vault/status").json()["state"] == "unlocked"
    assert raw_client.post("/api/vault/setup", json={"password": TEST_PASSWORD}).status_code == 409


def test_lock_unlock_and_wrong_password(client):
    assert client.get("/api/employees").status_code == 200
    assert client.post("/api/vault/lock").json() == {"state": "locked"}
    assert vault.STATE.cipher is None
    assert client.get("/api/employees").status_code == 401
    assert client.get("/api/health").json() == {"status": "ok", "vault": "locked"}  # aucun chiffre divulgué
    r = client.post("/api/vault/unlock", json={"password": "mauvais mot de passe"})
    assert r.status_code == 401 and "incorrect" in r.json()["detail"]
    assert client.post("/api/vault/unlock", json={"password": TEST_PASSWORD}).status_code == 200
    assert client.get("/api/employees").status_code == 200


def test_brute_force_is_throttled(client):
    client.post("/api/vault/lock")
    for _ in range(vault.MAX_FAILURES_FREE + 1):
        client.post("/api/vault/unlock", json={"password": "essai"})
    r = client.post("/api/vault/unlock", json={"password": TEST_PASSWORD})
    assert r.status_code == 429 and "réessayez" in r.json()["detail"]


def test_idle_timeout_forgets_the_key(client, monkeypatch):
    assert client.get("/api/employees").status_code == 200
    future = time.time() + vault.IDLE_TIMEOUT + 5
    monkeypatch.setattr(vault.time, "time", lambda: future)
    vault.purge()
    assert vault.STATE.cipher is None
    assert client.get("/api/employees").status_code == 401


def test_lock_forgets_pending_imports(client):
    up = upload(client, SAMPLES / "collaborateurs_sans_superieur.xlsx")
    assert len(main.PENDING) == 1
    client.post("/api/vault/lock")
    assert len(main.PENDING) == 0
    client.post("/api/vault/unlock", json={"password": TEST_PASSWORD})
    assert client.post("/api/import/preview", json={"token": up["token"], "mapping": {"name": 0}}).status_code == 404


def test_recovery_key_resets_password(raw_client):
    rk = raw_client.post("/api/vault/setup", json={"password": TEST_PASSWORD}).json()["recovery_key"]
    confirm(raw_client, upload(raw_client, SAMPLES / "collaborateurs_avec_superieur.xlsx"))
    raw_client.post("/api/vault/lock")
    bad = raw_client.post(
        "/api/vault/recover",
        json={"recovery_key": "0000-0000-0000-0000-0000-0000-0000-0000", "new_password": NEW_PASSWORD},
    )
    assert bad.status_code == 401
    vault.STATE.failures = 0
    vault.STATE.retry_at = 0
    r = raw_client.post(
        "/api/vault/recover", json={"recovery_key": rk.lower().replace("-", " "), "new_password": NEW_PASSWORD}
    )
    assert r.status_code == 200
    new_rk = r.json()["recovery_key"]
    assert new_rk != rk
    assert raw_client.get("/api/health").json()["employees"] == 48  # données intactes
    raw_client.post("/api/vault/lock")
    assert raw_client.post("/api/vault/unlock", json={"password": TEST_PASSWORD}).status_code == 401
    assert raw_client.post("/api/vault/unlock", json={"password": NEW_PASSWORD}).status_code == 200
    raw_client.post("/api/vault/lock")
    vault.STATE.failures = 0
    vault.STATE.retry_at = 0
    old = raw_client.post("/api/vault/recover", json={"recovery_key": rk, "new_password": NEW_PASSWORD})
    assert old.status_code == 401  # l'ancienne clé de secours ne fonctionne plus


def test_change_password_and_new_recovery_key(client):
    assert (
        client.post(
            "/api/vault/password", json={"current_password": "faux faux faux", "new_password": NEW_PASSWORD}
        ).status_code
        == 401
    )
    assert (
        client.post(
            "/api/vault/password", json={"current_password": TEST_PASSWORD, "new_password": "court"}
        ).status_code
        == 400
    )
    assert client.post(
        "/api/vault/password", json={"current_password": TEST_PASSWORD, "new_password": NEW_PASSWORD}
    ).json() == {"status": "ok"}
    rk = client.post("/api/vault/recovery-key", json={"password": NEW_PASSWORD}).json()["recovery_key"]
    assert crypto.normalize_recovery_key(rk) == rk
    client.post("/api/vault/lock")
    assert client.post("/api/vault/unlock", json={"password": NEW_PASSWORD}).status_code == 200
    # changer de mot de passe exige une session ouverte
    client.post("/api/vault/lock")
    assert (
        client.post(
            "/api/vault/password", json={"current_password": NEW_PASSWORD, "new_password": TEST_PASSWORD}
        ).status_code
        == 401
    )


def _db_bytes() -> bytes:
    path = db.db_path()
    data = path.read_bytes()
    for extra in (path.with_name(path.name + "-wal"), path.with_name(path.name + "-journal")):
        if extra.exists():
            data += extra.read_bytes()
    return data


def test_data_is_encrypted_at_rest(client):
    confirm(client, upload(client, SAMPLES / "collaborateurs_avec_superieur.xlsx"))
    client.patch("/api/employees/1", json={"phone": "06 39 98 99 99"})
    raw = _db_bytes()
    for clear in (
        "Hélène".encode(),
        b"Marchand",
        b"Directrice",
        "Siège".encode(),
        b"Lyon",
        b"entreprise.test",
        b"06 39 98",
        b"Collaborateur",
        b"collaborateurs_avec",
    ):
        assert clear not in raw, clear
    # mais tout est lisible pour une session déverrouillée
    names = {e["name"] for e in client.get("/api/employees").json()}
    assert "Hélène Marchand" in names


def test_plaintext_data_from_older_version_is_encrypted_at_setup(raw_client):
    with db.connect() as conn:
        conn.execute("INSERT INTO sites(id, name) VALUES (1, 'Siège - Lyon')")
        conn.execute(
            "INSERT INTO employees(id, name, name_key, title, site_id) "
            "VALUES (1, 'Hélène Marchand', 'helene marchand', 'Directrice', 1)"
        )
        conn.execute(
            "INSERT INTO settings(key, value) VALUES ('last_import', ?)", (json.dumps({"filename": "ancien.xlsx"}),)
        )
    raw_client.post("/api/vault/setup", json={"password": TEST_PASSWORD})
    assert b"Marchand" not in _db_bytes() and b"ancien.xlsx" not in _db_bytes()
    e = raw_client.get("/api/employees").json()[0]
    assert (e["name"], e["title"], e["site"]) == ("Hélène Marchand", "Directrice", "Siège - Lyon")
    assert raw_client.get("/api/import/last").json()["filename"] == "ancien.xlsx"
    # le réimport reconnaît la personne migrée
    up = upload(raw_client, SAMPLES / "collaborateurs_avec_superieur.xlsx")
    assert "Hélène Marchand" not in confirm(raw_client, up, dry_run=True)["added"]


def test_tampered_field_is_rejected(client):
    confirm(client, upload(client, SAMPLES / "collaborateurs_avec_superieur.xlsx"))
    with sqlite3.connect(db.db_path()) as conn:  # échange de deux champs chiffrés -> refusé (contexte en AAD)
        title = conn.execute("SELECT title FROM employees WHERE id = 1").fetchone()[0]
        conn.execute("UPDATE employees SET email = ? WHERE id = 1", (title,))
    with pytest.raises(crypto.CryptoError):
        client.get("/api/employees")


def test_shared_backup_fixture_is_readable():
    """Sauvegarde produite par crypto.py, relue aussi par le test JS (formats identiques)."""
    doc = json.loads((SAMPLES / "sauvegarde-chiffree-exemple.json").read_text())
    data = crypto.decrypt_backup(doc, "exemple-de-mot-de-passe")
    assert [e["name"] for e in data["employees"]] == ["Hélène Marchand", "François Lefèvre", "Nadia Benali"]
    with pytest.raises(crypto.CryptoError):
        crypto.decrypt_backup(doc, "mauvais")
    evil = {**doc, "kdf": {**doc["kdf"], "iterations": 10**9}}
    with pytest.raises(crypto.CryptoError):
        crypto.decrypt_backup(evil, "exemple-de-mot-de-passe")


def test_zip_bomb_is_rejected(client):
    buf = io.BytesIO()
    with zipfile.ZipFile(buf, "w", zipfile.ZIP_DEFLATED) as z:
        z.writestr("xl/worksheets/sheet1.xml", b"\0" * (210 * 1024 * 1024))
    assert len(buf.getvalue()) < 1_000_000
    r = client.post("/api/import", files={"file": ("bombe.xlsx", buf.getvalue())})
    assert r.status_code == 400 and "volumineux" in r.json()["detail"]
    r = client.post("/api/import", files={"file": ("abime.xlsx", b"PK pas un zip")})
    assert r.status_code == 400
