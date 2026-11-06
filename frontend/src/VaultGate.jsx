import { useCallback, useEffect, useRef, useState } from "react";
import { AlertTriangle, Check, Copy, Download, KeyRound, Loader2, Lock, Printer, ShieldCheck } from "lucide-react";
import { LOCK_EVENT } from "./data/errors.js";
import { downloadBlob } from "./data/download.js";
import { VaultContext } from "./vaultContext.js";

// Verrouillage automatique après 15 minutes sans activité (souris, clavier, défilement).
const IDLE_MS = 15 * 60 * 1000;
const MIN_PASSWORD = 12;

const input = "w-full rounded-xl border px-3 py-2 focus:outline-none focus:ring-2 focus:ring-slate-300";
const primary = "inline-flex w-full items-center justify-center gap-2 rounded-xl bg-slate-900 px-4 py-2.5 text-sm font-medium text-white shadow hover:bg-slate-800 disabled:opacity-50";
const link = "text-sm text-slate-500 underline hover:text-slate-800";

function Shell({ title, icon = Lock, children, wide }) {
  const Icon = icon;
  return (
    <div className="flex min-h-screen items-center justify-center bg-gradient-to-b from-slate-50 to-slate-100 p-4">
      <div className={`w-full ${wide ? "max-w-xl" : "max-w-md"} rounded-2xl border bg-white p-6 shadow-sm`} data-testid="vault-screen">
        <div className="mb-4 flex items-center gap-2">
          <span className="flex h-9 w-9 items-center justify-center rounded-full bg-slate-900 text-white"><Icon size={18} /></span>
          <h1 className="text-lg font-bold">{title}</h1>
        </div>
        {children}
      </div>
    </div>
  );
}

function ErrorLine({ error }) {
  if (!error) return null;
  return (
    <p role="alert" className="mt-3 flex items-start gap-1.5 rounded-lg bg-red-50 p-2 text-sm text-red-700">
      <AlertTriangle size={15} className="mt-0.5 shrink-0" /> {error}
    </p>
  );
}

/** Saisie d'un nouveau mot de passe + confirmation, avec rappel des règles. */
function NewPassword({ value, confirm, onChange, onConfirm, labels = ["Mot de passe", "Confirmer le mot de passe"] }) {
  const long = value.length >= MIN_PASSWORD;
  const same = value && value === confirm;
  return (
    <div className="space-y-3">
      <label className="block text-sm">
        <span className="font-medium">{labels[0]}</span>
        <input type="password" autoComplete="new-password" data-testid="new-password" className={input} value={value} onChange={(e) => onChange(e.target.value)} />
      </label>
      <label className="block text-sm">
        <span className="font-medium">{labels[1]}</span>
        <input type="password" autoComplete="new-password" data-testid="confirm-password" className={input} value={confirm} onChange={(e) => onConfirm(e.target.value)} />
      </label>
      <ul className="space-y-0.5 text-xs">
        <li className={long ? "text-emerald-700" : "text-slate-500"}>{long ? "✓" : "•"} au moins {MIN_PASSWORD} caractères (une phrase de passe est idéale, ex. « trois chats lisent le journal »)</li>
        <li className={same ? "text-emerald-700" : "text-slate-500"}>{same ? "✓" : "•"} les deux saisies sont identiques</li>
      </ul>
    </div>
  );
}

