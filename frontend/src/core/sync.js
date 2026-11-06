// Fusion d'un import avec les données existantes — portage fidèle de backend/sync.py
// (utilisé par le mode statique). Travaille sur un état en mémoire :
//   { sites: [{id, name}], employees: [{id, name, name_key, title, email, phone, photo,
//     site_id, manager_id, sort_order}], settings: {}, seq: {site, employee} }
import { nameKey, prettyName } from './text.js'

export function emptyState() {
  return { sites: [], employees: [], settings: {}, seq: { site: 0, employee: 0 } }
}

export function buildRecords(rows, mapping) {
  const col = (row, field) => {
    const i = mapping[field]
    return i !== undefined && i !== null && i >= 0 && i < row.length ? String(row[i] ?? '').trim() : ''
  }
  const records = []
  let skipped = 0
  rows.forEach((row, n) => {
    let name = 'name' in mapping ? col(row, 'name') : [col(row, 'first_name'), col(row, 'last_name')].filter(Boolean).join(' ')
    name = prettyName(name)
    if (!name) {
      skipped++
      return
    }
    records.push({
      row: n,
      name,
      key: nameKey(name),
      title: col(row, 'title') || null,
      site: col(row, 'site') || null,
      email: col(row, 'email') || null,
      phone: col(row, 'phone') || null,
      manager_raw: col(row, 'manager'),
    })
  })
  return { records, skipped }
}

function groupBy(items, keyFn) {
  const m = new Map()
  items.forEach((it, i) => {
    const k = keyFn(it, i)
    if (!m.has(k)) m.set(k, [])
    m.get(k).push(it)
  })
  return m
}

function resolveManagers(records, warnings) {
  const byKey = groupBy(records.map((_, i) => i), (i) => records[i].key)
  const result = records.map((r, i) => {
    if (!r.manager_raw) return null
    const cands = (byKey.get(nameKey(r.manager_raw)) || []).filter((c) => c !== i)
    if (!cands.length) {
      warnings.unresolved_managers.push({ name: r.name, manager: r.manager_raw })
      return null
    }
    if (cands.length > 1) warnings.ambiguous_managers.push({ name: r.name, manager: r.manager_raw })
    return cands[0]
  })
  for (let start = 0; start < records.length; start++) {
    const seen = new Set()
    let cur = start
    while (cur !== null && !seen.has(cur)) {
      seen.add(cur)
      cur = result[cur]
    }
    if (cur !== null && cur === start) {
      warnings.cycles.push(records[start].name)
      result[start] = null
    }
  }
  return result
}

const sameVal = (a, b) => (a || null) === (b || null)

export function computePlan(state, records, managerMapped) {
  const siteName = Object.fromEntries(state.sites.map((s) => [s.id, s.name]))
  const existing = [...state.employees].sort((a, b) => a.sort_order - b.sort_order || a.id - b.id)
  const exByKey = groupBy(existing, (e) => e.name_key || nameKey(e.name))
  const warnings = {
    duplicates: [], unresolved_managers: [], ambiguous_managers: [], cycles: [], orphaned: [], missing_site: [],
  }

  const recByKey = groupBy(records.map((_, i) => i), (i) => records[i].key)
  const match = new Map()
  const removed = []
  for (const [key, idxs] of recByKey) {
    if (idxs.length > 1) warnings.duplicates.push(records[idxs[0]].name)
    const olds = exByKey.get(key) || []
    idxs.forEach((i, n) => n < olds.length && match.set(i, olds[n]))
    removed.push(...olds.slice(idxs.length))
  }
  for (const [key, olds] of exByKey) if (!recByKey.has(key)) removed.push(...olds)

  const added = []
  const updated = []
  let unchanged = 0
  const labels = { name: 'nom', title: 'fonction', site: 'site', email: 'email', phone: 'téléphone' }
  records.forEach((r, i) => {
    if (!r.site) warnings.missing_site.push(r.name)
    const old = match.get(i)
    if (!old) {
      added.push(r.name)
      return
    }
    const before = { name: old.name, title: old.title, site: siteName[old.site_id] ?? null, email: old.email, phone: old.phone }
    const changes = Object.keys(labels)
      .filter((f) => !sameVal(before[f], r[f]))
      .map((f) => ({ field: labels[f], before: before[f] ?? null, after: r[f] ?? null }))
    if (changes.length) updated.push({ name: r.name, changes })
    else unchanged++
  })

  const managers = managerMapped ? resolveManagers(records, warnings) : null

  if (!managerMapped) {
    const removedIds = new Set(removed.map((e) => e.id))
    const byId = Object.fromEntries(existing.map((e) => [e.id, e]))
    for (const [i, old] of match) {
      if (removedIds.has(old.manager_id)) {
        warnings.orphaned.push({ name: records[i].name, former_manager: byId[old.manager_id].name })
      }
    }
  }

  const sites = new Map()
  for (const r of records) sites.set(r.site || 'Sans site', (sites.get(r.site || 'Sans site') || 0) + 1)

  return {
    summary: {
      total: records.length,
      added,
      removed: removed.map((e) => e.name),
      updated,
      unchanged,
      sites: [...sites.entries()].sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0)).map(([name, count]) => ({ name, count })),
      hierarchy_source: managerMapped ? 'file' : 'kept',
      warnings,
    },
    match,
    removed,
    managers,
  }
}

