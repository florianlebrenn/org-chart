"""API de l'organigramme (FastAPI). Aucune dépendance réseau sortante."""

import asyncio
import json
import re
import shutil
import threading
import time
import uuid
from contextlib import asynccontextmanager
from pathlib import Path
from typing import Annotated

import crypto
import db
import importer
import pdf
import sync
import tree
import vault
from fastapi import FastAPI, File, HTTPException, Request, Response, UploadFile
from fastapi.responses import JSONResponse
from pydantic import BaseModel

MAX_UPLOAD = 20 * 1024 * 1024
PREVIEW_ROWS = 8
IMPORT_TTL = 30 * 60  # un fichier importé mais non confirmé est oublié au bout de 30 min
MAX_PENDING = 10


class PendingImports:
    """Fichiers en cours d'import, gardés UNIQUEMENT en mémoire (jamais écrits sur le disque),
    puis oubliés dès la confirmation, l'abandon ou l'expiration. Suppose un seul processus uvicorn."""

    def __init__(self):
        self._items: dict[str, tuple[float, dict]] = {}
        self._lock = threading.Lock()

    def _purge(self) -> None:
        now = time.time()
        for t in [t for t, (exp, _) in self._items.items() if exp < now]:
            del self._items[t]
        while len(self._items) > MAX_PENDING:
            del self._items[min(self._items, key=lambda t: self._items[t][0])]

    def put(self, data: dict) -> str:
        token = uuid.uuid4().hex
        with self._lock:
            self._items[token] = (time.time() + IMPORT_TTL, data)
            self._purge()
        return token

    def get(self, token: str) -> dict:
        if not re.fullmatch(r"[0-9a-f]{32}", token or ""):
            raise HTTPException(400, "Jeton d'import invalide.")
        with self._lock:
            self._purge()
            item = self._items.get(token)
        if item is None:
            raise HTTPException(404, "Import expiré ou introuvable : rechargez le fichier.")
        return item[1]

    def drop(self, token: str) -> None:
        with self._lock:
            self._items.pop(token, None)

    def __len__(self) -> int:
        return len(self._items)


PENDING = PendingImports()
# au verrouillage, les fichiers en cours d'import sont oubliés eux aussi
vault.STATE.on_lock.append(lambda: PENDING._items.clear())


async def _purge_loop():
    while True:  # verrouillage automatique même sans nouvelle requête
        await asyncio.sleep(20)
        vault.purge()


@asynccontextmanager
async def lifespan(_app: FastAPI):
    db.init_db()
    # les versions précédentes gardaient les fichiers importés sur le disque : on les efface
    shutil.rmtree(db.data_dir() / "imports", ignore_errors=True)
    task = asyncio.create_task(_purge_loop())
    yield
    task.cancel()


DESCRIPTION = """
API locale de l'application Organigramme (mode serveur / Docker).

- Aucune donnée ne quitte la machine : pas d'appel réseau sortant, pas de télémétrie.
- **Données chiffrées** (AES-256-GCM) : un mot de passe est choisi au premier lancement
  (`POST /api/vault/setup`), puis demandé à chaque ouverture (`POST /api/vault/unlock`). Hors
  `/api/health` et `/api/vault/*`, toutes les routes exigent une session (cookie HttpOnly) ; verrouillage
  automatique après 15 minutes d'inactivité. Dans Swagger, déverrouillez d'abord via `/api/vault/unlock`.
- Interface Swagger servie localement sur `/api/docs` (aucun CDN).
- Parcours d'import : `POST /api/import` (fichier) → `POST /api/import/preview` (aperçu) →
  `POST /api/import/confirm` avec `dry_run=true` (simulation) → même appel avec `dry_run=false` (écriture).
- Confidentialité : seules les colonnes associées à un champ (nom, prénom, fonction, site, email,
  téléphone, supérieur) sont lues. Les autres colonnes du fichier ne sont ni importées, ni conservées,
  ni renvoyées. Le fichier n'est gardé qu'en mémoire, jusqu'à la confirmation (30 min au plus).
"""

