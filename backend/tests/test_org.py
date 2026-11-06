"""Tests : arbres par site, modification de la hiérarchie, exports, sauvegarde."""

import base64
import io
import re

from helpers import SAMPLES, TEST_PASSWORD, confirm, employees, upload
from reportlab.lib.utils import ImageReader


def _png() -> str:
    from PIL import Image  # fourni avec reportlab

    buf = io.BytesIO()
    Image.new("RGB", (8, 8), (37, 99, 235)).save(buf, format="PNG")
    return "data:image/png;base64," + base64.b64encode(buf.getvalue()).decode()


PNG_1PX = _png()
BROKEN_PNG = "data:image/png;base64," + base64.b64encode(b"\x89PNG pas une image").decode()


def load(client, file="collaborateurs_avec_superieur.xlsx"):
    confirm(client, upload(client, SAMPLES / file))
    return employees(client)


def test_org_groups(client):
    load(client)
    groups = client.get("/api/org").json()
    assert [g["site"] for g in groups] == ["Atelier - Villeurbanne", "Entrepôt - Vénissieux", "Siège - Lyon"]
    siege = groups[2]
    assert siege["count"] == 17 and siege["unassigned"] == []
    root = siege["trees"][0]
    assert root["name"] == "Hélène Marchand"
    assert {c["name"] for c in root["reports"]} >= {"François Lefèvre", "Claire Dubois"}
    one = client.get("/api/org", params={"site_id": siege["site_id"]}).json()
    assert len(one) == 1 and one[0]["site"] == "Siège - Lyon"


def test_unassigned_and_attach(client):
    emps = load(client, "collaborateurs_sans_superieur.xlsx")
    groups = client.get("/api/org").json()
    atelier = groups[0]
    assert atelier["trees"] == [] and len(atelier["unassigned"]) == 16
    head = emps["Philippe Rousseau"]["id"]
    r = client.post("/api/attach-unassigned", json={"manager_id": head, "site_id": atelier["site_id"]})
    assert r.json() == {"attached": 15}
    atelier = client.get("/api/org", params={"site_id": atelier["site_id"]}).json()[0]
    assert atelier["unassigned"] == [] and atelier["trees"][0]["name"] == "Philippe Rousseau"
    assert len(atelier["trees"][0]["reports"]) == 15


def test_patch_manager_cycle_and_root(client):
    e = load(client)
    nadia, francois, helene = (e[n]["id"] for n in ("Nadia Benali", "François Lefèvre", "Hélène Marchand"))
    # boucle : Hélène sous Nadia (qui est sous François, sous Hélène) -> refusé
    r = client.patch(f"/api/employees/{helene}", json={"manager_id": nadia})
    assert r.status_code == 400 and "boucle" in r.json()["detail"]
    r = client.patch(f"/api/employees/{nadia}", json={"manager_id": nadia})
    assert r.status_code == 400
    # déplacement valide puis remise en racine
    r = client.patch(f"/api/employees/{nadia}", json={"manager_id": helene})
    assert r.status_code == 200 and r.json()["manager_id"] == helene
    r = client.patch(f"/api/employees/{nadia}", json={"manager_id": None})
    assert r.json()["manager_id"] is None
    # un champ non envoyé n'est pas modifié
    r = client.patch(f"/api/employees/{francois}", json={"title": "  Chef comptable "})
    assert r.json()["title"] == "Chef comptable" and r.json()["manager_id"] == helene


def test_patch_photo_and_site(client):
    e = load(client)
    nadia = e["Nadia Benali"]["id"]
    assert client.patch(f"/api/employees/{nadia}", json={"photo": "javascript:alert(1)"}).status_code == 400
    r = client.patch(f"/api/employees/{nadia}", json={"photo": PNG_1PX})
    assert r.json()["photo"] == PNG_1PX
    sites = {s["name"]: s["id"] for s in client.get("/api/sites").json()}
    r = client.patch(f"/api/employees/{nadia}", json={"site_id": sites["Atelier - Villeurbanne"]})
    assert r.json()["site"] == "Atelier - Villeurbanne"
    # supérieur resté au siège -> racine de l'atelier avec une note
    atelier = client.get("/api/org", params={"site_id": sites["Atelier - Villeurbanne"]}).json()[0]
    moved = next(t for t in atelier["trees"] if t["name"] == "Nadia Benali")
    assert "François Lefèvre" in moved["note"]
    assert client.patch(f"/api/employees/{nadia}", json={"site_id": 9999}).status_code == 400
    assert client.patch("/api/employees/9999", json={"title": "x"}).status_code == 404


