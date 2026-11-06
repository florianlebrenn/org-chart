// Outils communs aux scénarios : ouverture de l'app sur une base vide, import, accès aux cartes,
// et surveillance permanente du réseau + de la console (un test échoue si l'app joint l'extérieur).
import { test as base, expect } from '@playwright/test'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

export const SAMPLES = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../tools/sample-data')
export const MAPPING_UPDATE = { last_name: 0, first_name: 1, title: 2, site: 3, email: 4, phone: 5 }
// mot de passe de l'instance de TEST uniquement (créé au premier scénario sur une base neuve)
export const TEST_PASSWORD = 'mot de passe de test e2e 2026'


class App {
  constructor(page, mode, baseURL) {
    this.page = page
    this.mode = mode
    this.baseURL = baseURL
    this.isServer = mode === 'server'
  }

  /** Ouvre l'application, crée ou saisit le mot de passe de test, et repart de données vides. */
  async open() {
    if (this.isServer && new URL(this.baseURL).port === '8080' && !process.env.E2E_ALLOW_RESET) {
      // garde-fou : jamais d'effacement sur l'application réelle (port 8080) par erreur
      throw new Error("Refus : les scénarios effacent les données. Utilisez l'instance de test (port 8081) ou E2E_ALLOW_RESET=1.")
    }
    await this.page.goto(this.baseURL)
    await this.passVault()
    if (this.isServer) {
      const res = await this.page.request.delete(this.api('data'))
      expect(res.ok(), 'remise à zéro de la base de test').toBeTruthy()
      await this.page.reload()
    }
    await expect(this.page.getByTestId('health-badge')).toHaveAttribute('data-status', 'ok')
  }

  /** Écran de création du mot de passe ou de déverrouillage, s'il est affiché. */
  async passVault(password = TEST_PASSWORD) {
    const screen = this.page.getByTestId('vault-screen')
    const badge = this.page.getByTestId('health-badge')
    await expect(screen.or(badge)).toBeVisible()
    if (await this.page.getByTestId('confirm-password').isVisible()) {
      await this.page.getByTestId('new-password').fill(password)
      await this.page.getByTestId('confirm-password').fill(password)
      await this.page.getByRole('button', { name: 'Créer le mot de passe' }).click()
      await this.acknowledgeRecoveryKey()
    } else if (await this.page.getByTestId('unlock-password').isVisible()) {
      await this.page.getByTestId('unlock-password').fill(password)
      await this.page.getByRole('button', { name: 'Déverrouiller' }).click()
    }
    await expect(badge).toBeVisible()
  }

  /** Lit la clé de secours affichée et valide l'écran. */
  async acknowledgeRecoveryKey() {
    const key = (await this.page.getByTestId('recovery-key').innerText()).trim()
    await this.page.getByTestId('recovery-saved').check()
    await this.page.getByRole('button', { name: 'Continuer' }).click()
    return key
  }

  api(path) {
    return new URL(`api/${path}`, this.baseURL.replace(/\/?$/, '/')).href
  }

  tab(name) {
    return this.page.getByRole('navigation').getByRole('button', { name, exact: true })
  }

  /** Charge un fichier dans l'écran d'import et attend l'étape « colonnes ». */
  async upload(file) {
    await this.tab('Importer').click()
    await this.page.getByTestId('file-input').setInputFiles(path.join(SAMPLES, file))
    await expect(this.page.getByText('Aperçu des premières lignes')).toBeVisible()
  }

  async setMapping(mapping) {
    for (const field of ['name', 'first_name', 'last_name', 'title', 'site', 'email', 'phone', 'manager']) {
      const v = mapping[field]
      await this.page.getByTestId(`map-${field}`).selectOption(v === undefined ? '' : String(v))
    }
  }

  async review() {
    await this.page.getByRole('button', { name: "Vérifier l'import" }).click()
    await expect(this.page.getByText('Ce qui va changer')).toBeVisible()
  }

  stat(label) {
    return this.page.getByTestId(`stat-${label}`)
  }

  async confirm() {
    await this.page.getByRole('button', { name: "Confirmer l'import" }).click()
    await expect(this.page.getByText('Import terminé')).toBeVisible()
    await this.page.getByRole('button', { name: "Voir l'organigramme" }).click()
    await expect(this.page.getByTestId('site-section').first()).toBeVisible()
  }

  /** Import complet avec les colonnes proposées (ou un mapping imposé). */
  async importFile(file, mapping) {
    await this.upload(file)
    if (mapping) await this.setMapping(mapping)
    await this.review()
    await this.confirm()
  }