TAGS = [
    {"name": "Santé", "description": "État du service."},
    {"name": "Coffre", "description": "Mot de passe, clé de secours, déverrouillage et verrouillage."},
    {"name": "Import", "description": "Import Excel/CSV avec choix des colonnes et fusion par nom."},
    {"name": "Collaborateurs", "description": "Lecture et modification (supérieur, fonction, site, contact, photo)."},
    {"name": "Exports", "description": "PDF A4 paysage (une page par site) et Mermaid."},
    {"name": "Sauvegarde", "description": "Sauvegarde chiffrée, restauration, effacement."},
]

# La page Swagger par défaut de FastAPI charge ses scripts depuis un CDN : on la désactive et on sert
# notre propre page Swagger UI embarquée (frontend/api-docs, servie par nginx sur /api/docs).
app = FastAPI(
    title="Organigramme — API locale",
    version="1.1.0",
    description=DESCRIPTION,
    openapi_tags=TAGS,
    contact={"name": "Florian Le Brenn", "url": "https://www.linkedin.com/in/florianlebrenn/"},
    license_info={"name": "MIT", "url": "https://opensource.org/licenses/MIT"},
    lifespan=lifespan,
    docs_url=None,
    redoc_url=None,
    openapi_url="/api/openapi.json",
)
app.include_router(vault.router)

PUBLIC_PATHS = {"/api/health", "/api/openapi.json"}


@app.exception_handler(vault.Locked)
async def _locked(_request: Request, _exc: vault.Locked):
    return JSONResponse({"detail": "Application verrouillée.", "locked": True}, status_code=401)


@app.middleware("http")
async def require_unlocked(request: Request, call_next):
    """Toute route de données exige une session déverrouillée (cookie)."""
    path = request.url.path
    protected = path.startswith("/api/") and path not in PUBLIC_PATHS and not path.startswith("/api/vault/")
    if protected and not vault.session_valid(request.cookies.get(vault.COOKIE)):
        return JSONResponse({"detail": "Application verrouillée.", "locked": True}, status_code=401)
    response = await call_next(request)
    if path.startswith("/api/"):
        response.headers["Cache-Control"] = "no-store"  # jamais de données en cache navigateur
    return response


# ------------------------------------------------------------------ santé


@app.get("/api/health", tags=["Santé"], summary="Vérifier que le service répond (aucune donnée tant que verrouillé)")
def health(request: Request):
    state = vault.state_for(request)
    out = {"status": "ok", "vault": state}
    if state == "unlocked":
        with db.connect() as conn:
            out["employees"] = conn.execute("SELECT COUNT(*) FROM employees").fetchone()[0]
            out["sites"] = conn.execute("SELECT COUNT(*) FROM sites").fetchone()[0]
    return out


# ------------------------------------------------------------------ import


def _sheet(token: str, sheet: int) -> tuple[dict, dict]:
    stored = PENDING.get(token)
    if not 0 <= sheet < len(stored["sheets"]):
        raise HTTPException(400, "Feuille inconnue.")
    return stored, stored["sheets"][sheet]


@app.post(
    "/api/import",
    tags=["Import"],
    summary="Envoyer un fichier .xlsx / .csv (renvoie feuilles, en-têtes et mapping proposé — aucune valeur)",
)
async def upload(file: Annotated[UploadFile, File()]):
    content = await file.read(MAX_UPLOAD + 1)
    if len(content) > MAX_UPLOAD:
        raise HTTPException(413, "Fichier trop volumineux (20 Mo maximum).")
    filename = Path(file.filename or "fichier").name
    try:
        sheets = importer.parse_file(filename, content)
    except importer.ImportError_ as e:
        raise HTTPException(400, str(e)) from e
    finally:
        del content

    token = PENDING.put({"filename": filename, "sheets": sheets})
    with db.connect() as conn:
        saved = db.get_setting(conn, "import_mapping", vault.cipher())
        has_data = conn.execute("SELECT COUNT(*) FROM employees").fetchone()[0] > 0
    # Aucune valeur de cellule n'est renvoyée ici : seulement les en-têtes (pour choisir les colonnes).
    return {
        "token": token,
        "filename": filename,
        "replaces_existing": has_data,
        "sheets": [
            {
                "name": s["name"],
                "header_row": s["header_row"],
                "headers": s["headers"],
                "row_count": len(s["rows"]),
                "suggested_mapping": importer.suggest_mapping(s["headers"], saved),
            }
            for s in sheets
        ],
    }


