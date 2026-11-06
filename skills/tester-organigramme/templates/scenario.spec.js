// Cas d'usage : <décrire en une phrase ce que fait la personne>.
// Copier dans e2e/tests/NN-sujet.spec.js. Données : fichiers FICTIFS de tools/sample-data uniquement.
import { test, expect } from './fixtures.js'

test.beforeEach(async ({ app }) => {
  await app.open() // mot de passe de test + données vides
  await app.importFile('collaborateurs_avec_superieur.xlsx')
})

test('<ce que la personne fait, et ce qu’elle doit voir>', async ({ app, page }) => {
  // test.skip(app.isServer, 'propre au mode autonome')  // si besoin

  // 1. action, via les rôles accessibles ou data-testid
  await app.card('Mehdi Brahimi').click()
  const panel = page.getByTestId('details-panel')

  // 2. résultat visible
  await expect(panel).toContainText('Chef d')

  // 3. résultat enregistré (API en mode serveur, IndexedDB déchiffrée en mode autonome)
  expect(await app.managerOf('Antoine Faure')).toBe('Mehdi Brahimi')
})
