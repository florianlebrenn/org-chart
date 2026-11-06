"""Lecture des fichiers Excel (.xlsx/.xlsm) et CSV, et suggestion du mapping de colonnes."""

import csv
import datetime as dt
import io
import re
import unicodedata
import zipfile

from openpyxl import load_workbook
from openpyxl.xml import DEFUSEDXML

# openpyxl n'est protégé contre les « bombes XML » que si defusedxml est installé (pyproject.toml / uv.lock).
if not DEFUSEDXML:  # pragma: no cover
    raise RuntimeError("defusedxml manquant : installez les dépendances (cd backend && uv sync).")

# Un .xlsx est une archive zip : on refuse les archives qui se décompressent de façon démesurée
# (« bombe zip ») avant même de les ouvrir.
MAX_UNCOMPRESSED = 200 * 1024 * 1024
MAX_ZIP_ENTRIES = 5000

FIELDS = ["name", "first_name", "last_name", "title", "site", "email", "phone", "manager"]

MAX_HEADER_SCAN = 20


class ImportError_(ValueError):
    """Erreur lisible renvoyée telle quelle à l'utilisateur."""


# ---------------------------------------------------------------- normalisation


def strip_accents(s: str) -> str:
    return "".join(c for c in unicodedata.normalize("NFKD", s) if not unicodedata.combining(c))


def norm_text(s: str) -> str:
    """minuscules, sans accents, ponctuation -> espaces, espaces compactés."""
    s = strip_accents(str(s or "")).lower()
    s = re.sub(r"[^a-z0-9+]+", " ", s)
    return " ".join(s.split())


def name_key(name: str) -> str:
    """Clé de correspondance d'un nom, indépendante de l'ordre prénom/nom et de la casse.

    « Hélène MARCHAND », « MARCHAND Hélène » et « helene marchand » -> « helene marchand ».
    """
    return " ".join(sorted(norm_text(name).split()))


def pretty_name(s: str) -> str:
    """Met en forme les mots écrits tout en majuscules : « D'ALMEIDA » -> « D'Almeida »."""

    def fix(word: str) -> str:
        if len(word) > 1 and word.isupper():
            return re.sub(r"(^|[-'’])(\w)", lambda m: m.group(1) + m.group(2).upper(), word.lower())
        return word

    return " ".join(fix(w) for w in str(s).split())


# ---------------------------------------------------------------- lecture


def cell_to_str(v) -> str:
    if v is None:
        return ""
    if isinstance(v, bool):
        return "oui" if v else "non"
    if isinstance(v, float) and v.is_integer():
        return str(int(v))
    if isinstance(v, (dt.datetime, dt.date)):
        return v.date().isoformat() if isinstance(v, dt.datetime) else v.isoformat()
    return " ".join(str(v).split())


def _table_from_rows(name: str, raw_rows) -> dict:
    rows = [[cell_to_str(c) for c in r] for r in raw_rows]
    # ligne d'en-têtes = première ligne avec au moins 2 cellules remplies
    header_idx = next((i for i, r in enumerate(rows[:MAX_HEADER_SCAN]) if sum(1 for c in r if c) >= 2), None)
    if header_idx is None:
        return {"name": name, "header_row": None, "headers": [], "rows": []}
    data = [r for r in rows[header_idx + 1 :] if any(r)]
    # largeur = dernière colonne non vide (en-têtes ou données)
    width = 0
    for r in [rows[header_idx]] + data:
        for i in range(len(r) - 1, -1, -1):
            if r[i]:
                width = max(width, i + 1)
                break
    headers = []
    for i in range(width):
        h = rows[header_idx][i] if i < len(rows[header_idx]) else ""
        headers.append(h or f"Colonne {_col_letter(i)}")
    data = [(r + [""] * width)[:width] for r in data]
    return {"name": name, "header_row": header_idx + 1, "headers": headers, "rows": data}


def _col_letter(i: int) -> str:
    s = ""
    i += 1
    while i:
        i, r = divmod(i - 1, 26)
        s = chr(65 + r) + s
    return s


def parse_file(filename: str, content: bytes) -> list[dict]:
    ext = filename.lower().rsplit(".", 1)[-1] if "." in filename else ""
    if ext == "xls":
        raise ImportError_(
            "Ancien format Excel (.xls) non pris en charge : ouvrez le fichier dans Excel "
            "puis « Enregistrer sous » au format .xlsx."
        )
    if ext in ("xlsx", "xlsm"):
        return _parse_xlsx(content)
    if ext in ("csv", "txt"):
        return [_parse_csv(content)]
    raise ImportError_("Format non reconnu : utilisez un fichier .xlsx ou .csv.")


def check_zip(content: bytes) -> None:
    """Refuse une archive xlsx anormale (trop d'entrées ou taille décompressée démesurée)."""
    try:
        with zipfile.ZipFile(io.BytesIO(content)) as z:
            infos = z.infolist()
    except zipfile.BadZipFile as e:
        raise ImportError_("Fichier Excel illisible ou endommagé.") from e
    if len(infos) > MAX_ZIP_ENTRIES or sum(i.file_size for i in infos) > MAX_UNCOMPRESSED:
        raise ImportError_("Fichier Excel refusé : contenu décompressé anormalement volumineux.")