class PreviewBody(BaseModel):
    token: str
    sheet: int = 0
    mapping: dict[str, int | None]


@app.post("/api/import/preview", tags=["Import"], summary="Aperçu des premières lignes, limité aux colonnes retenues")
def import_preview(body: PreviewBody):
    _, sheet = _sheet(body.token, body.sheet)
    mapping = importer.clean_mapping(body.mapping, len(sheet["headers"]))
    return importer.preview(sheet["rows"], sheet["headers"], mapping, PREVIEW_ROWS)


class ConfirmBody(PreviewBody):
    dry_run: bool = True


@app.post(
    "/api/import/confirm",
    tags=["Import"],
    summary="Simuler (dry_run=true) ou appliquer l'import avec le mapping choisi",
)
def confirm(body: ConfirmBody):
    stored, sheet = _sheet(body.token, body.sheet)
    mapping = importer.clean_mapping(body.mapping, len(sheet["headers"]))
    if not {"name", "first_name", "last_name"} & mapping.keys():
        raise HTTPException(400, "Choisissez au moins la colonne du nom.")
    # confidentialité : à partir d'ici, seules les colonnes retenues existent
    rows, reduced_mapping = importer.project_rows(sheet["rows"], mapping)
    c = vault.cipher()
    with db.connect() as conn:
        try:
            summary = sync.run_import(
                conn,
                rows,
                reduced_mapping,
                importer.mapping_to_headers(mapping, sheet["headers"]),
                stored["filename"],
                body.dry_run,
                c,
            )
        except ValueError as e:
            raise HTTPException(400, str(e)) from e
    if not body.dry_run:
        PENDING.drop(body.token)  # le fichier complet est oublié dès l'import terminé
    return {"applied": not body.dry_run, **summary}


@app.delete("/api/import/{token}", tags=["Import"], summary="Abandonner un import en cours (oublie le fichier)")
def cancel_import(token: str):
    PENDING.drop(token)
    return {"status": "ok"}


@app.get("/api/import/last", tags=["Import"], summary="Informations sur le dernier import")
def last_import():
    with db.connect() as conn:
        return db.get_setting(conn, "last_import", vault.cipher()) or {}


# ------------------------------------------------------------------ lecture


@app.get("/api/employees", tags=["Collaborateurs"], summary="Liste à plat des collaborateurs")
def employees():
    with db.connect() as conn:
        return tree.load_employees(conn, vault.cipher())


@app.get("/api/org", tags=["Collaborateurs"], summary="Arbres imbriqués par site")
def org(site_id: int | None = None):
    """Arbres imbriqués par site : [{site_id, site, count, trees, unassigned}]."""
    with db.connect() as conn:
        return tree.site_groups(tree.load_employees(conn, vault.cipher()), site_id)


@app.get("/api/sites", tags=["Collaborateurs"], summary="Liste des sites")
def sites():
    with db.connect() as conn:
        return tree.load_sites(conn, vault.cipher())


# ------------------------------------------------------------------ modification

MAX_PHOTO = 400_000  # data URL (~300 Ko d'image)

# une requête fixe par colonne modifiable : le nom de colonne ne vient jamais de la requête HTTP
UPDATE_SQL = {
    "manager_id": "UPDATE employees SET manager_id = ? WHERE id = ?",
    "site_id": "UPDATE employees SET site_id = ? WHERE id = ?",
    "title": "UPDATE employees SET title = ? WHERE id = ?",
    "email": "UPDATE employees SET email = ? WHERE id = ?",
    "phone": "UPDATE employees SET phone = ? WHERE id = ?",
    "photo": "UPDATE employees SET photo = ? WHERE id = ?",
}


class EmployeePatch(BaseModel):
    manager_id: int | None = None
    title: str | None = None
    site_id: int | None = None
    email: str | None = None
    phone: str | None = None
    photo: str | None = None


def _employee(conn, emp_id: int) -> dict:
    row = next((e for e in tree.load_employees(conn, vault.cipher()) if e["id"] == emp_id), None)
    if row is None:
        raise HTTPException(404, "Collaborateur introuvable.")
    return row


