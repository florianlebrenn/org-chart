"""Chiffrement des données (mode serveur). Formats partagés avec frontend/src/core/crypto.js.

Principe (« enveloppe ») :
- une clé de données aléatoire (DEK, 256 bits) chiffre les données en AES-256-GCM ;
- la DEK est elle-même chiffrée (« enveloppée ») deux fois : avec une clé dérivée du mot de passe,
  et avec une clé dérivée de la clé de secours (PBKDF2-HMAC-SHA256, 600 000 itérations, sel aléatoire) ;
- changer de mot de passe ne ré-enveloppe que la DEK ; les données ne sont pas rechiffrées.

Côté serveur, chaque champ sensible est chiffré séparément (AES-GCM, nonce aléatoire, contexte en AAD),
et les noms servant aux recherches exactes sont remplacés par une empreinte HMAC-SHA256.
"""

from __future__ import annotations

import base64
import hashlib
import hmac
import json
import os
import secrets
import time

from cryptography.exceptions import InvalidTag
from cryptography.hazmat.primitives import hashes
from cryptography.hazmat.primitives.ciphers.aead import AESGCM
from cryptography.hazmat.primitives.kdf.hkdf import HKDF

ITERATIONS = 600_000  # recommandation OWASP pour PBKDF2-HMAC-SHA256
KDF_NAME = "PBKDF2-SHA256"
CIPHER_NAME = "AES-256-GCM"
DEK_AAD = b"organigramme-dek-v1"
BACKUP_AAD = b"organigramme-sauvegarde-v1"
BACKUP_FORMAT = "organigramme-sauvegarde-chiffree"
FIELD_PREFIX = "v1:"
MIN_PASSWORD = 12
# clé de secours : 32 caractères base32 de Crockford (160 bits), sans I, L, O, U
RECOVERY_ALPHABET = "0123456789ABCDEFGHJKMNPQRSTVWXYZ"


class CryptoError(ValueError):
    """Mot de passe, clé de secours ou donnée chiffrée invalide."""


# ------------------------------------------------------------------ primitives


def b64e(b: bytes) -> str:
    return base64.b64encode(b).decode()


def b64d(s: str) -> bytes:
    return base64.b64decode(s.encode(), validate=True)


def derive(secret: str, salt: bytes, iterations: int) -> bytes:
    return hashlib.pbkdf2_hmac("sha256", secret.encode("utf-8"), salt, iterations, dklen=32)


def seal(key: bytes, plaintext: bytes, aad: bytes) -> bytes:
    """AES-256-GCM : renvoie nonce (12 octets) || chiffré || tag (même format que WebCrypto)."""
    iv = os.urandom(12)
    return iv + AESGCM(key).encrypt(iv, plaintext, aad)


def unseal(key: bytes, blob: bytes, aad: bytes) -> bytes:
    try:
        return AESGCM(key).decrypt(blob[:12], blob[12:], aad)
    except (InvalidTag, ValueError) as e:
        raise CryptoError("déchiffrement impossible") from e


# ------------------------------------------------------------------ mot de passe et clé de secours


def check_password_policy(password: str) -> None:
    if len(password or "") < MIN_PASSWORD:
        raise CryptoError(f"Le mot de passe doit contenir au moins {MIN_PASSWORD} caractères.")
    if len(set(password)) < 4:
        raise CryptoError("Mot de passe trop simple : variez les caractères (une phrase de passe convient bien).")


def new_recovery_key() -> str:
    raw = "".join(secrets.choice(RECOVERY_ALPHABET) for _ in range(32))
    return "-".join(raw[i : i + 4] for i in range(0, 32, 4))


def normalize_recovery_key(value: str) -> str:
    s = (value or "").upper().replace("-", "").replace(" ", "")
    s = s.replace("O", "0").replace("I", "1").replace("L", "1")
    if len(s) != 32 or any(c not in RECOVERY_ALPHABET for c in s):
        raise CryptoError("Clé de secours invalide.")
    return "-".join(s[i : i + 4] for i in range(0, 32, 4))


def _wrap(dek: bytes, secret: str) -> dict:
    salt = os.urandom(16)
    key = derive(secret, salt, ITERATIONS)
    return {"iterations": ITERATIONS, "salt": b64e(salt), "wrapped": b64e(seal(key, dek, DEK_AAD))}


def _unwrap(entry: dict, secret: str) -> bytes:
    key = derive(secret, b64d(entry["salt"]), int(entry["iterations"]))
    return unseal(key, b64d(entry["wrapped"]), DEK_AAD)


