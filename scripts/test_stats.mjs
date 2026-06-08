// Test de las estadísticas de engagement (Fase 4). node scripts/test_stats.mjs
import {
  groupMatchDistribution, contrarianOutcome, exactHeroes, globalAccuracy, championDistribution,
} from "../js/stats.js";

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

function round1(n) { return Math.round(n * 10) / 10; }
console.log(`\nstats: ${pass} OK, ${fail} fallos`);
process.exit(fail ? 1 : 0);
