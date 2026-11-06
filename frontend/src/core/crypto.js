// Chiffrement dans le navigateur (WebCrypto) — mêmes formats que backend/crypto.py.
//
// Enveloppe : une clé de données aléatoire (DEK, 256 bits) chiffre l'état en AES-256-GCM ;
// la DEK est enveloppée par une clé dérivée du mot de passe et par une clé dérivée de la clé de
// secours (PBKDF2-HMAC-SHA256, 600 000 itérations, sel aléatoire). Rien n'est envoyé nulle part.

export const ITERATIONS = 600_000
export const KDF_NAME = 'PBKDF2-SHA256'
export const CIPHER_NAME = 'AES-256-GCM'
export const BACKUP_FORMAT = 'organigramme-sauvegarde-chiffree'
export const MIN_PASSWORD = 12
const RECOVERY_ALPHABET = '0123456789ABCDEFGHJKMNPQRSTVWXYZ'
const enc = new TextEncoder()
const dec = new TextDecoder()
const AAD = {
  dek: enc.encode('organigramme-dek-v1'),
  backup: enc.encode('organigramme-sauvegarde-v1'),
  state: enc.encode('organigramme-etat-v1'),
}

export class CryptoError extends Error {}

// ------------------------------------------------------------------ primitives

export function b64e(bytes) {
  let s = ''
  for (let i = 0; i < bytes.length; i += 0x8000) s += String.fromCharCode(...bytes.subarray(i, i + 0x8000))
  return btoa(s)
}

export function b64d(str) {
  const s = atob(str)
  const out = new Uint8Array(s.length)
  for (let i = 0; i < s.length; i++) out[i] = s.charCodeAt(i)
  return out
}

const random = (n) => crypto.getRandomValues(new Uint8Array(n))

export async function derive(secret, salt, iterations) {
  const base = await crypto.subtle.importKey('raw', enc.encode(secret), 'PBKDF2', false, ['deriveBits'])
  const bits = await crypto.subtle.deriveBits({ name: 'PBKDF2', hash: 'SHA-256', salt, iterations }, base, 256)
  return new Uint8Array(bits)
}

const aesKey = (raw) => crypto.subtle.importKey('raw', raw, 'AES-GCM', false, ['encrypt', 'decrypt'])

/** AES-256-GCM -> nonce (12 octets) || chiffré || tag. `key` : octets bruts ou CryptoKey. */
export async function seal(key, plaintext, aad) {
  const k = key instanceof Uint8Array ? await aesKey(key) : key
  const iv = random(12)
  const ct = new Uint8Array(await crypto.subtle.encrypt({ name: 'AES-GCM', iv, additionalData: aad }, k, plaintext))
  const out = new Uint8Array(12 + ct.length)
  out.set(iv)
  out.set(ct, 12)
  return out
}

export async function unseal(key, blob, aad) {
  try {
    const k = key instanceof Uint8Array ? await aesKey(key) : key
    return new Uint8Array(await crypto.subtle.decrypt({ name: 'AES-GCM', iv: blob.subarray(0, 12), additionalData: aad }, k, blob.subarray(12)))
  } catch {
    throw new CryptoError('déchiffrement impossible')
  }
}

// ------------------------------------------------------------------ mot de passe et clé de secours

export function checkPasswordPolicy(password) {
  if ((password || '').length < MIN_PASSWORD) throw new CryptoError(`Le mot de passe doit contenir au moins ${MIN_PASSWORD} caractères.`)
  if (new Set(password).size < 4) throw new CryptoError('Mot de passe trop simple : variez les caractères (une phrase de passe convient bien).')
}

export function newRecoveryKey() {
  // 32 caractères base32 (160 bits) ; 256 est multiple de 32 : tirage uniforme
  const raw = Array.from(random(32), (b) => RECOVERY_ALPHABET[b & 31]).join('')
  return raw.match(/.{4}/g).join('-')
}

export function normalizeRecoveryKey(value) {
  const s = String(value || '').toUpperCase().replace(/[-\s]/g, '').replace(/O/g, '0').replace(/[IL]/g, '1')
  if (s.length !== 32 || [...s].some((c) => !RECOVERY_ALPHABET.includes(c))) throw new CryptoError('Clé de secours invalide.')
  return s.match(/.{4}/g).join('-')
}

