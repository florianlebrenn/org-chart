#!/usr/bin/env python3
"""Garde-fou avant commit : aucune donnée personnelle réelle dans le dépôt.

Refuse :
- les fichiers de données (Excel, CSV, base, PDF, images, sauvegardes) hors des exemples fictifs ;
- toute adresse email hors des domaines fictifs ou techniques autorisés ;
- tout numéro de téléphone français hors des plages réservées à la fiction par l'ARCEP ;
- tout numéro de sécurité sociale (NIR) apparent.

Usage : python tools/hooks/check_data_files.py <fichiers…>   (appelé par pre-commit, et en CI sur tout le dépôt)
Aucune dépendance. Code de sortie 1 en cas de problème.
"""

from __future__ import annotations

import re
import sys
from pathlib import Path

# Dossiers où des fichiers de données FICTIFS sont attendus
ALLOWED_DATA_DIRS = ("tools/sample-data/", "tools/csv-converter/")
DATA_EXTENSIONS = {
    ".xlsx",
    ".xlsm",
    ".xls",
    ".ods",
    ".csv",
    ".tsv",
    ".db",
    ".sqlite",
    ".sqlite3",
    ".pdf",
    ".png",
    ".jpg",
    ".jpeg",
    ".gif",
    ".webp",
    ".heic",
    ".bmp",
    ".tif",
    ".tiff",
    ".mmd",
}
# Fichiers générés ou minifiés : pas d'analyse ligne à ligne (faux positifs)
SKIP_CONTENT = ("package-lock.json", "static/organigramme.html", "tools/hooks/check_data_files.py")
ALLOWED_EMAIL_DOMAINS = ("entreprise.test", "example.com", "example.org", "example.net", "users.noreply.github.com")
# Plages ARCEP réservées à la fiction (01 99 00, 02 61 91, 03 53 01, 04 65 71, 05 36 49, 06 39 98, 07 …)
FICTION_PHONE_PREFIXES = ("0199 00", "0261 91", "0353 01", "0465 71", "0536 49", "0639 98")

EMAIL = re.compile(r"[A-Za-z0-9._%+-]+@([A-Za-z0-9-]+(?:\.[A-Za-z0-9-]+)*\.[A-Za-z]{2,})")
PHONE = re.compile(r"(?<![\w/.+])(?:\+33[ .]?|0)([1-9])(?:[ .-]?\d{2}){4}(?![\w/.])")
NIR = re.compile(r"(?<!\d)[12][ .]?\d{2}[ .]?(?:0[1-9]|1[0-2])[ .]?(?:\d{2}|2[AB])[ .]?\d{3}[ .]?\d{3}[ .]?\d{2}(?!\d)")


def normalize_phone(raw: str) -> str:
    digits = re.sub(r"\D", "", raw)
    if digits.startswith("33"):
        digits = "0" + digits[2:]
    return f"{digits[:4]} {digits[4:6]}"


def check(path: str) -> list[str]:
    p = Path(path)
    rel = p.as_posix()
    problems: list[str] = []
    if not p.is_file():
        return problems
    if backup_like(p):
        problems.append("ressemble à une sauvegarde de l'organigramme : ne jamais la committer")
    if p.suffix.lower() in DATA_EXTENSIONS and not rel.startswith(ALLOWED_DATA_DIRS):
        problems.append(f"fichier de données ({p.suffix}) hors de {', '.join(ALLOWED_DATA_DIRS)}")
        return problems
    if rel.endswith(SKIP_CONTENT) or p.stat().st_size > 2_000_000:
        return problems
    try:
        text = p.read_text(encoding="utf-8")
    except (UnicodeDecodeError, OSError):
        return problems
    for n, line in enumerate(text.splitlines(), 1):
        for m in EMAIL.finditer(line):
            domain = m.group(1).lower()
            if not domain.endswith(ALLOWED_EMAIL_DOMAINS):
                problems.append(f"ligne {n} : adresse email non fictive (domaine {domain})")
        for m in PHONE.finditer(line):
            if not normalize_phone(m.group(0)).startswith(FICTION_PHONE_PREFIXES) and not m.group(0).startswith("07"):
                problems.append(f"ligne {n} : numéro de téléphone hors des plages de fiction (06 39 98 xx xx…)")
        if NIR.search(line):
            problems.append(f"ligne {n} : ressemble à un numéro de sécurité sociale")
    return problems


def backup_like(p: Path) -> bool:
    if p.suffix.lower() != ".json" or p.as_posix().startswith(ALLOWED_DATA_DIRS):
        return False
    try:
        head = p.read_text(encoding="utf-8", errors="ignore")[:4000]
    except OSError:
        return False
    return '"organigramme-sauvegarde' in head


def main(argv: list[str]) -> int:
    failed = False
    for path in argv:
        for problem in check(path):
            failed = True
            print(f"✗ {path} : {problem}")
    if failed:
        print("\nDonnées personnelles possibles : retirez ces éléments (voir AGENTS.md §1).")
        print("Les exemples doivent rester fictifs : emails @entreprise.test, téléphones 06 39 98 xx xx.")
    return 1 if failed else 0


if __name__ == "__main__":
    sys.exit(main(sys.argv[1:]))
