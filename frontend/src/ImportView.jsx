import { useEffect, useRef, useState } from "react";
import {
  AlertTriangle, ArrowLeft, Check, ChevronRight, FileSpreadsheet, Loader2, ShieldCheck, Upload, UserMinus,
  UserPlus, UserPen,
} from "lucide-react";

const FIELDS = [
  { key: "name", label: "Nom complet", hint: "ou Prénom + Nom de famille ci-dessous" },
  { key: "first_name", label: "Prénom" },
  { key: "last_name", label: "Nom de famille" },
  { key: "title", label: "Fonction" },
  { key: "site", label: "Site / bâtiment" },
  { key: "email", label: "Email" },
  { key: "phone", label: "Téléphone" },
  { key: "manager", label: "Supérieur hiérarchique", hint: "optionnel" },
];
const LABEL = Object.fromEntries(FIELDS.map((f) => [f.key, f.label]));

const card = "rounded-2xl border bg-white p-5 shadow-sm";
const btn = "inline-flex items-center gap-2 rounded-xl border bg-white px-3 py-2 text-sm shadow-sm hover:bg-slate-50 disabled:opacity-50";
const btnPrimary = "inline-flex items-center gap-2 rounded-xl bg-slate-900 px-4 py-2 text-sm text-white shadow hover:bg-slate-800 disabled:opacity-50";

function Steps({ step }) {
  const steps = ["Fichier", "Colonnes", "Vérification"];
  const idx = { upload: 0, mapping: 1, review: 2, done: 2 }[step];
  return (
    <ol className="mb-5 flex items-center gap-2 text-sm">
      {steps.map((s, i) => (
        <li key={s} className="flex items-center gap-2">
          <span className={`flex h-6 w-6 items-center justify-center rounded-full text-xs font-semibold ${
            i < idx || step === "done" ? "bg-emerald-600 text-white" : i === idx ? "bg-slate-900 text-white" : "bg-slate-200 text-slate-500"
          }`}>
            {i < idx || step === "done" ? <Check size={14} /> : i + 1}
          </span>
          <span className={i === idx ? "font-semibold" : "text-slate-500"}>{s}</span>
          {i < steps.length - 1 && <ChevronRight size={14} className="text-slate-300" />}
        </li>
      ))}
    </ol>
  );
}

function ErrorBox({ error }) {
  if (!error) return null;
  return (
    <div role="alert" className="mt-4 flex items-start gap-2 rounded-xl border border-red-200 bg-red-50 p-3 text-sm text-red-700">
      <AlertTriangle size={16} className="mt-0.5 shrink-0" /> {error}
    </div>
  );
}

// ------------------------------------------------------------------ étape 1

function UploadStep({ store, onUploaded }) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [drag, setDrag] = useState(false);

  async function handle(file) {
    if (!file) return;
    setBusy(true);
    setError("");
    try {
      onUploaded(await store.upload(file));
    } catch (e) {
      setError(e.message);
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className={card}>
      <label
        onDragOver={(e) => { e.preventDefault(); setDrag(true); }}
        onDragLeave={() => setDrag(false)}
        onDrop={(e) => { e.preventDefault(); setDrag(false); handle(e.dataTransfer.files?.[0]); }}
        className={`flex cursor-pointer flex-col items-center justify-center gap-3 rounded-2xl border-2 border-dashed px-6 py-14 text-center transition-colors ${
          drag ? "border-slate-500 bg-slate-50" : "border-slate-300 hover:bg-slate-50"
        }`}
      >
        {busy ? <Loader2 className="animate-spin text-slate-500" size={32} /> : <FileSpreadsheet className="text-slate-500" size={32} />}
        <div className="font-semibold">Déposez le fichier Excel ici, ou cliquez pour le choisir</div>
        <div className="text-sm text-slate-500">Formats acceptés : .xlsx, .csv — {store.mode === "server" ? "le fichier est lu par le serveur local" : "le fichier est lu dans ce navigateur"}, rien n'est envoyé ailleurs.</div>
        <span className={btnPrimary}><Upload size={16} /> Choisir un fichier</span>
        <input
          type="file"
          accept=".xlsx,.xlsm,.csv,.xls"
          className="hidden"
          data-testid="file-input"
          onChange={(e) => handle(e.target.files?.[0])}
        />
      </label>
      <ErrorBox error={error} />
    </div>
  );
}

// ------------------------------------------------------------------ étape 2

