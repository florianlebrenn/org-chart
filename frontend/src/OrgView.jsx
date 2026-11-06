import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import {
  Building2, FileDown, FileSpreadsheet, GitFork, List, Maximize2, Minus, Network, Plus, Printer, Search, UserCheck, X,
} from "lucide-react";
import { ChartContext } from "./components/chartContext.js";
import OrgChart from "./components/OrgChart.jsx";
import OrgList from "./components/OrgList.jsx";
import PersonCard from "./components/PersonCard.jsx";
import DetailsPanel from "./components/DetailsPanel.jsx";
import { filterGroups, guessSiteHead, NO_SITE_COLOR, siteColors, siteGroups, toMermaid, walk, wouldCreateCycle } from "./core/tree.js";
import { downloadBlob, exportName } from "./data/download.js";

const ZOOMS = [0.4, 0.5, 0.6, 0.7, 0.8, 0.9, 1, 1.15, 1.3, 1.5];
// Zone imprimable d'une page A4 paysage (marges 10 mm), en px CSS, moins l'en-tête de section.
const PRINT_W = 1040;
const PRINT_H = 640;
// gabarit des cartes « non rattachés » (carte 220 px + écart 12 px ; ligne 64 + 10 px ; titre)
const TRAY_CARD_W = 232;
const TRAY_ROW_H = 74;
const TRAY_HEAD_H = 56;

const btn = "inline-flex items-center gap-1.5 rounded-xl border bg-white px-3 py-2 text-sm shadow-sm hover:bg-slate-50 disabled:opacity-50";

function Toast({ toast, onClose }) {
  useEffect(() => {
    if (!toast) return;
    const t = setTimeout(onClose, toast.error ? 8000 : 6000);
    return () => clearTimeout(t);
  }, [toast, onClose]);
  if (!toast) return null;
  return (
    <div role="status" className={`no-print pointer-events-none fixed bottom-5 left-1/2 z-50 flex -translate-x-1/2 items-center gap-3 rounded-xl px-4 py-3 text-sm shadow-lg ${
      toast.error ? "bg-red-700 text-white" : "bg-slate-900 text-white"
    }`}>
      <span>{toast.message}</span>
      {toast.undo && (
        <button className="pointer-events-auto rounded-lg bg-white/15 px-2 py-0.5 font-semibold hover:bg-white/25" onClick={() => { toast.undo(); onClose(); }}>
          Annuler
        </button>
      )}
      <button onClick={onClose} aria-label="Fermer" className="pointer-events-auto opacity-70 hover:opacity-100"><X size={14} /></button>
    </div>
  );
}

/** Bloc « Non rattachés » d'un site : cible de dépôt + rattachement groupé. */
function UnassignedTray({ group, people, onAttachAll, onDropRoot, ctx }) {
  const [managerId, setManagerId] = useState(() => guessSiteHead(people)?.id ?? "");
  const n = group.unassigned.length;
  const [over, setOver] = useState(false);
  return (
    <div
      data-testid="unassigned-tray"
      onDragOver={(e) => { if (ctx.dragId && ctx.canDropRoot()) { e.preventDefault(); setOver(true); } }}
      onDragLeave={() => setOver(false)}
      onDrop={(e) => { e.preventDefault(); setOver(false); onDropRoot(); }}
      className={`mx-4 mb-4 rounded-2xl border-2 border-dashed p-3 transition-colors ${over ? "border-emerald-500 bg-emerald-50" : "border-slate-200"}`}
    >
      <div className="mb-3 flex flex-wrap items-center gap-2 text-sm">
        <span className="font-semibold text-slate-600">Non rattachés ({n})</span>
        <span className="no-print text-xs text-slate-400">
          {n ? "Glissez une carte sur son supérieur, ou rattachez tout le monde d'un coup →" : "Déposez ici une carte pour la retirer de la hiérarchie."}
        </span>
        {n > 0 && ctx.editable && (
          <span className="no-print ml-auto flex items-center gap-2">
            <select
              data-testid="attach-select"
              value={managerId}
              onChange={(e) => setManagerId(e.target.value === "" ? "" : Number(e.target.value))}
              className="max-w-56 rounded-lg border px-2 py-1 text-sm"
            >
              <option value="">Choisir le responsable…</option>
              {people.map((p) => <option key={p.id} value={p.id}>{p.name}{p.title ? ` — ${p.title}` : ""}</option>)}
            </select>
            <button className={btn + " !py-1"} disabled={managerId === ""} onClick={() => onAttachAll(group, managerId)}>
              <UserCheck size={14} /> Rattacher tous
            </button>
          </span>
        )}
      </div>
      {n > 0 && (
        <div className="flex flex-wrap gap-3">
          {group.unassigned.map((p) => <PersonCard key={p.id} person={p} />)}
        </div>
      )}
    </div>
  );
}

