// Aplica bloques FIX_SEMIS_V1 (generados por fix.html) a las quinielas de
// data/submissions/. Corrige el emparejamiento de semifinales (W97-W98 / W99-W100)
// reescribiendo las líneas M101/M102/M103/M104 y campeon, dejando el resto intacto.
//
// Es DETERMINISTA y AUTO-VALIDANTE: antes de tocar nada comprueba que el bloque no
// cambia lo que debe quedar fijo (campeón, 4.º y los 4 semifinalistas del usuario) y
// que cada marcador es coherente con su clasificado. No commitea (revisa y sube tú).
//
// Uso:
//   node scripts/apply_fix_semis.mjs <fichero-con-bloques>   # uno o varios bloques
//   node scripts/apply_fix_semis.mjs < bloque.txt            # por stdin
//   node scripts/apply_fix_semis.mjs --check <fichero>       # solo valida, no escribe
// @ts-check
import { readFileSync, writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { parsePrediction } from "../js/parse_prediction.js";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const CHECK_ONLY = process.argv.includes("--check");

// Emparejamiento correcto esperado por cada cruce del bloque.
const SLOTS = {
  M101: ["W97", "W98"], M102: ["W99", "W100"],
  M103: ["L101", "L102"], M104: ["W101", "W102"],
};
const PEN_INITIAL = new Set([
  "1-0", "2-0", "2-1", "3-0", "3-1", "3-2", "4-1", "4-2", "4-3", "5-3", "5-4",
  "0-1", "0-2", "1-2", "0-3", "1-3", "2-3", "1-4", "2-4", "3-4", "3-5", "4-5",
]);
const validShootout = (a, b) =>
  Number.isInteger(a) && Number.isInteger(b) && a >= 0 && b >= 0 && a !== b &&
  (PEN_INITIAL.has(`${a}-${b}`) || Math.abs(a - b) === 1);

function parseKoLine(line) {
  const p = line.trim().split(/\s+/);
  if (p.length < 8) throw new Error(`línea de cruce incompleta: "${line}"`);
  const [id, hs, as, home, hg, ag, away] = p;
  let q = null, pen = null;
  for (let i = 7; i < p.length; i++) {
    if (p[i].startsWith("q:")) q = p[i].slice(2);
    else if (p[i].startsWith("pen:")) {
      const [a, b] = p[i].slice(4).split("-").map(Number);
      pen = { a, b };
    }
  }
  return { id, hs, as, home, away, hg, ag, q, pen, raw: line.trim() };
}

// Divide el texto en bloques (uno por "FIX_SEMIS_V1").
function splitBlocks(text) {
  const blocks = [];
  let cur = null;
  for (const raw of text.replace(/\r/g, "").split("\n")) {
    if (raw.startsWith("FIX_SEMIS_V1")) { cur = []; blocks.push(cur); }
    if (cur && raw.trim()) cur.push(raw.trim());
  }
  return blocks;
}

function parseBlock(lines) {
  const nickLine = lines.find((l) => /nick:/.test(l));
  const nick = nickLine ? nickLine.split("nick:")[1].trim() : null;
  const matches = {};
  for (const l of lines) if (/^M10[1-4]\b/.test(l)) { const m = parseKoLine(l); matches[m.id] = m; }
  const champLine = lines.find((l) => /^campeon:/.test(l));
  const champ = champLine ? champLine.split(":")[1].trim() : null;
  return { nick, matches, champ };
}

const registry = JSON.parse(readFileSync(join(root, "data/registry.json"), "utf8"));
const fileForNick = (nick) => {
  const p = (registry.participants || []).find((x) => x.nick.toLowerCase() === String(nick).toLowerCase());
  return p ? p.file : null;
};

// Valida un bloque contra la quiniela original. Devuelve lista de errores ([] = ok).
function validate(block, orig) {
  const errs = [];
  const ko = orig.knockout || {};
  const g = (id) => ko[id] && ko[id].qualified;
  const semifinalistas = new Set([g("M97"), g("M98"), g("M99"), g("M100")]);
  const origChamp = orig.champion;
  const origFourth = ko.M103 ? (ko.M103.qualified === ko.M103.home ? ko.M103.away : ko.M103.home) : null;

  for (const id of ["M101", "M102", "M103", "M104"]) {
    const m = block.matches[id];
    if (!m) { errs.push(`falta ${id}`); continue; }
    if (m.hs !== SLOTS[id][0] || m.as !== SLOTS[id][1])
      errs.push(`${id}: slots ${m.hs}/${m.as} ≠ esperados ${SLOTS[id][0]}/${SLOTS[id][1]} (¿emparejamiento sin corregir?)`);
    if (m.q !== m.home && m.q !== m.away) errs.push(`${id}: q:${m.q} no es uno de los dos equipos`);
    const hg = Number(m.hg), ag = Number(m.ag);
    if (!Number.isInteger(hg) || !Number.isInteger(ag)) { errs.push(`${id}: marcador no numérico`); continue; }
    const decisive = hg > ag ? m.home : ag > hg ? m.away : null;
    if (decisive) {
      if (decisive !== m.q) errs.push(`${id}: gana ${decisive} por marcador pero q:${m.q}`);
      if (m.pen) errs.push(`${id}: no debería haber penaltis sin empate`);
    } else {
      if (!m.pen) errs.push(`${id}: empate sin penaltis`);
      else if (!validShootout(m.pen.a, m.pen.b)) errs.push(`${id}: penaltis imposibles ${m.pen.a}-${m.pen.b}`);
      else if ((m.pen.a > m.pen.b ? m.home : m.away) !== m.q) errs.push(`${id}: la tanda no coincide con q:${m.q}`);
    }
  }
  // Semifinalistas del bloque = los del usuario (no se pueden cambiar).
  const blockTeams = new Set();
  for (const id of ["M101", "M102"]) { const m = block.matches[id]; if (m) { blockTeams.add(m.home); blockTeams.add(m.away); } }
  for (const t of blockTeams) if (!semifinalistas.has(t)) errs.push(`equipo ${t} no está entre tus semifinalistas`);

  // Lo intocable: campeón y 4.º.
  const m104 = block.matches.M104, m103 = block.matches.M103;
  const newChamp = block.champ || (m104 && m104.q);
  if (newChamp !== origChamp) errs.push(`campeón ${newChamp} ≠ tu campeón original ${origChamp} (debe mantenerse)`);
  if (m103) {
    const newFourth = m103.q === m103.home ? m103.away : m103.home;
    if (newFourth !== origFourth) errs.push(`4.º ${newFourth} ≠ tu 4.º original ${origFourth} (debe mantenerse)`);
  }
  return errs;
}

function applyBlock(block) {
  const nick = block.nick;
  const file = fileForNick(nick);
  if (!file) return { nick, ok: false, errs: [`nick "${nick}" no está en registry.json`] };
  const path = join(root, "data/submissions", file);
  const text = readFileSync(path, "utf8");
  const orig = parsePrediction(text);
  const errs = validate(block, orig);
  if (errs.length) return { nick, ok: false, errs };

  // Reemplazo por prefijo de línea (respeta la sección de cada cruce).
  let out = text;
  for (const id of ["M101", "M102", "M103", "M104"]) {
    const m = block.matches[id];
    const line = `${id} ${m.hs} ${m.as} ${m.home} ${m.hg} ${m.ag} ${m.away} q:${m.q}${m.pen ? ` pen:${m.pen.a}-${m.pen.b}` : ""}`;
    const re = new RegExp(`^${id} .*$`, "m");
    if (!re.test(out)) return { nick, ok: false, errs: [`no encuentro la línea ${id} en ${file}`] };
    out = out.replace(re, line);
  }
  out = out.replace(/^campeon:.*$/m, `campeon: ${block.champ}`);

  const changed = out !== text;
  if (!CHECK_ONLY && changed) writeFileSync(path, out);
  return { nick, ok: true, file, changed, wrote: !CHECK_ONLY && changed };
}

// ── main ────────────────────────────────────────────────────────────────
const arg = process.argv.slice(2).find((a) => !a.startsWith("--"));
const input = arg ? readFileSync(arg, "utf8") : readFileSync(0, "utf8");
const blocks = splitBlocks(input);
if (!blocks.length) { console.error("No hay ningún bloque FIX_SEMIS_V1 en la entrada."); process.exit(1); }

let fail = 0;
for (const raw of blocks) {
  const block = parseBlock(raw);
  const res = applyBlock(block);
  if (!res.ok) {
    fail++;
    console.error(`✗ ${res.nick}: ${res.errs.join(" · ")}`);
  } else if (!res.changed) {
    console.log(`= ${res.nick}: ya estaba aplicado (sin cambios).`);
  } else {
    console.log(`${res.wrote ? "✓" : "○"} ${res.nick}: ${res.wrote ? "aplicado" : "válido (–check, no escrito)"} en ${res.file}`);
  }
}
console.log(`\n${blocks.length - fail}/${blocks.length} bloques OK${fail ? ` · ${fail} con errores` : ""}${CHECK_ONLY ? " · modo --check (no se escribió nada)" : ""}`);
process.exit(fail ? 1 : 0);
