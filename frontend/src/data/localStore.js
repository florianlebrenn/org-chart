// Stockage « autonome » (mode statique, sans serveur) : tout reste dans ce navigateur.
// Persistance : IndexedDB, à défaut localStorage, à défaut mémoire (avertissement affiché).
// Données CHIFFRÉES (core/crypto.js) : seules les métadonnées du coffre (clé enveloppée) sont en clair ;
// la clé de données n'existe qu'en mémoire, après saisie du mot de passe.
import * as vault from '../core/crypto.js'
import { LockedError, announceLocked } from './errors.js'
import { cleanMapping, mappingToHeaders, parseFile, preview, projectRows, suggestMapping } from '../core/importer.js'
import { emptyState, runImport } from '../core/sync.js'
import { siteGroups, wouldCreateCycle } from '../core/tree.js'
import { nameKey } from '../core/text.js'
import { downloadBlob, exportName } from './download.js'

const DB_NAME = 'organigramme'
export const BACKUP_FORMAT = 'organigramme-sauvegarde' // contenu (une fois déchiffré) et ancien format en clair
const MAX_PHOTO = 400_000
export const IDLE_TIMEOUT = 15 * 60 * 1000

// ------------------------------------------------------------------ persistance

function idbOpen() {
  return new Promise((resolve, reject) => {
    if (typeof indexedDB === 'undefined') return reject(new Error('IndexedDB indisponible'))
    const req = indexedDB.open(DB_NAME, 1)
    req.onupgradeneeded = () => req.result.createObjectStore('kv')
    req.onsuccess = () => resolve(req.result)
    req.onerror = () => reject(req.error)
  })
}

function idbBackend(db) {
  const tx = (mode, fn) =>
    new Promise((resolve, reject) => {
      const t = db.transaction('kv', mode)
      const req = fn(t.objectStore('kv'))
      t.oncomplete = () => resolve(req.result)
      t.onerror = () => reject(t.error)
    })
  return {
    kind: 'IndexedDB',
    load: (key) => tx('readonly', (s) => s.get(key)),
    save: (key, value) => tx('readwrite', (s) => s.put(value, key)),
  }
}

function lsBackend() {
  localStorage.setItem(`${DB_NAME}:test`, '1')
  localStorage.removeItem(`${DB_NAME}:test`)
  return {
    kind: 'localStorage',
    load: async (key) => JSON.parse(localStorage.getItem(`${DB_NAME}:${key}`) || 'null'),
    save: async (key, value) => localStorage.setItem(`${DB_NAME}:${key}`, JSON.stringify(value)),
  }
}

export function memoryBackend() {
  const saved = new Map()
  return {
    kind: 'mémoire',
    load: async (key) => structuredClone(saved.get(key) ?? null),
    save: async (key, value) => void saved.set(key, structuredClone(value)),
    dump: () => JSON.stringify(Object.fromEntries(saved)),
  }
}

async function openBackend() {
  try {
    return idbBackend(await idbOpen())
  } catch {
    try {
      return lsBackend()
    } catch {
      return memoryBackend()
    }
  }
}

// ------------------------------------------------------------------ store

