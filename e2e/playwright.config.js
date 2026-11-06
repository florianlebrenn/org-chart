// Scénarios d'usage rejouables, sur les deux modes de l'application.
//
//   projet « serveur »  : l'app Docker de TEST (port 8081, données séparées) -> make e2e-server
//   projet « autonome » : le fichier HTML unique static/organigramme.html     -> make e2e-static
//
// Variables : BASE_URL (défaut http://localhost:8081), STATIC_FILE, SLOWMO (ms, mode visible).
import { defineConfig } from '@playwright/test'
import path from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'

const here = path.dirname(fileURLToPath(import.meta.url))
const staticFile = process.env.STATIC_FILE || path.join(here, '../static/organigramme.html')
const slowMo = Number(process.env.SLOWMO || 0)

export default defineConfig({
  testDir: './tests',
  // une seule base de test côté serveur : les scénarios s'enchaînent, chacun repart de zéro
  workers: 1,
  fullyParallel: false,
  timeout: 60_000,
  expect: { timeout: 10_000 },
  reporter: [['list'], ['html', { open: 'never', outputFolder: 'playwright-report' }]],
  outputDir: 'test-results',
  use: {
    viewport: { width: 1500, height: 950 },
    locale: 'fr-FR',
    timezoneId: 'Europe/Paris',
    acceptDownloads: true,
    screenshot: 'only-on-failure',
    trace: 'retain-on-failure',
    video: process.env.VIDEO ? 'on' : 'off',
    launchOptions: { slowMo },
  },
  projects: [
    {
      name: 'serveur',
      use: { browserName: 'chromium', baseURL: process.env.BASE_URL || 'http://localhost:8081', appMode: 'server' },
    },
    {
      name: 'autonome',
      use: { browserName: 'chromium', baseURL: pathToFileURL(staticFile).href, appMode: 'local' },
    },
  ],
})