@app.patch(
    "/api/employees/{emp_id}",
    tags=["Collaborateurs"],
    summary="Modifier supérieur, fonction, site, contact ou photo (anti-boucle)",
)
def patch_employee(emp_id: int, body: EmployeePatch):
    fields = body.model_fields_set  # seuls les champs envoyés sont modifiés (null autorisé)
    c = vault.cipher()
    with db.connect() as conn:
        _employee(conn, emp_id)
        updates: dict = {}
        if "manager_id" in fields:
            m = body.manager_id
            if m is not None:
                if not conn.execute("SELECT 1 FROM employees WHERE id = ?", (m,)).fetchone():
                    raise HTTPException(400, "Supérieur introuvable.")
                if tree.would_create_cycle(conn, emp_id, m):
                    raise HTTPException(400, "Impossible : ce choix créerait une boucle dans la hiérarchie.")
            updates["manager_id"] = m
        if "site_id" in fields:
            s = body.site_id
            if s is not None and not conn.execute("SELECT 1 FROM sites WHERE id = ?", (s,)).fetchone():
                raise HTTPException(400, "Site introuvable.")
            updates["site_id"] = s
        for f in ("title", "email", "phone"):
            if f in fields:
                updates[f] = c.enc((getattr(body, f) or "").strip() or None, f"employees.{f}")
        if "photo" in fields:
            p = body.photo
            if p is not None and (not re.match(r"^data:image/(png|jpeg|webp);base64,", p) or len(p) > MAX_PHOTO):
                raise HTTPException(400, "Photo refusée : image PNG/JPEG/WebP de moins de 300 Ko.")
            updates["photo"] = c.enc(p, "employees.photo")
        for column, value in updates.items():
            conn.execute(UPDATE_SQL[column], (value, emp_id))  # requêtes fixes, aucun SQL construit
        return _employee(conn, emp_id)


class AttachBody(BaseModel):
    manager_id: int
    site_id: int | None = None  # None = « Sans site »


@app.post(
    "/api/attach-unassigned",
    tags=["Collaborateurs"],
    summary="Rattacher tous les « non rattachés » d'un site à un responsable",
)
def attach_unassigned(body: AttachBody):
    """Rattache d'un coup tous les « non rattachés » d'un site au supérieur choisi."""
    with db.connect() as conn:
        _employee(conn, body.manager_id)
        groups = tree.site_groups(tree.load_employees(conn, vault.cipher()), body.site_id)
        if body.site_id is None:
            groups = [g for g in groups if g["site_id"] is None]
        ids = [n["id"] for g in groups for n in g["unassigned"] if n["id"] != body.manager_id]
        ids = [i for i in ids if not tree.would_create_cycle(conn, i, body.manager_id)]
        conn.executemany("UPDATE employees SET manager_id = ? WHERE id = ?", [(body.manager_id, i) for i in ids])
    return {"attached": len(ids)}


# ------------------------------------------------------------------ exports


def _export_name(ext: str, site: str | None = None) -> str:
    suffix = f"-{importer.norm_text(site).replace(' ', '-')}" if site else ""
    return f"organigramme{suffix}-{time.strftime('%Y-%m-%d')}.{ext}"


@app.get("/api/export/pdf", tags=["Exports"], summary="Télécharger le PDF (tous les sites ou un seul)")
def export_pdf(site_id: int | None = None):
    with db.connect() as conn:
        all_groups = tree.site_groups(tree.load_employees(conn, vault.cipher()))
    groups = [g for g in all_groups if site_id is None or g["site_id"] == site_id]
    content = pdf.render_pdf(groups, pdf.site_colors(all_groups))
    name = _export_name("pdf", groups[0]["site"] if site_id is not None and groups else None)
    return Response(
        content, media_type="application/pdf", headers={"Content-Disposition": f'attachment; filename="{name}"'}
    )


@app.get("/api/export/mermaid", tags=["Exports"], summary="Télécharger le code Mermaid")
def export_mermaid(site_id: int | None = None):
    with db.connect() as conn:
        groups = tree.site_groups(tree.load_employees(conn, vault.cipher()), site_id)
    return Response(
        tree.to_mermaid(groups),
        media_type="text/plain; charset=utf-8",
        headers={"Content-Disposition": f'attachment; filename="{_export_name("mmd")}"'},
    )


# ------------------------------------------------------------------ sauvegarde

