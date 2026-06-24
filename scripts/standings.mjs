// Generador del bloque [CLASIFICACION] del oficial (data/official/results.txt).
//
// El motor de puntuación (js/scoring.js) solo acredita el ranking de grupo cuando
// el grupo está completo (sus 6 partidos), leyendo el orden desde [CLASIFICACION]
// (off.groupOrder). Este script (re)genera esa sección a partir de los resultados
// ya registrados en [PARTIDOS], aplicando el MISMO desempate por enfrentamiento
// directo que predicciones.html (spec 05/08).
//
// Idempotente: reemplaza el bloque [CLASIFICACION] si ya existe, o lo inserta entre
// [PARTIDOS] y [DIECISEISAVOS]. NO toca [PARTIDOS], el bracket ni los contadores.
//
// Empates irresolubles (criterio F, solo en grupos completos): no se fabrica un
// orden. Si ya hay una línea manual para ese grupo se conserva; si no, se emite el
// orden de respaldo marcado con " (empate sin resolver)" y se avisa por consola
// para que el admin fije el orden a mano. Ver [[no-fabricar-datos-oficiales]].
//
// Uso: node scripts/standings.mjs            (escribe en data/official/results.txt)
//      node scripts/standings.mjs --check    (no escribe; solo informa y sale ≠0 si cambia)
// @ts-check

