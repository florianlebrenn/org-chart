// Cas d'usage : importer le fichier du personnel, puis le mettre à jour le mois suivant.
import { test, expect, MAPPING_UPDATE } from './fixtures.js'

test.beforeEach(async ({ app }) => app.open())

test("premier import d'un fichier avec colonne « supérieur »", async ({ app, page }) => {
  await expect(page.getByText("Aucun collaborateur pour l'instant")).toBeVisible()
  await app.upload('collaborateurs_avec_superieur.xlsx')
  // les colonnes sont reconnues automatiquement
  await expect(page.getByTestId('map-name')).toHaveValue('0')
  await expect(page.getByTestId('map-manager')).toHaveValue('4')
  await app.review()
  await expect(app.stat('Nouveaux')).toHaveText('48')
  await expect(app.stat('Retirés')).toHaveText('0')
  await expect(page.getByText('lue depuis la colonne « supérieur » du fichier')).toBeVisible()
  await app.confirm()

  await expect(page.getByTestId('site-section')).toHaveCount(3)
  await expect(page.getByTestId('health-badge')).toContainText('48 collaborateurs')
  await expect(app.section('Siège - Lyon').getByTestId('person-card')).toHaveCount(17)
  expect(await app.managerOf('Nadia Benali')).toBe('François Lefèvre')
  expect(await app.managerOf('Antoine Faure')).toBe('Mehdi Brahimi') // écrit « BRAHIMI Mehdi » dans le fichier
})

test('import sans colonne « supérieur » : tout le monde est à rattacher', async ({ app, page }) => {
  await app.upload('collaborateurs_sans_superieur.xlsx')
  await expect(page.getByText('en-têtes trouvés ligne 3')).toBeVisible() // titre au-dessus du tableau
  await expect(page.getByTestId('map-first_name')).toHaveValue('1')
  await expect(page.getByTestId('map-last_name')).toHaveValue('0')
  await expect(page.getByTestId('map-manager')).toHaveValue('')
  await app.review()
  await app.confirm()
  const trays = page.getByTestId('unassigned-tray')
  await expect(trays).toHaveCount(3)
  await expect(app.section('Atelier - Villeurbanne').getByText('Non rattachés (16)')).toBeVisible()
  // les noms en MAJUSCULES sont remis en forme
  await expect(app.card("Marion D'Almeida")).toBeVisible()
})

test('réimport du mois suivant : la hiérarchie est conservée', async ({ app, page }) => {
  await app.importFile('collaborateurs_avec_superieur.xlsx')
  await app.upload('collaborateurs_mise_a_jour.xlsx')
  await app.setMapping(MAPPING_UPDATE)
  await app.review()
  await expect(app.stat('Nouveaux')).toHaveText('3')
  await expect(app.stat('Retirés')).toHaveText('2')
  await expect(page.getByText('Bruno Guerin')).toBeVisible()
  await expect(page.getByText('liens existants conservés')).toBeVisible()
  await app.confirm()

  expect(await app.managerOf('Nadia Benali')).toBe('François Lefèvre')
  await expect(app.card('Bruno Guerin')).toHaveCount(0)
  // les nouveaux arrivent dans « Non rattachés » de leur site
  await expect(app.section('Atelier - Villeurbanne').getByTestId('unassigned-tray').locator('[data-person-name="Zoé Martin"]')).toBeVisible()
  // Yanis a changé de site mais garde son supérieur du siège
  await expect(app.card('Yanis Chevalier')).toContainText('Rattaché(e) à Pierre Lambert')
})

test('les choix de colonnes sont mémorisés pour le prochain import', async ({ app, page }) => {
  await app.upload('collaborateurs_sans_superieur.xlsx')
  await page.getByTestId('map-phone').selectOption('')
  await app.review()
  await app.confirm()
  await app.upload('collaborateurs_mise_a_jour.xlsx')
  await expect(page.getByTestId('map-phone')).toHaveValue('')
  await expect(page.getByTestId('map-title')).toHaveValue('2')
})

test('un ancien fichier .xls est refusé avec une explication', async ({ app, page }) => {
  await app.tab('Importer').click()
  await page.getByTestId('file-input').setInputFiles({ name: 'ancien.xls', mimeType: 'application/vnd.ms-excel', buffer: Buffer.from('xx') })
  await expect(page.getByRole('alert')).toContainText('Enregistrer sous')
})
