"""Export PDF de l'organigramme : A4 paysage, une page par site (reportlab, polices intégrées)."""

import base64
import datetime as dt
import io

from reportlab.lib.colors import HexColor, white
from reportlab.lib.pagesizes import A4, landscape
from reportlab.lib.utils import ImageReader, simpleSplit
from reportlab.pdfbase.pdfmetrics import stringWidth
from reportlab.pdfgen import canvas as rl_canvas
from tree import layout_items

PAGE_W, PAGE_H = landscape(A4)
MARGIN = 28
HEADER_H = 40
FOOTER_H = 16

CARD_W, CARD_H = 150, 54
H_GAP, V_GAP = 14, 28
STACK_GAP = 8
TREE_GAP = 34

INK = HexColor("#0f172a")
MUTED = HexColor("#64748b")
LINE = HexColor("#cbd5e1")
BORDER = HexColor("#e2e8f0")
NOTE = HexColor("#b45309")
SITE_COLORS = ["#2563eb", "#059669", "#d97706", "#7c3aed", "#db2777", "#0891b2", "#65a30d", "#dc2626"]


def initials(name: str) -> str:
    return "".join(w[0].upper() for w in name.split()[:2] if w)


def fit(text: str, font: str, size: float, width: float) -> str:
    if stringWidth(text, font, size) <= width:
        return text
    while text and stringWidth(text + "…", font, size) > width:
        text = text[:-1]
    return text.rstrip() + "…"


# ------------------------------------------------------------------ mise en page (coordonnées « haut-gauche »)


def measure(node: dict) -> None:
    """Calcule node['_w'], node['_h'], node['_anchor'] (centre de la carte, depuis la gauche du bloc)
    et node['_items'] = [(type, objet, largeur, hauteur, ancre)] selon tree.layout_items."""
    kids = node["reports"]
    if not kids:
        node["_w"], node["_h"], node["_anchor"], node["_items"] = CARD_W, CARD_H, CARD_W / 2, []
        return
    items = []
    for kind, obj in layout_items(node):
        if kind == "node":
            measure(obj)
            items.append((kind, obj, obj["_w"], obj["_h"], obj["_anchor"]))
        else:
            h = len(obj) * CARD_H + (len(obj) - 1) * STACK_GAP
            items.append((kind, obj, CARD_W, h, CARD_W / 2))
    cw = sum(i[2] for i in items) + H_GAP * (len(items) - 1)
    node["_items"] = items
    node["_w"] = max(CARD_W, cw)
    node["_h"] = CARD_H + V_GAP + max(i[3] for i in items)
    node["_anchor"] = node["_w"] / 2


class Drawer:
    def __init__(self, c: rl_canvas.Canvas, color: str):
        self.c = c
        self.color = HexColor(color)

    # y vers le bas dans nos calculs ; le canevas est translaté/échelonné, on inverse ici
    def card(self, n: dict, x: float, y: float) -> None:
        c = self.c
        c.setStrokeColor(BORDER)
        c.setFillColor(white)
        c.setLineWidth(0.8)
        c.roundRect(x, -(y + CARD_H), CARD_W, CARD_H, 6, stroke=1, fill=1)
        c.setFillColor(self.color)
        c.rect(x, -(y + CARD_H), 3, CARD_H, stroke=0, fill=1)

        cx, cy, r = x + 21, -(y + CARD_H / 2), 13
        if not self._photo(n.get("photo"), cx, cy, r):
            c.setFillColor(self.color)
            c.circle(cx, cy, r, stroke=0, fill=1)
            c.setFillColor(white)
            c.setFont("Helvetica-Bold", 8.5)
            c.drawCentredString(cx, cy - 3, initials(n["name"]))

        tx, tw = x + 40, CARD_W - 46
        c.setFillColor(INK)
        c.setFont("Helvetica-Bold", 8.5)
        c.drawString(tx, -(y + 14), fit(n["name"], "Helvetica-Bold", 8.5, tw))
        c.setFillColor(MUTED)
        c.setFont("Helvetica", 7)
        lines = simpleSplit(n.get("title") or "", "Helvetica", 7, tw)
        if len(lines) > 2:
            lines = [lines[0], fit(" ".join(lines[1:]), "Helvetica", 7, tw)]
        for i, line in enumerate(lines):
            c.drawString(tx, -(y + 24 + i * 8.5), line)
        contact = n.get("note") or n.get("phone") or n.get("email") or ""
        if contact:
            c.setFillColor(NOTE if n.get("note") else MUTED)
            c.setFont("Helvetica", 6.2)
            c.drawString(tx, -(y + CARD_H - 6), fit(contact, "Helvetica", 6.2, tw))

    def _photo(self, data_url: str | None, cx: float, cy: float, r: float) -> bool:
        if not data_url or not data_url.startswith("data:image/") or "," not in data_url:
            return False
        # Photo fournie par l'utilisateur : quelle que soit l'erreur de décodage, le PDF doit être produit
        # (on retombe sur les initiales). Capture large voulue.
        try:
            img = ImageReader(io.BytesIO(base64.b64decode(data_url.split(",", 1)[1])))
        except Exception:  # noqa: BLE001
            return False
        c = self.c
        c.saveState()
        try:
            p = c.beginPath()
            p.circle(cx, cy, r)
            c.clipPath(p, stroke=0, fill=0)
            c.drawImage(img, cx - r, cy - r, 2 * r, 2 * r, preserveAspectRatio=True, anchor="c")
            return True
        except Exception:  # noqa: BLE001 — image illisible : on retombe sur les initiales
            return False
        finally:
            c.restoreState()

    def line(self, x1, y1, x2, y2):
        self.c.setStrokeColor(LINE)
        self.c.setLineWidth(1)
        self.c.line(x1, -y1, x2, -y2)

    def column(self, nodes: list, left: float, top: float) -> None:
        """Colonne de personnes sans équipe : trait vertical derrière les cartes."""
        last_mid = top + (len(nodes) - 1) * (CARD_H + STACK_GAP) + CARD_H / 2
        self.line(left + CARD_W / 2, top, left + CARD_W / 2, last_mid)
        for i, k in enumerate(nodes):
            self.card(k, left, top + i * (CARD_H + STACK_GAP))

    def node(self, n: dict, left: float, top: float) -> None:
        px = left + n["_anchor"]
        self.card(n, px - CARD_W / 2, top)
        items = n.get("_items") or []
        if not items:
            return
        bus_y = top + CARD_H + V_GAP / 2
        child_top = top + CARD_H + V_GAP
        self.line(px, top + CARD_H, px, bus_y)
        cw = sum(i[2] for i in items) + H_GAP * (len(items) - 1)
        x = left + (n["_w"] - cw) / 2
        anchors = []
        for kind, obj, w, _h, anchor in items:
            ax = x + anchor
            anchors.append(ax)
            self.line(ax, bus_y, ax, child_top)
            if kind == "node":
                self.node(obj, x, child_top)
            else:
                self.column(obj, x, child_top)
            x += w + H_GAP
        self.line(min(anchors + [px]), bus_y, max(anchors + [px]), bus_y)


