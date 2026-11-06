"""Tests de l'import : lecture, mapping, fusion par nom, hiérarchie.

Lancer : cd backend && uv run pytest -q   (ou make test-back, dans Docker)
"""

from helpers import SAMPLES, confirm, employees, upload, xlsx_bytes

# ------------------------------------------------------------------ lecture & mapping


def test_unit_helpers():
    from importer import name_key, pretty_name, suggest_mapping

    assert name_key("Hélène MARCHAND") == name_key("marchand  helene") == "helene marchand"
    assert pretty_name("MARION D'ALMEIDA") == "Marion D'Almeida"
    assert pretty_name("JEAN-BAPTISTE Morel") == "Jean-Baptiste Morel"
    m = suggest_mapping(["Nom", "Prénom", "Fonction", "Bâtiment de rattachement", "Email", "Téléphone"])
    assert m == {"last_name": 0, "first_name": 1, "title": 2, "site": 3, "email": 4, "phone": 5}
    m = suggest_mapping(["Collaborateur", "Poste", "Site", "Mail", "Supérieur hiérarchique"])
    assert m == {"name": 0, "title": 1, "site": 2, "email": 3, "manager": 4}
    assert suggest_mapping(["Nom", "Fonction"]) == {"name": 0, "title": 1}


def test_xlsx_with_title_row_and_two_sheets(client):
    up = upload(client, SAMPLES / "collaborateurs_sans_superieur.xlsx")
    assert [s["name"] for s in up["sheets"]] == ["Personnel"]  # « Infos » n'a pas de tableau
    s = up["sheets"][0]
    assert s["header_row"] == 3
    assert s["row_count"] == 48
    assert s["headers"][3] == "Bâtiment de rattachement"
    assert up["replaces_existing"] is False


def test_csv_cp1252_semicolon(client):
    up = upload(client, SAMPLES / "collaborateurs.csv")
    s = up["sheets"][0]
    assert s["headers"][1] == "Prénom" and s["row_count"] == 48
    res = confirm(client, up)
    assert res["total"] == 48
    assert "Hélène Marchand" in employees(client)


def test_rejects_xls_and_unknown(client):
    r = client.post("/api/import", files={"file": ("vieux.xls", b"xx")})
    assert r.status_code == 400 and ".xlsx" in r.json()["detail"]
    r = client.post("/api/import", files={"file": ("photo.png", b"xx")})
    assert r.status_code == 400


# ------------------------------------------------------------------ import & fusion


def test_import_without_manager(client):
    up = upload(client, SAMPLES / "collaborateurs_sans_superieur.xlsx")
    preview = confirm(client, up, dry_run=True)
    assert preview["applied"] is False and len(preview["added"]) == 48
    assert client.get("/api/health").json()["employees"] == 0  # simulation : rien d'écrit

    res = confirm(client, up)
    assert res["applied"] and res["hierarchy_source"] == "kept"
    emps = employees(client)
    assert len(emps) == 48
    h = emps["Hélène Marchand"]
    assert h["title"] == "Directrice administrative et financière"
    assert h["site"] == "Siège - Lyon" and h["manager_id"] is None
    assert emps["Marion D'Almeida"]["email"] == "marion.dalmeida@entreprise.test"
    sites = {s["name"]: s["count"] for s in client.get("/api/sites").json()}
    assert sites == {"Siège - Lyon": 17, "Atelier - Villeurbanne": 16, "Entrepôt - Vénissieux": 15}


def test_import_with_manager_column(client):
    up = upload(client, SAMPLES / "collaborateurs_avec_superieur.xlsx")
    res = confirm(client, up)
    assert res["hierarchy_source"] == "file"
    assert not res["warnings"]["unresolved_managers"]
    emps = employees(client)
    by_id = {e["id"]: e for e in emps.values()}
    assert by_id[emps["Nadia Benali"]["manager_id"]]["name"] == "François Lefèvre"
    # « MEHDI Brahimi » écrit « BRAHIMI Mehdi » dans la colonne supérieur -> résolu quand même
    assert by_id[emps["Antoine Faure"]["manager_id"]]["name"] == "Mehdi Brahimi"
    roots = sorted(e["name"] for e in emps.values() if e["manager_id"] is None)
    assert roots == ["Hélène Marchand", "Philippe Rousseau", "Valérie Noël"]