/** Affichage unique de la clé de secours. */
export function RecoveryKeyScreen({ recoveryKey, onDone, title = "Votre clé de secours" }) {
  const [saved, setSaved] = useState(false);
  const [copied, setCopied] = useState(false);
  const text = `Organigramme — clé de secours\n\n${recoveryKey}\n\nCréée le ${new Date().toLocaleString("fr-FR")}.\nElle permet de choisir un nouveau mot de passe si vous l'oubliez.\nConservez-la HORS de cet ordinateur (papier rangé, coffre-fort de mots de passe).\n`;
  return (
    <Shell title={title} icon={KeyRound} wide>
      <p className="text-sm text-slate-600">
        Si vous oubliez le mot de passe, cette clé est le <strong>seul moyen</strong> de récupérer les données. Elle n'est affichée qu'une fois.
      </p>
      <div className="my-4 select-all rounded-xl border-2 border-dashed border-slate-300 bg-slate-50 p-4 text-center font-mono text-lg font-semibold tracking-wider" data-testid="recovery-key">
        {recoveryKey}
      </div>
      <div className="no-print flex flex-wrap justify-center gap-2 text-sm">
        <button className="inline-flex items-center gap-1.5 rounded-lg border px-3 py-1.5 hover:bg-slate-50"
          onClick={() => navigator.clipboard?.writeText(recoveryKey).then(() => setCopied(true)).catch(() => {})}>
          {copied ? <Check size={14} /> : <Copy size={14} />} {copied ? "Copiée" : "Copier"}
        </button>
        <button className="inline-flex items-center gap-1.5 rounded-lg border px-3 py-1.5 hover:bg-slate-50" onClick={() => window.print()}>
          <Printer size={14} /> Imprimer
        </button>
        <button className="inline-flex items-center gap-1.5 rounded-lg border px-3 py-1.5 hover:bg-slate-50"
          onClick={() => downloadBlob(new Blob([text], { type: "text/plain;charset=utf-8" }), "organigramme-cle-de-secours.txt")}>
          <Download size={14} /> Télécharger (.txt)
        </button>
      </div>
      <p className="mt-3 flex items-start gap-1.5 rounded-lg bg-amber-50 p-2 text-xs text-amber-800">
        <AlertTriangle size={14} className="mt-0.5 shrink-0" />
        Sans le mot de passe ni cette clé, les données sont définitivement illisibles, pour tout le monde. Si vous la téléchargez, ne laissez pas le fichier sur cet ordinateur.
      </p>
      <label className="no-print mt-4 flex items-center gap-2 text-sm">
        <input type="checkbox" data-testid="recovery-saved" checked={saved} onChange={(e) => setSaved(e.target.checked)} />
        J'ai rangé la clé de secours en lieu sûr
      </label>
      <button className={primary + " no-print mt-4"} disabled={!saved} onClick={onDone}>Continuer</button>
    </Shell>
  );
}

function SetupScreen({ store, onCreated }) {
  const [pw, setPw] = useState("");
  const [pw2, setPw2] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  async function submit(e) {
    e.preventDefault();
    if (pw !== pw2) return setError("Les deux mots de passe sont différents.");
    setBusy(true);
    setError("");
    try {
      const r = await store.setup(pw);
      onCreated(r.recovery_key);
    } catch (err) {
      setError(err.message);
    } finally {
      setBusy(false);
    }
  }
  return (
    <Shell title="Protégez l'organigramme" icon={ShieldCheck}>
      <p className="mb-4 text-sm text-slate-600">
        Les données (noms, fonctions, contacts, photos) seront <strong>chiffrées</strong> sur {store.mode === "server" ? "le serveur" : "cet ordinateur"}.
        Choisissez un mot de passe : il sera demandé à chaque ouverture et après 15 minutes d'inactivité.
      </p>
      <form onSubmit={submit}>
        <NewPassword value={pw} confirm={pw2} onChange={setPw} onConfirm={setPw2} />
        <ErrorLine error={error} />
        <button type="submit" className={primary + " mt-4"} disabled={busy || pw.length < MIN_PASSWORD || !pw2}>
          {busy && <Loader2 size={16} className="animate-spin" />} Créer le mot de passe
        </button>
      </form>
    </Shell>
  );
}

