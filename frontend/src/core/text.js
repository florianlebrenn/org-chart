// Normalisation des textes — mêmes règles que backend/importer.py.

export function stripAccents(s) {
  return String(s ?? '').normalize('NFKD').replace(/[̀-ͯ]/g, '')
}

/** minuscules, sans accents, ponctuation -> espaces, espaces compactés */
export function normText(s) {
  return stripAccents(s).toLowerCase().replace(/[^a-z0-9+]+/g, ' ').trim().replace(/\s+/g, ' ')
}

/** Clé de correspondance d'un nom, indépendante de l'ordre prénom/nom, de la casse et des accents. */
export function nameKey(name) {
  return normText(name).split(' ').filter(Boolean).sort().join(' ')
}

const isAllUpper = (w) => /\p{Lu}/u.test(w) && !/\p{Ll}/u.test(w)

/** « D'ALMEIDA » -> « D'Almeida », « JEAN-BAPTISTE » -> « Jean-Baptiste » */
export function prettyName(s) {
  return String(s ?? '')
    .split(/\s+/)
    .filter(Boolean)
    .map((w) =>
      w.length > 1 && isAllUpper(w)
        ? w.toLowerCase().replace(/(^|[-'’])(\p{L})/gu, (_, p, c) => p + c.toUpperCase())
        : w,
    )
    .join(' ')
}

export function initials(name) {
  return String(name ?? '')
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((w) => w[0].toUpperCase())
    .join('')
}
