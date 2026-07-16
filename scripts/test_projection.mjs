// Test de la proyección de techo/escenarios (ficha de usuario). node scripts/test_projection.mjs
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { bestDreamFor, buildDreamOfficial, ceilingFor, projectUser, repairSemiPairing } from "../js/projection.js";
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

// ── El sueño no regala puntos en los cruces que le dan igual al soñador ──────
// XF sueña con ZZ en M74, pero M74 lo juegan AR y BR: pase quien pase, XF no puntúa el
// clasificado. Antes el sueño coronaba al LOCAL (AR) por defecto, lo que regalaba puntos a
// quien hubiera pronosticado AR y podía hundir a XF un puesto sin que nada de su quiniela lo
// justificara. Ante la indiferencia, el desempate debe caer del lado de XF.
const xFree = P("XF", { home: "ZA", away: "CA", hg: 0, ag: 1, qualified: "CA" },
                      { home: "ZZ", away: "YY", hg: 1, ag: 0, qualified: "ZZ" });
const rAR = P("RAR", { home: "ZA", away: "CA", hg: 0, ag: 1, qualified: "CA" },
                     { home: "AR", away: "BR", hg: 1, ag: 0, qualified: "AR" });
const rBR = P("RBR", { home: "ZA", away: "CA", hg: 0, ag: 1, qualified: "CA" },
                     { home: "AR", away: "BR", hg: 0, ag: 1, qualified: "BR" });
eq(buildDreamOfficial(xFree, official).knockout.M74.qualified, "AR",
  "compat: buildDreamOfficial resuelve el cruce libre por el local");
const meanDream = bestDreamFor(xFree, official, rules, [rAR]);
eq(meanDream.knockout.M74.qualified, "BR",
  "sueño sin regalos: en un cruce que le da igual, no corona al equipo que pronosticó el rival");
ok(scoreParticipant(rAR, meanDream, rules).score.total
   < scoreParticipant(rAR, buildDreamOfficial(xFree, official), rules).score.total,
  "el rival puntúa menos en el sueño sin regalos que con el viejo fallback al local");
// Y romper el empate a su favor no le cuesta a XF ni un punto: su techo es el mismo.
eq(scoreParticipant(xFree, meanDream, rules).score.total, ceilingFor(xFree, official, rules),
  "el sueño sin regalos mantiene intacto el techo de XF");
// Tampoco se regala el marcador exacto: con rivales en ambos lados, gane quien gane el
// marcador elegido no debe coincidir con el de ninguno.
const m74 = bestDreamFor(xFree, official, rules, [rAR, rBR]).knockout.M74;
ok(![rAR, rBR].some((r) => r.knockout.M74.hg === m74.hg && r.knockout.M74.ag === m74.ag),
  "el marcador de un cruce libre no coincide con el de ningún rival (no se acredita el exacto)");

// El techo NO puede depender de una decisión arbitraria del código: es el máximo sobre todos
// los desenlaces de los cruces libres, no el que salga de coronar al local.
ok(ceilingFor(xFree, official, rules) >= scoreParticipant(xFree, buildDreamOfficial(xFree, official), rules).score.total,
  "el techo nunca es menor que el del sueño con fallback al local");

// ── repairSemiPairing: reempareja las semis buggeadas (solo proyección) ───────
// Cuadro con el bug (M101 = W97-W99 / M102 = W98-W100). Clasificación original del
// participante: campeón A, subcampeón B, 3.º C, 4.º D. Semifinalistas: A,B (arriba) y C,D.
const kk = (round, hs, as, home, away, qualified) =>
  ({ round, home_slot: hs, away_slot: as, home, away, hg: qualified === home ? 1 : 0, ag: qualified === home ? 0 : 1, qualified, pen: null });
const bugged = {
  nick: "BUG", groupMatches: {}, groupOrder: {}, thirdsKey: null, thirdsQualified: [], champion: "A", generadoAt: null,
  knockout: {
    M97: kk("CUARTOS", "W89", "W90", "A", "x", "A"),
    M98: kk("CUARTOS", "W93", "W94", "B", "y", "B"),
    M99: kk("CUARTOS", "W91", "W92", "C", "z", "C"),
    M100: kk("CUARTOS", "W95", "W96", "D", "w", "D"),
    M101: kk("SEMIS", "W97", "W99", "A", "C", "A"),   // bug: empareja W97 con W99
    M102: kk("SEMIS", "W98", "W100", "B", "D", "B"),  // bug: empareja W98 con W100
    M103: kk("TERCER_PUESTO", "L101", "L102", "C", "D", "C"),
    M104: kk("FINAL", "W101", "W102", "A", "B", "A"),
  },
};
const fixed = repairSemiPairing(bugged);
eq([fixed.knockout.M101.home_slot, fixed.knockout.M101.away_slot], ["W97", "W98"], "repair: M101 pasa a W97-W98");
eq([fixed.knockout.M101.home, fixed.knockout.M101.away, fixed.knockout.M101.qualified], ["A", "B", "A"], "repair: SF1 = A vs B, avanza el mejor (A)");
eq([fixed.knockout.M102.home, fixed.knockout.M102.away, fixed.knockout.M102.qualified], ["C", "D", "C"], "repair: SF2 = C vs D, avanza el mejor (C)");
eq([fixed.knockout.M104.home, fixed.knockout.M104.away, fixed.knockout.M104.qualified], ["A", "C", "A"], "repair: final = A vs C, campeón A (se mantiene)");
eq([fixed.knockout.M103.qualified, fixed.knockout.M103.home === "B" || fixed.knockout.M103.away === "B"], ["B", true], "repair: 3.er puesto lo gana B (subcampeón original), y D (4.º) sigue ahí");
ok(bugged.knockout.M101.away_slot === "W99", "repair no muta el original (sigue buggeado)");
// Idempotente: un cuadro ya corregido (M101.away_slot === "W98") se devuelve intacto.
ok(repairSemiPairing(fixed) === fixed, "repair: cuadro ya corregido se devuelve sin tocar");
// Cuadro sin semis (el de juguete de arriba, solo dieciseisavos) se devuelve intacto.
ok(repairSemiPairing(x) === x, "repair: sin semis, devuelve el pred tal cual");

console.log(`\nprojection: ${pass} OK, ${fail} fallos`);
process.exit(fail ? 1 : 0);