def test_reimport_keeps_manual_hierarchy(client):
    # 1) import avec hiérarchie (simule des liens saisis à la main)
    confirm(client, upload(client, SAMPLES / "collaborateurs_avec_superieur.xlsx"))
    before = employees(client)

    # 2) réimport d'un fichier SANS colonne supérieur, avec départs/arrivées/changements
    up = upload(client, SAMPLES / "collaborateurs_mise_a_jour.xlsx")
    assert up["replaces_existing"] is True
    mapping = {"last_name": 0, "first_name": 1, "title": 2, "site": 3, "email": 4, "phone": 5}
    preview = confirm(client, up, mapping=mapping, dry_run=True)
    assert sorted(preview["added"]) == ["Hugo Petit", "Léa Durand", "Zoé Martin"]
    assert sorted(preview["removed"]) == ["Bruno Guerin", "Laetitia Renard"]
    changed = {u["name"]: {c["field"] for c in u["changes"]} for u in preview["updated"]}
    assert changed["Lucas Blanc"] >= {"fonction"}
    assert changed["Yanis Chevalier"] >= {"site"}

    confirm(client, up, mapping=mapping)
    after = employees(client)
    assert len(after) == 49
    # la hiérarchie existante est conservée (même id, même supérieur)
    for name in ("Nadia Benali", "Antoine Faure", "Yanis Chevalier", "Lucas Blanc"):
        assert after[name]["id"] == before[name]["id"]
        assert after[name]["manager_id"] == before[name]["manager_id"]
    assert after["Lucas Blanc"]["title"] == "Commercial"
    assert after["Yanis Chevalier"]["site"] == "Atelier - Villeurbanne"
    # les nouveaux arrivent sans supérieur
    assert after["Zoé Martin"]["manager_id"] is None


def test_departure_of_manager_orphans_reports(client):
    rows = [
        ["Nom", "Fonction", "Site", "Supérieur"],
        ["Alice Chef", "Directrice", "A", ""],
        ["Bob Equipe", "Technicien", "A", "Alice Chef"],
    ]
    r = client.post("/api/import", files={"file": ("a.xlsx", xlsx_bytes(rows))})
    confirm(client, r.json())
    rows2 = [["Nom", "Fonction", "Site"], ["Bob Equipe", "Technicien", "A"]]
    r = client.post("/api/import", files={"file": ("b.xlsx", xlsx_bytes(rows2))})
    res = confirm(client, r.json(), dry_run=True)
    assert res["removed"] == ["Alice Chef"]
    assert res["warnings"]["orphaned"] == [{"name": "Bob Equipe", "former_manager": "Alice Chef"}]
    confirm(client, r.json())
    assert employees(client)["Bob Equipe"]["manager_id"] is None


def test_warnings_duplicates_unresolved_cycles_missing_site(client):
    rows = [
        ["Nom", "Site", "Manager"],
        ["Jean Dupont", "A", ""],
        ["Jean Dupont", "B", ""],
        ["Paul Durand", "", "Inconnu Total"],
        ["Ana X", "A", "Ben Y"],
        ["Ben Y", "A", "Ana X"],
    ]
    r = client.post("/api/import", files={"file": ("w.xlsx", xlsx_bytes(rows))})
    res = confirm(client, r.json())
    w = res["warnings"]
    assert w["duplicates"] == ["Jean Dupont"]
    assert w["unresolved_managers"] == [{"name": "Paul Durand", "manager": "Inconnu Total"}]
    assert len(w["cycles"]) == 1
    assert w["missing_site"] == ["Paul Durand"]
    assert len(employees(client)) == 4  # dict par nom : les 2 Jean Dupont fusionnent ici
    assert client.get("/api/health").json()["employees"] == 5


def test_saved_mapping_is_reused(client):
    up = upload(client, SAMPLES / "collaborateurs_sans_superieur.xlsx")
    m = dict(up["sheets"][0]["suggested_mapping"])
    m.pop("phone")  # l'utilisateur choisit de ne pas importer le téléphone
    confirm(client, up, mapping=m)
    up2 = upload(client, SAMPLES / "collaborateurs_mise_a_jour.xlsx")
    assert up2["sheets"][0]["suggested_mapping"] == m
    last = client.get("/api/import/last").json()
    assert last["filename"] == "collaborateurs_sans_superieur.xlsx" and last["total"] == 48


def test_bad_token_and_missing_name(client):
    r = client.post("/api/import/confirm", json={"token": "../../etc", "mapping": {"name": 0}})
    assert r.status_code == 400
    up = upload(client, SAMPLES / "collaborateurs_sans_superieur.xlsx")
    r = client.post("/api/import/confirm", json={"token": up["token"], "mapping": {"title": 2}})
    assert r.status_code == 400
