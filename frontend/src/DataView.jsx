import { useEffect, useState } from "react";
import { AlertTriangle, Check, Database, Download, KeyRound, Lock, RotateCcw, ShieldCheck, Trash2, Upload } from "lucide-react";
import { useVault } from "./vaultContext.js";

const card = "rounded-2xl border bg-white p-5 shadow-sm";
const btn = "inline-flex items-center gap-2 rounded-xl border bg-white px-3 py-2 text-sm shadow-sm hover:bg-slate-50 disabled:opacity-50";
const dark = "inline-flex items-center gap-1 rounded-lg bg-slate-900 px-3 py-1.5 text-sm text-white disabled:opacity-50";
const field = "w-full rounded-lg border px-2 py-1.5 text-sm focus:outline-none focus:ring-2 focus:ring-slate-300";

function Pw({ label, value, onChange, testId, autoComplete = "current-password" }) {
  return (
    <label className="block text-sm">
      <span className="text-xs font-medium text-slate-500">{label}</span>
      <input type="password" autoComplete={autoComplete} data-testid={testId} className={field} value={value} onChange={(e) => onChange(e.target.value)} />
    </label>
  );
}

/** Sauvegarde chiffrée, restauration, effacement, mot de passe et clé de secours. */
export default function DataView({ store, health, onChanged }) {
  const { showRecoveryKey } = useVault();
  const [message, setMessage] = useState(null);
  const [backupPw, setBackupPw] = useState("");
  const [pendingRestore, setPendingRestore] = useState(null);
  const [restorePw, setRestorePw] = useState("");
  const [confirmReset, setConfirmReset] = useState(false);
  const [persistence, setPersistence] = useState(null);
  const [pwForm, setPwForm] = useState({ current: "", next: "", again: "" });
  const [rkPw, setRkPw] = useState("");
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    store.persistence?.().then(setPersistence);
  }, [store]);

  const ok = (text) => setMessage({ text });
  const fail = (e) => setMessage({ text: e.message || String(e), error: true });
  async function run(fn) {
    setBusy(true);
    setMessage(null);
    try {
      await fn();
    } catch (e) {
      fail(e);
    } finally {
      setBusy(false);
    }
  }

  async function readBackup(file) {
    if (!file) return;
    try {
      const data = JSON.parse(await file.text());
      const encrypted = data?.format === "organigramme-sauvegarde-chiffree";
      if (!encrypted && data?.format !== "organigramme-sauvegarde") throw new Error("Ce fichier n'est pas une sauvegarde de l'organigramme.");
      setRestorePw("");
      setPendingRestore({ data, name: file.name, encrypted });
    } catch (e) {
      fail(e.name === "SyntaxError" ? new Error("Fichier illisible (JSON attendu).") : e);
    }
  }

  return (
    <div className="space-y-5">
      <div className={card}>
        <div className="flex items-center gap-2 font-semibold"><Database size={18} /> Où sont les données ?</div>
        {store.mode === "server" ? (
          <p className="mt-2 text-sm text-slate-600">
            Mode serveur : base SQLite du conteneur (volume Docker <code>org-data</code>), sur cette machine uniquement, <strong>chiffrée</strong> (AES-256-GCM).
            La clé n'existe qu'en mémoire du serveur, tant que l'application est déverrouillée.
          </p>
        ) : (
          <p className="mt-2 text-sm text-slate-600">
            Mode autonome : les données sont enregistrées <strong>chiffrées dans ce navigateur, sur cet ordinateur</strong>
            {persistence ? ` (${persistence})` : ""}. Elles ne sont envoyées nulle part, mais elles peuvent être perdues si
            l'historique du navigateur est effacé : <strong>téléchargez une sauvegarde après chaque mise à jour</strong>.
          </p>
        )}
        {persistence === "mémoire" && (
          <p className="mt-2 flex items-center gap-2 text-sm text-red-700">
            <AlertTriangle size={14} /> Ce navigateur refuse le stockage local : les données seront perdues à la fermeture de la page.
          </p>
        )}
        {health && <p className="mt-2 text-sm text-slate-500">{health.employees ?? 0} collaborateurs · {health.sites ?? 0} sites enregistrés.</p>}
      </div>

      <div className={card}>
        <div className="font-semibold">Sauvegarde chiffrée</div>
        <p className="mt-1 text-sm text-slate-600">
          Un fichier <code>.json</code> chiffré avec le mot de passe actuel : collaborateurs, hiérarchie, photos et choix de colonnes.
          Il sert aussi à passer du mode serveur au mode autonome (et inversement). Pour le restaurer, il faudra ce mot de passe.
        </p>
        <form
          className="mt-3 flex flex-wrap items-end gap-2"
          onSubmit={(e) => {
            e.preventDefault();
            run(async () => {
              await store.downloadBackup(backupPw);
              setBackupPw("");
              ok("Sauvegarde chiffrée téléchargée.");
            });
          }}
        >
          <div className="w-64"><Pw label="Mot de passe actuel" value={backupPw} onChange={setBackupPw} testId="backup-password" /></div>
          <button type="submit" className={btn} disabled={busy || !backupPw}><Download size={16} /> Télécharger une sauvegarde</button>
          <label className={btn + " cursor-pointer"}>
            <Upload size={16} /> Restaurer une sauvegarde…
            <input type="file" accept=".json,application/json" className="hidden" data-testid="restore-input" onChange={(e) => { readBackup(e.target.files?.[0]); e.target.value = ""; }} />
          </label>
        </form>
        {pendingRestore && (
          <form
            className="mt-3 rounded-xl border border-amber-200 bg-amber-50 p-3 text-sm"
            onSubmit={(e) => {
              e.preventDefault();
              run(async () => {
                const r = await store.restore(pendingRestore.data, restorePw);
                setPendingRestore(null);
                ok(`${r.restored} collaborateurs restaurés.`);
                onChanged();
              });
            }}
          >
            <p>
              Restaurer « {pendingRestore.name} » {pendingRestore.data.exported_at ? `(du ${pendingRestore.data.exported_at.replace("T", " à ")})` : ""} ?
              Les données actuelles seront <strong>remplacées</strong>.
            </p>
            {pendingRestore.encrypted && (
              <div className="mt-2 w-72"><Pw label="Mot de passe de cette sauvegarde" value={restorePw} onChange={setRestorePw} testId="restore-password" /></div>
            )}
            <div className="mt-2 flex gap-2">
              <button type="submit" className={dark} disabled={busy || (pendingRestore.encrypted && !restorePw)}>
                <RotateCcw size={14} /> Confirmer la restauration
              </button>
              <button type="button" className="rounded-lg border bg-white px-3 py-1.5" onClick={() => setPendingRestore(null)}>Annuler</button>
            </div>
          </form>
        )}
      </div>

      <div className={card}>
        <div className="flex items-center gap-2 font-semibold"><ShieldCheck size={18} /> Sécurité</div>
        <p className="mt-1 text-sm text-slate-600">
          Données chiffrées (AES-256-GCM, clé protégée par le mot de passe et par la clé de secours). Verrouillage automatique après 15 minutes d'inactivité.
        </p>
        <div className="mt-4 grid gap-6 md:grid-cols-2">
          <form
            className="space-y-2"
            onSubmit={(e) => {
              e.preventDefault();
              if (pwForm.next !== pwForm.again) return fail(new Error("Les deux nouveaux mots de passe sont différents."));
              run(async () => {
                await store.changePassword(pwForm.current, pwForm.next);
                setPwForm({ current: "", next: "", again: "" });
                ok("Mot de passe changé. Les anciennes sauvegardes gardent l'ancien mot de passe.");
              });
            }}
          >
            <div className="text-sm font-medium"><Lock size={14} className="mr-1 inline" />Changer le mot de passe</div>
            <Pw label="Mot de passe actuel" value={pwForm.current} onChange={(v) => setPwForm({ ...pwForm, current: v })} testId="pw-current" />
            <Pw label="Nouveau mot de passe (12 caractères minimum)" autoComplete="new-password" value={pwForm.next} onChange={(v) => setPwForm({ ...pwForm, next: v })} testId="pw-new" />
            <Pw label="Confirmer le nouveau mot de passe" autoComplete="new-password" value={pwForm.again} onChange={(v) => setPwForm({ ...pwForm, again: v })} testId="pw-again" />
            <button type="submit" className={dark} disabled={busy || !pwForm.current || !pwForm.next}>Changer le mot de passe</button>
          </form>
          <form
            className="space-y-2"
            onSubmit={(e) => {
              e.preventDefault();
              run(async () => {
                const r = await store.newRecoveryKey(rkPw);
                setRkPw("");
                showRecoveryKey(r.recovery_key);
              });
            }}
          >
            <div className="text-sm font-medium"><KeyRound size={14} className="mr-1 inline" />Nouvelle clé de secours</div>
            <p className="text-xs text-slate-500">Si la clé de secours a été perdue ou vue par quelqu'un : l'ancienne cessera de fonctionner.</p>
            <Pw label="Mot de passe actuel" value={rkPw} onChange={setRkPw} testId="rk-password" />
            <button type="submit" className={dark} disabled={busy || !rkPw}>Générer une nouvelle clé</button>
          </form>
        </div>
      </div>

      <div className={card + " border-red-100"}>
        <div className="font-semibold text-red-700">Effacer toutes les données</div>
        <p className="mt-1 text-sm text-slate-600">Supprime collaborateurs, hiérarchie, photos et réglages (le mot de passe est conservé). Pensez à télécharger une sauvegarde avant.</p>
        {!confirmReset ? (
          <button className={btn + " mt-3 text-red-700"} onClick={() => setConfirmReset(true)}><Trash2 size={16} /> Effacer…</button>
        ) : (
          <div className="mt-3 flex gap-2">
            <button
              className="inline-flex items-center gap-1 rounded-lg bg-red-700 px-3 py-1.5 text-sm text-white"
              onClick={() => run(async () => {
                await store.reset();
                setConfirmReset(false);
                ok("Toutes les données ont été effacées.");
                onChanged();
              })}
            >
              <Trash2 size={14} /> Oui, tout effacer
            </button>
            <button className="rounded-lg border px-3 py-1.5 text-sm" onClick={() => setConfirmReset(false)}>Annuler</button>
          </div>
        )}
      </div>

      {message && (
        <div role="status" className={`flex items-center gap-2 rounded-xl border p-3 text-sm ${message.error ? "border-red-200 bg-red-50 text-red-700" : "border-emerald-200 bg-emerald-50 text-emerald-800"}`}>
          {message.error ? <AlertTriangle size={16} /> : <Check size={16} />} {message.text}
        </div>
      )}
    </div>
  );
}
