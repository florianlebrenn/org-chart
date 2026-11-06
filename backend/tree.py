"""Construction des arbres par site (règles partagées avec le frontend, cf. frontend/src/core/tree.js).

- Un arbre par site : racine = personne sans supérieur, ou dont le supérieur est sur un autre site.
- « Non rattachés » = personnes sans supérieur ET sans subordonné sur le site.
- Les subordonnés sans équipe (au moins STACK_MIN) sont empilés en colonnes de MAX_COLUMN au plus.
"""

import sqlite3

STACK_MIN = 3
NO_SITE = "Sans site"


def load_employees(conn: sqlite3.Connection, c) -> list[dict]:
    """Collaborateurs DÉCHIFFRÉS (c = crypto.FieldCipher de la session), triés comme dans le fichier."""
    rows = conn.execute(
        "SELECT e.id, e.name, e.name_key, e.title, e.email, e.phone, e.photo, e.site_id, s.name AS site, "
        "e.manager_id, e.sort_order FROM employees e LEFT JOIN sites s ON s.id = e.site_id "
        "ORDER BY e.sort_order, e.id"
    ).fetchall()
    out = []
    for r in rows:
        out.append(
            {
                "id": r["id"],
                "name": c.dec(r["name"], "employees.name"),
                "title": c.dec(r["title"], "employees.title"),
                "email": c.dec(r["email"], "employees.email"),
                "phone": c.dec(r["phone"], "employees.phone"),
                "photo": c.dec(r["photo"], "employees.photo"),
                "site_id": r["site_id"],
                "site": c.dec(r["site"], "sites.name"),
                "manager_id": r["manager_id"],
                "sort_order": r["sort_order"],
            }
        )
    return out


def load_sites(conn: sqlite3.Connection, c) -> list[dict]:
    rows = conn.execute(
        "SELECT s.id, s.name, COUNT(e.id) AS count FROM sites s LEFT JOIN employees e ON e.site_id = s.id GROUP BY s.id"
    ).fetchall()
    sites = [{"id": r["id"], "name": c.dec(r["name"], "sites.name"), "count": r["count"]} for r in rows]
    return sorted(sites, key=lambda x: x["name"].lower())


def would_create_cycle(conn: sqlite3.Connection, employee_id: int, manager_id: int) -> bool:
    """Vrai si `manager_id` est `employee_id` ou l'un de ses subordonnés (directs ou non)."""
    parents = dict(conn.execute("SELECT id, manager_id FROM employees").fetchall())
    cur, seen = manager_id, set()
    while cur is not None and cur not in seen:
        if cur == employee_id:
            return True
        seen.add(cur)
        cur = parents.get(cur)
    return False


MAX_COLUMN = 6


def layout_items(node: dict) -> list[tuple[str, object]]:
    """Disposition des enfants (même règle que frontend/src/core/tree.js `layoutItems`) :
    les personnes sans équipe sont empilées en colonnes (si au moins STACK_MIN), les autres côte à côte.
    -> [("node", noeud) | ("column", [noeuds])]"""
    kids = node["reports"]
    leaves = [k for k in kids if not k["reports"]]
    if len(leaves) < STACK_MIN:
        return [("node", k) for k in kids]
    items: list[tuple[str, object]] = [("node", k) for k in kids if k["reports"]]
    ncols = -(-len(leaves) // MAX_COLUMN)
    size = -(-len(leaves) // ncols)
    items += [("column", leaves[i : i + size]) for i in range(0, len(leaves), size)]
    return items


def site_groups(employees: list[dict], site_id: int | None = None) -> list[dict]:
    """[{site_id, site, count, trees: [noeud imbriqué], unassigned: [noeud]}] trié par nom de site."""
    by_id = {e["id"]: e for e in employees}
    groups: dict = {}
    for e in employees:
        groups.setdefault(e["site_id"], []).append(e)

    result = []
    for sid, people in groups.items():
        if site_id is not None and sid != site_id:
            continue
        ids = {p["id"] for p in people}
        nodes = {p["id"]: {**p, "reports": []} for p in people}
        roots = []
        for p in people:
            node = nodes[p["id"]]
            if p["manager_id"] in ids:
                nodes[p["manager_id"]]["reports"].append(node)
            else:
                m = by_id.get(p["manager_id"])
                if m:
                    node["note"] = f"Rattaché(e) à {m['name']}" + (f" ({m['site']})" if m["site"] else "")
                roots.append(node)
        trees = [r for r in roots if r["reports"] or r["manager_id"]]
        unassigned = [r for r in roots if not r["reports"] and not r["manager_id"]]
        result.append(
            {
                "site_id": sid,
                "site": people[0]["site"] or NO_SITE,
                "count": len(people),
                "trees": trees,
                "unassigned": unassigned,
            }
        )
    result.sort(key=lambda g: (g["site_id"] is None, g["site"].lower()))
    return result


def to_mermaid(groups: list[dict]) -> str:
    def q(s: str | None) -> str:
        return (s or "").replace('"', "#quot;").replace("<", "#lt;").replace(">", "#gt;")

    lines = ["flowchart TD"]
    edges = []
    for gi, g in enumerate(groups):
        lines.append(f'  subgraph S{gi}["{q(g["site"])}"]')

        def walk(n):
            label = q(n["name"]) + (f"<br/><small>{q(n['title'])}</small>" if n.get("title") else "")
            lines.append(f'    E{n["id"]}["{label}"]')
            for c in n["reports"]:
                edges.append(f"  E{n['id']} --> E{c['id']}")
                walk(c)

        for t in g["trees"] + g["unassigned"]:
            walk(t)
        lines.append("  end")
    return "\n".join(lines + edges) + "\n"
