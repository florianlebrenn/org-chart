"""Fusion d'un fichier importé avec la base.

Règles :
- une personne est reconnue par son NOM (insensible à la casse, aux accents et à l'ordre prénom/nom) ;
- personne présente des deux côtés  -> mise à jour (fonction, site, contact), hiérarchie CONSERVÉE ;
- personne nouvelle                 -> ajoutée sans supérieur ;
- personne absente du fichier       -> retirée (ses subordonnés remontent en racine, signalé) ;
- si une colonne « supérieur » est mappée, c'est le fichier qui fait foi pour la hiérarchie ;
- homonymes : appariés dans l'ordre du fichier, et signalés.
"""

import datetime as dt
import sqlite3
from collections import defaultdict

import db
from importer import name_key, pretty_name
from tree import load_employees


def build_records(rows: list[list[str]], mapping: dict) -> tuple[list[dict], int]:
    """Transforme les lignes du tableau en fiches. Renvoie (fiches, nb de lignes sans nom)."""

    def col(row, field):
        i = mapping.get(field)
        return row[i].strip() if i is not None and 0 <= i < len(row) else ""

    records, skipped = [], 0
    for n, row in enumerate(rows):
        if "name" in mapping:
            name = col(row, "name")
        else:
            name = " ".join(p for p in (col(row, "first_name"), col(row, "last_name")) if p)
        name = pretty_name(name)
        if not name:
            skipped += 1
            continue
        records.append(
            {
                "row": n,
                "name": name,
                "key": name_key(name),
                "title": col(row, "title") or None,
                "site": col(row, "site") or None,
                "email": col(row, "email") or None,
                "phone": col(row, "phone") or None,
                "manager_raw": col(row, "manager"),
            }
        )
    return records, skipped


def _resolve_managers(records: list[dict], warnings: dict) -> list[int | None]:
    """Pour chaque fiche, index de la fiche du supérieur (ou None)."""
    by_key = defaultdict(list)
    for i, r in enumerate(records):
        by_key[r["key"]].append(i)
    result: list[int | None] = []
    for i, r in enumerate(records):
        raw = r["manager_raw"]
        if not raw:
            result.append(None)
            continue
        cands = [c for c in by_key.get(name_key(raw), []) if c != i]
        if not cands:
            warnings["unresolved_managers"].append({"name": r["name"], "manager": raw})
            result.append(None)
            continue
        if len(cands) > 1:
            warnings["ambiguous_managers"].append({"name": r["name"], "manager": raw})
        result.append(cands[0])
    # casse les éventuelles boucles (A -> B -> A)
    for start in range(len(records)):
        seen, cur = set(), start
        while cur is not None and cur not in seen:
            seen.add(cur)
            cur = result[cur]
        if cur is not None and cur == start:
            warnings["cycles"].append(records[start]["name"])
            result[start] = None
    return result


def compute_plan(conn: sqlite3.Connection, records: list[dict], manager_mapped: bool, c) -> dict:
    """c = crypto.FieldCipher : les noms sont comparés via leur empreinte HMAC (name_key en base)."""
    existing = load_employees(conn, c)
    stored_keys = dict(conn.execute("SELECT id, name_key FROM employees").fetchall())
    ex_by_key = defaultdict(list)
    for e in existing:
        e["site_name"] = e["site"]
        ex_by_key[stored_keys.get(e["id"]) or c.index(name_key(e["name"]))].append(e)

    warnings = {
        k: [] for k in ("duplicates", "unresolved_managers", "ambiguous_managers", "cycles", "orphaned", "missing_site")
    }

    # appariement par clé de nom, dans l'ordre
    rec_by_key = defaultdict(list)
    for i, r in enumerate(records):
        rec_by_key[c.index(r["key"])].append(i)
    match: dict[int, sqlite3.Row] = {}
    removed = []
    for key, idxs in rec_by_key.items():
        if len(idxs) > 1:
            warnings["duplicates"].append(records[idxs[0]]["name"])
        olds = ex_by_key.get(key, [])
        for i, old in zip(idxs, olds, strict=False):  # homonymes : plus ou moins d'anciens que de nouveaux
            match[i] = old
        removed.extend(olds[len(idxs) :])
    for key, olds in ex_by_key.items():
        if key not in rec_by_key:
            removed.extend(olds)

    added, updated, unchanged = [], [], 0
    labels = {"name": "nom", "title": "fonction", "site": "site", "email": "email", "phone": "téléphone"}
    for i, r in enumerate(records):
        if not r["site"]:
            warnings["missing_site"].append(r["name"])
        old = match.get(i)
        if old is None:
            added.append(r["name"])
            continue
        before = {
            "name": old["name"],
            "title": old["title"],
            "site": old["site_name"],
            "email": old["email"],
            "phone": old["phone"],
        }
        changes = [
            {"field": labels[f], "before": before[f], "after": r[f]}
            for f in labels
            if (before[f] or None) != (r[f] or None)
        ]
        if changes:
            updated.append({"name": r["name"], "changes": changes})
        else:
            unchanged += 1

    managers = _resolve_managers(records, warnings) if manager_mapped else None

    if not manager_mapped:
        removed_ids = {e["id"] for e in removed}
        by_id = {e["id"]: e for e in existing}
        for i, old in match.items():
            if old["manager_id"] in removed_ids:
                warnings["orphaned"].append(
                    {"name": records[i]["name"], "former_manager": by_id[old["manager_id"]]["name"]}
                )

    sites = defaultdict(int)
    for r in records:
        sites[r["site"] or "Sans site"] += 1

    return {
        "summary": {
            "total": len(records),
            "added": added,
            "removed": [e["name"] for e in removed],
            "updated": updated,
            "unchanged": unchanged,
            "sites": [{"name": k, "count": v} for k, v in sorted(sites.items())],
            "hierarchy_source": "file" if manager_mapped else "kept",
            "warnings": warnings,
        },
        "_match": match,
        "_removed": removed,
        "_managers": managers,
    }


