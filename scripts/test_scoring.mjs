// Test del motor de puntuación (Fase 2). Reproduce los ejemplos numéricos de
// SPEC 06 y valida contra los datos reales. Ejecutar: node scripts/test_scoring.mjs
import { readFileSync, readdirSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { parsePrediction } from "../js/parse_prediction.js";
import {
  scoreGroupMatch, scoreGroupRanking, scoreBestThirds, scoreKnockoutMatch,
  scoreProgression, scoreParticipant,
} from "../js/scoring.js";
import { buildLeaderboard } from "../js/leaderboard.js";
import { buildPoolRanking } from "../js/pools.js";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const rules = JSON.parse(readFileSync(join(root, "data/scoring_rules.json"), "utf8"));

let pass = 0, fail = 0;
const eq = (a, e, m) => (JSON.stringify(a) === JSON.stringify(e) ? pass++ :
  (fail++, console.error(`  ✗ ${m}\n      esperado ${JSON.stringify(e)}, obtenido ${JSON.stringify(a)}`)));
const ok = (c, m) => (c ? pass++ : (fail++, console.error(`  ✗ ${m}`)));
const gm = (hg, ag) => ({ hg, ag });

// ── SPEC §5.5 · Partido de grupo ─────────────────────────────────────────────
eq(scoreGroupMatch(gm(2, 0), gm(2, 0), rules).points, 5, "§5.5 marcador exacto = 5");
eq(scoreGroupMatch(gm(3, 1), gm(2, 0), rules).points, 3, "§5.5 resultado+DG = 3");
eq(scoreGroupMatch(gm(1, 0), gm(2, 0), rules).points, 3, "§5.5 resultado+gol visitante = 3");
eq(scoreGroupMatch(gm(1, 1), gm(2, 0), rules).points, 0, "§5.5 resultado incorrecto = 0");

// ── SPEC §6 · Ranking de grupo ───────────────────────────────────────────────
const noKey = new Set(), keyH = new Set(["H"]);
eq(scoreGroupRanking(["ES", "CV", "UY", "SA"], ["ES", "UY", "CV", "SA"], "H", noKey, noKey, rules).positions, 7,
  "§6.1 puntos de posición = 7 (1º y 4º)");
eq(scoreGroupRanking(["ES", "CV", "UY", "SA"], ["ES", "UY", "CV", "SA"], "H", keyH, keyH, rules).qualified, 3,
  "§6.2 clasificados correctos = 3");
const full = scoreGroupRanking(["ES", "UY", "CV", "SA"], ["ES", "UY", "CV", "SA"], "H", keyH, keyH, rules);
eq(full.positions, 14, "§6.3 posiciones completas = 14");
ok(full.completeOrder === true, "§6.3 bonus de orden completo");
eq(full.points, 25, "§6.4 máximo por grupo = 25");

// ── SPEC §7 · Mejores terceros ───────────────────────────────────────────────
const t1 = scoreBestThirds("ABCDEFGH", "ABCEFGHI", rules);
eq(t1.correct, 7, "§7.1 terceros acertados = 7");
eq(t1.points, 21, "§7.1 puntos terceros = 21");
ok(t1.fullKey === false, "§7.1 clave no completa");
const t2 = scoreBestThirds("ABCEFGHI", "ABCEFGHI", rules);
eq(t2.points, 32, "§7.2 clave completa = 24+8 = 32");
ok(t2.fullKey === true, "§7.2 clave completa detectada");

// ── SPEC §8 · Partido de eliminatoria ────────────────────────────────────────
eq(scoreKnockoutMatch(
  { home: "BRA", away: "SWE", hg: 1, ag: 0, qualified: "BRA" },
  { home: "BRA", away: "SWE", hg: 1, ag: 0, qualified: "BRA" }, rules, "R32").points, 13,
  "§8.3 exacto+fixture+clasificado = 13");
eq(scoreKnockoutMatch(
  { home: "BRA", away: "SWE", hg: 2, ag: 1, qualified: "BRA" },
  { home: "BRA", away: "URU", hg: 1, ag: 0, qualified: "BRA" }, rules, "R32").points, 6,
  "§8.5 clasificado correcto con fixture parcial = 6");

// ── SPEC §10.2 · Progresión (alcance acumulado) ──────────────────────────────
const reachBRA = scoreProgression(
  { knockout: { M73: { round: "DIECISEISAVOS", home: "BRA", away: null }, M89: { round: "OCTAVOS", home: "BRA", away: null }, M97: { round: "CUARTOS", home: "BRA", away: null }, M101: { round: "SEMIS", home: "BRA", away: null } } },
  { knockout: { M73: { round: "DIECISEISAVOS", home: "BRA", away: null }, M89: { round: "OCTAVOS", home: "BRA", away: null }, M97: { round: "CUARTOS", home: "BRA", away: null } } },
  rules);
eq(reachBRA.points, 12, "§10.2 predijo SF, llegó a QF → 2+4+6 = 12");
const champ = scoreProgression(
  { knockout: { M73: { round: "DIECISEISAVOS", home: "C", away: null }, M89: { round: "OCTAVOS", home: "C", away: null }, M97: { round: "CUARTOS", home: "C", away: null }, M101: { round: "SEMIS", home: "C", away: null }, M104: { round: "FINAL", home: "C", away: null, qualified: "C" } } },
  { knockout: { M73: { round: "DIECISEISAVOS", home: "C", away: null }, M89: { round: "OCTAVOS", home: "C", away: null }, M97: { round: "CUARTOS", home: "C", away: null }, M101: { round: "SEMIS", home: "C", away: null }, M104: { round: "FINAL", home: "C", away: null, qualified: "C" } } },
  rules);
eq(champ.points, 47, "§10.3 campeón acertado → 2+4+6+10+25 = 47");

// ── Integración: datos reales ────────────────────────────────────────────────
const official = parsePrediction(readFileSync(join(root, "data/official/results.txt"), "utf8"));
const subs = readdirSync(join(root, "data/submissions")).filter((f) => f.endsWith(".txt"))
  .map((f) => ({ nick: f.replace(".txt", ""), prediction: parsePrediction(readFileSync(join(root, "data/submissions", f), "utf8")) }));

// Auto-puntuación: el oficial contra sí mismo = máximo de la fase de grupos.
const self = scoreParticipant(official, official, rules);
eq(self.details.exact_group_scores, 72, "auto-score: 72 marcadores de grupo exactos");
eq(self.score.group_match_points, 360, "auto-score: 72×5 = 360 pts de grupo");
eq(self.details.correct_group_winners, 12, "auto-score: 12 ganadores de grupo");
ok(self.breakdown.bestThirds.fullKey === true, "auto-score: clave de terceros completa");
eq(self.details.correct_qualified_knockout_teams, 0, "auto-score: KO pendiente en el oficial → 0 clasificados");

// Leaderboard de los 5 participantes contra el oficial de ejemplo.
const board = buildLeaderboard(subs, official, rules);
ok(board.every((s, i) => i === 0 || board[i - 1].score.total >= s.score.total), "leaderboard ordenado por total ↓");
ok(board[0].rank === 1, "primer puesto = rank 1");

console.log("\n=== Leaderboard individual (vs oficial de ejemplo: grupos jugados, KO por jugar) ===");
console.log("Pos Nick           Total  Grupos Ranking 3os  Exactos GanaGrupo");
for (const s of board) {
  console.log(
    String(s.rank).padStart(2) + "  " + s.nick.padEnd(13) +
    String(s.score.total).padStart(5) +
    String(s.score.group_match_points).padStart(7) +
    String(s.score.group_ranking_points).padStart(8) +
    String(s.score.best_third_points).padStart(5) +
    String(s.details.exact_scores).padStart(7) +
    String(s.details.correct_group_winners).padStart(9));
}

// Pool ranking.
const reg = JSON.parse(readFileSync(join(root, "data/registry.json"), "utf8"));
const byNick = new Map(board.map((s) => [s.nick, s]));
const pr = buildPoolRanking(reg.pools, byNick, rules);
console.log("\n=== Ranking de pools (media por activo, SPEC 07) ===");
for (const p of pr.eligible)
  console.log("  #" + p.rank + " " + p.name.padEnd(18) + " media " + p.average.toFixed(1) + "  (total " + p.totalPoints + ", " + p.activeCount + " activos)");
for (const p of pr.notEligible)
  console.log("  -- " + p.name.padEnd(18) + " media " + p.average.toFixed(1) + "  NO ELEGIBLE (" + p.activeCount + " activo/s)");

console.log(`\nscoring: ${pass} OK, ${fail} fallos`);
process.exit(fail ? 1 : 0);
