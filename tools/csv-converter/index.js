#!/usr/bin/env node
/**
 * Usage:
 *   node org-from-csv.js org.csv org_tree.json org_chart.mmd
 *
 * CSV headers:
 *   - Required: Employee, Manager
 *   - Optional: Title (or Role)
 *
 * Outputs:
 *   1) org_tree.json  -> nested JSON tree including { name, title, reports[] }
 *   2) org_chart.mmd  -> Mermaid flowchart with "Name — Title" labels
 */

const fs = require("fs/promises");
const path = require("path");

// --- Simple CSV parser (no quoted commas). For robust CSVs, use csv-parse (see note at bottom).
function parseSimpleCSV(text) {
  const lines = text
    .split(/\r?\n/)
    .map(l => l.trim())
    .filter(Boolean);

  if (lines.length === 0) return [];

  const headers = lines[0].split(",").map(h => h.trim());
  const rows = [];

  for (let i = 1; i < lines.length; i++) {
    const cols = lines[i].split(",").map(c => c.trim());
    if (cols.length === 1 && cols[0] === "") continue; // skip empty lines
    const obj = {};
    headers.forEach((h, idx) => (obj[h] = cols[idx] ?? ""));
    rows.push(obj);
  }
  return rows;
}

function normalize(s) {
  return (s || "").trim();
}

function uniqueIdsFromNames(names) {
  const makeId = (name) =>
    name.toLowerCase().replace(/[^a-z0-9]+/g, "_").replace(/^_+|_+$/g, "") || "node";
  const used = new Map();
  const map = new Map();

  for (const name of names) {
    let id = makeId(name);
    if (!used.has(id)) {
      used.set(id, 1);
    } else {
      const n = used.get(id) + 1;
      used.set(id, n);
      id = `${id}_${n}`;
    }
    map.set(name, id);
  }
  return map;
}

function detectCycles(nodesMap) {
  const State = { UNVISITED: 0, VISITING: 1, DONE: 2 };
  const state = new Map([...nodesMap.keys()].map((k) => [k, State.UNVISITED]));

  function visit(name, stack) {
    const st = state.get(name);
    if (st === State.VISITING) {
      const cyclePath = [...stack, name].join(" -> ");
      throw new Error(`Cycle detected in manager chain: ${cyclePath}`);
    }
    if (st === State.DONE) return;

    state.set(name, State.VISITING);
    const node = nodesMap.get(name);
    const mgr = node.managerName;
    if (mgr && nodesMap.has(mgr)) visit(mgr, [...stack, name]);
    state.set(name, State.DONE);
  }

  for (const name of nodesMap.keys()) {
    if (state.get(name) === State.UNVISITED) visit(name, []);
  }
}

function buildOrg(rawRows) {
  const rows = rawRows.map(r => ({
    employee: normalize(r.Employee ?? r.employee),
    manager:  normalize(r.Manager  ?? r.manager),
    title:    normalize(r.Title    ?? r.title ?? r.Role ?? r.role), // accept Title or Role
  })).filter(r => r.employee);

  // Guard: duplicate employees
  const seen = new Set();
  for (const r of rows) {
    if (seen.has(r.employee)) {
      throw new Error(`Duplicate employee found in CSV: "${r.employee}"`);
    }
    seen.add(r.employee);
  }

  // Build nodes map
  const nodes = new Map(); // name -> node
  const ensureNode = (name) => {
    if (!nodes.has(name)) {
      nodes.set(name, { name, title: "", managerName: "", reports: [] });
    }
    return nodes.get(name);
  };

  for (const { employee, manager, title } of rows) {
    const eNode = ensureNode(employee);
    if (title) eNode.title = title; // set/overwrite from CSV row
    if (manager) {
      const mNode = ensureNode(manager);
      eNode.managerName = manager;
      mNode.reports.push(eNode);
    } else {
      eNode.managerName = ""; // root
    }
  }

  // Cycle detection
  detectCycles(nodes);

  // Roots
  const roots = [];
  for (const node of nodes.values()) {
    if (!node.managerName || !nodes.has(node.managerName)) {
      roots.push(node);
    }
  }

  // Edges
  const edges = [];
  for (const node of nodes.values()) {
    if (node.managerName) {
      edges.push([node.managerName, node.name]);
    }
  }

  return { roots, nodes, edges };
}

function stringifyTree(roots) {
  function toPlain(n) {
    return {
      name: n.name,
      title: n.title || "",
      reports: n.reports.map(toPlain),
    };
  }
  return JSON.stringify(roots.map(toPlain), null, 2);
}

// Escape for Mermaid label in quotes
function escLabel(s) {
  return String(s).replace(/(["\\])/g, "\\$1");
}

function toMermaid(nodesMap, edges) {
  const allNames = [...nodesMap.keys()];
  const idMap = uniqueIdsFromNames(allNames);

  let out = "flowchart TB\n";
  // Declare nodes with labels "Name — Title" (Title optional)
  for (const name of allNames) {
    const id = idMap.get(name);
    const node = nodesMap.get(name);
    const label = node.title ? `**${node.name}** <br> *${node.title}*` : `**${node.name}**`;
    out += `  ${id}["${escLabel(label)}"]\n`;
  }
  // Draw edges: manager --> employee
  for (const [mgr, emp] of edges) {
    const a = idMap.get(mgr);
    const b = idMap.get(emp);
    out += `  ${a} --> ${b}\n`;
  }
  return out;
}

async function main() {
  const input = process.argv[2] || "../input/org.csv";
  const outJson = process.argv[3] || "../output/org_tree.json";
  const outMmd  = process.argv[4] || "../output/org_chart.mmd";

  const csvText = await fs.readFile(path.resolve(input), "utf8");
  const rows = parseSimpleCSV(csvText);

  if (!rows.length) {
    console.error("CSV seems empty or malformed.");
    process.exit(1);
  }
  if (!("Employee" in rows[0]) || !("Manager" in rows[0])) {
    console.error('CSV must have headers: "Employee,Manager" (Title/Role optional)');
    process.exit(1);
  }

  const { roots, nodes, edges } = buildOrg(rows);

  await fs.writeFile(outJson, stringifyTree(roots));
  await fs.writeFile(outMmd, toMermaid(nodes, edges));

  console.log(`✅ Built org tree with ${nodes.size} people, ${roots.length} root(s).`);
  console.log(`→ JSON:   ${path.resolve(outJson)}`);
  console.log(`→ Mermaid: ${path.resolve(outMmd)}`);
  console.log(`Tip: Paste Mermaid into https://mermaid.live to view the chart.`);
}

main().catch(err => {
  console.error("Error:", err.message);
  process.exit(1);
});