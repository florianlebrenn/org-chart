// Choix du stockage au moment du build :
//   npm run build          -> mode serveur (Docker, backend FastAPI)
//   npm run build:static   -> mode autonome (fichier HTML unique, données dans le navigateur)
import { apiStore } from './apiStore.js'
import { createLocalStore } from './localStore.js'

export const store = import.meta.env.VITE_STORAGE === 'local' ? createLocalStore() : apiStore
