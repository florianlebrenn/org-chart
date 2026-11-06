"""Accès SQLite : connexion, schéma et petites migrations."""

import json
import os
import sqlite3
from pathlib import Path

SCHEMA = """
-- Les colonnes de texte (noms, fonctions, contacts, photos, réglages) sont CHIFFRÉES (crypto.py) ;
-- name_key / name_hash sont des empreintes HMAC servant aux correspondances exactes.
CREATE TABLE IF NOT EXISTS sites (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  name        TEXT NOT NULL UNIQUE,
  name_hash   TEXT
);

CREATE TABLE IF NOT EXISTS employees (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  name        TEXT NOT NULL,
  name_key    TEXT,                                  -- nom normalisé (correspondance au réimport)
  title       TEXT,
  email       TEXT,
  phone       TEXT,
  photo       TEXT,                                  -- data URL (optionnelle)
  site_id     INTEGER REFERENCES sites(id) ON DELETE SET NULL,
  manager_id  INTEGER REFERENCES employees(id) ON DELETE SET NULL,  -- NULL = racine
  sort_order  INTEGER DEFAULT 0
);

CREATE INDEX IF NOT EXISTS idx_employees_site    ON employees(site_id);
CREATE INDEX IF NOT EXISTS idx_employees_manager ON employees(manager_id);

CREATE TABLE IF NOT EXISTS settings (
  key   TEXT PRIMARY KEY,
  value TEXT
);

-- Coffre : clé de données enveloppée par le mot de passe et par la clé de secours (jamais en clair)
CREATE TABLE IF NOT EXISTS vault (
  id    INTEGER PRIMARY KEY CHECK (id = 1),
  meta  TEXT NOT NULL
);
"""


def db_path() -> Path:
    """Chemin du fichier SQLite, depuis DATABASE_URL (sqlite:////data/org.db)."""
    url = os.environ.get("DATABASE_URL", "sqlite:///./org.db")
    prefix = "sqlite:///"
    if not url.startswith(prefix):
        raise ValueError(f"DATABASE_URL non supportée : {url}")
    return Path(url[len(prefix) :])


def data_dir() -> Path:
    """Dossier de travail à côté de la base (fichiers d'import temporaires)."""
    return db_path().parent


def connect() -> sqlite3.Connection:
    conn = sqlite3.connect(db_path())
    conn.row_factory = sqlite3.Row
    conn.execute("PRAGMA foreign_keys = ON")
    return conn


def _migrate(conn: sqlite3.Connection) -> None:
    cols = {r["name"] for r in conn.execute("PRAGMA table_info(employees)")}
    if "name_key" not in cols:  # base créée en phase 1
        conn.execute("ALTER TABLE employees ADD COLUMN name_key TEXT")
    if "phone" not in cols:
        conn.execute("ALTER TABLE employees ADD COLUMN phone TEXT")
    if "photo" not in cols:
        conn.execute("ALTER TABLE employees ADD COLUMN photo TEXT")
    conn.execute("CREATE INDEX IF NOT EXISTS idx_employees_key ON employees(name_key)")
    site_cols = {r["name"] for r in conn.execute("PRAGMA table_info(sites)")}
    if "name_hash" not in site_cols:
        conn.execute("ALTER TABLE sites ADD COLUMN name_hash TEXT")
    conn.execute("CREATE UNIQUE INDEX IF NOT EXISTS idx_sites_hash ON sites(name_hash)")


def init_db() -> None:
    path = db_path()
    path.parent.mkdir(parents=True, exist_ok=True)
    with connect() as conn:
        conn.executescript(SCHEMA)
        _migrate(conn)


def get_setting(conn: sqlite3.Connection, key: str, cipher, default=None):
    """Réglage chiffré (cipher = crypto.FieldCipher de la session déverrouillée)."""
    row = conn.execute("SELECT value FROM settings WHERE key = ?", (key,)).fetchone()
    return json.loads(cipher.dec(row["value"], f"settings.{key}")) if row else default


def set_setting(conn: sqlite3.Connection, key: str, value, cipher) -> None:
    conn.execute(
        "INSERT INTO settings(key, value) VALUES(?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value",
        (key, cipher.enc(json.dumps(value, ensure_ascii=False), f"settings.{key}")),
    )
