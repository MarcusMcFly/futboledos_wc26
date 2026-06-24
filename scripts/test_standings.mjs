// Test del generador de clasificación oficial (scripts/standings.mjs).
// Cubre: 1º por enfrentamiento directo a igualdad de puntos (caso del usuario),
// triple empate donde el h2h no separa → DG/GF global, empate irresoluble (manual),
// grupo incompleto, idempotencia del parcheo y cruce con el motor de puntuación.
// Ejecutar: node scripts/test_standings.mjs
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { parsePrediction } from "../js/parse_prediction.js";
import { scoreParticipant } from "../js/scoring.js";
import { loadGroups, rankGroup, buildClasificacion, applyClasificacion } from "./standings.mjs";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const rules = JSON.parse(readFileSync(join(root, "data/scoring_rules.json"), "utf8"));
// Base sin [CLASIFICACION] para que el test sea determinista, exista o no la
// sección en el fichero real (el generador puede haberla escrito ya).
const officialText = readFileSync(join(root, "data/official/results.txt"), "utf8")
  .replace(/\n\[CLASIFICACION\][\s\S]*?(?=\n\[DIECISEISAVOS\])/, "");
const groups = loadGroups();
const groupA = groups.find((g) => g.groupId === "A");

let pass = 0, fail = 0;
const eq = (a, e, m) => (JSON.stringify(a) === JSON.stringify(e) ? pass++ :
  (fail++, console.error(`  ✗ ${m}\n      esperado ${JSON.stringify(e)}, obtenido ${JSON.stringify(a)}`)));
const ok = (c, m) => (c ? pass++ : (fail++, console.error(`  ✗ ${m}`)));

// Sustituye las líneas A_0n de [PARTIDOS] por un marcador completo del grupo A.
function withGroupA(text, scores) {
  return text.replace(/^A_0[1-6] .*$/gm, (line) => {
    const id = line.split(/\s+/)[0];
    const s = scores[id];
    const [h, a] = line.match(/^(A_0\d) (\S+) \S+ \S+ (\S+)$/).slice(2);
    return `${id} ${h} ${s.home} ${s.away} ${a}`;
  });
}

// ── rankGroup: 1º decidido por enfrentamiento directo a igualdad de puntos ────
// MX y KR a 6 pts; MX ganó el directo (A_04) → 1º. CZ/ZA a 3, ZA ganó el directo.
const h2hWinner = {
  A_01: { home: 2, away: 0 }, A_02: { home: 2, away: 0 }, A_03: { home: 0, away: 1 },
  A_04: { home: 1, away: 0 }, A_05: { home: 1, away: 0 }, A_06: { home: 0, away: 1 },
};
const r1 = rankGroup(groupA, h2hWinner);
eq(r1.rows, ["MX", "KR", "ZA", "CZ"], "1º por enfrentamiento directo (MX>KR a 6 pts)");
ok(r1.complete && r1.manualSets.length === 0, "grupo completo, sin empate manual");

// ── rankGroup: triple empate; el h2h no separa → DG/GF global ─────────────────
// Ciclo 1-0 (MX>KR>CZ>MX): h2h idéntico (3 pts, DG0, GF1) → cae a DG global.
const cycle = {
  A_01: { home: 5, away: 0 }, A_02: { home: 1, away: 0 }, A_03: { home: 1, away: 0 },
  A_04: { home: 1, away: 0 }, A_05: { home: 1, away: 0 }, A_06: { home: 0, away: 3 },
};
const r2 = rankGroup(groupA, cycle);
eq(r2.rows, ["MX", "KR", "CZ", "ZA"], "triple empate resuelto por DG global (MX+5,KR+3,CZ+1)");
ok(r2.manualSets.length === 0, "ciclo h2h sí resoluble por DG → sin set manual");

// ── rankGroup: empate irresoluble (todo 0-0) → set manual + orden de respaldo ─
const allDraws = Object.fromEntries(
  ["A_01", "A_02", "A_03", "A_04", "A_05", "A_06"].map((id) => [id, { home: 0, away: 0 }]));
