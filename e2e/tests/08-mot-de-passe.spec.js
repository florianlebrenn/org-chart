// Cas d'usage : données chiffrées par un mot de passe (création, verrouillage, oubli, changement).
import { readFileSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'
import { test, expect, TEST_PASSWORD } from './fixtures.js'

const STATIC = pathToFileURL(path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../static/organigramme.html')).href

test('premier lancement : mot de passe obligatoire et clé de secours', async ({ app, page }) => {
  test.skip(app.isServer, "l'instance de test serveur a déjà son mot de passe ; testé par pytest")
  await page.goto(app.baseURL)
  await expect(page.getByRole('heading', { name: "Protégez l'organigramme" })).toBeVisible()
  const create = page.getByRole('button', { name: 'Créer le mot de passe' })
  await page.getByTestId('new-password').fill('court')
  await expect(create).toBeDisabled()
  await page.getByTestId('new-password').fill(TEST_PASSWORD)
  await page.getByTestId('confirm-password').fill(TEST_PASSWORD + 'x')
  await create.click()
  await expect(page.getByRole('alert')).toContainText('différents')
  await page.getByTestId('confirm-password').fill(TEST_PASSWORD)
  await create.click()

  const key = (await page.getByTestId('recovery-key').innerText()).trim()
  expect(key).toMatch(/^([0-9A-Z]{4}-){7}[0-9A-Z]{4}$/)
  await expect(page.getByRole('button', { name: 'Continuer' })).toBeDisabled()
  await page.getByTestId('recovery-saved').check()
  await page.getByRole('button', { name: 'Continuer' }).click()
  await expect(page.getByTestId('health-badge')).toBeVisible()
  // au rechargement, il faut le mot de passe
  await page.reload()
  await expect(page.getByTestId('unlock-password')).toBeVisible()
})

test('verrouiller, mauvais mot de passe, déverrouiller', async ({ app, page }) => {
  await app.open()
  await app.importFile('collaborateurs_avec_superieur.xlsx')
  await page.getByRole('button', { name: 'Verrouiller' }).click()
  await expect(page.getByRole('heading', { name: 'Organigramme verrouillé' })).toBeVisible()
  await expect(page.getByTestId('person-card')).toHaveCount(0)
  if (app.isServer) {
    // la clé a quitté la mémoire du serveur : l'API ne renvoie plus rien
    const res = await page.request.get(app.api('employees'))
    expect(res.status()).toBe(401)
    expect(await res.json()).toEqual({ detail: 'Application verrouillée.', locked: true })
  }
  await page.getByTestId('unlock-password').fill('mauvais mot de passe')
  await page.getByRole('button', { name: 'Déverrouiller' }).click()
  await expect(page.getByRole('alert')).toContainText('incorrect')
  await page.getByTestId('unlock-password').fill(TEST_PASSWORD)
  await page.getByRole('button', { name: 'Déverrouiller' }).click()
  await expect(page.getByTestId('person-card')).toHaveCount(48)
})

test('verrouillage automatique après 15 minutes d’inactivité', async ({ app, page }) => {
  await page.clock.install()
  await app.open()
  await app.importFile('collaborateurs_avec_superieur.xlsx')
  await page.clock.fastForward('14:00')
  await expect(page.getByTestId('person-card').first()).toBeVisible()
  await page.clock.fastForward('02:00')
  await expect(page.getByRole('heading', { name: 'Organigramme verrouillé' })).toBeVisible()
  if (app.isServer) expect((await page.request.get(app.api('employees'))).status()).toBe(401)
})

test('mot de passe oublié : la clé de secours permet d’en choisir un nouveau', async ({ app, page }) => {
  test.skip(app.isServer, 'ne change pas le mot de passe de l’instance de test ; testé par pytest')
  await page.goto(app.baseURL)
  await page.getByTestId('new-password').fill(TEST_PASSWORD)
  await page.getByTestId('confirm-password').fill(TEST_PASSWORD)
  await page.getByRole('button', { name: 'Créer le mot de passe' }).click()
  const key = await app.acknowledgeRecoveryKey()
  await app.importFile('collaborateurs_avec_superieur.xlsx')
  await page.getByRole('button', { name: 'Verrouiller' }).click()

  await page.getByRole('button', { name: 'Mot de passe oublié ?' }).click()
  await page.getByTestId('recovery-input').fill('0000-0000-0000-0000-0000-0000-0000-0000')
  await page.getByTestId('new-password').fill('nouveau mot de passe 2026')
  await page.getByTestId('confirm-password').fill('nouveau mot de passe 2026')
  await page.getByRole('button', { name: 'Changer le mot de passe' }).click()
  await expect(page.getByRole('alert')).toContainText('incorrecte')
  await page.getByTestId('recovery-input').fill(key.toLowerCase())
  await page.getByRole('button', { name: 'Changer le mot de passe' }).click()
  const newKey = await app.acknowledgeRecoveryKey()
  expect(newKey).not.toBe(key)
  await expect(page.getByTestId('person-card')).toHaveCount(48)

  await page.getByRole('button', { name: 'Verrouiller' }).click()
  await page.getByTestId('unlock-password').fill(TEST_PASSWORD)
  await page.getByRole('button', { name: 'Déverrouiller' }).click()
  await expect(page.getByRole('alert')).toContainText('incorrect')
  await page.getByTestId('unlock-password').fill('nouveau mot de passe 2026')
  await page.getByRole('button', { name: 'Déverrouiller' }).click()
  await expect(page.getByTestId('person-card')).toHaveCount(48)
})

test('changer le mot de passe et générer une nouvelle clé de secours', async ({ app, page }) => {
  test.skip(app.isServer, 'ne change pas le mot de passe de l’instance de test ; testé par pytest')
  await app.open()
  await app.tab('Données').click()
  await page.getByTestId('pw-current').fill(TEST_PASSWORD)
  await page.getByTestId('pw-new').fill('autre mot de passe 2026')
  await page.getByTestId('pw-again').fill('autre mot de passe 2026')
  await page.getByRole('button', { name: 'Changer le mot de passe' }).click()
  await expect(page.getByRole('status')).toContainText('Mot de passe changé')
  await page.getByTestId('rk-password').fill('autre mot de passe 2026')
  await page.getByRole('button', { name: 'Générer une nouvelle clé' }).click()
  await expect(page.getByRole('heading', { name: 'Votre clé de secours' })).toBeVisible()
  await app.acknowledgeRecoveryKey()
  await page.getByRole('button', { name: 'Verrouiller' }).click()
  await page.getByTestId('unlock-password').fill('autre mot de passe 2026')
  await page.getByRole('button', { name: 'Déverrouiller' }).click()
  await expect(page.getByTestId('health-badge')).toBeVisible()
})

test('une sauvegarde du mode autonome se restaure dans le mode serveur', async ({ app, page, context }) => {
  test.skip(!app.isServer, 'scénario croisé, lancé depuis le projet serveur')
  // 1) mode autonome (fichier HTML) dans un autre onglet : import + sauvegarde chiffrée
  const local = await context.newPage()
  await local.goto(STATIC)
  await local.getByTestId('new-password').fill('mot de passe autonome 2026')
  await local.getByTestId('confirm-password').fill('mot de passe autonome 2026')
  await local.getByRole('button', { name: 'Créer le mot de passe' }).click()
  await local.getByTestId('recovery-saved').check()
  await local.getByRole('button', { name: 'Continuer' }).click()
  await local.getByRole('navigation').getByRole('button', { name: 'Importer', exact: true }).click()
  await local.getByTestId('file-input').setInputFiles(path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../tools/sample-data/collaborateurs_avec_superieur.xlsx'))
  await local.getByRole('button', { name: "Vérifier l'import" }).click()
  await local.getByRole('button', { name: "Confirmer l'import" }).click()
  await local.getByRole('navigation').getByRole('button', { name: 'Données', exact: true }).click()
  await local.getByTestId('backup-password').fill('mot de passe autonome 2026')
  const [download] = await Promise.all([
    local.waitForEvent('download'),
    local.getByRole('button', { name: 'Télécharger une sauvegarde' }).click(),
  ])
  const file = await download.path()
  expect(readFileSync(file, 'utf8')).not.toContain('Marchand')
  await local.close()

  // 2) mode serveur : restauration avec le mot de passe de la sauvegarde
  await app.open()
  await app.tab('Données').click()
  await page.getByTestId('restore-input').setInputFiles(file)
  await page.getByTestId('restore-password').fill('mot de passe autonome 2026')
  await page.getByRole('button', { name: 'Confirmer la restauration' }).click()
  await expect(page.getByText('48 collaborateurs restaurés.')).toBeVisible()
  expect(await app.managerOf('Nadia Benali')).toBe('François Lefèvre')
})

test('le serveur refuse un nom d’hôte inconnu (protection DNS rebinding)', async ({ app, page }) => {
  test.skip(!app.isServer, 'concerne nginx (mode serveur)')
  const res = await page.request.get(app.api('vault/status'), { headers: { Host: 'attaquant.example' } })
  expect(res.status()).toBe(421)
})
