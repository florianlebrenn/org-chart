// Cas d'usage : sauvegarder (chiffré), tout effacer, restaurer.
import { readFileSync } from 'node:fs'
import { test, expect, TEST_PASSWORD } from './fixtures.js'

test('sauvegarde puis restauration après effacement', async ({ app, page }) => {
  await app.open()
  await app.importFile('collaborateurs_avec_superieur.xlsx')
  await app.tab('Données').click()

  await page.getByTestId('backup-password').fill('mauvais mot de passe')
  await page.getByRole('button', { name: 'Télécharger une sauvegarde' }).click()
  await expect(page.getByRole('status')).toContainText('incorrect')
  await page.getByTestId('backup-password').fill(TEST_PASSWORD)
  const [download] = await Promise.all([
    page.waitForEvent('download'),
    page.getByRole('button', { name: 'Télécharger une sauvegarde' }).click(),
  ])
  const backupPath = await download.path()
  expect(download.suggestedFilename()).toMatch(/^organigramme-.*\.json$/)
  // la sauvegarde est chiffrée : aucun nom lisible dans le fichier
  const content = readFileSync(backupPath, 'utf8')
  expect(content).toContain('organigramme-sauvegarde-chiffree')
  expect(content).not.toContain('Nadia')

  await page.getByRole('button', { name: 'Effacer…' }).click()
  await page.getByRole('button', { name: 'Oui, tout effacer' }).click()
  await expect(page.getByText('Toutes les données ont été effacées.')).toBeVisible()
  await expect(page.getByTestId('health-badge')).toContainText('0 collaborateurs')

  await page.getByTestId('restore-input').setInputFiles(backupPath)
  await page.getByTestId('restore-password').fill('pas le bon')
  await page.getByRole('button', { name: 'Confirmer la restauration' }).click()
  await expect(page.getByRole('status')).toContainText('incorrect')
  await page.getByTestId('restore-password').fill(TEST_PASSWORD)
  await page.getByRole('button', { name: 'Confirmer la restauration' }).click()
  await expect(page.getByText('48 collaborateurs restaurés.')).toBeVisible()

  await app.tab('Organigramme').click()
  await expect(page.getByTestId('person-card')).toHaveCount(48)
  expect(await app.managerOf('Nadia Benali')).toBe('François Lefèvre')
})

test('un fichier qui n’est pas une sauvegarde est refusé', async ({ app, page }) => {
  await app.open()
  await app.tab('Données').click()
  await page.getByTestId('restore-input').setInputFiles({ name: 'autre.json', mimeType: 'application/json', buffer: Buffer.from('{"a":1}') })
  await expect(page.getByRole('status')).toContainText("n'est pas une sauvegarde")
})
