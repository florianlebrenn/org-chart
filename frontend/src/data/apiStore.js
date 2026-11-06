// Stockage « serveur » (mode Docker) : appels au backend FastAPI, chemins relatifs uniquement.
import { downloadBlob, exportName } from './download.js'
import { LockedError, announceLocked } from './errors.js'

async function request(path, options = {}) {
  const res = await fetch(`./api${path}`, {
    ...options,
    headers: { Accept: 'application/json', ...(options.headers || {}) },
  })
  if (!res.ok) {
    let detail = ''
    let body = null
    try {
      body = await res.json()
      detail = typeof body.detail === 'string' ? body.detail : JSON.stringify(body.detail)
    } catch {
      detail = res.statusText
    }
    if (res.status === 401 && body?.locked) {
      announceLocked() // session expirée ou application verrouillée : écran de mot de passe
      throw new LockedError()
    }
    throw new Error(detail || `Erreur ${res.status}`)
  }
  return res
}

const getJson = (path) => request(path).then((r) => r.json())
const sendJson = (method, path, body) =>
  request(path, {
    method,
    headers: { 'Content-Type': 'application/json' },
    body: body === undefined ? undefined : JSON.stringify(body),
  }).then((r) => r.json())

function filenameFrom(res, fallback) {
  const m = /filename="([^"]+)"/.exec(res.headers.get('Content-Disposition') || '')
  return m ? m[1] : fallback
}

export const apiStore = {
  mode: 'server',
  label: 'Mode serveur',
  capabilities: { serverPdf: true },

  // ---------------------------------------------------------------- coffre
  vaultStatus: () => getJson('/vault/status').then((r) => r.state),
  setup: (password) => sendJson('POST', '/vault/setup', { password }),
  unlock: (password) => sendJson('POST', '/vault/unlock', { password }),
  lock: () => sendJson('POST', '/vault/lock'),
  recover: (recoveryKey, newPassword) => sendJson('POST', '/vault/recover', { recovery_key: recoveryKey, new_password: newPassword }),
  changePassword: (currentPassword, newPassword) =>
    sendJson('POST', '/vault/password', { current_password: currentPassword, new_password: newPassword }),
  newRecoveryKey: (password) => sendJson('POST', '/vault/recovery-key', { password }),

  // ---------------------------------------------------------------- données
  health: () => getJson('/health'),
  employees: () => getJson('/employees'),
  lastImport: () => getJson('/import/last'),

  upload(file) {
    const form = new FormData()
    form.append('file', file)
    return request('/import', { method: 'POST', body: form }).then((r) => r.json())
  },
  previewImport: ({ token, sheet, mapping }) => sendJson('POST', '/import/preview', { token, sheet, mapping }),
  cancelImport: (token) => sendJson('DELETE', `/import/${token}`),
  confirmImport: ({ token, sheet, mapping, dryRun }) =>
    sendJson('POST', '/import/confirm', { token, sheet, mapping, dry_run: dryRun }),

  updateEmployee: (id, patch) => sendJson('PATCH', `/employees/${id}`, patch),
  attachUnassigned: (siteId, managerId) => sendJson('POST', '/attach-unassigned', { site_id: siteId, manager_id: managerId }),

  async downloadPdf(siteId, siteName) {
    const q = siteId === undefined || siteId === null ? '' : `?site_id=${siteId}`
    const res = await request(`/export/pdf${q}`, { headers: { Accept: 'application/pdf' } })
    downloadBlob(await res.blob(), filenameFrom(res, exportName('pdf', siteName)))
  },
  async downloadBackup(password) {
    const res = await request('/backup', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ password }),
    })
    downloadBlob(await res.blob(), filenameFrom(res, exportName('json')))
  },
  restore: (backup, password) => sendJson('POST', '/restore', { backup, password }),
  reset: () => sendJson('DELETE', '/data'),
}
