// Tests du mode autonome (mêmes scénarios que backend/tests) — `npm test` (lanceur intégré à Node, sans dépendance)
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import path from 'node:path'
import { describe, it } from 'node:test'
import assert from 'node:assert/strict'
import { createLocalStore, memoryBackend, IDLE_TIMEOUT } from '../data/localStore.js'
import { LockedError } from '../data/errors.js'
import * as vault from './crypto.js'
import { nameKey, prettyName } from './text.js'
import { parseCsvText, suggestMapping } from './importer.js'
import { filterGroups, guessSiteHead, layoutItems, siteGroups, toMermaid } from './tree.js'

// petit équivalent de expect() au-dessus de node:assert
const expect = (v) => ({
  toBe: (x) => assert.strictEqual(v, x),
  toEqual: (x) => assert.deepStrictEqual(v, x),
  toHaveLength: (n) => assert.strictEqual(v?.length, n),
  toBeNull: () => assert.strictEqual(v, null),
  rejects: {
    toThrow: (msg) => assert.rejects(v, (e) => e.message.includes(msg)),
    toBeInstanceOf: (cls) => assert.rejects(v, cls),
  },
  not: { toBe: (x) => assert.notStrictEqual(v, x) },
})

const SAMPLES = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../../tools/sample-data')
const sample = (name) => new File([readFileSync(path.join(SAMPLES, name))], name)

const PW = 'mot de passe de test 2026'

/** Stockage en mémoire, coffre non créé (itérations réduites pour la vitesse des tests). */
function rawStore(backend = memoryBackend()) {
  const store = createLocalStore(Promise.resolve(backend), { iterations: 1000 })
  store.savedJson = () => backend.dump()
  store.backend = backend
  return store
}

/** Stockage prêt à l'emploi : mot de passe créé, déverrouillé. Synchrone pour l'appelant (setup en tâche). */
function memoryStore() {
  const store = rawStore()
  const ready = store.setup(PW)
  const wrapped = {}
  for (const [k, v] of Object.entries(store)) {
    const sync = k === 'savedJson'
    wrapped[k] = typeof v === 'function' && !sync ? async (...a) => (await ready, v.apply(store, a)) : v
  }
  return wrapped
}

function withDownloadStub(fn) {
  return async () => {
    let blob
    const orig = globalThis.document
    globalThis.URL.createObjectURL = (b) => ((blob = b), 'blob:x')
    globalThis.URL.revokeObjectURL = () => {}
    globalThis.document = { createElement: () => ({ click() {}, remove() {} }), body: { appendChild() {} } }
    try {
      await fn(() => blob)
    } finally {
      globalThis.document = orig
    }
  }
}

async function importFile(store, name, { mapping, dryRun = false } = {}) {
  const up = await store.upload(sample(name))
  return store.confirmImport({ token: up.token, sheet: 0, mapping: mapping ?? up.sheets[0].suggested_mapping, dryRun })
}

const byName = async (store) => Object.fromEntries((await store.employees()).map((e) => [e.name, e]))

describe('texte & mapping', () => {
  it('normalise les noms comme le backend', () => {
    expect(nameKey('Hélène MARCHAND')).toBe('helene marchand')
    expect(nameKey('marchand  helene')).toBe('helene marchand')
    expect(prettyName("MARION D'ALMEIDA")).toBe("Marion D'Almeida")
    expect(prettyName('JEAN-BAPTISTE Morel')).toBe('Jean-Baptiste Morel')
  })
  it('propose le mapping', () => {
    expect(suggestMapping(['Nom', 'Prénom', 'Fonction', 'Bâtiment de rattachement', 'Email', 'Téléphone'])).toEqual({
      last_name: 0, first_name: 1, title: 2, site: 3, email: 4, phone: 5,
    })
    expect(suggestMapping(['Collaborateur', 'Poste', 'Site', 'Mail', 'Supérieur hiérarchique'])).toEqual({
      name: 0, title: 1, site: 2, email: 3, manager: 4,
    })
    expect(suggestMapping(['Nom', 'Fonction'])).toEqual({ name: 0, title: 1 })
  })
  it('lit un CSV avec guillemets', () => {
    expect(parseCsvText('a;b\n"x;1";"dit ""oui"""\n')).toEqual([['a', 'b'], ['x;1', 'dit "oui"']])
  })
})