async function wrap(dek, secret, iterations) {
  const salt = random(16)
  return { iterations, salt: b64e(salt), wrapped: b64e(await seal(await derive(secret, salt, iterations), dek, AAD.dek)) }
}

async function unwrap(entry, secret) {
  return unseal(await derive(secret, b64d(entry.salt), entry.iterations), b64d(entry.wrapped), AAD.dek)
}

export async function createVault(password, iterations = ITERATIONS) {
  checkPasswordPolicy(password)
  const dek = random(32)
  const recovery = newRecoveryKey()
  const meta = {
    version: 1,
    kdf: KDF_NAME,
    cipher: CIPHER_NAME,
    password: await wrap(dek, password, iterations),
    recovery: await wrap(dek, recovery, iterations),
    created: new Date().toISOString().slice(0, 19),
  }
  return { meta, dek, recovery }
}

export async function openWithPassword(meta, password) {
  try {
    return await unwrap(meta.password, password || '')
  } catch {
    throw new CryptoError('Mot de passe incorrect.')
  }
}

export async function openWithRecovery(meta, recoveryKey) {
  const rk = normalizeRecoveryKey(recoveryKey)
  try {
    return await unwrap(meta.recovery, rk)
  } catch {
    throw new CryptoError('Clé de secours incorrecte.')
  }
}

export async function rewrap(meta, dek, { password, recoveryKey } = {}, iterations = ITERATIONS) {
  const out = { ...meta }
  if (password !== undefined) {
    checkPasswordPolicy(password)
    out.password = await wrap(dek, password, iterations)
  }
  if (recoveryKey !== undefined) out.recovery = await wrap(dek, normalizeRecoveryKey(recoveryKey), iterations)
  return out
}

// ------------------------------------------------------------------ état chiffré (mode autonome)

export const importDataKey = (dek) => aesKey(dek)

export async function encryptState(dataKey, state) {
  return { v: 1, blob: b64e(await seal(dataKey, enc.encode(JSON.stringify(state)), AAD.state)) }
}

export async function decryptState(dataKey, stored) {
  return JSON.parse(dec.decode(await unseal(dataKey, b64d(stored.blob), AAD.state)))
}

// ------------------------------------------------------------------ sauvegardes chiffrées (format commun)

export async function encryptBackup(data, password, iterations = ITERATIONS) {
  const salt = random(16)
  const blob = await seal(await derive(password, salt, iterations), enc.encode(JSON.stringify(data)), AAD.backup)
  return {
    format: BACKUP_FORMAT,
    version: 1,
    exported_at: data.exported_at ?? null,
    kdf: { name: KDF_NAME, iterations, salt: b64e(salt) },
    cipher: { name: CIPHER_NAME, iv: b64e(blob.subarray(0, 12)) },
    data: b64e(blob.subarray(12)),
  }
}

export async function decryptBackup(doc, password) {
  let plain
  try {
    if (doc?.format !== BACKUP_FORMAT || doc.kdf?.name !== KDF_NAME || doc.cipher?.name !== CIPHER_NAME) {
      throw new CryptoError('Format de sauvegarde chiffrée inconnu.')
    }
    const iterations = Number(doc.kdf.iterations)
    if (!(iterations >= 1000 && iterations <= 5_000_000)) throw new CryptoError('Paramètres de sauvegarde invalides.')
    const key = await derive(password || '', b64d(doc.kdf.salt), iterations)
    const iv = b64d(doc.cipher.iv)
    const ct = b64d(doc.data)
    const blob = new Uint8Array(iv.length + ct.length)
    blob.set(iv)
    blob.set(ct, iv.length)
    plain = await unseal(key, blob, AAD.backup)
  } catch (e) {
    if (e instanceof CryptoError && e.message !== 'déchiffrement impossible') throw e
    throw new CryptoError('Mot de passe de la sauvegarde incorrect, ou fichier endommagé.')
  }
  return JSON.parse(dec.decode(plain))
}
