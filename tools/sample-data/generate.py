"""Génère des fichiers de test FICTIFS (aucune personne réelle).

Usage : uv run --project backend python tools/sample-data/generate.py   (openpyxl, installé par uv)

Produit, dans le même dossier :
  - collaborateurs_sans_superieur.xlsx  (Nom / Prénom séparés, titre au-dessus des en-têtes)
  - collaborateurs_avec_superieur.xlsx  (nom complet + colonne « Supérieur hiérarchique »)
  - collaborateurs_mise_a_jour.xlsx     (= sans_superieur avec départs, arrivées, changements)
  - collaborateurs.csv                  (séparateur « ; », encodage Windows-1252, comme un export Excel FR)
  - collaborateurs_avec_colonnes_sensibles.xlsx (colonnes RH en trop, à ne jamais importer)
  - sauvegarde-chiffree-exemple.json    (3 personnes, mot de passe « exemple-de-mot-de-passe » ;
                                         fichier fixe, produit par backend/crypto.py, relu par les tests Python ET JS)
  - photo-exemple.png                   (image abstraite pour tester l'ajout de photo)
"""

import csv
import unicodedata
from pathlib import Path

from openpyxl import Workbook
from openpyxl.styles import Font

OUT = Path(__file__).parent

S1, S2, S3 = "Siège - Lyon", "Atelier - Villeurbanne", "Entrepôt - Vénissieux"

# (prénom, nom, fonction, site, clé du supérieur ou None) ; la clé = index dans la liste
PEOPLE = [
    # --- Siège ---
    ("Hélène", "Marchand", "Directrice administrative et financière", S1, None),  # 0
    ("Claire", "Dubois", "Assistante de direction", S1, 0),  # 1
    ("François", "Lefèvre", "Responsable comptabilité", S1, 0),  # 2
    ("Nadia", "Benali", "Comptable", S1, 2),
    ("Julien", "Roux", "Comptable", S1, 2),
    ("Sophie", "Garnier", "Aide-comptable", S1, 2),
    ("Éloïse", "Fontaine", "Responsable RH", S1, 0),  # 6
    ("Karim", "Haddad", "Chargé de recrutement", S1, 6),
    ("Laura", "Perrin", "Gestionnaire paie", S1, 6),
    ("Jean-Baptiste", "Morel", "Responsable commercial", S1, 0),  # 9
    ("Camille", "Girard", "Commerciale", S1, 9),
    ("Thomas", "Bonnet", "Commercial", S1, 9),
    ("Inès", "Mercier", "Commerciale", S1, 9),
    ("Lucas", "Blanc", "Assistant commercial", S1, 9),
    ("Marion", "D'Almeida", "Chargée de communication", S1, 0),
    ("Pierre", "Lambert", "Responsable informatique", S1, 0),  # 15
    ("Yanis", "Chevalier", "Technicien support", S1, 15),
    # --- Atelier ---
    ("Philippe", "Rousseau", "Directeur de site", S2, None),  # 17
    ("Sandrine", "Vincent", "Assistante de site", S2, 17),
    ("Mehdi", "Brahimi", "Chef d'atelier", S2, 17),  # 19
    ("Antoine", "Faure", "Technicien de production", S2, 19),
    ("Julie", "André", "Technicienne de production", S2, 19),
    ("Romain", "Gauthier", "Technicien de production", S2, 19),
    ("Kevin", "Masson", "Opérateur", S2, 19),
    ("Amandine", "Lemoine", "Opératrice", S2, 19),
    ("Bruno", "Guerin", "Opérateur", S2, 19),
    ("Céline", "Robin", "Responsable qualité", S2, 17),  # 26
    ("Ousmane", "Diallo", "Technicien qualité", S2, 26),
    ("Manon", "Picard", "Technicienne qualité", S2, 26),
    ("Stéphane", "Arnaud", "Responsable maintenance", S2, 17),  # 29
    ("David", "Lopez", "Technicien de maintenance", S2, 29),
    ("Nicolas", "Henry", "Électricien", S2, 29),
    ("Fabien", "Caron", "Mécanicien", S2, 29),
    # --- Entrepôt ---
    ("Valérie", "Noël", "Responsable d'entrepôt", S3, None),  # 33
    ("Sébastien", "Fournier", "Chef d'équipe logistique", S3, 33),  # 34
    ("Mathieu", "Bertrand", "Préparateur de commandes", S3, 34),
    ("Aurélie", "Colin", "Préparatrice de commandes", S3, 34),
    ("Rachid", "Amrani", "Préparateur de commandes", S3, 34),
    ("Émilie", "Barbier", "Préparatrice de commandes", S3, 34),
    ("Guillaume", "Meyer", "Préparateur de commandes", S3, 34),
    ("Patrick", "Dumont", "Chef d'équipe expédition", S3, 33),  # 40
    ("Christophe", "Leroy", "Cariste", S3, 40),
    ("Samir", "Khelifi", "Cariste", S3, 40),
    ("Anthony", "Roche", "Cariste", S3, 40),
    ("Laetitia", "Renard", "Agente d'expédition", S3, 40),
    ("Isabelle", "Gaillard", "Gestionnaire de stock", S3, 33),  # 45
    ("Alexandre", "Schmitt", "Aide-gestionnaire de stock", S3, 45),
    ("Mélanie", "Brun", "Assistante logistique", S3, 33),
]


def ascii_slug(s: str) -> str:
    s = unicodedata.normalize("NFKD", s).encode("ascii", "ignore").decode()
    return s.lower().replace(" ", "").replace("'", "")


