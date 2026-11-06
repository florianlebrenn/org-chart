// Cas d'usage : sortir l'organigramme en PDF / impression / Mermaid.
import { readFileSync } from 'node:fs'
import { test, expect } from './fixtures.js'

const pdfPages = (buf) => (buf.toString('latin1').match(/\/Type\s*\/Page[^s]/g) || []).length

test.beforeEach(async ({ app }) => {
  await app.open()
  await app.importFile('collaborateurs_avec_superieur.xlsx')
})

test('PDF A4 paysage : une page par site (mode serveur)', async ({ app, page }) => {
  test.skip(!app.isServer, 'en mode autonome le PDF passe par l’impression du navigateur')
  const [download] = await Promise.all([page.waitForEvent('download'), page.getByTestId('export-pdf').click()])
  expect(download.suggestedFilename()).toMatch(/^organigramme-\d{4}-\d{2}-\d{2}\.pdf$/)
  const pdf = readFileSync(await download.path())
  expect(pdf.subarray(0, 4).toString()).toBe('%PDF')
  expect(pdfPages(pdf)).toBe(3)

  // PDF d'un seul site depuis son en-tête
  const [one] = await Promise.all([
    page.waitForEvent('download'),
    app.section('Siège - Lyon').getByRole('button', { name: 'PDF du site' }).click(),
  ])
  expect(one.suggestedFilename()).toContain('siege-lyon')
  expect(pdfPages(readFileSync(await one.path()))).toBe(1)
})

test('impression navigateur : une page A4 paysage par site', async ({ page, browserName, headless }, testInfo) => {
  test.skip(browserName !== 'chromium' || !headless, 'page.pdf() demande Chromium sans fenêtre')
  await page.emulateMedia({ media: 'print' })
  const pdf = await page.pdf({ preferCSSPageSize: true, printBackground: true })
  expect(pdfPages(pdf)).toBe(3)
  await testInfo.attach('impression.pdf', { body: pdf, contentType: 'application/pdf' })
})

test('export Mermaid', async ({ page }) => {
  const [download] = await Promise.all([page.waitForEvent('download'), page.getByTestId('export-mermaid').click()])
  const text = readFileSync(await download.path(), 'utf8')
  expect(text.startsWith('flowchart TD')).toBeTruthy()
  expect(text.match(/-->/g)).toHaveLength(45)
})