const r3 = rankGroup(groupA, allDraws);
eq(r3.manualSets, [["MX", "ZA", "KR", "CZ"]], "empate a 4 irresoluble → set manual completo");
eq(r3.rows, ["MX", "ZA", "KR", "CZ"], "orden de respaldo = orden de dataset (dsIdx)");

// ── buildClasificacion: grupo A completo + resto incompleto ───────────────────
const { lines, warnings } = buildClasificacion(withGroupA(officialText, h2hWinner), groups);
const lineOf = (g) => lines.find((l) => l.startsWith(g + " "));
eq(lineOf("A"), "A 1:MX 2:KR 3:ZA 4:CZ", "línea A completa sin marcador de estado");
ok(lineOf("B").endsWith("(incompleto)"), "grupo B (4/6 jugados) marcado (incompleto)");
eq(warnings.length, 0, "sin avisos cuando no hay empates irresolubles");

// Empate irresoluble emite aviso y marca (empate sin resolver).
const drawText = withGroupA(officialText, allDraws);
const draw = buildClasificacion(drawText, groups);
ok(lineOf2(draw.lines, "A").endsWith("(empate sin resolver)"), "A irresoluble marcado (empate sin resolver)");
ok(draw.warnings.some((w) => w.includes("Grupo A")), "aviso de empate irresoluble en A");
function lineOf2(ls, g) { return ls.find((l) => l.startsWith(g + " ")); }

// Si ya hay línea manual previa para A, se conserva (no se sobrescribe).
const manualText = applyClasificacion(drawText, ["A 1:CZ 2:KR 3:ZA 4:MX (manual)", ...draw.lines.slice(1)]);
const draw2 = buildClasificacion(manualText, groups);
eq(lineOf2(draw2.lines, "A"), "A 1:CZ 2:KR 3:ZA 4:MX (manual)", "conserva el orden manual existente en empate irresoluble");

// Una línea (incompleto) obsoleta NO cuenta como resolución manual: se reemarca.
const staleText = applyClasificacion(drawText, ["A 1:MX 2:ZA 3:KR 4:CZ (incompleto)", ...draw.lines.slice(1)]);
ok(lineOf2(buildClasificacion(staleText, groups).lines, "A").endsWith("(empate sin resolver)"),
  "no conserva una línea (incompleto) obsoleta; reemarca (empate sin resolver)");

// ── applyClasificacion: inserta la sección y es idempotente ───────────────────
const applied = applyClasificacion(withGroupA(officialText, h2hWinner), lines);
ok(/\[CLASIFICACION\]\r?\nA 1:MX 2:KR 3:ZA 4:CZ/.test(applied), "sección [CLASIFICACION] insertada entre [PARTIDOS] y [DIECISEISAVOS]");
ok(applied.indexOf("[CLASIFICACION]") < applied.indexOf("[DIECISEISAVOS]"), "ubicada antes de [DIECISEISAVOS]");
const reapplied = applyClasificacion(applied, buildClasificacion(applied, groups).lines);
eq(reapplied, applied, "reaplicar no cambia el texto (idempotente)");

// ── Cruce con el motor: el grupo cerrado puntúa; los incompletos no ───────────
const off = parsePrediction(applied);
const marcus = parsePrediction(readFileSync(join(root, "data/submissions/Marcus.txt"), "utf8"));
const score = scoreParticipant(marcus, off, rules);
ok(score.breakdown.groupRankDetails.A.status === "scored", "motor puntúa el ranking del grupo A (cerrado)");
ok(score.breakdown.groupRankDetails.B.status === "pending", "motor deja pendiente el grupo B (incompleto)");
ok(score.score.group_ranking_points > 0, "group_ranking_points > 0 tras cerrar el grupo A");

console.log(`\nstandings: ${pass} OK, ${fail} fallos`);
if (fail) process.exit(1);