def email(first, last):
    return f"{ascii_slug(first)}.{ascii_slug(last)}@entreprise.test"


def phone(i):
    # plage 06 39 98 xx xx réservée par l'ARCEP aux œuvres de fiction : aucun numéro réel
    return f"06 39 98 {i // 100:02d} {i % 100:02d}"


def full(p):
    return f"{p[0]} {p[1]}"


def write_xlsx(path, title, headers, rows, widths):
    wb = Workbook()
    ws = wb.active
    ws.title = "Personnel"
    start = 1
    if title:
        ws.append([title])
        ws["A1"].font = Font(bold=True, size=14)
        ws.append([])
        start = 3
    ws.append(headers)
    for c in ws[start]:
        c.font = Font(bold=True)
    for r in rows:
        ws.append(r)
    for i, w in enumerate(widths):
        ws.column_dimensions[chr(65 + i)].width = w
    # Une seconde feuille, pour vérifier le choix de feuille à l'import
    info = wb.create_sheet("Infos")
    info.append(["Fichier fictif généré pour les tests de l'application Organigramme."])
    wb.save(path)


def basic_rows(people):
    return [[p[1].upper(), p[0], p[2], p[3], email(p[0], p[1]), phone(i)] for i, p in enumerate(people)]


HEAD_BASIC = ["Nom", "Prénom", "Fonction", "Bâtiment de rattachement", "Email", "Téléphone"]
WIDTHS = [18, 16, 40, 26, 36, 18]


def main():
    # 1. Sans supérieur
    write_xlsx(
        OUT / "collaborateurs_sans_superieur.xlsx",
        "Liste du personnel - novembre 2026",
        HEAD_BASIC,
        basic_rows(PEOPLE),
        WIDTHS,
    )

    # 2. Avec supérieur (nom complet ; certains supérieurs écrits « NOM Prénom »)
    rows = []
    for i, p in enumerate(PEOPLE):
        mgr = ""
        if p[4] is not None:
            m = PEOPLE[p[4]]
            mgr = f"{m[1].upper()} {m[0]}" if i % 3 == 0 else full(m)
        rows.append([full(p), p[2], p[3], email(p[0], p[1]), mgr])
    write_xlsx(
        OUT / "collaborateurs_avec_superieur.xlsx",
        None,
        ["Collaborateur", "Poste", "Site", "Mail", "Supérieur hiérarchique"],
        rows,
        [26, 40, 26, 36, 28],
    )

    # 3. Mise à jour : 2 départs, 3 arrivées, 1 changement de poste, 1 changement de site
    updated = [list(p) for p in PEOPLE]
    departed = {"Bruno Guerin", "Laetitia Renard"}
    updated = [p for p in updated if full(p) not in departed]
    for p in updated:
        if full(p) == "Lucas Blanc":
            p[2] = "Commercial"
        if full(p) == "Yanis Chevalier":
            p[3] = S2
    updated += [
        ["Zoé", "Martin", "Opératrice", S2, None],
        ["Hugo", "Petit", "Cariste", S3, None],
        ["Léa", "Durand", "Stagiaire RH", S1, None],
    ]
    write_xlsx(
        OUT / "collaborateurs_mise_a_jour.xlsx",
        "Liste du personnel - décembre 2026",
        HEAD_BASIC,
        basic_rows(updated),
        WIDTHS,
    )

    # 4. CSV « export Excel français »
    with open(OUT / "collaborateurs.csv", "w", encoding="cp1252", newline="") as f:
        w = csv.writer(f, delimiter=";")
        w.writerow(HEAD_BASIC)
        w.writerows(basic_rows(PEOPLE))

    # 5. Fichier « RH complet » : colonnes en trop, qui ne doivent JAMAIS être importées ni affichées.
    #    Valeurs volontairement marquées « CONFIDENTIEL » pour que les tests puissent les traquer.
    rows = []
    for i, p in enumerate(PEOPLE):
        rows.append(
            [
                f"CONFIDENTIEL-MATRICULE-{i:04d}",
                p[1].upper(),
                p[0],
                f"CONFIDENTIEL-NAISSANCE-{i:04d}",
                p[2],
                p[3],
                f"CONFIDENTIEL-SALAIRE-{i:04d}",
                f"CONFIDENTIEL-NIR-{i:04d}",
                email(p[0], p[1]),
                phone(i),
                f"CONFIDENTIEL-COMMENTAIRE-RH-{i:04d}",
            ]
        )
    write_xlsx(
        OUT / "collaborateurs_avec_colonnes_sensibles.xlsx",
        "Export RH complet - novembre 2026",
        [
            "Matricule",
            "Nom",
            "Prénom",
            "Date de naissance",
            "Fonction",
            "Site",
            "Salaire brut annuel",
            "N° de sécurité sociale",
            "Email",
            "Téléphone",
            "Commentaire RH",
        ],
        rows,
        [26, 16, 14, 28, 36, 24, 28, 26, 34, 16, 34],
    )

    # 6. Photo d'exemple (dégradé abstrait) pour tester l'ajout de photo
    try:
        from PIL import Image  # installé avec reportlab

        img = Image.new("RGB", (240, 240))
        img.putdata([(40 + x // 2, 90 + y // 3, 200 - x // 3) for y in range(240) for x in range(240)])
        img.save(OUT / "photo-exemple.png")
    except ImportError:
        pass

    print(f"{len(PEOPLE)} personnes, 3 sites -> fichiers écrits dans {OUT}")


if __name__ == "__main__":
    main()