describe('import local', () => {
  it('lit un xlsx avec titre et 2 feuilles', async () => {
    const store = memoryStore()
    const up = await store.upload(sample('collaborateurs_sans_superieur.xlsx'))
    expect(up.sheets.map((s) => s.name)).toEqual(['Personnel'])
    expect(up.sheets[0].header_row).toBe(3)
    expect(up.sheets[0].row_count).toBe(48)
  })

  it('lit le CSV Windows-1252', async () => {
    const store = memoryStore()
    const res = await importFile(store, 'collaborateurs.csv')
    expect(res.total).toBe(48)
    expect((await byName(store))['Hélène Marchand'].site).toBe('Siège - Lyon')
  })

  it('refuse le .xls', async () => {
    await expect(memoryStore().upload(new File(['x'], 'vieux.xls'))).rejects.toThrow('.xlsx')
  })

  it('simulation puis import avec hiérarchie', async () => {
    const store = memoryStore()
    const dry = await importFile(store, 'collaborateurs_avec_superieur.xlsx', { dryRun: true })
    expect(dry.added).toHaveLength(48)
    expect((await store.health()).employees).toBe(0)
    await importFile(store, 'collaborateurs_avec_superieur.xlsx')
    const e = await byName(store)
    const name = (id) => Object.values(e).find((x) => x.id === id)?.name
    expect(name(e['Nadia Benali'].manager_id)).toBe('François Lefèvre')
    expect(name(e['Antoine Faure'].manager_id)).toBe('Mehdi Brahimi')
    const groups = siteGroups(await store.employees())
    expect(groups.map((g) => g.site)).toEqual(['Atelier - Villeurbanne', 'Entrepôt - Vénissieux', 'Siège - Lyon'])
    expect(groups.map((g) => g.trees.map((t) => t.name))).toEqual([['Philippe Rousseau'], ['Valérie Noël'], ['Hélène Marchand']])
  })

  it('réimport : hiérarchie conservée, arrivées, départs, changements', async () => {
    const store = memoryStore()
    await importFile(store, 'collaborateurs_avec_superieur.xlsx')
    const before = await byName(store)
    const mapping = { last_name: 0, first_name: 1, title: 2, site: 3, email: 4, phone: 5 }
    const dry = await importFile(store, 'collaborateurs_mise_a_jour.xlsx', { mapping, dryRun: true })
    expect([...dry.added].sort()).toEqual(['Hugo Petit', 'Léa Durand', 'Zoé Martin'])
    expect([...dry.removed].sort()).toEqual(['Bruno Guerin', 'Laetitia Renard'])
    await importFile(store, 'collaborateurs_mise_a_jour.xlsx', { mapping })
    const after = await byName(store)
    expect(Object.keys(after)).toHaveLength(49)
    for (const n of ['Nadia Benali', 'Antoine Faure', 'Yanis Chevalier', 'Lucas Blanc']) {
      expect(after[n].id).toBe(before[n].id)
      expect(after[n].manager_id).toBe(before[n].manager_id)
    }
    expect(after['Lucas Blanc'].title).toBe('Commercial')
    expect(after['Yanis Chevalier'].site).toBe('Atelier - Villeurbanne')
    expect(after['Zoé Martin'].manager_id).toBeNull()
    const up = await store.upload(sample('collaborateurs_mise_a_jour.xlsx'))
    expect(up.replaces_existing).toBe(true)
  })

  it('modifications : boucle refusée, rattachement groupé, photo', async () => {
    const store = memoryStore()
    await importFile(store, 'collaborateurs_sans_superieur.xlsx')
    let e = await byName(store)
    const atelier = siteGroups(await store.employees()).find((g) => g.site === 'Atelier - Villeurbanne')
    expect(guessSiteHead(atelier.unassigned).name).toBe('Philippe Rousseau')
    expect(await store.attachUnassigned(atelier.site_id, e['Philippe Rousseau'].id)).toEqual({ attached: 15 })
    await store.updateEmployee(e['Mehdi Brahimi'].id, { manager_id: e['Philippe Rousseau'].id })
    await store.updateEmployee(e['Antoine Faure'].id, { manager_id: e['Mehdi Brahimi'].id })
    await expect(store.updateEmployee(e['Philippe Rousseau'].id, { manager_id: e['Antoine Faure'].id })).rejects.toThrow('boucle')
    await expect(store.updateEmployee(e['Antoine Faure'].id, { photo: 'javascript:x' })).rejects.toThrow('Photo')
    await store.updateEmployee(e['Antoine Faure'].id, { photo: 'data:image/png;base64,AAAA', title: ' Chef ' })
    e = await byName(store)
    expect(e['Antoine Faure'].title).toBe('Chef')
    expect(e['Antoine Faure'].manager_id).toBe(e['Mehdi Brahimi'].id)
  })

  it('sauvegarde chiffrée / restauration / effacement', withDownloadStub(async (blob) => {
    const store = memoryStore()
    await importFile(store, 'collaborateurs_avec_superieur.xlsx')
    await expect(store.downloadBackup('mauvais mot de passe')).rejects.toThrow('incorrect')
    await store.downloadBackup(PW)
    const doc = JSON.parse(await blob().text())
    expect(doc.format).toBe('organigramme-sauvegarde-chiffree')
    expect(JSON.stringify(doc).includes('Nadia')).toBe(false)
    await store.reset()
    expect((await store.health()).employees).toBe(0)
    await expect(store.restore({ foo: 1 })).rejects.toThrow('sauvegarde')
    await expect(store.restore(doc, 'faux')).rejects.toThrow('incorrect')
    expect(await store.restore(doc, PW)).toEqual({ restored: 48 })
    const dry = await importFile(store, 'collaborateurs_avec_superieur.xlsx', { dryRun: true })
    expect(dry.added).toEqual([])
  }))
})

