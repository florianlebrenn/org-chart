import { useMemo, useState } from "react";
import { Camera, ChevronRight, Search, Trash2, X } from "lucide-react";
import { Avatar } from "./PersonCard.jsx";
import { normText } from "../core/text.js";
import { wouldCreateCycle } from "../core/tree.js";
import { resizePhoto } from "../lib/photo.js";

function Field({ label, value, onSave, type = "text", testId }) {
  const [draft, setDraft] = useState(value || "");
  const commit = () => (draft.trim() || null) !== (value || null) && onSave(draft);
  return (
    <label className="block text-sm">
      <span className="text-xs font-medium text-slate-500">{label}</span>
      <input
        type={type}
        data-testid={testId}
        value={draft}
        onChange={(e) => setDraft(e.target.value)}
        onBlur={commit}
        onKeyDown={(e) => e.key === "Enter" && e.currentTarget.blur()}
        className="mt-0.5 w-full rounded-lg border px-2 py-1.5 focus:outline-none focus:ring-2 focus:ring-slate-300"
      />
    </label>
  );
}

/** Panneau latéral : détail d'un collaborateur et modification de son supérieur. */
export default function DetailsPanel({ person, employees, sites, colorOf, onClose, onUpdate, onSelect, onError }) {
  const [picking, setPicking] = useState(false);
  const [query, setQuery] = useState("");
  const byId = useMemo(() => Object.fromEntries(employees.map((e) => [e.id, e])), [employees]);
  const manager = byId[person.manager_id];
  const reports = employees.filter((e) => e.manager_id === person.id);

  const candidates = useMemo(() => {
    const q = normText(query);
    return employees
      .filter((e) => e.id !== person.id && e.id !== person.manager_id && !wouldCreateCycle(employees, person.id, e.id))
      .filter((e) => !q || normText(`${e.name} ${e.title || ""} ${e.site || ""}`).includes(q))
      .sort((a, b) => (a.site_id !== person.site_id) - (b.site_id !== person.site_id) || a.name.localeCompare(b.name, "fr"));
  }, [employees, person, query]);

  async function onPhoto(file) {
    if (!file) return;
    try {
      onUpdate(person.id, { photo: await resizePhoto(file) });
    } catch (e) {
      onError(e.message);
    }
  }

  return (
    <aside
      data-testid="details-panel"
      className="no-print fixed inset-y-0 right-0 z-40 flex w-full max-w-sm flex-col border-l bg-white shadow-2xl"
    >
      <div className="flex items-center justify-between border-b px-4 py-3">
        <span className="text-sm font-semibold text-slate-500">Fiche collaborateur</span>
        <button onClick={onClose} className="rounded-lg p-1 hover:bg-slate-100" aria-label="Fermer">
          <X size={18} />
        </button>
      </div>

      <div className="flex-1 space-y-5 overflow-y-auto p-4" key={person.id}>
        <div className="flex items-center gap-3">
          <Avatar person={person} color={colorOf(person)} size={64} />
          <div className="min-w-0">
            <div className="text-lg font-bold leading-tight">{person.name}</div>
            <div className="text-sm text-slate-500">{person.title}</div>
            <div className="mt-1 flex gap-2 text-xs">
              <label className="inline-flex cursor-pointer items-center gap-1 rounded-lg border px-2 py-1 hover:bg-slate-50">
                <Camera size={12} /> {person.photo ? "Changer la photo" : "Ajouter une photo"}
                <input type="file" accept="image/*" className="hidden" data-testid="photo-input" onChange={(e) => onPhoto(e.target.files?.[0])} />
              </label>
              {person.photo && (
                <button className="inline-flex items-center gap-1 rounded-lg border px-2 py-1 hover:bg-slate-50" onClick={() => onUpdate(person.id, { photo: null })}>
                  <Trash2 size={12} /> Retirer
                </button>
              )}
            </div>
          </div>
        </div>

        <section>
          <div className="mb-1 text-xs font-medium text-slate-500">Supérieur hiérarchique</div>
          <div className="flex items-center justify-between gap-2 rounded-xl border bg-slate-50 px-3 py-2">
            {manager ? (
              <button className="min-w-0 text-left" onClick={() => onSelect(manager.id)}>
                <div className="truncate font-medium" data-testid="current-manager">{manager.name}</div>
                <div className="truncate text-xs text-slate-500">{manager.title}{manager.site_id !== person.site_id && manager.site ? ` · ${manager.site}` : ""}</div>
              </button>
            ) : (
              <span className="text-sm text-slate-500" data-testid="current-manager">Aucun (en haut de l'organigramme)</span>
            )}
            <button className="shrink-0 rounded-lg border bg-white px-2 py-1 text-xs hover:bg-slate-100" onClick={() => setPicking((v) => !v)}>
              {picking ? "Fermer" : "Changer"}
            </button>
          </div>
          {picking && (
            <div className="mt-2 rounded-xl border p-2">
              <div className="flex items-center gap-2 rounded-lg border px-2">
                <Search size={14} className="text-slate-400" />
                <input
                  autoFocus
                  data-testid="manager-search"
                  value={query}
                  onChange={(e) => setQuery(e.target.value)}
                  placeholder="Rechercher un nom, une fonction…"
                  className="w-full py-1.5 text-sm focus:outline-none"
                />
              </div>
              {person.manager_id && (
                <button
                  className="mt-2 w-full rounded-lg px-2 py-1.5 text-left text-sm text-slate-600 hover:bg-slate-100"
                  onClick={() => { onUpdate(person.id, { manager_id: null }); setPicking(false); }}
                >
                  — Aucun supérieur (placer en haut)
                </button>
              )}
              <ul className="mt-1 max-h-64 overflow-y-auto">
                {candidates.slice(0, 60).map((c) => (
                  <li key={c.id}>
                    <button
                      data-testid="manager-option"
                      className="flex w-full items-center gap-2 rounded-lg px-2 py-1.5 text-left hover:bg-slate-100"
                      onClick={() => { onUpdate(person.id, { manager_id: c.id }); setPicking(false); setQuery(""); }}
                    >
                      <Avatar person={c} color={colorOf(c)} size={24} />
                      <span className="min-w-0 flex-1">
                        <span className="block truncate text-sm font-medium">{c.name}</span>
                        <span className="block truncate text-xs text-slate-500">{c.title}{c.site ? ` · ${c.site}` : ""}</span>
                      </span>
                    </button>
                  </li>
                ))}
                {!candidates.length && <li className="px-2 py-2 text-sm text-slate-500">Aucun résultat.</li>}
              </ul>
            </div>
          )}
        </section>

        {reports.length > 0 && (
          <section>
            <div className="mb-1 text-xs font-medium text-slate-500">Équipe directe ({reports.length})</div>
            <ul className="divide-y rounded-xl border">
              {reports.map((r) => (
                <li key={r.id}>
                  <button className="flex w-full items-center gap-2 px-3 py-1.5 text-left text-sm hover:bg-slate-50" onClick={() => onSelect(r.id)}>
                    <span className="min-w-0 flex-1 truncate">{r.name} <span className="text-slate-400">· {r.title}</span></span>
                    <ChevronRight size={14} className="text-slate-300" />
                  </button>
                </li>
              ))}
            </ul>
          </section>
        )}

        <section className="space-y-3">
          <Field label="Fonction" value={person.title} testId="field-title" onSave={(v) => onUpdate(person.id, { title: v })} />
          <label className="block text-sm">
            <span className="text-xs font-medium text-slate-500">Site / bâtiment</span>
            <select
              value={person.site_id ?? ""}
              onChange={(e) => onUpdate(person.id, { site_id: e.target.value === "" ? null : Number(e.target.value) })}
              className="mt-0.5 w-full rounded-lg border px-2 py-1.5"
            >
              <option value="">Sans site</option>
              {sites.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}
            </select>
          </label>
          <Field label="Email" type="email" value={person.email} onSave={(v) => onUpdate(person.id, { email: v })} />
          <Field label="Téléphone" type="tel" value={person.phone} onSave={(v) => onUpdate(person.id, { phone: v })} />
          <p className="text-xs text-slate-400">
            Le prochain import du fichier Excel remplacera fonction, site et contact si ces colonnes y figurent. La photo est conservée, et la hiérarchie aussi (sauf si vous choisissez une colonne « supérieur » à l'import).
          </p>
        </section>
      </div>
    </aside>
  );
}
