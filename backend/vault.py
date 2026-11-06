"""Coffre (mode serveur) : mot de passe obligatoire, clé de secours, sessions, verrouillage automatique.

- Au premier lancement, l'application demande de choisir un mot de passe (POST /api/vault/setup) ;
  les données existantes sont alors chiffrées, et une clé de secours est affichée UNE seule fois.
- Ensuite, l'application démarre VERROUILLÉE : la clé de données n'existe qu'en mémoire, après
  saisie du mot de passe, et disparaît au verrouillage, après 15 min d'inactivité ou au redémarrage.
- Une session = un cookie HttpOnly, SameSite=Strict, limité à /api. Toutes les routes /api/* hors
  /api/health, /api/openapi.json et /api/vault/* exigent une session valide (voir main.py).
"""

from __future__ import annotations

import json
import secrets
import threading
import time
from collections.abc import Callable

import crypto
import db
from fastapi import APIRouter, HTTPException, Request, Response
from pydantic import BaseModel

COOKIE = "organigramme_session"
IDLE_TIMEOUT = 15 * 60  # verrouillage après 15 min sans requête
MAX_SESSION = 12 * 3600  # durée maximale d'une session
MAX_FAILURES_FREE = 3  # tentatives avant temporisation
MAX_DELAY = 300

router = APIRouter(prefix="/api/vault", tags=["Coffre"])


class Locked(Exception):
    """Application verrouillée : main.py la transforme en 401 {"detail": ..., "locked": true}."""


class _State:
    def __init__(self):
        self.lock = threading.Lock()
        self.cipher: crypto.FieldCipher | None = None
        self.sessions: dict[str, tuple[float, float]] = {}  # jeton -> (créée, dernière activité)
        self.failures = 0
        self.retry_at = 0.0
        self.on_lock: list[Callable[[], None]] = []


STATE = _State()


# ------------------------------------------------------------------ état


def _meta(conn) -> dict | None:
    row = conn.execute("SELECT meta FROM vault WHERE id = 1").fetchone()
    return json.loads(row["meta"]) if row else None


def _save_meta(conn, meta: dict) -> None:
    conn.execute(
        "INSERT INTO vault(id, meta) VALUES (1, ?) ON CONFLICT(id) DO UPDATE SET meta = excluded.meta",
        (json.dumps(meta),),
    )


def purge(now: float | None = None) -> None:
    """Expire les sessions inactives ; sans session restante, la clé est effacée de la mémoire."""
    now = now or time.time()
    with STATE.lock:
        for t, (created, seen) in list(STATE.sessions.items()):
            if now - seen > IDLE_TIMEOUT or now - created > MAX_SESSION:
                del STATE.sessions[t]
        if not STATE.sessions and STATE.cipher is not None:
            _forget_locked()


def _forget_locked() -> None:
    STATE.cipher = None
    STATE.sessions.clear()
    for cb in STATE.on_lock:
        cb()


def lock_all() -> None:
    with STATE.lock:
        _forget_locked()


def session_valid(token: str | None, touch: bool = True) -> bool:
    purge()
    with STATE.lock:
        if not token or token not in STATE.sessions or STATE.cipher is None:
            return False
        if touch:
            created, _ = STATE.sessions[token]
            STATE.sessions[token] = (created, time.time())
        return True


def cipher() -> crypto.FieldCipher:
    c = STATE.cipher
    if c is None:
        raise Locked()
    return c


def _open_session(response: Response, request: Request, dek: bytes) -> None:
    token = secrets.token_urlsafe(32)
    now = time.time()
    with STATE.lock:
        STATE.cipher = crypto.FieldCipher(dek)
        STATE.sessions[token] = (now, now)
        STATE.failures = 0
        STATE.retry_at = 0.0
    secure = request.headers.get("x-forwarded-proto") == "https" or request.url.scheme == "https"
    response.set_cookie(COOKIE, token, httponly=True, samesite="strict", path="/api", secure=secure)


def _throttle() -> None:
    wait = STATE.retry_at - time.time()
    if wait > 0:
        raise HTTPException(429, f"Trop de tentatives : réessayez dans {int(wait) + 1} s.")


def _failed() -> None:
    with STATE.lock:
        STATE.failures += 1
        if STATE.failures > MAX_FAILURES_FREE:
            STATE.retry_at = time.time() + min(MAX_DELAY, 2 ** (STATE.failures - MAX_FAILURES_FREE))


def state_for(request: Request) -> str:
    with db.connect() as conn:
        if _meta(conn) is None:
            return "setup"
    return "unlocked" if session_valid(request.cookies.get(COOKIE), touch=False) else "locked"


# ------------------------------------------------------------------ chiffrement des données existantes


def encrypt_existing(conn, c: crypto.FieldCipher) -> None:
    """Chiffre les données en clair d'une version précédente (appelé une seule fois, à la création du coffre)."""
    from importer import name_key  # import local : évite un import circulaire

    for e in conn.execute("SELECT id, name, title, email, phone, photo FROM employees").fetchall():
        conn.execute(
            "UPDATE employees SET name=?, name_key=?, title=?, email=?, phone=?, photo=? WHERE id=?",
            (
                c.enc(e["name"], "employees.name"),
                c.index(name_key(e["name"])),
                c.enc(e["title"], "employees.title"),
                c.enc(e["email"], "employees.email"),
                c.enc(e["phone"], "employees.phone"),
                c.enc(e["photo"], "employees.photo"),
                e["id"],
            ),
        )
    for s in conn.execute("SELECT id, name FROM sites").fetchall():
        conn.execute(
            "UPDATE sites SET name=?, name_hash=? WHERE id=?",
            (c.enc(s["name"], "sites.name"), c.index(s["name"]), s["id"]),
        )
    for r in conn.execute("SELECT key, value FROM settings").fetchall():
        conn.execute("UPDATE settings SET value=? WHERE key=?", (c.enc(r["value"], f"settings.{r['key']}"), r["key"]))


