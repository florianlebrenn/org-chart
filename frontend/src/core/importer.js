// Lecture de fichiers Excel/CSV dans le navigateur + suggestion de mapping.
// Mêmes règles que backend/importer.py (mode statique, sans serveur).
import { unzipSync } from 'fflate'
import { normText } from './text.js'

export const FIELDS = ['name', 'first_name', 'last_name', 'title', 'site', 'email', 'phone', 'manager']
const MAX_HEADER_SCAN = 20

export class ImportError extends Error {}

// Un .xlsx est une archive zip : on refuse celles qui se décompressent de façon démesurée (« bombe zip »).
// Mêmes limites que backend/importer.py.
export const MAX_UNCOMPRESSED = 200 * 1024 * 1024
export const MAX_ZIP_ENTRIES = 5000

export function checkZip(buffer) {
  let total = 0
  let count = 0
  try {
    // le filtre lit seulement l'en-tête de chaque entrée : rien n'est décompressé ici
    unzipSync(new Uint8Array(buffer), {
      filter: (f) => {
        total += f.originalSize
        count += 1
        if (count > MAX_ZIP_ENTRIES || total > MAX_UNCOMPRESSED) throw new ImportError('trop gros')
        return false
      },
    })
  } catch (e) {
    if (e instanceof ImportError) throw new ImportError('Fichier Excel refusé : contenu décompressé anormalement volumineux.')
    throw new ImportError('Fichier Excel illisible ou endommagé.')
  }
}

export function cellToStr(v) {
  if (v === null || v === undefined) return ''
  if (typeof v === 'boolean') return v ? 'oui' : 'non'
  if (typeof v === 'number') return Number.isInteger(v) ? String(v) : String(v)
  if (v instanceof Date) return isNaN(v) ? '' : v.toISOString().slice(0, 10)
  return String(v).split(/\s+/).filter(Boolean).join(' ')
}

function colLetter(i) {
  let s = ''
  i += 1
  while (i) {
    const r = (i - 1) % 26
    s = String.fromCharCode(65 + r) + s
    i = Math.floor((i - 1) / 26)
  }
  return s
}

export function tableFromRows(name, rawRows) {
  const rows = rawRows.map((r) => (r || []).map(cellToStr))
  const headerIdx = rows.slice(0, MAX_HEADER_SCAN).findIndex((r) => r.filter(Boolean).length >= 2)
  if (headerIdx < 0) return { name, header_row: null, headers: [], rows: [] }
  const data = rows.slice(headerIdx + 1).filter((r) => r.some(Boolean))
  let width = 0
  for (const r of [rows[headerIdx], ...data]) {
    for (let i = r.length - 1; i >= 0; i--) {
      if (r[i]) {
        width = Math.max(width, i + 1)
        break
      }
    }
  }
  const headers = Array.from({ length: width }, (_, i) => rows[headerIdx][i] || `Colonne ${colLetter(i)}`)
  return {
    name,
    header_row: headerIdx + 1,
    headers,
    rows: data.map((r) => Array.from({ length: width }, (_, i) => r[i] ?? '')),
  }
}

/** Petit lecteur CSV (guillemets, séparateur ; , ou tabulation). */
export function parseCsvText(text) {
  const firstLine = text.split(/\r?\n/, 1)[0] || ''
  const counts = [';', ',', '\t'].map((d) => [d, firstLine.split(d).length - 1])
  const delim = counts.sort((a, b) => b[1] - a[1])[0][1] > 0 ? counts[0][0] : ';'
  const rows = []
  let row = []
  let field = ''
  let quoted = false
  for (let i = 0; i < text.length; i++) {
    const c = text[i]
    if (quoted) {
      if (c === '"' && text[i + 1] === '"') {
        field += '"'
        i++
      } else if (c === '"') quoted = false
      else field += c
    } else if (c === '"' && field === '') quoted = true
    else if (c === delim) {
      row.push(field)
      field = ''
    } else if (c === '\n' || c === '\r') {
      if (c === '\r' && text[i + 1] === '\n') i++
      row.push(field)
      rows.push(row)
      row = []
      field = ''
    } else field += c
  }
  if (field !== '' || row.length) {
    row.push(field)
    rows.push(row)
  }
  return rows
}

function decodeText(buffer) {
  try {
    return new TextDecoder('utf-8', { fatal: true }).decode(buffer).replace(/^\uFEFF/, '')
  } catch {
    return new TextDecoder('windows-1252').decode(buffer)
  }
}