def apply_plan(conn: sqlite3.Connection, records: list[dict], plan: dict, c) -> None:
    match, removed, managers = plan["_match"], plan["_removed"], plan["_managers"]

    # sites (nom chiffré, retrouvé par son empreinte)
    site_ids = {}
    for name in {r["site"] for r in records if r["site"]}:
        h = c.index(name)
        row = conn.execute("SELECT id FROM sites WHERE name_hash = ?", (h,)).fetchone()
        if row is None:
            row = {
                "id": conn.execute(
                    "INSERT INTO sites(name, name_hash) VALUES (?, ?)", (c.enc(name, "sites.name"), h)
                ).lastrowid
            }
        site_ids[name] = row["id"]

    # retraits d'abord (les subordonnés passent à NULL grâce à ON DELETE SET NULL)
    gone = [(e["id"],) for e in removed]
    conn.executemany("UPDATE employees SET manager_id = NULL WHERE manager_id = ?", gone)
    conn.executemany("DELETE FROM employees WHERE id = ?", gone)

    ids: list[int] = []
    for i, r in enumerate(records):
        values = (
            c.enc(r["name"], "employees.name"),
            c.index(r["key"]),
            c.enc(r["title"], "employees.title"),
            c.enc(r["email"], "employees.email"),
            c.enc(r["phone"], "employees.phone"),
            site_ids.get(r["site"]),
            i,
        )
        old = match.get(i)
        if old is not None:
            conn.execute(
                "UPDATE employees SET name=?, name_key=?, title=?, email=?, phone=?, site_id=?, "
                "sort_order=? WHERE id=?",
                (*values, old["id"]),
            )
            ids.append(old["id"])
        else:
            cur = conn.execute(
                "INSERT INTO employees(name, name_key, title, email, phone, site_id, sort_order) "
                "VALUES (?, ?, ?, ?, ?, ?, ?)",
                values,
            )
            ids.append(cur.lastrowid)

    if managers is not None:  # le fichier fait foi pour la hiérarchie
        conn.executemany(
            "UPDATE employees SET manager_id = ? WHERE id = ?",
            [(ids[m] if m is not None else None, ids[i]) for i, m in enumerate(managers)],
        )

    conn.execute("DELETE FROM sites WHERE id NOT IN (SELECT site_id FROM employees WHERE site_id IS NOT NULL)")


def run_import(conn, rows, mapping, mapping_headers: dict, filename, dry_run: bool, c) -> dict:
    """`rows`/`mapping` : tableau DÉJÀ réduit aux colonnes retenues (importer.project_rows).
    `mapping_headers` : {champ: en-tête d'origine}, mémorisé pour pré-remplir le prochain import."""
    records, skipped = build_records(rows, mapping)
    if not records:
        raise ValueError("Aucune ligne avec un nom : vérifiez la colonne choisie pour le nom.")
    plan = compute_plan(conn, records, manager_mapped="manager" in mapping, c=c)
    summary = plan["summary"]
    summary["skipped_rows"] = skipped
    if not dry_run:
        apply_plan(conn, records, plan, c)
        db.set_setting(conn, "import_mapping", mapping_headers, c)
        db.set_setting(
            conn,
            "last_import",
            cipher=c,
            value={
                "filename": filename,
                "date": dt.datetime.now().isoformat(timespec="seconds"),
                "total": summary["total"],
                "added": len(summary["added"]),
                "removed": len(summary["removed"]),
                "updated": len(summary["updated"]),
            },
        )
    return summary