  section(site) {
    return this.page.locator(`[data-testid="site-section"][data-site="${site}"]`)
  }

  card(name) {
    return this.page.locator(`[data-testid="person-card"][data-person-name="${name}"]`)
  }

  /** Données telles que l'application les voit : API (mode serveur) ou IndexedDB déchiffrée (mode autonome). */
  async employees(password = TEST_PASSWORD) {
    if (this.isServer) {
      const res = await this.page.request.get(this.api('employees'))
      return res.json()
    }
    return this.page.evaluate(async (pw) => {
      const get = (key) =>
        new Promise((resolve, reject) => {
          const req = indexedDB.open('organigramme', 1)
          req.onsuccess = () => {
            const r = req.result.transaction('kv').objectStore('kv').get(key)
            r.onsuccess = () => resolve(r.result)
            r.onerror = () => reject(r.error)
          }
          req.onerror = () => reject(req.error)
        })
      const b64 = (s) => Uint8Array.from(atob(s), (c) => c.charCodeAt(0))
      const te = new TextEncoder()
      const [meta, stored] = [await get('vault'), await get('state')]
      if (!stored) return []
      const base = await crypto.subtle.importKey('raw', te.encode(pw), 'PBKDF2', false, ['deriveBits'])
      const entry = meta.password
      const bits = await crypto.subtle.deriveBits({ name: 'PBKDF2', hash: 'SHA-256', salt: b64(entry.salt), iterations: entry.iterations }, base, 256)
      const open = async (raw, blob, aad) => {
        const k = await crypto.subtle.importKey('raw', raw, 'AES-GCM', false, ['decrypt'])
        return new Uint8Array(await crypto.subtle.decrypt({ name: 'AES-GCM', iv: blob.slice(0, 12), additionalData: te.encode(aad) }, k, blob.slice(12)))
      }
      const dek = await open(new Uint8Array(bits), b64(entry.wrapped), 'organigramme-dek-v1')
      const s = JSON.parse(new TextDecoder().decode(await open(dek, b64(stored.blob), 'organigramme-etat-v1')))
      const site = Object.fromEntries(s.sites.map((x) => [x.id, x.name]))
      return s.employees.map((e) => ({ ...e, site: site[e.site_id] ?? null }))
    }, password)
  }

  /** Contenu BRUT du stockage du navigateur (mode autonome), tel qu'il est écrit sur le disque. */
  async rawBrowserStorage() {
    return this.page.evaluate(
      () =>
        new Promise((resolve) => {
          const req = indexedDB.open('organigramme', 1)
          req.onsuccess = () => {
            const store = req.result.transaction('kv').objectStore('kv')
            const all = store.getAll()
            all.onsuccess = () => resolve(JSON.stringify(all.result))
          }
        }),
    )
  }

  async managerOf(name) {
    const emps = await this.employees()
    const me = emps.find((e) => e.name === name)
    return emps.find((e) => e.id === me?.manager_id)?.name ?? null
  }

  async toast(text) {
    await expect(this.page.getByRole('status').filter({ hasText: text })).toBeVisible()
  }
}

export const test = base.extend({
  appMode: ['server', { option: true }],

  // surveillance automatique, active dans tous les scénarios
  network: [
    async ({ page, baseURL }, use, testInfo) => {
      const origin = baseURL.startsWith('file:') ? 'file://' : new URL(baseURL).origin
      const external = []
      const errors = []
      const allowed = []
      page.on('request', (r) => {
        const u = r.url()
        if (!u.startsWith(origin) && !u.startsWith('data:') && !u.startsWith('blob:')) external.push(u)
      })
      page.on('pageerror', (e) => errors.push(e.message))
      page.on('console', (m) => m.type() === 'error' && !/status of 4\d\d/.test(m.text()) && errors.push(m.text()))
      // un scénario peut déclarer une tentative de connexion volontaire (qui doit être bloquée)
      await use({ external, errors, expectBlocked: (re) => allowed.push(re) })
      const unexpected = (list) => list.filter((x) => !allowed.some((re) => re.test(x)))
      external.splice(0, external.length, ...unexpected(external))
      errors.splice(0, errors.length, ...unexpected(errors))
      await testInfo.attach('réseau', { body: `Requêtes externes : ${external.length}\n${external.join('\n')}` })
      expect(external, "aucune requête ne doit quitter l'application").toEqual([])
      expect(errors, 'aucune erreur JavaScript').toEqual([])
    },
    { auto: true },
  ],

  app: async ({ page, appMode, baseURL }, use) => {
    await use(new App(page, appMode, baseURL))
  },
})

export { expect }
