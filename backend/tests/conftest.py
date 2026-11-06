"""Fixtures communes : base neuve par test, coffre créé avec un mot de passe de test."""

import pytest
from fastapi.testclient import TestClient
from helpers import TEST_PASSWORD


def _reset_vault_state():
    import vault

    vault.lock_all()
    vault.STATE.failures = 0
    vault.STATE.retry_at = 0.0


@pytest.fixture()
def raw_client(tmp_path, monkeypatch):
    """Client sur une base neuve, SANS mot de passe défini (application à créer)."""
    monkeypatch.setenv("DATABASE_URL", f"sqlite:///{tmp_path}/org.db")
    import crypto
    import main

    monkeypatch.setattr(crypto, "ITERATIONS", 1_000)  # tests rapides ; la valeur réelle est testée à part
    _reset_vault_state()
    with TestClient(main.app) as c:
        yield c
    _reset_vault_state()


@pytest.fixture()
def client(raw_client):
    """Client déverrouillé (mot de passe créé)."""
    r = raw_client.post("/api/vault/setup", json={"password": TEST_PASSWORD})
    assert r.status_code == 200, r.text
    return raw_client