export function createLocalStore(backendPromise = openBackend(), { iterations = vault.ITERATIONS } = {}) {
  let state = null // état déchiffré (null tant que verrouillé)
  let dataKey = null // CryptoKey AES (non exportable), null tant que verrouillé
  let lastActivity = 0
  // fichiers en cours d'import : en mémoire uniquement (jamais dans IndexedDB), oubliés après confirmation
  const pending = new Map() // jeton -> {filename, sheets}
  const ready = backendPromise

  const meta = async () => (await ready).load('vault')

  function lockNow() {
    state = null
    dataKey = null
    pending.clear()
  }

  async function current() {
    await ready
    if (dataKey && Date.now() - lastActivity > IDLE_TIMEOUT) lockNow() // inactivité : on oublie tout
    if (!dataKey || !state) {
      announceLocked()
      throw new LockedError()
    }
    lastActivity = Date.now()
    return state
  }
  async function commit(next) {
    const b = await ready
    if (!dataKey) throw new LockedError()
    await b.save('state', await vault.encryptState(dataKey, next))
    state = next
  }
  async function openWith(dek) {
    const b = await ready
    const key = await vault.importDataKey(dek)
    const stored = await b.load('state')
    const loaded = stored ? await vault.decryptState(key, stored) : emptyState()
    dataKey = key
    state = loaded
    lastActivity = Date.now()
  }

  function pendingSheet(token, sheet) {
    const stored = pending.get(token)
    if (!stored) throw new Error('Import expiré ou introuvable : rechargez le fichier.')
    const table = stored.sheets[sheet]
    if (!table) throw new Error('Feuille inconnue.')
    return table
  }

  const view = (s) => {
    const site = Object.fromEntries(s.sites.map((x) => [x.id, x.name]))
    return [...s.employees]
      .sort((a, b) => a.sort_order - b.sort_order || a.id - b.id)
      .map(({ name_key, ...e }) => ({ ...e, site: site[e.site_id] ?? null })) // eslint-disable-line no-unused-vars
  }

  return {
    mode: 'local',
    label: 'Mode autonome',
    capabilities: { serverPdf: false },
    persistence: () => ready.then((b) => b.kind),

    // ---------------------------------------------------------------- coffre
    async vaultStatus() {
      if (!(await meta())) return 'setup'
      if (dataKey && Date.now() - lastActivity > IDLE_TIMEOUT) lockNow()
      return dataKey ? 'unlocked' : 'locked'
    },

    async setup(password) {
      const b = await ready
      if (await meta()) throw new Error('Le mot de passe est déjà défini.')
      const { meta: m, dek, recovery } = await vault.createVault(password, iterations)
      // données en clair d'une version précédente : chiffrées maintenant
      const legacy = await b.load('state')
      const initial = legacy && Array.isArray(legacy.employees) ? legacy : emptyState()
      dataKey = await vault.importDataKey(dek)
      await b.save('state', await vault.encryptState(dataKey, initial))
      await b.save('vault', m)
      state = initial
      lastActivity = Date.now()
      return { recovery_key: recovery }
    },

    async unlock(password) {
      const m = await meta()
      if (!m) throw new Error("Aucun mot de passe défini : créez-le d'abord.")
      await openWith(await vault.openWithPassword(m, password))
      return { state: 'unlocked' }
    },

    async lock() {
      lockNow()
      return { state: 'locked' }
    },

    async recover(recoveryKey, newPassword) {
      const b = await ready
      const m = await meta()
      const dek = await vault.openWithRecovery(m, recoveryKey)
      const recovery = vault.newRecoveryKey()
      await b.save('vault', await vault.rewrap(m, dek, { password: newPassword, recoveryKey: recovery }, iterations))
      await openWith(dek)
      return { recovery_key: recovery }
    },

    async changePassword(currentPassword, newPassword) {
      await current()
      const b = await ready
      const m = await meta()
      let dek
      try {
        dek = await vault.openWithPassword(m, currentPassword)
      } catch {
        throw new Error('Mot de passe actuel incorrect.')
      }
      await b.save('vault', await vault.rewrap(m, dek, { password: newPassword }, iterations))
      return { status: 'ok' }
    },

    async newRecoveryKey(password) {
      await current()
      const b = await ready
      const m = await meta()
      const dek = await vault.openWithPassword(m, password)
      const recovery = vault.newRecoveryKey()
      await b.save('vault', await vault.rewrap(m, dek, { recoveryKey: recovery }, iterations))
      return { recovery_key: recovery }
    },

    // ---------------------------------------------------------------- données
    async health() {
      const status = await this.vaultStatus()
      if (status !== 'unlocked') return { status: 'ok', vault: status }
      const s = await current()
      return { status: 'ok', vault: status, database: (await ready).kind, employees: s.employees.length, sites: s.sites.length }
    },
    employees: async () => view(await current()),
    lastImport: async () => (await current()).settings.last_import || {},

    async upload(file) {
      const sheets = await parseFile(file)
      const s = await current()
      const token = Math.random().toString(16).slice(2) + Date.now().toString(16)
      pending.set(token, { filename: file.name, sheets })
      return {
        token,
        filename: file.name,
        replaces_existing: s.employees.length > 0,
        sheets: sheets.map((t) => ({
          name: t.name,
          header_row: t.header_row,
          headers: t.headers,
          row_count: t.rows.length,
          suggested_mapping: suggestMapping(t.headers, s.settings.import_mapping),
        })),
      }
    },

    async previewImport({ token, sheet = 0, mapping }) {
      const table = pendingSheet(token, sheet)
      return preview(table.rows, table.headers, cleanMapping(mapping, table.headers.length))
    },

    async cancelImport(token) {
      pending.delete(token)
      return { status: 'ok' }
    },

    async confirmImport({ token, sheet = 0, mapping, dryRun }) {
      const table = pendingSheet(token, sheet)
      const m = cleanMapping(mapping, table.headers.length)
      if (!('name' in m) && !('last_name' in m) && !('first_name' in m)) throw new Error('Choisissez au moins la colonne du nom.')
      // confidentialité : à partir d'ici, seules les colonnes retenues existent
      const reduced = projectRows(table.rows, m)
      const res = runImport(await current(), reduced.rows, reduced.mapping, mappingToHeaders(m, table.headers), pending.get(token).filename, dryRun)
      if (!dryRun) {
        await commit(res.state)
        pending.delete(token)
      }
      return { applied: !dryRun, ...res.summary }
    },

    async updateEmployee(id, patch) {
      const s = structuredClone(await current())
      const e = s.employees.find((x) => x.id === id)
      if (!e) throw new Error('Collaborateur introuvable.')
      if ('manager_id' in patch) {
        const m = patch.manager_id
        if (m !== null) {
          if (!s.employees.some((x) => x.id === m)) throw new Error('Supérieur introuvable.')
          if (wouldCreateCycle(s.employees, id, m)) throw new Error('Impossible : ce choix créerait une boucle dans la hiérarchie.')
        }
        e.manager_id = m
      }
      if ('site_id' in patch) {
        if (patch.site_id !== null && !s.sites.some((x) => x.id === patch.site_id)) throw new Error('Site introuvable.')
        e.site_id = patch.site_id
      }
      for (const f of ['title', 'email', 'phone']) if (f in patch) e[f] = (patch[f] || '').trim() || null
      if ('photo' in patch) {
        const p = patch.photo
        if (p !== null && (!/^data:image\/(png|jpeg|webp);base64,/.test(p) || p.length > MAX_PHOTO)) {
          throw new Error('Photo refusée : image PNG/JPEG/WebP de moins de 300 Ko.')
        }
        e.photo = p
      }
      await commit(s)
      return view(s).find((x) => x.id === id)
    },

    async attachUnassigned(siteId, managerId) {
      const s = structuredClone(await current())
      if (!s.employees.some((x) => x.id === managerId)) throw new Error('Collaborateur introuvable.')
      const groups = siteGroups(view(s)).filter((g) => g.site_id === (siteId ?? null))
      const ids = groups
        .flatMap((g) => g.unassigned.map((n) => n.id))
        .filter((i) => i !== managerId && !wouldCreateCycle(s.employees, i, managerId))
      for (const e of s.employees) if (ids.includes(e.id)) e.manager_id = managerId
      await commit(s)
      return { attached: ids.length }
    },

    async downloadBackup(password) {
      const s = await current()
      await vault.openWithPassword(await meta(), password) // vérifie le mot de passe actuel
      const data = {
        format: BACKUP_FORMAT,
        version: 1,
        exported_at: new Date().toISOString().slice(0, 19),
        sites: s.sites,
        employees: s.employees.map(({ name_key, ...e }) => e), // eslint-disable-line no-unused-vars
        settings: { import_mapping: s.settings.import_mapping, last_import: s.settings.last_import },
      }
      const doc = await vault.encryptBackup(data, password, iterations)
      downloadBlob(new Blob([JSON.stringify(doc, null, 1)], { type: 'application/json' }), exportName('json'))
      return doc
    },

    async restore(doc, password) {
      await current()
      const data = doc?.format === vault.BACKUP_FORMAT ? await vault.decryptBackup(doc, password) : doc
      if (!data || typeof data !== 'object' || data.format !== BACKUP_FORMAT) {
        throw new Error("Ce fichier n'est pas une sauvegarde de l'organigramme.")
      }
      const sites = (data.sites || []).map((x) => ({ id: x.id, name: x.name }))
      const siteIds = new Set(sites.map((x) => x.id))
      const empIds = new Set((data.employees || []).map((e) => e.id))
      const employees = (data.employees || []).map((e) => ({
        id: e.id,
        name: e.name,
        name_key: nameKey(e.name),
        title: e.title ?? null,
        email: e.email ?? null,
        phone: e.phone ?? null,
        photo: e.photo ?? null,
        site_id: siteIds.has(e.site_id) ? e.site_id : null,
        manager_id: empIds.has(e.manager_id) ? e.manager_id : null,
        sort_order: e.sort_order || 0,
      }))
      const next = {
        sites,
        employees,
        settings: {
          ...(data.settings?.import_mapping ? { import_mapping: data.settings.import_mapping } : {}),
          ...(data.settings?.last_import ? { last_import: data.settings.last_import } : {}),
        },
        seq: {
          site: Math.max(0, ...sites.map((x) => x.id)),
          employee: Math.max(0, ...employees.map((x) => x.id)),
        },
      }
      await commit(next)
      return { restored: employees.length }
    },

    async reset() {
      await current()
      await commit(emptyState())
      return { status: 'ok' }
    },
  }
}
