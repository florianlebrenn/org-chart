// Cas d'usage : consulter l'organigramme (sites, recherche, repli, liste, zoom).
import { test, expect } from './fixtures.js'

test.beforeEach(async ({ app }) => {
  await app.open()
  await app.importFile('collaborateurs_avec_superieur.xlsx')
})

test('vue par site', async ({ app, page }) => {
  const filter = page.getByTestId('site-filter')
  await filter.selectOption({ label: 'Entrepôt - Vénissieux (15)' })
  await expect(page.getByTestId('site-section')).toHaveCount(1)
  await expect(app.card('Valérie Noël')).toBeVisible()
  await expect(app.card('Hélène Marchand')).toHaveCount(0)
  await filter.selectOption('all')
  await expect(page.getByTestId('site-section')).toHaveCount(3)
})

test('recherche par nom, fonction ou téléphone', async ({ app, page }) => {
  const search = page.getByTestId('search')
  await search.fill('cariste')
  await expect(page.getByTestId('search-count')).toHaveText('3 résultats')
  await expect(page.getByTestId('site-section')).toHaveCount(1)
  // les supérieurs restent affichés pour situer les résultats
  await expect(app.card('Patrick Dumont')).toBeVisible()
  await expect(app.card('Samir Khelifi')).toHaveClass(/ring-amber-400/)

  await search.fill('helene') // sans accent
  await expect(page.getByTestId('search-count')).toHaveText('1 résultat')
  await search.fill('zzz')
  await expect(page.getByText('Aucun résultat pour « zzz »')).toBeVisible()
  await page.getByRole('button', { name: 'Effacer' }).click()
  await expect(page.getByTestId('site-section')).toHaveCount(3)
})

test('replier / déplier une équipe et tout l’organigramme', async ({ app, page }) => {
  const atelier = app.section('Atelier - Villeurbanne')
  await expect(atelier.getByTestId('person-card')).toHaveCount(16)
  await app.card('Mehdi Brahimi').getByRole('button', { name: /Replier/ }).click()
  await expect(atelier.getByTestId('person-card')).toHaveCount(10)
  await expect(app.card('Antoine Faure')).toHaveCount(0)
  await app.card('Mehdi Brahimi').getByRole('button', { name: /Déplier/ }).click()
  await expect(app.card('Antoine Faure')).toBeVisible()

  await page.getByRole('button', { name: 'Tout replier' }).click()
  await expect(page.getByTestId('person-card')).toHaveCount(3) // les 3 responsables de site
  await page.getByRole('button', { name: 'Tout déplier' }).click()
  await expect(page.getByTestId('person-card')).toHaveCount(48)
})

test('vue liste et zoom', async ({ page }) => {
  await page.getByRole('button', { name: 'Liste' }).click()
  await expect(page.getByTestId('list-row')).toHaveCount(48)
  await page.getByRole('button', { name: 'Organigramme', exact: true }).last().click()

  const level = page.getByTestId('zoom-level')
  await expect(level).toHaveText('100 %')
  await page.getByRole('button', { name: 'Dézoomer' }).click()
  await expect(level).toHaveText('90 %')
  await page.getByRole('button', { name: 'Ajuster' }).click()
  await expect(level).not.toHaveText('90 %')
  await level.click()
  await expect(level).toHaveText('100 %')
})