function LockScreen({ store, onUnlocked, onRecovered }) {
  const [mode, setMode] = useState("unlock");
  const [pw, setPw] = useState("");
  const [key, setKey] = useState("");
  const [pw1, setPw1] = useState("");
  const [pw2, setPw2] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  async function run(fn) {
    setBusy(true);
    setError("");
    try {
      await fn();
    } catch (err) {
      setError(err.message);
    } finally {
      setBusy(false);
    }
  }

  if (mode === "recover") {
    return (
      <Shell title="Mot de passe oublié" icon={KeyRound}>
        <p className="mb-4 text-sm text-slate-600">Saisissez la clé de secours remise lors de la création du mot de passe, puis choisissez un nouveau mot de passe.</p>
        <form onSubmit={(e) => {
          e.preventDefault();
          if (pw1 !== pw2) return setError("Les deux mots de passe sont différents.");
          run(async () => onRecovered((await store.recover(key, pw1)).recovery_key));
        }}>
          <label className="mb-3 block text-sm">
            <span className="font-medium">Clé de secours</span>
            <input data-testid="recovery-input" className={input + " font-mono uppercase"} value={key} onChange={(e) => setKey(e.target.value)} placeholder="XXXX-XXXX-XXXX-XXXX-XXXX-XXXX-XXXX-XXXX" autoComplete="off" spellCheck={false} />
          </label>
          <NewPassword value={pw1} confirm={pw2} onChange={setPw1} onConfirm={setPw2} labels={["Nouveau mot de passe", "Confirmer le nouveau mot de passe"]} />
          <ErrorLine error={error} />
          <button type="submit" className={primary + " mt-4"} disabled={busy || !key || pw1.length < MIN_PASSWORD}>
            {busy && <Loader2 size={16} className="animate-spin" />} Changer le mot de passe
          </button>
        </form>
        <button className={link + " mt-3"} onClick={() => { setMode("unlock"); setError(""); }}>Retour</button>
      </Shell>
    );
  }

  return (
    <Shell title="Organigramme verrouillé">
      <p className="mb-4 text-sm text-slate-600">Les données sont chiffrées. Saisissez le mot de passe pour les ouvrir.</p>
      <form onSubmit={(e) => { e.preventDefault(); run(async () => { await store.unlock(pw); onUnlocked(); }); }}>
        <label className="block text-sm">
          <span className="font-medium">Mot de passe</span>
          <input type="password" autoFocus autoComplete="current-password" data-testid="unlock-password" className={input} value={pw} onChange={(e) => setPw(e.target.value)} />
        </label>
        <ErrorLine error={error} />
        <button type="submit" className={primary + " mt-4"} disabled={busy || !pw}>
          {busy && <Loader2 size={16} className="animate-spin" />} Déverrouiller
        </button>
      </form>
      <button className={link + " mt-3"} onClick={() => { setMode("recover"); setError(""); }}>Mot de passe oublié ?</button>
    </Shell>
  );
}

/** Affiche l'application seulement une fois déverrouillée ; gère le verrouillage automatique. */
export default function VaultGate({ store, children }) {
  const [status, setStatus] = useState("loading");
  const [recoveryKey, setRecoveryKey] = useState(null);
  const [error, setError] = useState("");
  const lastActivity = useRef(Date.now());

  const refresh = useCallback(() => {
    store.vaultStatus().then(setStatus).catch((e) => setError(e.message));
  }, [store]);

  const lock = useCallback(async () => {
    try {
      await store.lock();
    } finally {
      setStatus("locked");
    }
  }, [store]);

  useEffect(refresh, [refresh]);

  // verrouillage annoncé par le stockage (session expirée côté serveur, etc.)
  useEffect(() => {
    const onLocked = () => setStatus((s) => (s === "unlocked" ? "locked" : s));
    window.addEventListener(LOCK_EVENT, onLocked);
    return () => window.removeEventListener(LOCK_EVENT, onLocked);
  }, []);

  // verrouillage automatique après inactivité
  useEffect(() => {
    if (status !== "unlocked") return;
    lastActivity.current = Date.now();
    const touch = () => (lastActivity.current = Date.now());
    const events = ["pointerdown", "pointermove", "keydown", "wheel", "touchstart"];
    events.forEach((ev) => window.addEventListener(ev, touch, { passive: true }));
    const timer = setInterval(() => {
      if (Date.now() - lastActivity.current > IDLE_MS) lock();
    }, 10_000);
    return () => {
      events.forEach((ev) => window.removeEventListener(ev, touch));
      clearInterval(timer);
    };
  }, [status, lock]);

  if (error) {
    return <Shell title="Erreur"><ErrorLine error={error} /></Shell>;
  }
  if (recoveryKey) {
    return (
      <RecoveryKeyScreen
        recoveryKey={recoveryKey}
        title={status === "unlocked" ? "Votre clé de secours" : "Nouvelle clé de secours"}
        onDone={() => { setRecoveryKey(null); setStatus("unlocked"); }}
      />
    );
  }
  if (status === "loading") {
    return <div className="flex min-h-screen items-center justify-center text-slate-400"><Loader2 className="animate-spin" /></div>;
  }
  if (status === "setup") {
    return <SetupScreen store={store} onCreated={(rk) => { setRecoveryKey(rk); setStatus("unlocked"); }} />;
  }
  if (status === "locked") {
    return (
      <LockScreen
        store={store}
        onUnlocked={() => setStatus("unlocked")}
        onRecovered={(rk) => { setRecoveryKey(rk); setStatus("unlocked"); }}
      />
    );
  }
  return <VaultContext.Provider value={{ lock, showRecoveryKey: setRecoveryKey }}>{children}</VaultContext.Provider>;
}