describe('arbres', () => {
  it('recherche, empilement, mermaid', async () => {
    const store = memoryStore()
    await importFile(store, 'collaborateurs_avec_superieur.xlsx')
    const groups = siteGroups(await store.employees())
    const { groups: found, hits } = filterGroups(groups, 'nadia')
    expect(hits).toBe(1)
    expect(found).toHaveLength(1)
    expect(found[0].trees[0].name).toBe('Hélène Marchand')
    const atelier = groups[0].trees[0]
    const mehdi = atelier.reports.find((r) => r.name === 'Mehdi Brahimi')
    expect(layoutItems(mehdi)).toEqual([{ type: 'column', nodes: mehdi.reports }])
    // 13 subordonnés dont 12 sans équipe -> 1 sous-arbre + 2 colonnes de 6
    const big = { reports: [{ reports: [{ reports: [] }] }, ...Array.from({ length: 12 }, () => ({ reports: [] }))] }
    expect(layoutItems(big).map((i) => (i.type === 'node' ? 'node' : i.nodes.length))).toEqual(['node', 6, 6])
    const two = { reports: [{ reports: [] }, { reports: [] }] }
    expect(layoutItems(two).map((i) => i.type)).toEqual(['node', 'node'])
    const m = toMermaid(groups)
    expect(m.startsWith('flowchart TD')).toBe(true)
    expect(m.match(/-->/g)).toHaveLength(45)
  })
})

describe('confidentialité : seules les colonnes retenues sont traitées', () => {
  const SECRET = 'CONFIDENTIEL'
  it("aucune valeur des colonnes non retenues n'est lue, affichée ou enregistrée", async () => {
    const store = memoryStore()
    const up = await store.upload(sample('collaborateurs_avec_colonnes_sensibles.xlsx'))
    expect(JSON.stringify(up).includes(SECRET)).toBe(false)
    const mapping = up.sheets[0].suggested_mapping
    expect(Object.keys(mapping).sort()).toEqual(['email', 'first_name', 'last_name', 'phone', 'site', 'title'])

    const pv = await store.previewImport({ token: up.token, mapping: { ...mapping, salary: 6, notes: 10 } })
    expect(JSON.stringify(pv).includes(SECRET)).toBe(false)
    expect(pv.columns.map((c) => c.field)).toEqual(['first_name', 'last_name', 'title', 'site', 'email', 'phone'])
    expect(pv.ignored_headers).toEqual(['Matricule', 'Date de naissance', 'Salaire brut annuel', 'N° de sécurité sociale', 'Commentaire RH'])

    const res = await store.confirmImport({ token: up.token, mapping: { ...mapping, salary: 6 }, dryRun: false })
    expect(res.total).toBe(48)
    expect(JSON.stringify(res).includes(SECRET)).toBe(false)
    expect(store.savedJson().includes(SECRET)).toBe(false)
    expect(store.savedJson().includes('Salaire')).toBe(false)
    expect(JSON.stringify(await store.employees()).includes(SECRET)).toBe(false)
    // le fichier complet est oublié après l'import
    await expect(store.previewImport({ token: up.token, mapping })).rejects.toThrow('expiré')
  })

  it("abandonner un import oublie le fichier", async () => {
    const store = memoryStore()
    const up = await store.upload(sample('collaborateurs_avec_colonnes_sensibles.xlsx'))
    await store.cancelImport(up.token)
    await expect(store.previewImport({ token: up.token, mapping: { name: 1 } })).rejects.toThrow('expiré')
  })
})

