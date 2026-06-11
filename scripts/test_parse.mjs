// Test del parser FUTBOLEDOS_PRED_V1 (Fase 1). Ejecutar: node scripts/test_parse.mjs
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { parsePrediction } from "../js/parse_prediction.js";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");

let pass = 0, fail = 0;
function eq(actual, expected, msg) {
  const a = JSON.stringify(actual), e = JSON.stringify(expected);
  if (a === e) { pass++; }
  else { fail++; console.error(`  ✗ ${msg}\n      esperado: ${e}\n      obtenido: ${a}`); }
}
function ok(cond, msg) { if (cond) pass++; else { fail++; console.error(`  ✗ ${msg}`); } }

// ── 1. Predicción real de Marcus ─────────────────────────────────────────────
const di = parsePrediction(readFileSync(join(root, "data/submissions/Marcus.txt"), "utf8"));
eq(di.nick, "Marcus", "nick");
eq(di.pool, "Quinielas_panda", "pool");
ok(typeof di.generadoAt === "string" && di.generadoAt.length > 0, "generadoAt presente");
eq(Object.keys(di.groupMatches).length, 72, "72 partidos de grupo parseados");
eq(di.groupMatches["A_01"], { home: "MX", away: "ZA", hg: 3, ag: 2 }, "A_01 = MX 3-2 ZA");
eq(di.groupMatches["J_01"], { home: "AR", away: "DZ", hg: 4, ag: 1 }, "J_01 = AR 4-1 DZ");
eq(di.groupMatches["H_01"], { home: "ES", away: "CV", hg: 3, ag: 0 }, "H_01 = ES 3-0 CV");
eq(di.groupOrder["A"], ["MX", "KR", "CZ", "ZA"], "orden grupo A");
eq(di.groupOrder["D"], ["US", "TR", "PY", "AU"], "orden grupo D");
ok(di.tiebreakManual["D"] === true, "grupo D resuelto con desempate manual");
// Marcus está completo: eliminatorias con 32 partidos + campeón.
ok(di.knockoutPending === false, "eliminatorias presentes");
eq(Object.keys(di.knockout).length, 32, "32 partidos de eliminatoria");
ok(!!di.champion, "campeón definido");

// ── 2. Camino con goles "-" (pendiente/sin predecir) ────────────────────────
const partial = parsePrediction([
  "FUTBOLEDOS_PRED_V1",
  "nick: tester",
  "pool: -",
  "",
  "[PARTIDOS]",
  "A_01 MX - - ZA",
  "END_FUTBOLEDOS_PRED_V1",
].join("\n"));
eq(partial.pool, null, "pool '-' → null");
eq(partial.groupMatches["A_01"], { home: "MX", away: "ZA", hg: null, ag: null }, "goles '-' → null");

// ── 3. Parseo de líneas de eliminatoria (R32 + penaltis) ────────────────────
const ko = parsePrediction([
  "FUTBOLEDOS_PRED_V1",
  "nick: tester",
  "",
  "[DIECISEISAVOS]",
  "terceros_clave: ABCEFGHI",
  "terceros_clasificados: A:MX B:CA C:BR E:DE F:NL G:BE H:CV I:SN",
  "M73 2A 2B AR 1 1 DZ q:AR pen:4-3",
  "M74 1E 3ABCDF DE 2 0 SN q:DE",
  "r32_completados: 2/16",
  "",
  "[FINAL]",
  "M104 W101 W102 BR 3 1 FR q:BR",
  "campeon: BR",
  "END_FUTBOLEDOS_PRED_V1",
].join("\n"));
eq(ko.thirdsKey, "ABCEFGHI", "clave de terceros");
eq(ko.thirdsQualified.length, 8, "8 terceros clasificados");
eq(ko.thirdsQualified[0], { group: "A", id: "MX" }, "primer tercero A:MX");
ok(ko.knockoutPending === false, "KO no pendiente cuando hay datos");
eq(ko.knockout["M73"],
  { round: "DIECISEISAVOS", home_slot: "2A", away_slot: "2B", home: "AR", away: "DZ", hg: 1, ag: 1, qualified: "AR", pen: { home: 4, away: 3 } },
  "M73 con penaltis");
eq(ko.knockout["M74"].pen, null, "M74 sin penaltis");
eq(ko.knockout["M104"], { round: "FINAL", home_slot: "W101", away_slot: "W102", home: "BR", away: "FR", hg: 3, ag: 1, qualified: "BR", pen: null }, "final M104");
eq(ko.champion, "BR", "campeón BR");

// ── Resumen ─────────────────────────────────────────────────────────────────
console.log(`\nparse_prediction: ${pass} OK, ${fail} fallos`);
process.exit(fail ? 1 : 0);