/** Applique le plan sur une COPIE de l'état et la renvoie. */
export function applyPlan(state, records, plan) {
  const next = structuredClone(state)
  const siteIds = Object.fromEntries(next.sites.map((s) => [s.name, s.id]))
  for (const name of new Set(records.map((r) => r.site).filter(Boolean))) {
    if (!(name in siteIds)) {
      const id = ++next.seq.site
      next.sites.push({ id, name })
      siteIds[name] = id
    }
  }
  const gone = new Set(plan.removed.map((e) => e.id))
  next.employees = next.employees.filter((e) => !gone.has(e.id))
  for (const e of next.employees) if (gone.has(e.manager_id)) e.manager_id = null

  const byId = new Map(next.employees.map((e) => [e.id, e]))
  const ids = records.map((r, i) => {
    const fields = {
      name: r.name, name_key: r.key, title: r.title, email: r.email, phone: r.phone,
      site_id: r.site ? siteIds[r.site] : null, sort_order: i,
    }
    const old = plan.match.get(i)
    if (old) {
      Object.assign(byId.get(old.id), fields)
      return old.id
    }
    const id = ++next.seq.employee
    next.employees.push({ id, photo: null, manager_id: null, ...fields })
    byId.set(id, next.employees[next.employees.length - 1])
    return id
  })
  if (plan.managers) {
    plan.managers.forEach((m, i) => {
      byId.get(ids[i]).manager_id = m === null ? null : ids[m]
    })
  }
  const used = new Set(next.employees.map((e) => e.site_id).filter((x) => x !== null))
  next.sites = next.sites.filter((s) => used.has(s.id))
  return next
}

/** `rows`/`mapping` : tableau DÉJÀ réduit aux colonnes retenues (projectRows).
 *  `mappingHeaders` : {champ: en-tête d'origine}, mémorisé pour le prochain import. */
export function runImport(state, rows, mapping, mappingHeaders, filename, dryRun) {
  const { records, skipped } = buildRecords(rows, mapping)
  if (!records.length) throw new Error('Aucune ligne avec un nom : vérifiez la colonne choisie pour le nom.')
  const plan = computePlan(state, records, 'manager' in mapping)
  const summary = { ...plan.summary, skipped_rows: skipped }
  if (dryRun) return { state, summary }
  const next = applyPlan(state, records, plan)
  const added = summary.added.length
  next.settings.import_mapping = mappingHeaders
  next.settings.last_import = {
    filename,
    date: new Date().toISOString().slice(0, 19),
    total: summary.total,
    added,
    removed: summary.removed.length,
    updated: summary.updated.length,
  }
  return { state: next, summary }
}