/** Une section par site : en-tête, organigramme (zoom / déplacement), non rattachés. */
function SiteSection({ group, people, color, zoom, viewMode, onAttachAll, onDropRoot, ctx, onSitePdf }) {
  const contentRef = useRef(null);
  const viewportRef = useRef(null);
  const [printZoom, setPrintZoom] = useState(1);
  const drag = useRef(null);

  // facteur d'échelle pour que la section tienne sur une page A4 paysage à l'impression
  useLayoutEffect(() => {
    const el = contentRef.current;
    if (!el) return;
    const n = group.unassigned.length;
    const measure = () => {
      const r = el.getBoundingClientRect();
      const w = r.width / zoom;
      const h = r.height / zoom;
      // même facteur pour l'organigramme et les « non rattachés » (qui reviennent à la ligne)
      let z = Math.min(1, w ? PRINT_W / w : 1);
      const fits = (k) => {
        const cols = Math.max(1, Math.floor(PRINT_W / (TRAY_CARD_W * k)));
        const trayH = n ? (TRAY_HEAD_H + Math.ceil(n / cols) * TRAY_ROW_H) * k : 0;
        return h * k + trayH <= PRINT_H;
      };
      while (z > 0.25 && !fits(z)) z -= 0.05;
      setPrintZoom(Math.max(0.25, Math.round(z * 100) / 100));
    };
    measure();
    const ro = new ResizeObserver(measure);
    ro.observe(el);
    return () => ro.disconnect();
  }, [zoom, group]);

  // déplacement à la souris en attrapant le fond
  const onMouseDown = (e) => {
    if (e.button !== 0 || e.target.closest(".oc-card, button, select, input")) return;
    drag.current = { x: e.clientX, y: e.clientY, left: viewportRef.current.scrollLeft, top: window.scrollY };
    e.preventDefault();
  };
  useEffect(() => {
    const move = (e) => {
      if (!drag.current) return;
      viewportRef.current.scrollLeft = drag.current.left - (e.clientX - drag.current.x);
      window.scrollTo({ top: drag.current.top - (e.clientY - drag.current.y) });
    };
    const up = () => (drag.current = null);
    window.addEventListener("mousemove", move);
    window.addEventListener("mouseup", up);
    return () => {
      window.removeEventListener("mousemove", move);
      window.removeEventListener("mouseup", up);
    };
  }, []);

  return (
    <section
      data-testid="site-section"
      data-site={group.site}
      className="site-section overflow-hidden rounded-2xl border bg-white shadow-sm"
      style={{ "--print-zoom": printZoom }}
    >
      <header className="flex items-center gap-2 border-b px-4 py-3" style={{ borderTop: `4px solid ${color}` }}>
        <Building2 size={18} style={{ color }} />
        <h2 className="font-semibold">{group.site}</h2>
        <span className="rounded-full bg-slate-100 px-2 text-xs text-slate-500">{group.count} pers.</span>
        <span className="print-only ml-auto text-xs text-slate-500">Organigramme au {new Date().toLocaleDateString("fr-FR")}</span>
        {onSitePdf && (
          <button className="no-print ml-auto rounded-lg px-2 py-1 text-xs text-slate-500 hover:bg-slate-100" onClick={onSitePdf}>
            <FileDown size={13} className="mr-1 inline" />PDF du site
          </button>
        )}
      </header>
      <div ref={viewportRef} onMouseDown={onMouseDown} className={`chart-viewport overflow-x-auto ${viewMode === "chart" ? "cursor-grab active:cursor-grabbing" : ""}`}>
        <div className="zoom-wrap" style={{ zoom }}>
          <div ref={contentRef} className="w-max min-w-full">
            {viewMode === "chart" ? (
              <OrgChart trees={group.trees} />
            ) : (
              group.trees.length > 0 && <div className="p-3"><OrgList nodes={group.trees} /></div>
            )}
          </div>
        </div>
      </div>
      {(group.unassigned.length > 0 || ctx.dragId) && (
        <div className="zoom-wrap" style={{ zoom }}>
          <UnassignedTray
            key={group.site_id ?? "none"}
            group={group}
            people={people}
            onAttachAll={onAttachAll}
            onDropRoot={onDropRoot}
            ctx={ctx}
          />
        </div>
      )}
    </section>
  );
}