def _parse_xlsx(content: bytes) -> list[dict]:
    check_zip(content)
    try:
        wb = load_workbook(io.BytesIO(content), read_only=True, data_only=True)
    except Exception as e:  # fichier corrompu, protégé par mot de passe…
        raise ImportError_(f"Impossible de lire le fichier Excel ({e.__class__.__name__}).") from e
    try:
        sheets = [_table_from_rows(ws.title, ws.iter_rows(values_only=True)) for ws in wb.worksheets]
    finally:
        wb.close()
    sheets = [s for s in sheets if s["headers"]]
    if not sheets:
        raise ImportError_("Aucun tableau trouvé dans le fichier.")
    return sheets


def _parse_csv(content: bytes) -> dict:
    for enc in ("utf-8-sig", "cp1252"):
        try:
            text = content.decode(enc)
            break
        except UnicodeDecodeError:
            continue
    else:
        raise ImportError_("Encodage du CSV non reconnu.")
    try:
        dialect = csv.Sniffer().sniff(text[:4096], delimiters=";,\t")
        delim = dialect.delimiter
    except csv.Error:
        delim = ";"
    table = _table_from_rows("CSV", csv.reader(io.StringIO(text), delimiter=delim))
    if not table["headers"]:
        raise ImportError_("Aucun tableau trouvé dans le fichier.")
    return table


# ---------------------------------------------------------------- mapping

# Ordre important : chaque colonne n'est attribuée qu'une fois, au premier champ qui la reconnaît.
PATTERNS = [
    ("manager", r"superieur|manager|\bn ?\+ ?1\b|responsable hierarchique|chef direct|hierarchie"),
    ("first_name", r"^prenom$|first ?name|^prenoms?\b"),
    ("last_name", r"^nom$|nom de famille|last ?name|surname|^nom usuel$"),
    (
        "name",
        r"nom complet|nom et prenom|prenom et nom|nom prenom|prenom nom|collaborat|salarie|employe|personne|^name$|full ?name|^agent$",
    ),
    ("site", r"site|batiment|etablissement|lieu|localisation|implantation|agence|bureau|locaux"),
    ("title", r"fonction|poste|intitule|titre|role|job|metier|emploi"),
    ("email", r"mail|courriel"),
    ("phone", r"tel|phone|portable|mobile|gsm"),
]


def suggest_mapping(headers: list[str], saved: dict | None = None) -> dict:
    """Propose {champ: index de colonne}. Réutilise le dernier mapping si les en-têtes correspondent."""
    norm = [norm_text(h) for h in headers]
    mapping: dict[str, int] = {}
    if saved:
        for field, header in saved.items():
            if field in FIELDS and norm_text(header) in norm:
                mapping[field] = norm.index(norm_text(header))
        if "name" in mapping or "last_name" in mapping:
            return mapping
        mapping = {}
    used: set[int] = set()
    for field, pattern in PATTERNS:
        for i, h in enumerate(norm):
            if i not in used and re.search(pattern, h):
                mapping[field] = i
                used.add(i)
                break
    # un « Nom » seul sans « Prénom » = nom complet
    if "last_name" in mapping and "first_name" not in mapping and "name" not in mapping:
        mapping["name"] = mapping.pop("last_name")
    return mapping


# ------------------------------------------------------------------ confidentialité : colonnes retenues
# Seules les colonnes associées à un champ de FIELDS sont lues. Toute autre colonne du fichier
# (salaire, date de naissance, n° de sécurité sociale, commentaires…) n'est jamais importée,
# conservée ni affichée : on « projette » le tableau sur les colonnes retenues dès que possible.


def clean_mapping(mapping: dict, width: int) -> dict:
    """Mapping sûr : champs connus uniquement, index valides, une colonne par champ,
    et « nom complet » prioritaire sur prénom + nom."""
    out: dict[str, int] = {}
    used: set[int] = set()
    for field in FIELDS:
        i = mapping.get(field)
        if isinstance(i, int) and not isinstance(i, bool) and 0 <= i < width and i not in used:
            out[field] = i
            used.add(i)
    if "name" in out:
        out.pop("first_name", None)
        out.pop("last_name", None)
    return out


def project_rows(rows: list[list[str]], mapping: dict) -> tuple[list[list[str]], dict]:
    """Ne garde QUE les colonnes retenues. Renvoie (lignes réduites, mapping vers les nouvelles colonnes)."""
    fields = [f for f in FIELDS if f in mapping]
    reduced = [[row[mapping[f]] if mapping[f] < len(row) else "" for f in fields] for row in rows]
    return reduced, {f: n for n, f in enumerate(fields)}


def preview(rows: list[list[str]], headers: list[str], mapping: dict, n: int = 8) -> dict:
    """Aperçu limité aux colonnes retenues (les autres ne sont jamais renvoyées au navigateur)."""
    reduced, _ = project_rows(rows[:n], mapping)
    fields = [f for f in FIELDS if f in mapping]
    return {
        "columns": [{"field": f, "index": mapping[f], "header": headers[mapping[f]]} for f in fields],
        "rows": reduced,
        "ignored_headers": [h for i, h in enumerate(headers) if i not in mapping.values()],
    }


def mapping_to_headers(mapping: dict, headers: list[str]) -> dict:
    return {f: headers[i] for f, i in mapping.items() if i is not None and 0 <= i < len(headers)}