describe('chiffrement (mode autonome)', () => {
  it('lit la sauvegarde chiffrée produite par le serveur (format commun)', async () => {
    const doc = JSON.parse(readFileSync(path.join(SAMPLES, 'sauvegarde-chiffree-exemple.json'), 'utf8'))
    const data = await vault.decryptBackup(doc, 'exemple-de-mot-de-passe')
    expect(data.employees.map((e) => e.name)).toEqual(['Hélène Marchand', 'François Lefèvre', 'Nadia Benali'])
    await expect(vault.decryptBackup(doc, 'mauvais')).rejects.toThrow('incorrect')
    await expect(vault.decryptBackup({ ...doc, kdf: { ...doc.kdf, iterations: 1e9 } }, 'x')).rejects.toThrow('invalides')
    // une sauvegarde produite ici se relit, et peut être restaurée côté serveur (même format)
    const again = await vault.decryptBackup(await vault.encryptBackup(data, 'autre mot de passe', 1000), 'autre mot de passe')
    expect(again).toEqual(data)
  })

  it('premier lancement, verrouillage, mauvais mot de passe, déverrouillage', async () => {
    const store = rawStore()
    expect(await store.vaultStatus()).toBe('setup')
    await expect(store.employees()).rejects.toBeInstanceOf(LockedError)
    await expect(store.setup('court')).rejects.toThrow('12 caractères')
    const { recovery_key: rk } = await store.setup(PW)
    expect(vault.normalizeRecoveryKey(rk)).toBe(rk)
    await importFile(store, 'collaborateurs_avec_superieur.xlsx')
    // au repos, rien n'est lisible
    const dump = store.savedJson()
    for (const clear of ['Marchand', 'Directrice', 'Siège', 'entreprise.test', 'collaborateurs_avec']) {
      expect(dump.includes(clear)).toBe(false)
    }
    await store.lock()
    expect(await store.vaultStatus()).toBe('locked')
    await expect(store.employees()).rejects.toBeInstanceOf(LockedError)
    await expect(store.unlock('mauvais mot de passe')).rejects.toThrow('incorrect')
    await store.unlock(PW)
    expect(await store.employees()).toHaveLength(48)
  })

  it('verrouillage après 15 minutes d’inactivité', async () => {
    const store = rawStore()
    await store.setup(PW)
    const realNow = Date.now
    try {
      Date.now = () => realNow() + IDLE_TIMEOUT + 1000
      expect(await store.vaultStatus()).toBe('locked')
      await expect(store.employees()).rejects.toBeInstanceOf(LockedError)
    } finally {
      Date.now = realNow
    }
  })

  it('clé de secours, changement de mot de passe, nouvelle clé', async () => {
    const store = rawStore()
    const { recovery_key: rk } = await store.setup(PW)
    await importFile(store, 'collaborateurs_avec_superieur.xlsx')
    await store.lock()
    await expect(store.recover('0000-0000-0000-0000-0000-0000-0000-0000', 'un nouveau mot de passe')).rejects.toThrow('incorrecte')
    const { recovery_key: rk2 } = await store.recover(rk.toLowerCase(), 'un nouveau mot de passe')
    expect(rk2).not.toBe(rk)
    expect(await store.employees()).toHaveLength(48)
    await store.lock()
    await expect(store.unlock(PW)).rejects.toThrow('incorrect')
    await store.unlock('un nouveau mot de passe')
    await expect(store.recover(rk, 'encore un autre mot de passe')).rejects.toThrow('incorrecte')
    await store.changePassword('un nouveau mot de passe', PW)
    const { recovery_key: rk3 } = await store.newRecoveryKey(PW)
    await store.lock()
    await store.recover(rk3, 'mot de passe final 2026')
    expect(await store.employees()).toHaveLength(48)
  })

  it('les données en clair d’une version précédente sont chiffrées à la création du mot de passe', async () => {
    const backend = memoryBackend()
    await backend.save('state', {
      sites: [{ id: 1, name: 'Siège - Lyon' }],
      employees: [{ id: 1, name: 'Hélène Marchand', name_key: 'helene marchand', title: 'Directrice', email: null, phone: null, photo: null, site_id: 1, manager_id: null, sort_order: 0 }],
      settings: {},
      seq: { site: 1, employee: 1 },
    })
    const store = rawStore(backend)
    await store.setup(PW)
    expect(store.savedJson().includes('Marchand')).toBe(false)
    expect((await store.employees())[0].name).toBe('Hélène Marchand')
  })
})