function MappingStep({ store, upload, sheetIdx, setSheetIdx, mapping, setMapping, onBack, onReview }) {
  const sheet = upload.sheets[sheetIdx];
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [preview, setPreview] = useState(null);

  // aperçu demandé pour les SEULES colonnes retenues (les autres ne quittent jamais le fichier)
  useEffect(() => {
    let alive = true;
    const t = setTimeout(() => {
      store
        .previewImport({ token: upload.token, sheet: sheetIdx, mapping })
        .then((p) => alive && setPreview(p))
        .catch((e) => alive && setError(e.message));
    }, 150);
    return () => {
      alive = false;
      clearTimeout(t);
    };
  }, [store, upload.token, sheetIdx, mapping]);

  const hasName = mapping.name != null || mapping.last_name != null || mapping.first_name != null;

  function setField(field, value) {
    setMapping((m) => {
      const next = { ...m };
      // une colonne ne peut servir qu'à un seul champ
      for (const [f, i] of Object.entries(next)) if (i === value && value !== null) next[f] = null;
      next[field] = value;
      return next;
    });
  }

  async function review() {
    setBusy(true);
    setError("");
    try {
      const summary = await store.confirmImport({ token: upload.token, sheet: sheetIdx, mapping, dryRun: true });
      onReview(summary);
    } catch (e) {
      setError(e.message);
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="space-y-5">
      <div className={card}>
        <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
          <div>
            <div className="font-semibold flex items-center gap-2"><FileSpreadsheet size={18} /> {upload.filename}</div>
            <div className="text-sm text-slate-500">
              {sheet.row_count} lignes · en-têtes trouvés ligne {sheet.header_row}
            </div>
          </div>
          {upload.sheets.length > 1 && (
            <label className="text-sm">
              Feuille :{" "}
              <select
                className="rounded-lg border px-2 py-1"
                value={sheetIdx}
                onChange={(e) => {
                  const i = Number(e.target.value);
                  setSheetIdx(i);
                  setMapping(upload.sheets[i].suggested_mapping);
                }}
              >
                {upload.sheets.map((s, i) => <option key={s.name} value={i}>{s.name}</option>)}
              </select>
            </label>
          )}
        </div>

        <p className="mb-4 text-sm text-slate-600">
          Indiquez quelle colonne du fichier correspond à chaque information. Les choix proposés sont déduits des en-têtes et seront mémorisés pour le prochain import.
        </p>
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
          {FIELDS.map((f) => (
            <label key={f.key} className="flex flex-col gap-1 text-sm">
              <span className="font-medium">
                {f.label} {f.hint && <span className="font-normal text-slate-400">({f.hint})</span>}
              </span>
              <select
                data-testid={`map-${f.key}`}
                className={`rounded-lg border px-2 py-1.5 ${mapping[f.key] != null ? "border-emerald-300 bg-emerald-50" : ""}`}
                value={mapping[f.key] ?? ""}
                onChange={(e) => setField(f.key, e.target.value === "" ? null : Number(e.target.value))}
              >
                <option value="">— Ne pas importer —</option>
                {sheet.headers.map((h, i) => <option key={i} value={i}>{h}</option>)}
              </select>
            </label>
          ))}
        </div>
        {mapping.name != null && (mapping.first_name != null || mapping.last_name != null) && (
          <p className="mt-3 text-xs text-amber-700">« Nom complet » est choisi : les colonnes Prénom / Nom de famille seront ignorées.</p>
        )}
        {mapping.manager == null && (
          <p className="mt-3 text-xs text-slate-500">
            Sans colonne « supérieur », la hiérarchie déjà saisie dans l'application est conservée ; les nouveaux collaborateurs arrivent sans supérieur.
          </p>
        )}
      </div>

      <div className={`${card} overflow-x-auto`} data-testid="import-preview">
        <div className="mb-1 font-semibold">Aperçu des premières lignes</div>
        <p className="mb-3 flex items-start gap-1.5 text-xs text-slate-500">
          <ShieldCheck size={14} className="mt-0.5 shrink-0 text-emerald-600" />
          Seules les colonnes choisies ci-dessus sont lues et importées. Les autres colonnes du fichier ne sont ni importées, ni conservées, ni affichées.
        </p>
        {preview && preview.columns.length > 0 && (
          <table className="w-full text-left text-xs">
            <thead>
              <tr>
                {preview.columns.map((c) => (
                  <th key={c.field} className="whitespace-nowrap border-b bg-emerald-50 px-2 py-1.5">
                    <div>{c.header}</div>
                    <div className="text-[10px] font-normal text-emerald-700">→ {LABEL[c.field]}</div>
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {preview.rows.map((row, r) => (
                <tr key={r} className="odd:bg-slate-50">
                  {row.map((c, i) => <td key={i} className="whitespace-nowrap px-2 py-1">{c}</td>)}
                </tr>
              ))}
            </tbody>
          </table>
        )}
        {preview && preview.ignored_headers.length > 0 && (
          <p className="mt-3 text-xs text-slate-500" data-testid="ignored-columns">
            <span className="font-medium">Colonnes ignorées ({preview.ignored_headers.length}) :</span> {preview.ignored_headers.join(", ")}
          </p>
        )}
      </div>

      <ErrorBox error={error} />
      <div className="flex justify-between">
        <button className={btn} onClick={() => { store.cancelImport?.(upload.token).catch(() => {}); onBack(); }}><ArrowLeft size={16} /> Autre fichier</button>
        <button className={btnPrimary} disabled={!hasName || busy} onClick={review}>
          {busy ? <Loader2 size={16} className="animate-spin" /> : null} Vérifier l'import
        </button>
      </div>
    </div>
  );
}

// ------------------------------------------------------------------ étape 3

function NameList({ items, render = (x) => x }) {
  if (!items.length) return null;
  return (
    <ul className="mt-2 max-h-56 space-y-0.5 overflow-auto text-sm">
      {items.map((x, i) => <li key={i}>{render(x)}</li>)}
    </ul>
  );
}

function Stat({ icon: Icon, label, value, tone = "slate" }) {
  const tones = {
    slate: "bg-slate-50 text-slate-700",
    green: "bg-emerald-50 text-emerald-700",
    blue: "bg-sky-50 text-sky-700",
    red: "bg-red-50 text-red-700",
  };
  return (
    <div className={`rounded-xl p-3 ${tones[tone]}`}>
      <div className="flex items-center gap-1.5 text-xs">{Icon && <Icon size={14} />} {label}</div>
      <div className="text-2xl font-bold" data-testid={`stat-${label}`}>{value}</div>
    </div>
  );
}

function warningLines(w) {
  const lines = [];
  if (w.duplicates.length)
    lines.push(`Homonymes dans le fichier (appariés dans l'ordre des lignes) : ${w.duplicates.join(", ")}`);
  for (const u of w.unresolved_managers)
    lines.push(`${u.name} : supérieur « ${u.manager} » introuvable dans le fichier — placé en haut de l'arbre`);
  for (const u of w.ambiguous_managers)
    lines.push(`${u.name} : supérieur « ${u.manager} » ambigu (homonymes) — le premier a été retenu`);
  if (w.cycles.length)
    lines.push(`Boucle hiérarchique détectée et coupée pour : ${w.cycles.join(", ")}`);
  for (const o of w.orphaned)
    lines.push(`${o.name} n'aura plus de supérieur (départ de ${o.former_manager})`);
  if (w.missing_site.length)
    lines.push(`Sans site (${w.missing_site.length}) : ${w.missing_site.join(", ")}`);
  return lines;
}

function ReviewStep({ summary, applied, busy, error, onBack, onConfirm, onDone }) {
  const warnings = warningLines(summary.warnings);
  return (
    <div className="space-y-5">
      {applied && (
        <div className="flex items-center gap-2 rounded-2xl border border-emerald-200 bg-emerald-50 p-4 text-emerald-800">
          <Check size={18} /> Import terminé : {summary.total} collaborateurs enregistrés.
        </div>
      )}
      <div className={card}>
        <div className="mb-4 font-semibold">{applied ? "Résultat" : "Ce qui va changer"}</div>
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-5">
          <Stat label="Total" value={summary.total} />
          <Stat icon={UserPlus} label="Nouveaux" value={summary.added.length} tone="green" />
          <Stat icon={UserPen} label="Modifiés" value={summary.updated.length} tone="blue" />
          <Stat icon={UserMinus} label="Retirés" value={summary.removed.length} tone={summary.removed.length ? "red" : "slate"} />
          <Stat label="Inchangés" value={summary.unchanged} />
        </div>

        <div className="mt-4 text-sm text-slate-600">
          <span className="font-medium">Hiérarchie : </span>
          {summary.hierarchy_source === "file"
            ? "lue depuis la colonne « supérieur » du fichier."
            : "liens existants conservés ; les nouveaux arrivent sans supérieur (à rattacher ensuite)."}
        </div>
        <div className="mt-2 flex flex-wrap gap-2 text-sm">
          {summary.sites.map((s) => (
            <span key={s.name} className="rounded-full bg-slate-100 px-2.5 py-0.5">{s.name} · {s.count}</span>
          ))}
        </div>
        {summary.skipped_rows > 0 && (
          <div className="mt-2 text-xs text-slate-500">{summary.skipped_rows} ligne(s) sans nom ignorée(s).</div>
        )}
      </div>

      {warnings.length > 0 && (
        <div className="rounded-2xl border border-amber-200 bg-amber-50 p-5" data-testid="warnings">
          <div className="flex items-center gap-2 font-semibold text-amber-800"><AlertTriangle size={16} /> Points d'attention</div>
          <ul className="mt-2 list-disc space-y-1 pl-5 text-sm text-amber-900">
            {warnings.map((l, i) => <li key={i}>{l}</li>)}
          </ul>
        </div>
      )}

      <div className="grid gap-5 md:grid-cols-3">
        {summary.added.length > 0 && (
          <details className={card} open={summary.added.length <= 10}>
            <summary className="cursor-pointer font-semibold text-emerald-700">Nouveaux ({summary.added.length})</summary>
            <NameList items={summary.added} />
          </details>
        )}
        {summary.updated.length > 0 && (
          <details className={card} open>
            <summary className="cursor-pointer font-semibold text-sky-700">Modifiés ({summary.updated.length})</summary>
            <NameList
              items={summary.updated}
              render={(u) => (
                <>
                  <span className="font-medium">{u.name}</span>
                  <span className="text-slate-500"> — {u.changes.map((c) => `${c.field} : ${c.before ?? "∅"} → ${c.after ?? "∅"}`).join(" ; ")}</span>
                </>
              )}
            />
          </details>
        )}
        {summary.removed.length > 0 && (
          <details className={`${card} border-red-200`} open>
            <summary className="cursor-pointer font-semibold text-red-700">Retirés ({summary.removed.length})</summary>
            <p className="mt-1 text-xs text-slate-500">Absents du nouveau fichier : ils seront supprimés de l'organigramme.</p>
            <NameList items={summary.removed} />
          </details>
        )}
      </div>

      <ErrorBox error={error} />
      <div className="flex justify-between">
        {applied ? (
          <span />
        ) : (
          <button className={btn} onClick={onBack} disabled={busy}><ArrowLeft size={16} /> Modifier les colonnes</button>
        )}
        {applied ? (
          <button className={btnPrimary} onClick={onDone}>Voir l'organigramme <ChevronRight size={16} /></button>
        ) : (
          <button className={btnPrimary} onClick={onConfirm} disabled={busy}>
            {busy ? <Loader2 size={16} className="animate-spin" /> : <Check size={16} />} Confirmer l'import
          </button>
        )}
      </div>
    </div>
  );
}

// ------------------------------------------------------------------ écran

export default function ImportView({ store, onImported, onDone }) {
  const [step, setStep] = useState("upload");
  const [upload, setUpload] = useState(null);
  const [sheetIdx, setSheetIdx] = useState(0);
  const [mapping, setMapping] = useState({});
  const [summary, setSummary] = useState(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const pendingToken = useRef(null);

  // quitter l'écran d'import sans confirmer : le fichier chargé est oublié immédiatement
  useEffect(() => {
    pendingToken.current = upload && step !== "done" ? upload.token : null;
  }, [upload, step]);
  useEffect(() => () => {
    if (pendingToken.current) store.cancelImport?.(pendingToken.current).catch(() => {});
  }, [store]);

  async function confirm() {
    setBusy(true);
    setError("");
    try {
      const res = await store.confirmImport({ token: upload.token, sheet: sheetIdx, mapping, dryRun: false });
      setSummary(res);
      setStep("done");
      onImported?.();
    } catch (e) {
      setError(e.message);
    } finally {
      setBusy(false);
    }
  }

  return (
    <div>
      <Steps step={step} />
      {step === "upload" && (
        <UploadStep
          store={store}
          onUploaded={(up) => {
            setUpload(up);
            setSheetIdx(0);
            setMapping(up.sheets[0].suggested_mapping);
            setStep("mapping");
          }}
        />
      )}
      {step === "mapping" && (
        <MappingStep
          store={store}
          upload={upload}
          sheetIdx={sheetIdx}
          setSheetIdx={setSheetIdx}
          mapping={mapping}
          setMapping={setMapping}
          onBack={() => setStep("upload")}
          onReview={(s) => { setSummary(s); setError(""); setStep("review"); }}
        />
      )}
      {(step === "review" || step === "done") && (
        <ReviewStep
          summary={summary}
          applied={step === "done"}
          busy={busy}
          error={error}
          onBack={() => setStep("mapping")}
          onConfirm={confirm}
          onDone={onDone}
        />
      )}
    </div>
  );
}
