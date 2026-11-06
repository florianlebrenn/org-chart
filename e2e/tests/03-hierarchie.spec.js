// Cas d'usage : construire la hiérarchie à la main (fichier sans colonne « supérieur »).
import path from 'node:path'
import { test, expect, SAMPLES } from './fixtures.js'

test.beforeEach(async ({ app }) => {
  await app.open()
  await app.importFile('collaborateurs_sans_superieur.xlsx')
})

test('rattacher tous les non-rattachés au responsable de site', async ({ app, page }) => {
  const atelier = app.section('Atelier - Villeurbanne')
  // le responsable est deviné d'après sa fonction
  await expect(atelier.getByTestId('attach-select')).toHaveValue(/\d+/)
  await expect(atelier.getByTestId('attach-select').locator('option:checked')).toContainText('Philippe Rousseau')
  await atelier.getByRole('button', { name: 'Rattacher tous' }).click()
  await app.toast('15 personne(s) rattachée(s) à Philippe Rousseau')
  await expect(atelier.getByTestId('unassigned-tray')).toHaveCount(0)
  expect(await app.managerOf('Mehdi Brahimi')).toBe('Philippe Rousseau')

  // « Annuler » remet tout le monde dans « Non rattachés »
  await page.getByRole('button', { name: 'Annuler' }).click()
  await expect(atelier.getByText('Non rattachés (16)')).toBeVisible()
})

test('glisser-déposer une carte sur son futur supérieur, puis annuler', async ({ app, page }) => {
  await app.card('Antoine Faure').dragTo(app.card('Mehdi Brahimi'))
  await app.toast('Antoine Faure est maintenant rattaché(e) à Mehdi Brahimi')
  expect(await app.managerOf('Antoine Faure')).toBe('Mehdi Brahimi')
  await app.card('Mehdi Brahimi').dragTo(app.card('Philippe Rousseau'))
  await app.toast('Mehdi Brahimi est maintenant rattaché(e) à Philippe Rousseau')
  await expect(app.card('Mehdi Brahimi').getByRole('button', { name: 'Replier (1)' })).toBeVisible()

  await page.getByRole('button', { name: 'Annuler' }).click()
  await expect.poll(() => app.managerOf('Mehdi Brahimi')).toBe(null)
})

test('une boucle hiérarchique est impossible', async ({ app }) => {
  await app.card('Antoine Faure').dragTo(app.card('Mehdi Brahimi'))
  await app.toast('rattaché(e) à Mehdi Brahimi')
  // déposer le chef sur son subordonné ne fait rien
  await app.card('Mehdi Brahimi').dragTo(app.card('Antoine Faure'))
  expect(await app.managerOf('Mehdi Brahimi')).toBe(null)
})

test('retirer quelqu’un de la hiérarchie en le déposant dans « Non rattachés »', async ({ app }) => {
  await app.card('Antoine Faure').dragTo(app.card('Mehdi Brahimi'))
  await app.toast('rattaché(e) à Mehdi Brahimi')
  const tray = app.section('Atelier - Villeurbanne').getByTestId('unassigned-tray')
  await app.card('Antoine Faure').dragTo(tray)
  await app.toast("Antoine Faure n'a plus de supérieur")
  expect(await app.managerOf('Antoine Faure')).toBe(null)
})

test('fiche collaborateur : choisir le supérieur, modifier, ajouter une photo', async ({ app, page }) => {
  await app.card('Julie André').click()
  const panel = page.getByTestId('details-panel')
  await expect(panel).toContainText('Julie André')
  await expect(panel.getByTestId('current-manager')).toHaveText("Aucun (en haut de l'organigramme)")

  await panel.getByRole('button', { name: 'Changer' }).click()
  await panel.getByTestId('manager-search').fill('chef d atelier')
  await expect(panel.getByTestId('manager-option')).toHaveCount(1)
  await panel.getByTestId('manager-option').click()
  await expect(panel.getByTestId('current-manager')).toHaveText('Mehdi Brahimi')
  await app.toast('Julie André est maintenant rattaché(e) à Mehdi Brahimi')

  await panel.getByTestId('field-title').fill('Technicienne principale')
  await panel.getByTestId('field-title').press('Enter')
  await expect(app.card('Julie André')).toContainText('Technicienne principale')

  await panel.getByTestId('photo-input').setInputFiles(path.join(SAMPLES, 'photo-exemple.png'))
  await expect(app.card('Julie André').locator('img')).toBeVisible()
  await panel.getByRole('button', { name: 'Retirer' }).click()
  await expect(app.card('Julie André').locator('img')).toHaveCount(0)

  // navigation vers le supérieur depuis la fiche
  await panel.getByTestId('current-manager').click()
  await expect(panel).toContainText('Mehdi Brahimi')
  await expect(panel).toContainText('Équipe directe (1)')
  await page.getByRole('button', { name: 'Fermer' }).first().click()
  await expect(panel).toHaveCount(0)
})