def _pdf_pages(content: bytes) -> int:
    return len(re.findall(rb"/Type\s*/Page[^s]", content))


def test_pdf_export(client):
    e = load(client)
    client.patch(f"/api/employees/{e['Hélène Marchand']['id']}", json={"photo": PNG_1PX})
    r = client.get("/api/export/pdf")
    assert r.status_code == 200 and r.headers["content-type"] == "application/pdf"
    assert r.content.startswith(b"%PDF") and _pdf_pages(r.content) == 3
    assert "attachment" in r.headers["content-disposition"]
    sid = client.get("/api/sites").json()[0]["id"]
    r = client.get("/api/export/pdf", params={"site_id": sid})
    assert _pdf_pages(r.content) == 1
    assert "organigramme-atelier-villeurbanne" in r.headers["content-disposition"]


def test_pdf_empty_and_flat(client):
    r = client.get("/api/export/pdf")
    assert r.status_code == 200 and _pdf_pages(r.content) == 1
    load(client, "collaborateurs_sans_superieur.xlsx")  # tout le monde « non rattaché »
    assert _pdf_pages(client.get("/api/export/pdf").content) == 3


def test_mermaid(client):
    load(client)
    text = client.get("/api/export/mermaid").text
    assert text.startswith("flowchart TD")
    assert 'subgraph S0["Atelier - Villeurbanne"]' in text
    assert text.count("-->") == 45  # 48 personnes - 3 racines


def test_backup_restore_reset(client):
    e = load(client)
    client.patch(f"/api/employees/{e['Nadia Benali']['id']}", json={"photo": PNG_1PX})
    assert client.post("/api/backup", json={"password": "mauvais mot de passe"}).status_code == 401
    doc = client.post("/api/backup", json={"password": TEST_PASSWORD}).json()
    # la sauvegarde est chiffrée : aucun nom lisible
    assert doc["format"] == "organigramme-sauvegarde-chiffree" and "Nadia" not in str(doc)
    assert client.delete("/api/data").json() == {"status": "ok"}
    assert client.get("/api/health").json()["employees"] == 0
    assert client.post("/api/restore", json={"backup": {"foo": 1}}).status_code == 400
    assert client.post("/api/restore", json={"backup": doc, "password": "faux"}).status_code == 400
    assert client.post("/api/restore", json={"backup": doc, "password": TEST_PASSWORD}).json() == {"restored": 48}
    after = employees(client)
    assert after["Nadia Benali"]["photo"] == PNG_1PX
    by_id = {x["id"]: x for x in after.values()}
    assert by_id[after["Nadia Benali"]["manager_id"]]["name"] == "François Lefèvre"
    # le réimport après restauration reconnaît toujours les personnes
    up = upload(client, SAMPLES / "collaborateurs_avec_superieur.xlsx")
    assert confirm(client, up, dry_run=True)["added"] == []


def test_pdf_survives_broken_photo(client):
    e = load(client)
    client.patch(f"/api/employees/{e['Nadia Benali']['id']}", json={"photo": BROKEN_PNG})
    assert client.get("/api/export/pdf").content.startswith(b"%PDF")


def test_png_fixture_is_valid():
    ImageReader(io.BytesIO(base64.b64decode(PNG_1PX.split(",")[1]))).getSize()


def test_openapi_for_swagger(client):
    spec = client.get("/api/openapi.json").json()
    assert spec["info"]["title"] == "Organigramme — API locale"
    assert {t["name"] for t in spec["tags"]} == {"Santé", "Coffre", "Import", "Collaborateurs", "Exports", "Sauvegarde"}
    assert "/api/employees/{emp_id}" in spec["paths"]
    assert client.get("/docs").status_code == 404  # page Swagger CDN de FastAPI désactivée