export default function OrgView({ store, employees, reload, onImport }) {
  const [siteFilter, setSiteFilter] = useState("all");
  const [query, setQuery] = useState("");
  const [viewMode, setViewMode] = useState("chart");
  const [zoom, setZoom] = useState(1);
  const [collapsed, setCollapsed] = useState(() => new Set());
  const [selectedId, setSelectedId] = useState(null);
  const [toast, setToast] = useState(null);
  const [dragId, setDragId] = useState(null);
  const [dropTargetId, setDropTargetId] = useState(null);
  const [busy, setBusy] = useState(false);

  const byId = useMemo(() => Object.fromEntries(employees.map((e) => [e.id, e])), [employees]);
  const colors = useMemo(() => siteColors(employees), [employees]);
  const colorOf = useCallback((p) => colors[p.site_id] || NO_SITE_COLOR, [colors]);
  const allGroups = useMemo(() => siteGroups(employees), [employees]);
  const sites = useMemo(
    () => allGroups.filter((g) => g.site_id !== null).map((g) => ({ id: g.site_id, name: g.site, count: g.count })),
    [allGroups],
  );
  const scoped = useMemo(
    () => allGroups.filter((g) => siteFilter === "all" || g.site_id === siteFilter || (siteFilter === "none" && g.site_id === null)),
    [allGroups, siteFilter],
  );
  const { groups, hits } = useMemo(() => filterGroups(scoped, query), [scoped, query]);
  const searching = query.trim().length > 0;
  const selected = selectedId ? byId[selectedId] : null;

  useEffect(() => {
    if (selectedId && !byId[selectedId]) setSelectedId(null);
  }, [byId, selectedId]);

  const closeToast = useCallback(() => setToast(null), []);
  const fail = (e) => setToast({ message: e.message || String(e), error: true });

  async function update(id, patch, { undo, message } = {}) {
    try {
      await store.updateEmployee(id, patch);
      await reload();
      if (message) setToast({ message, undo });
    } catch (e) {
      fail(e);
    }
  }

  function move(id, managerId) {
    const p = byId[id];
    if (!p || p.manager_id === managerId) return;
    const prev = p.manager_id;
    const label = managerId ? `${p.name} est maintenant rattaché(e) à ${byId[managerId].name}.` : `${p.name} n'a plus de supérieur.`;
    update(id, { manager_id: managerId }, { message: label, undo: () => update(id, { manager_id: prev }) });
  }

  async function attachAll(group, managerId) {
    const ids = group.unassigned.map((n) => n.id).filter((i) => i !== managerId);
    try {
      const res = await store.attachUnassigned(group.site_id, managerId);
      await reload();
      setToast({
        message: `${res.attached} personne(s) rattachée(s) à ${byId[managerId].name}.`,
        undo: async () => {
          for (const i of ids) await store.updateEmployee(i, { manager_id: null }).catch(() => {});
          await reload();
        },
      });
    } catch (e) {
      fail(e);
    }
  }

  const ctx = {
    editable: true,
    selectedId,
    dragId,
    dropTargetId,
    colorOf,
    isCollapsed: (id) => !searching && collapsed.has(id),
    toggle: (id) => setCollapsed((s) => { const n = new Set(s); n.has(id) ? n.delete(id) : n.add(id); return n; }),
    select: (id) => setSelectedId(id),
    startDrag: (id) => setDragId(id),
    endDrag: () => { setDragId(null); setDropTargetId(null); },
    setDropTarget: setDropTargetId,
    canDropOn: (target) => dragId !== null && target !== dragId && byId[dragId]?.manager_id !== target && !wouldCreateCycle(employees, dragId, target),
    canDropRoot: () => dragId !== null && byId[dragId]?.manager_id !== null,
    dropOn: (target) => {
      const id = dragId;
      setDragId(null);
      setDropTargetId(null);
      if (id === null || id === target) return;
      if (wouldCreateCycle(employees, id, target)) return fail(new Error("Impossible : ce choix créerait une boucle dans la hiérarchie."));
      move(id, target);
    },
  };

  function expandAll() {
    setCollapsed(new Set());
  }
  function collapseAll() {
    const s = new Set();
    walk(groups.flatMap((g) => g.trees), (n) => n.reports.length && s.add(n.id));
    setCollapsed(s);
  }
  function fit() {
    const els = [...document.querySelectorAll(".site-section .zoom-wrap > div")];
    const vp = document.querySelector(".chart-viewport");
    if (!els.length || !vp) return;
    const natural = Math.max(...els.map((el) => el.getBoundingClientRect().width / zoom));
    const z = Math.min(1.5, Math.max(0.3, (vp.clientWidth - 8) / natural));
    setZoom(Math.round(z * 100) / 100);
  }
  const stepZoom = (dir) => {
    const i = ZOOMS.findIndex((z) => z >= zoom - 0.001);
    setZoom(ZOOMS[Math.min(ZOOMS.length - 1, Math.max(0, (i < 0 ? ZOOMS.length - 1 : i) + dir))]);
  };

  function print() {
    expandAll();
    setSelectedId(null);
    setTimeout(() => window.print(), 300);
  }
  async function exportPdf(siteId, siteName) {
    if (!store.capabilities.serverPdf) return print();
    setBusy(true);
    try {
      await store.downloadPdf(siteId, siteName);
    } catch (e) {
      fail(e);
    } finally {
      setBusy(false);
    }
  }
  function exportMermaid() {
    downloadBlob(new Blob([toMermaid(scoped)], { type: "text/plain;charset=utf-8" }), exportName("mmd"));
  }

  if (!employees.length) {
    return (
      <div className="rounded-2xl border bg-white p-10 text-center shadow-sm">
        <FileSpreadsheet className="mx-auto text-slate-400" size={36} />
        <div className="mt-3 font-semibold">Aucun collaborateur pour l'instant</div>
        <p className="mt-1 text-sm text-slate-500">Importez le fichier Excel du personnel pour construire l'organigramme.</p>
        <button onClick={onImport} className="mt-4 rounded-xl bg-slate-900 px-4 py-2 text-sm text-white shadow hover:bg-slate-800">
          Importer un fichier
        </button>
      </div>
    );
  }

  const filterSite = siteFilter === "all" ? null : groups[0] || scoped[0];
  const counted = scoped.reduce((n, g) => n + g.count, 0);

  return (
    <ChartContext.Provider value={ctx}>
      <div className="no-print sticky top-0 z-30 -mx-2 mb-4 flex flex-wrap items-center gap-2 rounded-2xl bg-slate-50/90 px-2 py-2 backdrop-blur">
        <select
          data-testid="site-filter"
          value={siteFilter}
          onChange={(e) => {
            const v = e.target.value;
            setSiteFilter(v === "all" || v === "none" ? v : Number(v));
          }}
          className="rounded-xl border bg-white px-3 py-2 text-sm shadow-sm"
        >
          <option value="all">Tous les sites ({employees.length})</option>
          {sites.map((s) => <option key={s.id} value={s.id}>{s.name} ({s.count})</option>)}
          {allGroups.some((g) => g.site_id === null) && <option value="none">Sans site</option>}
        </select>
        <label className="flex min-w-56 flex-1 items-center gap-2 rounded-xl border bg-white px-3 py-2 text-sm shadow-sm">
          <Search size={15} className="text-slate-400" />
          <input
            data-testid="search"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Rechercher une personne, une fonction, un numéro…"
            className="w-full focus:outline-none"
          />
          {searching && (
            <span className="whitespace-nowrap text-xs text-slate-500" data-testid="search-count">
              {hits} résultat{hits > 1 ? "s" : ""}
            </span>
          )}
          {searching && <button onClick={() => setQuery("")} aria-label="Effacer"><X size={14} /></button>}
        </label>
        <div className="flex overflow-hidden rounded-xl border bg-white text-sm shadow-sm">
          <button className={`flex items-center gap-1.5 px-3 py-2 ${viewMode === "chart" ? "bg-slate-900 text-white" : "hover:bg-slate-50"}`} onClick={() => setViewMode("chart")}>
            <GitFork size={14} className="rotate-180" /> Organigramme
          </button>
          <button className={`flex items-center gap-1.5 px-3 py-2 ${viewMode === "list" ? "bg-slate-900 text-white" : "hover:bg-slate-50"}`} onClick={() => setViewMode("list")}>
            <List size={14} /> Liste
          </button>
        </div>
        <button className={btn} onClick={expandAll}>Tout déplier</button>
        <button className={btn} onClick={collapseAll}>Tout replier</button>
        <div className="flex items-center overflow-hidden rounded-xl border bg-white text-sm shadow-sm">
          <button className="px-2 py-2 hover:bg-slate-50" onClick={() => stepZoom(-1)} aria-label="Dézoomer"><Minus size={14} /></button>
          <button className="w-14 py-2 text-center hover:bg-slate-50" onClick={() => setZoom(1)} title="Taille réelle" data-testid="zoom-level">
            {Math.round(zoom * 100)} %
          </button>
          <button className="px-2 py-2 hover:bg-slate-50" onClick={() => stepZoom(1)} aria-label="Zoomer"><Plus size={14} /></button>
          <button className="border-l px-2 py-2 hover:bg-slate-50" onClick={fit} title="Ajuster à la largeur" aria-label="Ajuster"><Maximize2 size={14} /></button>
        </div>
        <div className="ml-auto flex gap-2">
          <button className={btn} disabled={busy} onClick={() => exportPdf(filterSite?.site_id, filterSite?.site)} data-testid="export-pdf"
            title={store.capabilities.serverPdf ? "PDF A4 paysage, une page par site" : "Ouvre l'impression : choisissez « Enregistrer au format PDF »"}>
            <FileDown size={15} /> PDF
          </button>
          <button className={btn} onClick={print} title="Imprimer (une page A4 paysage par site)"><Printer size={15} /></button>
          <button className={btn} onClick={exportMermaid} title="Exporter au format Mermaid (.mmd)" data-testid="export-mermaid"><Network size={15} /></button>
        </div>
      </div>

      {searching && !groups.length && (
        <div className="rounded-2xl border bg-white p-6 text-center text-sm text-slate-500">Aucun résultat pour « {query} ».</div>
      )}

      <div className="space-y-5">
        {groups.map((g) => (
          <SiteSection
            key={g.site_id ?? "none"}
            group={g}
            people={employees.filter((e) => (e.site_id ?? null) === g.site_id)}
            color={g.site_id === null ? NO_SITE_COLOR : colors[g.site_id]}
            zoom={zoom}
            viewMode={viewMode}
            onAttachAll={attachAll}
            onDropRoot={() => { const id = dragId; ctx.endDrag(); if (id !== null) move(id, null); }}
            ctx={ctx}
            onSitePdf={siteFilter === "all" && store.capabilities.serverPdf && g.site_id !== null ? () => exportPdf(g.site_id, g.site) : null}
          />
        ))}
      </div>
      <p className="no-print mt-3 text-center text-xs text-slate-400">
        {counted} personne(s) affichée(s) · cliquez sur une carte pour sa fiche · glissez une carte sur une autre pour changer son supérieur
      </p>

      {selected && (
        <DetailsPanel
          person={selected}
          employees={employees}
          sites={sites}
          colorOf={colorOf}
          onClose={() => setSelectedId(null)}
          onSelect={setSelectedId}
          onError={(m) => fail(new Error(m))}
          onUpdate={(id, patch) =>
            update(id, patch, "manager_id" in patch
              ? {
                  message: patch.manager_id ? `${byId[id].name} est maintenant rattaché(e) à ${byId[patch.manager_id].name}.` : `${byId[id].name} n'a plus de supérieur.`,
                  undo: () => update(id, { manager_id: byId[id].manager_id }),
                }
              : {})
          }
        />
      )}
      <Toast toast={toast} onClose={closeToast} />
    </ChartContext.Provider>
  );
}