# ------------------------------------------------------------------ pages


def _draw_site_page(c, group: dict, color: str, generated: str, page: int, pages: int) -> None:
    c.setFillColor(INK)
    c.setFont("Helvetica-Bold", 16)
    c.drawString(MARGIN, PAGE_H - MARGIN - 12, group["site"])
    c.setFont("Helvetica", 9)
    c.setFillColor(MUTED)
    c.drawRightString(
        PAGE_W - MARGIN,
        PAGE_H - MARGIN - 10,
        f"{group['count']} personne{'s' if group['count'] > 1 else ''} · Organigramme au {generated}",
    )
    c.setStrokeColor(HexColor(color))
    c.setLineWidth(2)
    c.line(MARGIN, PAGE_H - MARGIN - 22, PAGE_W - MARGIN, PAGE_H - MARGIN - 22)
    c.setFont("Helvetica", 7)
    c.drawRightString(PAGE_W - MARGIN, MARGIN - 10, f"Page {page} / {pages}")

    trees, tray = group["trees"], group["unassigned"]
    for t in trees:
        measure(t)
    trees_w = sum(t["_w"] for t in trees) + TREE_GAP * max(0, len(trees) - 1)
    trees_h = max([t["_h"] for t in trees], default=0)

    avail_w = PAGE_W - 2 * MARGIN
    avail_h = PAGE_H - 2 * MARGIN - HEADER_H - FOOTER_H
    tray_cols = max(1, int(max(trees_w, avail_w) // (CARD_W + H_GAP)))
    tray_rows = -(-len(tray) // tray_cols) if tray else 0
    tray_title = 18 if tray else 0
    tray_w = min(len(tray), tray_cols) * (CARD_W + H_GAP) - H_GAP if tray else 0
    tray_h = tray_title + tray_rows * (CARD_H + STACK_GAP) if tray else 0
    gap = TREE_GAP if trees and tray else 0

    total_w = max(trees_w, tray_w, 1)
    total_h = max(trees_h + gap + tray_h, 1)
    s = min(1.0, avail_w / total_w, avail_h / total_h)

    c.saveState()
    ox = MARGIN + (avail_w - total_w * s) / 2
    c.translate(ox, PAGE_H - MARGIN - HEADER_H)
    c.scale(s, s)
    d = Drawer(c, color)
    x = (total_w - trees_w) / 2
    for t in trees:
        d.node(t, x, 0)
        x += t["_w"] + TREE_GAP
    if tray:
        y = trees_h + gap
        c.setFillColor(MUTED)
        c.setFont("Helvetica-Bold", 9)
        c.drawString(0, -(y + 10), f"Non rattachés ({len(tray)})")
        y += tray_title
        for i, n in enumerate(tray):
            r, col = divmod(i, tray_cols)
            d.card(n, col * (CARD_W + H_GAP), y + r * (CARD_H + STACK_GAP))
    c.restoreState()


def site_colors(all_groups: list[dict]) -> dict:
    """Couleur de chaque site = rang du site (trié par nom) dans la palette ; même règle côté frontend."""
    named = [g["site_id"] for g in all_groups if g["site_id"] is not None]
    return {sid: SITE_COLORS[i % len(SITE_COLORS)] for i, sid in enumerate(named)}


def render_pdf(groups: list[dict], colors: dict | None = None) -> bytes:
    buf = io.BytesIO()
    c = rl_canvas.Canvas(buf, pagesize=(PAGE_W, PAGE_H), invariant=1)
    c.setTitle("Organigramme")
    c.setAuthor("Organigramme")
    c.setCreator("Organigramme (local)")
    generated = dt.date.today().strftime("%d/%m/%Y")
    if not groups:
        c.setFont("Helvetica", 14)
        c.drawCentredString(PAGE_W / 2, PAGE_H / 2, "Aucun collaborateur à afficher.")
        c.showPage()
    for i, g in enumerate(groups):
        color = (colors or site_colors(groups)).get(g["site_id"], "#64748b")
        _draw_site_page(c, g, color, generated, i + 1, len(groups))
        c.showPage()
    c.save()
    return buf.getvalue()
