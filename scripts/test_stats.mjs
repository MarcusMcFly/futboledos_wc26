// Test de las estadísticas de engagement (Fase 4). node scripts/test_stats.mjs
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import {
  groupMatchDistribution, contrarianOutcome, exactHeroes, globalAccuracy, championDistribution,
  groupComplete, groupStandings, groupCrossStats,
} from "../js/stats.js";
import { buildLeaderboard } from "../js/leaderboard.js";

let pass = 0, fail = 0;
const eq = (a, e, m) => (JSON.stringify(a) === JSON.stringify(e) ? pass++ :
  (fail++, console.error(`  ✗ ${m}\n      esperado ${JSON.stringify(e)}, obtenido ${JSON.stringify(a)}`)));
const ok = (c, m) => (c ? pass++ : (fail++, console.error(`  ✗ ${m}`)));
const P = (A_01, champion) => ({ nick: "x", groupMatches: { A_01 }, knockout: {}, champion });

// ── Distribución (§5/§14) ────────────────────────────────────────────────────
const preds = [
  P({ home: "MX", away: "ZA", hg: 2, ag: 0 }), // HOME 2-0
  P({ home: "MX", away: "ZA", hg: 1, ag: 0 }), // HOME 1-0
  P({ home: "MX", away: "ZA", hg: 2, ag: 0 }), // HOME 2-0
  P({ home: "MX", away: "ZA", hg: 1, ag: 1 }), // DRAW
  P({ home: "MX", away: "ZA", hg: 0, ag: 2 }), // AWAY
  P({ home: "MX", away: "ZA", hg: 0, ag: 1 }), // AWAY
  P({ home: "MX", away: "ZA", hg: null, ag: null }), // pendiente → ignorado
];
const dist = groupMatchDistribution(preds, "A_01");
eq(dist.total, 6, "distribución: 6 predicciones (ignora pendiente)");
eq([dist.home, dist.draw, dist.away], [3, 1, 2], "distribución: 3 local / 1 empate / 2 visitante");
eq(dist.homePct, 50, "distribución: 50% local");
eq(dist.mostCommon, { score: "2-0", count: 2, pct: round1(2 / 6 * 100) }, "marcador más común 2-0 ×2");

// ── Contrarian (§6): el signo menos elegido ─────────────────────────────────
eq(contrarianOutcome(dist).outcome, "DRAW", "contrarian = empate (1)");
eq(contrarianOutcome(dist).count, 1, "contrarian: 1 voto");

// ── Exact heroes + dificultad (§11) ─────────────────────────────────────────
const official = { groupMatches: { A_01: { home: "MX", away: "ZA", hg: 2, ag: 0 } } };
const h = exactHeroes(preds, official, "A_01");
eq(h.heroes.length, 2, "2 exact-score heroes");
eq(h.signHits, 3, "3 aciertan el signo (HOME_WIN: 2-0, 1-0, 2-0)");
eq(h.label, "Exacto común", "dificultad: 2/6 = 33% → común");
ok(exactHeroes(preds, { groupMatches: { A_01: { hg: null, ag: null } } }, "A_01") === null, "sin resultado → null");

// ── Accuracy global (§13) ────────────────────────────────────────────────────
const board = [{ score: { total: 10 } }, { score: { total: 20 } }];
const acc = globalAccuracy(preds, official, board);
eq(acc.completedMatches, 1, "1 partido jugado");
eq(acc.exactPct, round1(2 / 6 * 100), "exact % global");
eq(acc.avgPointsUser, 15, "media de puntos (10,20)→15");

// ── Favorito de la peña ──────────────────────────────────────────────────────
const champs = championDistribution([P({}, "ES"), P({}, "ES"), P({}, "BR"), P({})]);
eq(champs[0], { id: "ES", count: 2, pct: round1(2 / 3 * 100) }, "campeón más votado ES ×2");
eq(champs.length, 2, "2 campeones distintos (ignora sin campeón)");

// ── Clasificación final + estadísticas cruzadas de un grupo cerrado ──────────
const rules = JSON.parse(readFileSync(
  join(dirname(fileURLToPath(import.meta.url)), "..", "data/scoring_rules.json"), "utf8"));
const M = (home, away, hg, ag) => ({ home, away, hg, ag });
// Grupo A cerrado: MX y KR a 6 (MX gana el directo A_04); ZA y CZ a 3 (ZA gana A_03).
const offA = {
  groupMatches: {
    A_01: M("MX", "ZA", 2, 0), A_02: M("KR", "CZ", 2, 0), A_03: M("CZ", "ZA", 0, 1),
    A_04: M("MX", "KR", 1, 0), A_05: M("CZ", "MX", 1, 0), A_06: M("ZA", "KR", 0, 1),
  },
  groupOrder: { A: ["MX", "KR", "ZA", "CZ"] },
  thirdsKey: null, thirdsQualified: [], knockout: {}, champion: null,
};

ok(groupComplete(offA, "A") === true, "groupComplete: grupo A con 6 partidos");
ok(groupComplete(offA, "B") === false, "groupComplete: grupo B sin partidos");
ok(groupStandings(offA, "B") === null, "groupStandings: null si el grupo no está completo");

const st = groupStandings(offA, "A");
eq(st.map((r) => r.id), ["MX", "KR", "ZA", "CZ"], "standings: orden oficial (head-to-head)");
eq([st[0].pts, st[0].w, st[0].l, st[0].gf, st[0].gc, st[0].dg], [6, 2, 1, 3, 1, 2], "standings MX: 6 pts, +2");
eq([st[2].pts, st[2].dg], [3, -2], "standings ZA (3.º): 3 pts, -2");

// 4 predicciones con distinto acierto del orden del grupo A.
const ord = (nick, A) => ({ nick, groupMatches: {}, groupOrder: { A }, thirdsKey: null, thirdsQualified: [], knockout: {}, champion: null });
const preds2 = [
  ord("P1", ["MX", "KR", "ZA", "CZ"]), // orden exacto (héroe)
  ord("P2", ["MX", "KR", "CZ", "ZA"]), // 1.º + top-2 ok
  ord("P3", ["KR", "MX", "CZ", "ZA"]), // top-2 ok, 1.º no
  ord("P4", ["ZA", "CZ", "MX", "KR"]), // nada
];
const boardA = buildLeaderboard(preds2.map((p) => ({ nick: p.nick, prediction: p })), offA, rules);
const predByNick = new Map(preds2.map((p) => [p.nick, p]));
const cs = groupCrossStats(boardA, predByNick, offA, "A");
eq([cs.total, cs.winner, cs.top2, cs.full], [4, 2, 3, 1], "cross: 4 pred, 2 acertaron 1.º, 3 top-2, 1 orden completo");
eq([cs.winnerPct, cs.top2Pct, cs.fullPct], [50, 75, 25], "cross: porcentajes 50/75/25");
eq(cs.heroes, ["P1"], "cross: héroe de orden completo = P1");
eq(cs.avgPoints, 10, "cross: media de puntos del grupo = 10 (23+13+4+0)/4");
eq(cs.perPos.map((p) => p.pct), [50, 50, 25, 25], "cross: % predicho en cada posición");
eq([cs.surprise.id, cs.surprise.avgPredPos, cs.surprise.actualPos], ["CZ", 3, 4], "cross: sorpresa = CZ (3.0 → 4)");
ok(groupCrossStats(boardA, predByNick, offA, "B") === null, "cross: null si el grupo no está completo");

function round1(n) { return Math.round(n * 10) / 10; }
console.log(`\nstats: ${pass} OK, ${fail} fallos`);
process.exit(fail ? 1 : 0);