/** Lit un fichier (File/Blob) et renvoie [{name, header_row, headers, rows}]. */
export async function parseFile(file) {
  const filename = file.name || 'fichier'
  const ext = filename.includes('.') ? filename.split('.').pop().toLowerCase() : ''
  if (ext === 'xls') {
    throw new ImportError(
      "Ancien format Excel (.xls) non pris en charge : ouvrez le fichier dans Excel puis « Enregistrer sous » au format .xlsx.",
    )
  }
  const buffer = await file.arrayBuffer()
  if (ext === 'csv' || ext === 'txt') {
    const table = tableFromRows('CSV', parseCsvText(decodeText(buffer)))
    if (!table.headers.length) throw new ImportError('Aucun tableau trouvé dans le fichier.')
    return [table]
  }
  if (ext !== 'xlsx' && ext !== 'xlsm') throw new ImportError('Format non reconnu : utilisez un fichier .xlsx ou .csv.')
  checkZip(buffer)
  let sheets
  try {
    const { default: readExcelFile } = await import('read-excel-file/universal')
    sheets = await readExcelFile(buffer)
  } catch (e) {
    throw new ImportError(`Impossible de lire le fichier Excel (${e?.message || e}).`)
  }
  const tables = sheets.map((s) => tableFromRows(s.sheet, s.data)).filter((t) => t.headers.length)
  if (!tables.length) throw new ImportError('Aucun tableau trouvé dans le fichier.')
  return tables
}

// L'ordre compte : une colonne n'est attribuée qu'au premier champ qui la reconnaît.
const PATTERNS = [
  ['manager', /superieur|manager|\bn ?\+ ?1\b|responsable hierarchique|chef direct|hierarchie/],
  ['first_name', /^prenom$|first ?name|^prenoms?\b/],
  ['last_name', /^nom$|nom de famille|last ?name|surname|^nom usuel$/],
  ['name', /nom complet|nom et prenom|prenom et nom|nom prenom|prenom nom|collaborat|salarie|employe|personne|^name$|full ?name|^agent$/],
  ['site', /site|batiment|etablissement|lieu|localisation|implantation|agence|bureau|locaux/],
  ['title', /fonction|poste|intitule|titre|role|job|metier|emploi/],
  ['email', /mail|courriel/],
  ['phone', /tel|phone|portable|mobile|gsm/],
]

export function suggestMapping(headers, saved) {
  const norm = headers.map(normText)
  let mapping = {}
  if (saved) {
    for (const [field, header] of Object.entries(saved)) {
      const i = norm.indexOf(normText(header))
      if (FIELDS.includes(field) && i >= 0) mapping[field] = i
    }
    if ('name' in mapping || 'last_name' in mapping) return mapping
    mapping = {}
  }
  const used = new Set()
  for (const [field, re] of PATTERNS) {
    const i = norm.findIndex((h, idx) => !used.has(idx) && re.test(h))
    if (i >= 0) {
      mapping[field] = i
      used.add(i)
    }
  }
  if ('last_name' in mapping && !('first_name' in mapping) && !('name' in mapping)) {
    mapping.name = mapping.last_name
    delete mapping.last_name
  }
  return mapping
}

// ------------------------------------------------------------------ confidentialité : colonnes retenues
// Mêmes règles que backend/importer.py : seules les colonnes associées à un champ de FIELDS sont lues.
// Les autres colonnes du fichier ne sont jamais importées, conservées ni affichées.

/** Mapping sûr : champs connus, index valides, une colonne par champ, « nom complet » prioritaire. */
export function cleanMapping(mapping, width) {
  const out = {}
  const used = new Set()
  for (const field of FIELDS) {
    const i = mapping?.[field]
    if (Number.isInteger(i) && i >= 0 && i < width && !used.has(i)) {
      out[field] = i
      used.add(i)
    }
  }
  if ('name' in out) {
    delete out.first_name
    delete out.last_name
  }
  return out
}

/** Ne garde QUE les colonnes retenues -> { rows, mapping } (mapping vers les nouvelles colonnes). */
export function projectRows(rows, mapping) {
  const fields = FIELDS.filter((f) => f in mapping)
  return {
    rows: rows.map((row) => fields.map((f) => row[mapping[f]] ?? '')),
    mapping: Object.fromEntries(fields.map((f, n) => [f, n])),
  }
}

/** Aperçu limité aux colonnes retenues. */
export function preview(rows, headers, mapping, n = 8) {
  const fields = FIELDS.filter((f) => f in mapping)
  const used = new Set(Object.values(mapping))
  return {
    columns: fields.map((f) => ({ field: f, index: mapping[f], header: headers[mapping[f]] })),
    rows: projectRows(rows.slice(0, n), mapping).rows,
    ignored_headers: headers.filter((_, i) => !used.has(i)),
  }
}

export function mappingToHeaders(mapping, headers) {
  return Object.fromEntries(
    Object.entries(mapping)
      .filter(([, i]) => i !== null && i !== undefined && i >= 0 && i < headers.length)
      .map(([f, i]) => [f, headers[i]]),
  )
}
