#!/usr/bin/env python3
"""Prépare un fichier du personnel pour l'organigramme SANS exposer les colonnes inutiles.

- `--entetes` : affiche uniquement la ligne d'en-têtes détectée et le mapping proposé (aucune valeur de cellule).
- sinon : écrit une copie .xlsx ne contenant QUE les colonnes retenues (mapping proposé ou --garder),
  et affiche seulement les en-têtes conservés, les en-têtes écartés et le nombre de lignes.

Utilise la même lecture que l'application (backend/importer.py : détection de l'en-tête, protection XML et zip).
Dépendances : celles du backend (openpyxl, defusedxml), installées par uv ; lancer avec
`uv run --project backend python …` depuis la racine du dépôt.

Exemples :
  uv run --project backend python skills/importer-fichier-personnel/scripts/reduire_colonnes.py personnel.xlsx --entetes
  uv run --project backend python skills/importer-fichier-personnel/scripts/reduire_colonnes.py personnel.xlsx -o personnel_organigramme.xlsx
  uv run --project backend python skills/importer-fichier-personnel/scripts/reduire_colonnes.py personnel.xlsx --garder "Nom,Prénom,Poste,Site" -o reduit.xlsx

La copie produite contient encore des données personnelles : à importer puis à supprimer, jamais à committer.
"""

from __future__ import annotations

import argparse
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[3]
sys.path.insert(0, str(ROOT / "backend"))

import importer


def main() -> int:
    ap = argparse.ArgumentParser(description=__doc__.split("\n")[0])
    ap.add_argument("fichier", type=Path)
    ap.add_argument("--feuille", type=int, default=0, help="index de la feuille (0 = première feuille avec un tableau)")
    ap.add_argument("--entetes", action="store_true", help="afficher seulement les en-têtes et le mapping proposé")
    ap.add_argument("--garder", help="en-têtes à conserver, séparés par des virgules (défaut : mapping proposé)")
    ap.add_argument("-o", "--sortie", type=Path, help="fichier .xlsx réduit à écrire")
    args = ap.parse_args()

    try:
        sheets = importer.parse_file(args.fichier.name, args.fichier.read_bytes())
    except importer.ImportError_ as e:
        print(f"Erreur : {e}", file=sys.stderr)
        return 2
    if not 0 <= args.feuille < len(sheets):
        print(f"Feuille {args.feuille} introuvable ({len(sheets)} feuille(s) avec un tableau).", file=sys.stderr)
        return 2
    sheet = sheets[args.feuille]
    headers = sheet["headers"]
    suggested = importer.suggest_mapping(headers)

    print(f"Feuilles avec un tableau : {[s['name'] for s in sheets]}")
    print(f"Feuille « {sheet['name']} », en-têtes ligne {sheet['header_row']}, {len(sheet['rows'])} lignes")
    print("En-têtes :", headers)
    print("Mapping proposé :", {f: headers[i] for f, i in suggested.items()})
    if args.entetes:
        return 0
    if not args.sortie:
        print("Indiquez -o <fichier.xlsx> pour écrire la copie réduite (ou --entetes).", file=sys.stderr)
        return 2

    if args.garder:
        wanted = [h.strip() for h in args.garder.split(",") if h.strip()]
        unknown = [h for h in wanted if h not in headers]
        if unknown:
            print(f"En-têtes inconnus : {unknown}", file=sys.stderr)
            return 2
        keep = [headers.index(h) for h in wanted]
    else:
        keep = sorted(importer.clean_mapping(suggested, len(headers)).values())
    if not keep:
        print("Aucune colonne retenue.", file=sys.stderr)
        return 2

    from openpyxl import Workbook

    wb = Workbook()
    ws = wb.active
    ws.title = "Personnel"
    ws.append([headers[i] for i in keep])
    for row in sheet["rows"]:
        ws.append([row[i] for i in keep])
    wb.save(args.sortie)
    print("Colonnes conservées :", [headers[i] for i in keep])
    print("Colonnes écartées   :", [h for i, h in enumerate(headers) if i not in keep])
    print(f"→ {args.sortie} ({len(sheet['rows'])} lignes). À importer puis supprimer ; ne jamais committer.")
    return 0


if __name__ == "__main__":
    sys.exit(main())