# ------------------------------------------------------------------ routes


class PasswordBody(BaseModel):
    password: str


class RecoverBody(BaseModel):
    recovery_key: str
    new_password: str


class ChangeBody(BaseModel):
    current_password: str
    new_password: str


@router.get("/status", summary="État : setup (à créer), locked (verrouillée) ou unlocked")
def status(request: Request):
    return {"state": state_for(request), "idle_timeout": IDLE_TIMEOUT}


@router.post(
    "/setup", summary="Premier lancement : choisir le mot de passe (renvoie la clé de secours, une seule fois)"
)
def setup(body: PasswordBody, request: Request, response: Response):
    with db.connect() as conn:
        if _meta(conn) is not None:
            raise HTTPException(409, "Le mot de passe est déjà défini.")
        try:
            meta, dek, recovery = crypto.create_vault(body.password)
        except crypto.CryptoError as e:
            raise HTTPException(400, str(e)) from e
        encrypt_existing(conn, crypto.FieldCipher(dek))
        _save_meta(conn, meta)
    _open_session(response, request, dek)
    return {"state": "unlocked", "recovery_key": recovery}


@router.post("/unlock", summary="Déverrouiller avec le mot de passe")
def unlock(body: PasswordBody, request: Request, response: Response):
    _throttle()
    with db.connect() as conn:
        meta = _meta(conn)
    if meta is None:
        raise HTTPException(409, "Aucun mot de passe défini : créez-le d'abord.")
    try:
        dek = crypto.open_with_password(meta, body.password)
    except crypto.CryptoError as e:
        _failed()
        raise HTTPException(401, str(e)) from e
    _open_session(response, request, dek)
    return {"state": "unlocked"}


@router.post(
    "/recover",
    summary="Mot de passe oublié : clé de secours + nouveau mot de passe (renvoie une NOUVELLE clé de secours)",
)
def recover(body: RecoverBody, request: Request, response: Response):
    _throttle()
    with db.connect() as conn:
        meta = _meta(conn)
        if meta is None:
            raise HTTPException(409, "Aucun mot de passe défini.")
        try:
            dek = crypto.open_with_recovery(meta, body.recovery_key)
        except crypto.CryptoError as e:
            _failed()
            raise HTTPException(401, str(e)) from e
        new_recovery = crypto.new_recovery_key()
        try:
            _save_meta(conn, crypto.rewrap(meta, dek, password=body.new_password, recovery_key=new_recovery))
        except crypto.CryptoError as e:
            raise HTTPException(400, str(e)) from e
    lock_all()  # les autres sessions éventuelles sont fermées
    _open_session(response, request, dek)
    return {"state": "unlocked", "recovery_key": new_recovery}


@router.post("/password", summary="Changer le mot de passe (session ouverte + mot de passe actuel)")
def change_password(body: ChangeBody, request: Request):
    if not session_valid(request.cookies.get(COOKIE)):
        raise Locked()
    _throttle()
    with db.connect() as conn:
        meta = _meta(conn)
        try:
            dek = crypto.open_with_password(meta, body.current_password)
        except crypto.CryptoError as e:
            _failed()
            raise HTTPException(401, "Mot de passe actuel incorrect.") from e
        try:
            _save_meta(conn, crypto.rewrap(meta, dek, password=body.new_password))
        except crypto.CryptoError as e:
            raise HTTPException(400, str(e)) from e
    return {"status": "ok"}


@router.post("/recovery-key", summary="Générer une nouvelle clé de secours (l'ancienne ne fonctionne plus)")
def new_recovery_key(body: PasswordBody, request: Request):
    if not session_valid(request.cookies.get(COOKIE)):
        raise Locked()
    _throttle()
    with db.connect() as conn:
        meta = _meta(conn)
        try:
            dek = crypto.open_with_password(meta, body.password)
        except crypto.CryptoError as e:
            _failed()
            raise HTTPException(401, "Mot de passe incorrect.") from e
        recovery = crypto.new_recovery_key()
        _save_meta(conn, crypto.rewrap(meta, dek, recovery_key=recovery))
    return {"recovery_key": recovery}


@router.post("/lock", summary="Verrouiller (efface la clé de la mémoire du serveur)")
def lock(response: Response):
    lock_all()
    response.delete_cookie(COOKIE, path="/api")
    return {"state": "locked"}


def check_password(password: str) -> None:
    """Vérifie le mot de passe actuel (utilisé pour chiffrer une sauvegarde)."""
    _throttle()
    with db.connect() as conn:
        meta = _meta(conn)
    try:
        crypto.open_with_password(meta, password)
    except crypto.CryptoError as e:
        _failed()
        raise HTTPException(401, "Mot de passe incorrect.") from e