import { readFileSync, writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { parsePrediction } from "../js/parse_prediction.js";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const RESULTS = join(ROOT, "data", "official", "results.txt");

// ── Grupos canónicos (id de equipo + dsIdx) derivados de data/groups.json ───
// Orden de equipos (dsIdx, fallback §17) = orden de primera aparición en los
// partidos del grupo, idéntico al array GROUPS inline de predicciones.html.
export function loadGroups() {
  const groupsData = JSON.parse(readFileSync(join(ROOT, "data", "groups.json"), "utf8"));
  const teamsData = JSON.parse(readFileSync(join(ROOT, "data", "teams.json"), "utf8"));
  const nameToId = new Map();
  for (const [id, t] of Object.entries(teamsData.teams)) nameToId.set(t.name, id);

  return groupsData.groups.map((g) => {
    const matches = g.matches.map((m) => ({
      id: m.match_id, home: nameToId.get(m.home_team), away: nameToId.get(m.away_team),
    }));
    const seen = [];
    for (const m of matches) for (const id of [m.home, m.away]) if (!seen.includes(id)) seen.push(id);
    const teams = seen.map((id, i) => ({ id, dsIdx: i }));
    return { groupId: g.group_id, teams, matches };
  });
}

// ── Algoritmo de clasificación (port fiel de predicciones.html:374-495) ──────
const isComplete = (s) => s && typeof s.home === "number" && typeof s.away === "number";
const groupComplete = (group, scores) => group.matches.every((m) => isComplete(scores[m.id]));

// Estadísticas base del grupo (todos los partidos jugados, sin ordenar).
function baseStats(group, scores) {
  const rows = group.teams.map((t) => ({ id: t.id, dsIdx: t.dsIdx, pts: 0, GF: 0, GC: 0, DG: 0 }));
  const byId = new Map(rows.map((r) => [r.id, r]));
  for (const m of group.matches) {
    const s = scores[m.id];
    if (!isComplete(s)) continue;
    const h = byId.get(m.home), a = byId.get(m.away);
    h.GF += s.home; h.GC += s.away; a.GF += s.away; a.GC += s.home;
    if (s.home > s.away) h.pts += 3;
    else if (s.home < s.away) a.pts += 3;
    else { h.pts++; a.pts++; }
  }
  for (const r of rows) r.DG = r.GF - r.GC;
  return rows;
}

// Particiona una lista YA ordenada en grupos de elementos consecutivos iguales.
function partitionBy(sorted, equal) {
  const out = [];
  for (let i = 0; i < sorted.length; i++) {
    if (i === 0 || !equal(sorted[i - 1], sorted[i])) out.push([]);
    out[out.length - 1].push(sorted[i]);
  }
  return out;
}

// Mini-tabla head-to-head: solo partidos entre los equipos de `ids` (spec 05 §10).
function computeH2H(ids, group, scores) {
  const set = new Set(ids);
  const t = new Map(ids.map((id) => [id, { id, pts: 0, gf: 0, ga: 0, gd: 0 }]));
  for (const m of group.matches) {
    if (!set.has(m.home) || !set.has(m.away)) continue;
    const s = scores[m.id];
    if (!isComplete(s)) continue;
    const h = t.get(m.home), a = t.get(m.away);
    h.gf += s.home; h.ga += s.away; a.gf += s.away; a.ga += s.home;
    if (s.home > s.away) h.pts += 3;
    else if (s.home < s.away) a.pts += 3;
    else { h.pts++; a.pts++; }
  }
  for (const x of t.values()) x.gd = x.gf - x.ga;
  return t;
}

// Steps 3+F (spec 05): D) DG global, E) GF global, F) manual.
function resolveByOverall(ids, byId) {
  const sorted = ids.slice().sort((x, y) =>
    byId.get(y).DG - byId.get(x).DG || byId.get(y).GF - byId.get(x).GF);
  const order = [], manual = [];
  for (const b of partitionBy(sorted, (x, y) =>
    byId.get(x).DG === byId.get(y).DG && byId.get(x).GF === byId.get(y).GF)) {
    if (b.length === 1) { order.push(b[0]); continue; }
    const ds = b.slice().sort((x, y) => byId.get(x).dsIdx - byId.get(y).dsIdx); // fallback §17
    order.push(...ds); manual.push(ds);
  }
  return { order, manual };
}

// Step 1 (A,B,C head-to-head) + Step 2 (recursión sobre los aún empatados). spec 05.
function resolveTie(ids, group, scores, byId) {
  if (ids.length === 1) return { order: ids.slice(), manual: [] };
  const h = computeH2H(ids, group, scores);
  const sorted = ids.slice().sort((x, y) =>
    h.get(y).pts - h.get(x).pts || h.get(y).gd - h.get(x).gd || h.get(y).gf - h.get(x).gf);
  const buckets = partitionBy(sorted, (x, y) =>
    h.get(x).pts === h.get(y).pts && h.get(x).gd === h.get(y).gd && h.get(x).gf === h.get(y).gf);
  if (buckets.length === 1) return resolveByOverall(ids, byId); // h2h no separa → D/E/F
  const order = [], manual = [];
  for (const b of buckets) {
    const r = resolveTie(b, group, scores, byId); // reaplicar A-C a los restantes (Step 2)
    order.push(...r.order); manual.push(...r.manual);
  }
  return { order, manual };
}

// Clasificación final del grupo. { rows:[ids], manualSets:[[ids]], complete }.
export function rankGroup(group, scores) {
  const rows = baseStats(group, scores);
  const byId = new Map(rows.map((r) => [r.id, r]));
  if (!groupComplete(group, scores)) {
    // En vivo (§7): Pts → DG global → GF global → orden del dataset.
    const order = rows.slice().sort((a, b) =>
      b.pts - a.pts || b.DG - a.DG || b.GF - a.GF || a.dsIdx - b.dsIdx);
    return { rows: order.map((r) => r.id), manualSets: [], complete: false };
  }
  // Completo (§8): buckets por puntos, luego head-to-head recursivo.
  const ids = rows.map((r) => r.id).sort((x, y) => byId.get(y).pts - byId.get(x).pts);
  const orderIds = [], manualSets = [];
  for (const b of partitionBy(ids, (x, y) => byId.get(x).pts === byId.get(y).pts)) {
    const r = resolveTie(b, group, scores, byId);
    orderIds.push(...r.order);
    for (const ms of r.manual) manualSets.push(ms);
  }
  return { rows: orderIds, manualSets, complete: true };
}

// ── Construcción del bloque de texto ─────────────────────────────────────────
// Lee scores desde [PARTIDOS]; devuelve { lines:[12 líneas], warnings:[...] }.
export function buildClasificacion(text, groups) {
  const parsed = parsePrediction(text);
  const existing = parseExistingClasificacion(text); // group → línea cruda previa
  const lines = [], warnings = [];
  for (const g of groups) {
    const scores = {};
    for (const m of g.matches) {
      const gm = parsed.groupMatches[m.id];
      if (gm && gm.hg != null && gm.ag != null) scores[m.id] = { home: gm.hg, away: gm.ag };
    }
    const { rows, manualSets, complete } = rankGroup(g, scores);
    const order = rows.map((id, i) => `${i + 1}:${id}`).join(" ");

    if (complete && manualSets.length) {
      // Empate irresoluble: no fabricar. Conservar SOLO una resolución manual
      // previa ya finalizada (sin marcador (incompleto)/(empate sin resolver));
      // una línea auto-generada obsoleta no cuenta como decisión del admin.
      const tied = manualSets.map((s) => s.join("/")).join(", ");
      const prev = existing.get(g.groupId);
      const settled = prev && !/\(incompleto\)|\(empate sin resolver\)/.test(prev);
      if (settled) {
        warnings.push(`Grupo ${g.groupId}: empate irresoluble (${tied}); se conserva el orden manual existente.`);
        lines.push(prev);
      } else {
        warnings.push(`Grupo ${g.groupId}: empate irresoluble (${tied}); fija el orden a mano (desempate FIFA).`);
        lines.push(`${g.groupId} ${order} (empate sin resolver)`);
      }
      continue;
    }
    const status = complete ? "" : " (incompleto)";
    lines.push(`${g.groupId} ${order}${status}`);
  }
  return { lines, warnings };
}

// Mapa group → línea cruda existente en la sección [CLASIFICACION] (si la hay).
function parseExistingClasificacion(text) {
  const map = new Map();
  const all = text.replace(/\r/g, "").split("\n");
  let inSection = false;
  for (const raw of all) {
    const line = raw.trim();
    if (line === "[CLASIFICACION]") { inSection = true; continue; }
    if (inSection) {
      if (line.startsWith("[") || line.startsWith("END_")) break;
      if (!line) continue;
      const g = line.split(/\s+/)[0];
      if (/^[A-L]$/.test(g)) map.set(g, line);
    }
  }
  return map;
}

// Inserta/reemplaza el bloque [CLASIFICACION] entre [PARTIDOS] y [DIECISEISAVOS].
export function applyClasificacion(text, clasifLines) {
  const eol = text.includes("\r\n") ? "\r\n" : "\n";
  const lines = text.replace(/\r/g, "").split("\n");
  const block = ["[CLASIFICACION]", ...clasifLines];

  const idxClasif = lines.indexOf("[CLASIFICACION]");
  const idxDieci = lines.indexOf("[DIECISEISAVOS]");
  if (idxDieci < 0) throw new Error("results.txt no tiene sección [DIECISEISAVOS]");

  // Punto donde empiezan las líneas en blanco que preceden a [DIECISEISAVOS].
  let resume = idxDieci;
  while (resume - 1 >= 0 && lines[resume - 1].trim() === "") resume--;

  let before;
  if (idxClasif >= 0) {
    // before incluye la línea en blanco anterior a [CLASIFICACION].
    before = lines.slice(0, idxClasif);
    const after = lines.slice(resume); // blancos + [DIECISEISAVOS]...
    return [...before, ...block, ...after].join(eol);
  }
  // No existía: insertar antes de los blancos que preceden a [DIECISEISAVOS].
  before = lines.slice(0, resume);
  const after = lines.slice(resume);
  return [...before, "", ...block, ...after].join(eol);
}

// ── CLI ──────────────────────────────────────────────────────────────────────
function main() {
  const check = process.argv.includes("--check");
  const text = readFileSync(RESULTS, "utf8");
  const groups = loadGroups();
  const { lines, warnings } = buildClasificacion(text, groups);
  const updated = applyClasificacion(text, lines);

  for (const w of warnings) console.warn("⚠ " + w);
  const changed = updated !== text;
  if (check) {
    console.log(changed ? "[CLASIFICACION] cambiaría (ejecuta sin --check)." : "[CLASIFICACION] al día.");
    process.exit(changed ? 1 : 0);
  }
  if (changed) {
    writeFileSync(RESULTS, updated);
    console.log("✓ [CLASIFICACION] actualizada en data/official/results.txt");
  } else {
    console.log("[CLASIFICACION] ya estaba al día; sin cambios.");
  }
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) main();
