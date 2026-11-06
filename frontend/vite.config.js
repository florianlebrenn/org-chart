import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import { viteSingleFile } from 'vite-plugin-singlefile'

// Tout est bundlé localement : aucun CDN, aucune ressource distante.
//   npm run build         -> dist/         (mode serveur, servi par nginx dans Docker)
//   npm run build:static  -> dist-static/  (mode autonome : UN fichier index.html, données dans le navigateur)

// Mode autonome : politique de sécurité dans la page elle-même.
// connect-src 'none' = le navigateur refuse TOUTE requête réseau émise par la page.
const STATIC_CSP = [
  "default-src 'none'",
  "script-src 'unsafe-inline'",
  "style-src 'unsafe-inline'",
  'img-src data: blob:',
  "connect-src 'none'",
  "font-src 'none'",
  "object-src 'none'",
  "base-uri 'none'",
  "form-action 'none'",
].join('; ')

function staticCsp() {
  return {
    name: 'static-csp',
    transformIndexHtml: (html) =>
      html.replace('<meta charset="UTF-8" />', `<meta charset="UTF-8" />\n    <meta http-equiv="Content-Security-Policy" content="${STATIC_CSP}" />`),
  }
}

export default defineConfig(({ mode }) => {
  const isStatic = mode === 'static'
  return {
    plugins: [react(), ...(isStatic ? [viteSingleFile(), staticCsp()] : [])],
    base: './',
    define: {
      'import.meta.env.VITE_STORAGE': JSON.stringify(isStatic ? 'local' : 'api'),
    },
    build: {
      outDir: isStatic ? 'dist-static' : 'dist',
      assetsDir: 'assets',
      sourcemap: false,
      target: 'es2020',
    },
    server: {
      // En dev (`npm run dev`), /api est relayé vers le backend local.
      proxy: { '/api': 'http://localhost:8000' },
    },
  }
})
