// Arbres par site — mêmes règles que backend/tree.py.
import { normText } from './text.js'

export const STACK_MIN = 3
export const NO_SITE = 'Sans site'
export const SITE_COLORS = ['#2563eb', '#059669', '#d97706', '#7c3aed', '#db2777', '#0891b2', '#65a30d', '#dc2626']
export const NO_SITE_COLOR = '#64748b'

// tri « code point » comme Python (sorted / str.lower) pour garder les mêmes couleurs et le même ordre
const cmp = (a, b) => (a < b ? -1 : a > b ? 1 : 0)

/** Couleur par site : rang du site (trié par nom) dans la palette. */
export function siteColors(employees) {
  const sites = new Map()
  for (const e of employees) if (e.site_id !== null && e.site_id !== undefined) sites.set(e.site_id, e.site || '')
  const sorted = [...sites.entries()].sort((a, b) => cmp(a[1].toLowerCase(), b[1].toLowerCase()))
  return Object.fromEntries(sorted.map(([id], i) => [id, SITE_COLORS[i % SITE_COLORS.length]]))
}

export const MAX_COLUMN = 6

/**
 * Disposition des enfants d'un nœud (même règle que backend/tree.py `layout_items`) :
 * les personnes sans équipe sont empilées en colonnes (si elles sont au moins STACK_MIN),
 * les autres restent côte à côte avec leur propre équipe en dessous.
 *   -> [{type: 'node', node} | {type: 'column', nodes: [...]}]
 */
export function layoutItems(node) {
  const kids = node.reports
  const leaves = kids.filter((k) => !k.reports.length)
  if (leaves.length < STACK_MIN) return kids.map((k) => ({ type: 'node', node: k }))
  const items = kids.filter((k) => k.reports.length).map((k) => ({ type: 'node', node: k }))
  const ncols = Math.ceil(leaves.length / MAX_COLUMN)
  const size = Math.ceil(leaves.length / ncols)
  for (let i = 0; i < leaves.length; i += size) items.push({ type: 'column', nodes: leaves.slice(i, i + size) })
  return items
}

/** [{site_id, site, count, trees, unassigned}] trié par nom de site, « Sans site » en dernier. */
export function siteGroups(employees) {
  const byId = new Map(employees.map((e) => [e.id, e]))
  const bySite = new Map()
  for (const e of employees) {
    const k = e.site_id ?? null
    if (!bySite.has(k)) bySite.set(k, [])
    bySite.get(k).push(e)
  }
  const groups = []
  for (const [sid, people] of bySite) {
    const ids = new Set(people.map((p) => p.id))
    const nodes = new Map(people.map((p) => [p.id, { ...p, reports: [] }]))
    const roots = []
    for (const p of people) {
      const node = nodes.get(p.id)
      if (ids.has(p.manager_id)) nodes.get(p.manager_id).reports.push(node)
      else {
        const m = byId.get(p.manager_id)
        if (m) node.note = `Rattaché(e) à ${m.name}${m.site ? ` (${m.site})` : ''}`
        roots.push(node)
      }
    }
    groups.push({
      site_id: sid,
      site: people[0].site || NO_SITE,
      count: people.length,
      trees: roots.filter((r) => r.reports.length || r.manager_id),
      unassigned: roots.filter((r) => !r.reports.length && !r.manager_id),
    })
  }
  return groups.sort((a, b) => (a.site_id === null) - (b.site_id === null) || cmp(a.site.toLowerCase(), b.site.toLowerCase()))
}

/** Vrai si managerId est employeeId ou l'un de ses subordonnés. */
export function wouldCreateCycle(employees, employeeId, managerId) {
  const parent = new Map(employees.map((e) => [e.id, e.manager_id]))
  const seen = new Set()
  let cur = managerId
  while (cur !== null && cur !== undefined && !seen.has(cur)) {
    if (cur === employeeId) return true
    seen.add(cur)
    cur = parent.get(cur)
  }
  return false
}

export function matches(person, q) {
  if (!q) return false
  return [person.name, person.title, person.email, person.phone].some((v) => v && normText(v).includes(q))
}

/** Filtre les groupes : garde les nœuds correspondants et leurs ancêtres. Renvoie {groups, hits}. */
export function filterGroups(groups, query) {
  const q = normText(query)
  if (!q) return { groups, hits: 0 }
  let hits = 0
  const prune = (node) => {
    const kids = node.reports.map(prune).filter(Boolean)
    const hit = matches(node, q)
    if (hit) hits++
    return hit || kids.length ? { ...node, reports: hit ? node.reports.map((k) => prune(k) || k) : kids, hit } : null
  }
  const out = groups
    .map((g) => {
      const trees = g.trees.map(prune).filter(Boolean)
      const unassigned = g.unassigned.filter((n) => matches(n, q)).map((n) => ({ ...n, hit: true }))
      hits += unassigned.length
      return { ...g, trees, unassigned }
    })
    .filter((g) => g.trees.length || g.unassigned.length)
  return { groups: out, hits }
}

export function walk(nodes, fn) {
  for (const n of nodes) {
    fn(n)
    walk(n.reports || [], fn)
  }
}

/** Devine le responsable d'un site d'après la fonction (pour pré-remplir « Rattacher tous à… »). */
export function guessSiteHead(people) {
  const rules = [
    /\bdirect(eur|rice) (de site|general|generale|d agence|d etablissement)\b/,
    /\bresponsable (de site|d entrepot|d agence|d etablissement)\b/,
    /\b(chef|gerant|gerante) (de site|d agence)\b/,
    /\bdirect(eur|rice)\b/,
    /\bresponsable\b/,
  ]
  for (const re of rules) {
    const found = people.filter((p) => re.test(normText(p.title)))
    if (found.length === 1) return found[0]
  }
  return null
}

export function toMermaid(groups) {
  const q = (s) => String(s ?? '').replaceAll('"', '#quot;').replaceAll('<', '#lt;').replaceAll('>', '#gt;')
  const lines = ['flowchart TD']
  const edges = []
  groups.forEach((g, gi) => {
    lines.push(`  subgraph S${gi}["${q(g.site)}"]`)
    const rec = (n) => {
      const label = q(n.name) + (n.title ? `<br/><small>${q(n.title)}</small>` : '')
      lines.push(`    E${n.id}["${label}"]`)
      for (const c of n.reports) {
        edges.push(`  E${n.id} --> E${c.id}`)
        rec(c)
      }
    }
    ;[...g.trees, ...g.unassigned].forEach(rec)
    lines.push('  end')
  })
  return [...lines, ...edges].join('\n') + '\n'
}
