// Test de la proyección de techo/escenarios (ficha de usuario). node scripts/test_projection.mjs
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { buildDreamOfficial, ceilingFor, projectUser } from "../js/projection.js";
import { buildLeaderboard } from "../js/leaderboard.js";
import { scoreParticipant } from "../js/scoring.js";

let pass = 0, fail = 0;
const eq = (a, e, m) => (JSON.stringify(a) === JSON.stringify(e) ? pass++ :
  (fail++, console.error(`  ✗ ${m}\n      esperado ${JSON.stringify(e)}, obtenido ${JSON.stringify(a)}`)));
const ok = (c, m) => (c ? pass++ : (fail++, console.error(`  ✗ ${m}`)));

const rules = JSON.parse(readFileSync(
  join(dirname(fileURLToPath(import.meta.url)), "..", "data/scoring_rules.json"), "utf8"));

// ── Escenario mínimo: 1 cruce de dieciseisavos, uno resuelto y otro no ───────
// Bracket de juguete: M73 (resuelto, pasa CA), M74 (sin resolver, AR vs BR).
const ko = (round, home_slot, away_slot, home, away, hg, ag, qualified) =>
  ({ round, home_slot, away_slot, home, away, hg, ag, qualified, pen: null });
const official = {
  groupMatches: {}, groupOrder: {}, thirdsKey: null, thirdsQualified: [], champion: null,
  knockout: {
    M73: ko("DIECISEISAVOS", "1A", "2B", "ZA", "CA", 0, 1, "CA"),   // jugado
    M74: ko("DIECISEISAVOS", "1C", "2D", "AR", "BR", null, null, null), // pendiente
  },
};
const P = (nick, k73, k74) => {
  const knockout = {};
  if (k73) knockout.M73 = { round: "DIECISEISAVOS", home_slot: "1A", away_slot: "2B", ...k73, pen: null };
  if (k74) knockout.M74 = { round: "DIECISEISAVOS", home_slot: "1C", away_slot: "2D", ...k74, pen: null };
  return { nick, groupMatches: {}, groupOrder: {}, thirdsKey: null, thirdsQualified: [], champion: null, generadoAt: null, knockout };
};

// El mundo ideal de X: M73 se mantiene REAL (CA pasó), M74 se cierra como sueña.
const x = P("X", { home: "ZA", away: "CA", hg: 0, ag: 1, qualified: "CA" },
                  { home: "AR", away: "BR", hg: 2, ag: 1, qualified: "AR" });
const dream = buildDreamOfficial(x, official);
eq([dream.knockout.M73.qualified, dream.knockout.M73.hg, dream.knockout.M73.ag], ["CA", 0, 1], "sueño: M73 se mantiene real");
eq([dream.knockout.M74.qualified, dream.knockout.M74.hg, dream.knockout.M74.ag], ["AR", 2, 1], "sueño: M74 se cierra como X pronostica");

// Techo de X = puntos actuales (M73 acertado) + máximo de M74 (cruce+exacto+clasificado).
// Actual: M73 sameFixture + exact(6) + qualified(5) = 11 + progresión (CA en R32 = 2).
const koRules = rules.knockout_match;
const perfMatch = koRules.correct_home_team + koRules.correct_away_team + koRules.exact_score + koRules.correct_qualified_team; // 13
const ceil = ceilingFor(x, official, rules);
const cur = scoreParticipant(x, official, rules).score.total;
ok(ceil - cur >= perfMatch, `techo suma al menos un cruce perfecto de M74 (Δ=${ceil - cur} ≥ ${perfMatch})`);

// ── Un equipo eliminado no puede soñarse campeón / avanzar ───────────────────
// Y sueña que BR (que perdió M73... no: ZA perdió). Probamos: Z pronostica que ZA
// (eliminada en M73) pasa M74 → imposible, no debe acreditarse su clasificado.
const z = P("Z", { home: "ZA", away: "CA", hg: 1, ag: 0, qualified: "ZA" },   // falló M73
                  { home: "AR", away: "BR", hg: 1, ag: 0, qualified: "AR" });
const zc = ceilingFor(z, official, rules);
const zcur = scoreParticipant(z, official, rules).score.total;
ok(zc - zcur >= perfMatch, "techo de Z cuenta M74 (su cruce vivo)");
// El sueño de Z respeta que ZA está eliminada: M73 sigue con CA como clasificada.
eq(buildDreamOfficial(z, official).knockout.M73.qualified, "CA", "sueño: equipo eliminado (ZA) no revive en M73");

// ── projectUser: rangos de rivales y escenarios ──────────────────────────────
const subs = [
  { nick: "X", prediction: x },
  { nick: "Z", prediction: z },
  { nick: "Y", prediction: P("Y", { home: "ZA", away: "CA", hg: 0, ag: 2, qualified: "CA" }, null) }, // solo M73, poco techo
];
const board = buildLeaderboard(subs, official, rules);
const byNick = new Map(board.map((s) => [s.nick, s]));
const predByNick = new Map(subs.map((s) => [s.nick, s.prediction]));
const proj = projectUser("X", { board, byNick, predByNick, official, rules });
ok(proj !== null, "projectUser devuelve datos");
eq(proj.scenarios.map((s) => s.pct), [100, 65, 30], "tres escenarios 100/65/30");
eq(proj.scenarios[0].score, proj.ceiling, "escenario bueno (100%) = techo");
ok(proj.scenarios[0].score >= proj.scenarios[1].score && proj.scenarios[1].score >= proj.scenarios[2].score, "escenarios decrecientes");
ok(proj.remaining === proj.ceiling - proj.current, "remaining = techo - actual");
// Cada rival cae en exactamente un bucket.
const buckets = proj.impossible.length + proj.catchable.length + proj.threat.length + proj.secured.length;
eq(buckets, board.length - 1, "cada rival en un único bucket");
// Y (con solo M73 predicho) tiene poco techo → X (que puede sumar M74) debería tenerlo ganado o como amenaza baja.
ok([...proj.secured, ...proj.threat].some((o) => o.nick === "Y"), "Y clasificado como amenaza/ganado (techo bajo)");

console.log(`\nprojection: ${pass} OK, ${fail} fallos`);
process.exit(fail ? 1 : 0);