def create_vault(password: str) -> tuple[dict, bytes, str]:
    """Nouveau coffre -> (métadonnées à stocker, DEK, clé de secours à montrer UNE fois)."""
    check_password_policy(password)
    dek = os.urandom(32)
    recovery = new_recovery_key()
    meta = {
        "version": 1,
        "kdf": KDF_NAME,
        "cipher": CIPHER_NAME,
        "password": _wrap(dek, password),
        "recovery": _wrap(dek, recovery),
        "created": time.strftime("%Y-%m-%dT%H:%M:%S"),
    }
    return meta, dek, recovery


def open_with_password(meta: dict, password: str) -> bytes:
    try:
        return _unwrap(meta["password"], password or "")
    except CryptoError as e:
        raise CryptoError("Mot de passe incorrect.") from e


def open_with_recovery(meta: dict, recovery_key: str) -> bytes:
    rk = normalize_recovery_key(recovery_key)
    try:
        return _unwrap(meta["recovery"], rk)
    except CryptoError as e:
        raise CryptoError("Clé de secours incorrecte.") from e


def rewrap(meta: dict, dek: bytes, *, password: str | None = None, recovery_key: str | None = None) -> dict:
    """Ré-enveloppe la DEK avec un nouveau mot de passe et/ou une nouvelle clé de secours."""
    out = dict(meta)
    if password is not None:
        check_password_policy(password)
        out["password"] = _wrap(dek, password)
    if recovery_key is not None:
        out["recovery"] = _wrap(dek, normalize_recovery_key(recovery_key))
    return out


# ------------------------------------------------------------------ chiffrement des champs (serveur)


class FieldCipher:
    """Chiffre/déchiffre les champs stockés en base. Clés dérivées de la DEK par HKDF."""

    def __init__(self, dek: bytes):
        def sub(info: bytes) -> bytes:
            return HKDF(algorithm=hashes.SHA256(), length=32, salt=None, info=info).derive(dek)

        self._enc = sub(b"organigramme-champs-v1")
        self._mac = sub(b"organigramme-index-v1")

    def enc(self, value: str | None, context: str) -> str | None:
        if value is None:
            return None
        return FIELD_PREFIX + b64e(seal(self._enc, value.encode("utf-8"), context.encode()))

    def dec(self, value: str | None, context: str) -> str | None:
        if value is None:
            return None
        if not value.startswith(FIELD_PREFIX):
            raise CryptoError(f"donnée non chiffrée inattendue ({context})")
        return unseal(self._enc, b64d(value[len(FIELD_PREFIX) :]), context.encode()).decode("utf-8")

    def enc_json(self, value, context: str) -> str:
        return self.enc(json.dumps(value, ensure_ascii=False), context)

    def dec_json(self, value: str | None, context: str):
        return None if value is None else json.loads(self.dec(value, context))

    def index(self, value: str) -> str:
        """Empreinte déterministe (HMAC) pour les correspondances exactes (nom, site)."""
        return hmac.new(self._mac, value.encode("utf-8"), hashlib.sha256).hexdigest()


# ------------------------------------------------------------------ sauvegardes chiffrées (format commun)


def encrypt_backup(data: dict, password: str) -> dict:
    salt = os.urandom(16)
    key = derive(password, salt, ITERATIONS)
    blob = seal(key, json.dumps(data, ensure_ascii=False).encode("utf-8"), BACKUP_AAD)
    return {
        "format": BACKUP_FORMAT,
        "version": 1,
        "exported_at": data.get("exported_at"),
        "kdf": {"name": KDF_NAME, "iterations": ITERATIONS, "salt": b64e(salt)},
        "cipher": {"name": CIPHER_NAME, "iv": b64e(blob[:12])},
        "data": b64e(blob[12:]),
    }


def decrypt_backup(doc: dict, password: str) -> dict:
    try:
        if doc.get("format") != BACKUP_FORMAT or doc["kdf"]["name"] != KDF_NAME or doc["cipher"]["name"] != CIPHER_NAME:
            raise CryptoError("Format de sauvegarde chiffrée inconnu.")
        iterations = int(doc["kdf"]["iterations"])
        if not 1_000 <= iterations <= 5_000_000:  # borne : un fichier piégé ne doit pas bloquer le serveur
            raise CryptoError("Paramètres de sauvegarde invalides.")
        key = derive(password or "", b64d(doc["kdf"]["salt"]), iterations)
        plain = unseal(key, b64d(doc["cipher"]["iv"]) + b64d(doc["data"]), BACKUP_AAD)
    except CryptoError:
        raise CryptoError("Mot de passe de la sauvegarde incorrect, ou fichier endommagé.") from None
    except (KeyError, TypeError, ValueError) as e:
        raise CryptoError("Sauvegarde chiffrée illisible.") from e
    return json.loads(plain)
