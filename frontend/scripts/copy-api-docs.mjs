// Copie Swagger UI (paquet npm swagger-ui-dist) + notre page dans dist/api-docs/,
// pour que la documentation de l'API fonctionne hors ligne, sans CDN.
import { copyFileSync, mkdirSync } from 'node:fs'
import { createRequire } from 'node:module'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const swagger = path.dirname(createRequire(import.meta.url).resolve('swagger-ui-dist/package.json'))
const out = path.join(root, 'dist', 'api-docs')
mkdirSync(out, { recursive: true })

for (const f of ['swagger-ui-bundle.js', 'swagger-ui.css', 'favicon-32x32.png', 'LICENSE', 'NOTICE']) {
  copyFileSync(path.join(swagger, f), path.join(out, f === 'LICENSE' || f === 'NOTICE' ? `${f}-swagger-ui.txt` : f))
}
for (const f of ['index.html', 'init.js']) copyFileSync(path.join(root, 'api-docs', f), path.join(out, f))
console.log('Swagger UI copié dans dist/api-docs/')
