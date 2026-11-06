import { useCallback, useEffect, useState } from "react";
import { Database, Lock, Network, Upload } from "lucide-react";
import { store } from "./data/index.js";
import ImportView from "./ImportView.jsx";
import OrgView from "./OrgView.jsx";
import DataView from "./DataView.jsx";
import { useVault } from "./vaultContext.js";

function StatusBadge({ health, error }) {
  const status = error ? "error" : health ? "ok" : "loading";
  const styles = {
    loading: "bg-slate-100 text-slate-600",
    ok: "bg-emerald-50 text-emerald-700 border-emerald-200",
    error: "bg-red-50 text-red-700 border-red-200",
  };
  const ok =
    store.mode === "server"
      ? `Backend OK · ${health?.employees ?? 0} collaborateurs · ${health?.sites ?? 0} sites`
      : `Mode autonome · ${health?.employees ?? 0} collaborateurs · données dans ce navigateur`;
  const label = { loading: "Vérification…", ok, error: store.mode === "server" ? "Backend injoignable" : "Stockage local indisponible" };
  return (
    <span data-testid="health-badge" data-status={status} title={error || ""}
      className={`inline-flex items-center rounded-full border px-2 py-0.5 text-xs ${styles[status]}`}>
      {label[status]}
    </span>
  );
}

function formatDate(iso) {
  try {
    return new Date(iso).toLocaleString("fr-FR", { dateStyle: "long", timeStyle: "short" });
  } catch {
    return iso;
  }
}

export default function App() {
  const [view, setView] = useState("org");
  const [employees, setEmployees] = useState([]);
  const [health, setHealth] = useState(null);
  const [lastImport, setLastImport] = useState(null);
  const [error, setError] = useState("");
  const [importKey, setImportKey] = useState(0);
  const { lock } = useVault();

  const reload = useCallback(async () => {
    try {
      const [emps, last, h] = await Promise.all([store.employees(), store.lastImport(), store.health()]);
      setEmployees(emps);
      setLastImport(last?.filename ? last : null);
      setHealth(h);
      setError("");
    } catch (e) {
      setError(e.message);
    }
  }, []);

  useEffect(() => {
    reload();
  }, [reload]);

  const tab = (id, Icon, label) => (
    <button
      onClick={() => {
        if (id === "import") setImportKey((k) => k + 1); // repart de l'étape 1
        setView(id);
      }}
      className={`inline-flex items-center gap-2 rounded-xl px-3 py-2 text-sm ${
        view === id ? "bg-slate-900 text-white shadow" : "border bg-white shadow-sm hover:bg-slate-50"
      }`}
    >
      <Icon size={16} /> {label}
    </button>
  );

  return (
    <div className="min-h-screen bg-gradient-to-b from-slate-50 to-slate-100 text-slate-800 print:bg-white">
      <div className="mx-auto max-w-[1600px] p-4 sm:p-6 print:max-w-none print:p-0">
        <header className="no-print mb-5 flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between">
          <div>
            <h1 className="text-2xl font-bold tracking-tight sm:text-3xl">Organigramme</h1>
            <p className="mt-1 flex flex-wrap items-center gap-2 text-sm text-slate-600">
              <StatusBadge health={health} error={error} />
              {lastImport && <span>Dernier import : {lastImport.filename} · {formatDate(lastImport.date)}</span>}
            </p>
          </div>
          <nav className="flex gap-2">
            {tab("org", Network, "Organigramme")}
            {tab("import", Upload, "Importer")}
            {tab("data", Database, "Données")}
            <button
              onClick={lock}
              title="Verrouiller (efface la clé de chiffrement de la mémoire)"
              className="inline-flex items-center gap-2 rounded-xl border bg-white px-3 py-2 text-sm shadow-sm hover:bg-slate-50"
            >
              <Lock size={16} /> Verrouiller
            </button>
          </nav>
        </header>

        {error && <div className="no-print mb-4 rounded-xl border border-red-200 bg-red-50 p-3 text-sm text-red-700">{error}</div>}

        {view === "org" && <OrgView store={store} employees={employees} reload={reload} onImport={() => setView("import")} />}
        {view === "import" && <ImportView key={importKey} store={store} onImported={reload} onDone={() => setView("org")} />}
        {view === "data" && <DataView store={store} health={health} onChanged={reload} />}

        <footer className="no-print mt-8 text-center text-xs text-slate-500">
          Organigramme par{" "}
          <a href="https://www.linkedin.com/in/florianlebrenn/" target="_blank" rel="noopener noreferrer" className="underline hover:text-slate-700">Florian Le Brenn</a>
          {" "}· licence MIT · 100 % local, aucune donnée ne quitte cette machine
        </footer>
      </div>
    </div>
  );
}