PLAIN_BACKUP_FORMAT = "organigramme-sauvegarde"  # contenu (une fois déchiffré) et ancien format en clair


class BackupBody(BaseModel):
    password: str


@app.post(
    "/api/backup", tags=["Sauvegarde"], summary="Télécharger une sauvegarde CHIFFRÉE (mot de passe actuel requis)"
)
def backup(body: BackupBody):
    vault.check_password(body.password)
    c = vault.cipher()
    with db.connect() as conn:
        emps = tree.load_employees(conn, c)
        data = {
            "format": PLAIN_BACKUP_FORMAT,
            "version": 1,
            "exported_at": time.strftime("%Y-%m-%dT%H:%M:%S"),
            "sites": [{"id": s["id"], "name": s["name"]} for s in tree.load_sites(conn, c)],
            "employees": [
                {
                    k: e[k]
                    for k in ("id", "name", "title", "email", "phone", "photo", "site_id", "manager_id", "sort_order")
                }
                for e in emps
            ],
            "settings": {r["key"]: db.get_setting(conn, r["key"], c) for r in conn.execute("SELECT key FROM settings")},
        }
    doc = crypto.encrypt_backup(data, body.password)
    return Response(
        json.dumps(doc, indent=1),
        media_type="application/json",
        headers={"Content-Disposition": f'attachment; filename="{_export_name("json")}"'},
    )


def _restore(conn, data: dict, c) -> None:
    if not isinstance(data, dict) or data.get("format") != PLAIN_BACKUP_FORMAT:
        raise HTTPException(400, "Ce fichier n'est pas une sauvegarde de l'organigramme.")
    sites = data.get("sites") or []
    emps = data.get("employees") or []
    site_ids = {s["id"] for s in sites}
    emp_ids = {e["id"] for e in emps}
    conn.execute("DELETE FROM employees")
    conn.execute("DELETE FROM sites")
    conn.execute("DELETE FROM settings")
    conn.executemany(
        "INSERT INTO sites(id, name, name_hash) VALUES (?, ?, ?)",
        [(s["id"], c.enc(s["name"], "sites.name"), c.index(s["name"])) for s in sites],
    )
    conn.executemany(
        "INSERT INTO employees(id, name, name_key, title, email, phone, photo, site_id, manager_id, sort_order) "
        "VALUES (?, ?, ?, ?, ?, ?, ?, ?, NULL, ?)",
        [
            (
                e["id"],
                c.enc(e["name"], "employees.name"),
                c.index(importer.name_key(e["name"])),
                c.enc(e.get("title"), "employees.title"),
                c.enc(e.get("email"), "employees.email"),
                c.enc(e.get("phone"), "employees.phone"),
                c.enc(e.get("photo"), "employees.photo"),
                e.get("site_id") if e.get("site_id") in site_ids else None,
                e.get("sort_order") or 0,
            )
            for e in emps
        ],
    )
    conn.executemany(
        "UPDATE employees SET manager_id = ? WHERE id = ?",
        [(e.get("manager_id"), e["id"]) for e in emps if e.get("manager_id") in emp_ids],
    )
    for k, v in (data.get("settings") or {}).items():
        if k in ("import_mapping", "last_import"):
            db.set_setting(conn, k, v, c)


class RestoreBody(BaseModel):
    backup: dict
    password: str | None = None  # mot de passe de la sauvegarde (si elle est chiffrée)


@app.post("/api/restore", tags=["Sauvegarde"], summary="Restaurer une sauvegarde (remplace tout)")
def restore(body: RestoreBody):
    data = body.backup
    if data.get("format") == crypto.BACKUP_FORMAT:
        try:
            data = crypto.decrypt_backup(data, body.password or "")
        except crypto.CryptoError as e:
            raise HTTPException(400, str(e)) from e
    c = vault.cipher()
    with db.connect() as conn:
        _restore(conn, data, c)
        n = conn.execute("SELECT COUNT(*) FROM employees").fetchone()[0]
    return {"restored": n}


@app.delete("/api/data", tags=["Sauvegarde"], summary="Effacer toutes les données (le mot de passe est conservé)")
def reset_data():
    with db.connect() as conn:
        conn.execute("DELETE FROM employees")
        conn.execute("DELETE FROM sites")
        conn.execute("DELETE FROM settings")
    return {"status": "ok"}
