// Cas d'usage : la personne importe l'export RH complet (salaire, n° de sécurité sociale, date de naissance…).
// Règle : seules les colonnes utilisées par l'outil sont lues ; les autres ne sont ni importées,
// ni conservées, ni affichées. Toutes les valeurs sensibles du fichier fictif commencent par « CONFIDENTIEL ».
import { readFileSync } from 'node:fs'
import { test, expect, TEST_PASSWORD } from './fixtures.js'

const SECRET = 'CONFIDENTIEL'

test("un export RH complet n'expose aucune colonne non retenue", async ({ app, page }) => {
  // en mode serveur : on inspecte aussi toutes les réponses de l'API reçues par le navigateur
  const apiBodies = []
  page.on('response', async (r) => {
    if (r.url().includes('/api/') && !r.url().includes('/export/pdf')) apiBodies.push(await r.text().catch(() => ''))
  })

  await app.open()
  await app.upload('collaborateurs_avec_colonnes_sensibles.xlsx')
  const ignored = page.getByTestId('ignored-columns')
  await expect(ignored).toContainText('Colonnes ignorées (5)')
  await expect(ignored).toContainText('Salaire brut annuel')
  await expect(ignored).toContainText('N° de sécurité sociale')
  await expect(page.getByTestId('import-preview').locator('th')).toHaveCount(6)
  await expect(page.getByTestId('import-preview')).toContainText('MARCHAND')
  expect(await page.content()).not.toContain(SECRET)

  await app.review()
  expect(await page.content()).not.toContain(SECRET)
  await app.confirm()
  await expect(page.getByTestId('person-card')).toHaveCount(48)
  expect(await page.content()).not.toContain(SECRET)

  // ce qui est enregistré (API ou IndexedDB) et la sauvegarde
  expect(JSON.stringify(await app.employees())).not.toContain(SECRET)
  await app.tab('Données').click()
  await page.getByTestId('backup-password').fill(TEST_PASSWORD)
  const [download] = await Promise.all([
    page.waitForEvent('download'),
    page.getByRole('button', { name: 'Télécharger une sauvegarde' }).click(),
  ])
  const backup = readFileSync(await download.path(), 'utf8')
  expect(backup).not.toContain(SECRET)
  expect(backup).not.toContain('Salaire')

  if (!app.isServer) {
    const stored = await app.rawBrowserStorage()
    expect(stored).not.toContain(SECRET)
    expect(stored).not.toContain('Marchand') // chiffré au repos
  }
  expect(apiBodies.join('\n')).not.toContain(SECRET)
})

test("quitter l'import sans confirmer fait oublier le fichier", async ({ app, page }) => {
  test.skip(!app.isServer, 'en mode autonome, le fichier ne vit que dans la page')
  await app.open()
  const tokens = []
  page.on('response', async (r) => {
    if (r.url().endsWith('/api/import') && r.request().method() === 'POST') tokens.push((await r.json()).token)
  })
  await app.upload('collaborateurs_avec_colonnes_sensibles.xlsx')
  await page.getByRole('button', { name: 'Autre fichier' }).click()
  await expect.poll(() => tokens.length).toBe(1)
  const res = await page.request.post(new URL('api/import/preview', app.baseURL + '/').href, {
    data: { token: tokens[0], mapping: { name: 1 } },
  })
  expect(res.status()).toBe(404)
})
