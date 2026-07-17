// Test de las estadísticas de engagement (Fase 4). node scripts/test_stats.mjs
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import {
  groupMatchDistribution, contrarianOutcome, exactHeroes, globalAccuracy, championDistribution,
  groupComplete, groupStandings, groupCrossStats, koRoundQualifierLeaders, koRoundFollowers,
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

// Sorpresa solo si la desviación media ≥ 1 posición: si el grupo salió como se
// pronosticó, el equipo de mayor gap (gap 0) NO debe marcarse como sorpresa.
const predsClose = [ord("Q1", ["MX", "KR", "ZA", "CZ"]), ord("Q2", ["MX", "KR", "ZA", "CZ"])];
const boardClose = buildLeaderboard(predsClose.map((p) => ({ nick: p.nick, prediction: p })), offA, rules);
const csClose = groupCrossStats(boardClose, new Map(predsClose.map((p) => [p.nick, p])), offA, "A");
ok(csClose.surprise === null, "cross: sin sorpresa si el grupo salió como se pronosticó (gap < 1)");

// ── Top players por fase de eliminatoria (quién pasa acertado) ───────────────
// Dos cruces resueltos (M73 pasa CA, M74 pasa MA) y uno sin resolver (M75 q:-).
const KO = (round, qualified) => ({ round, hg: qualified ? 1 : null, ag: 0, qualified });
const offKo = {
  knockout: {
    M73: KO("DIECISEISAVOS", "CA"), M74: KO("DIECISEISAVOS", "MA"),
    M75: KO("DIECISEISAVOS", null),                 // sin resolver → no cuenta
    M90: KO("OCTAVOS", null),                       // ronda sin ningún resuelto
  },
};
const kp = (nick, ko) => ({ nick, groupMatches: {}, knockout: ko, champion: null });
const predsKo = [
  kp("A", { M73: { qualified: "CA" }, M74: { qualified: "MA" }, M75: { qualified: "CA" } }), // 2 aciertos
  kp("B", { M73: { qualified: "CA" }, M74: { qualified: "ZA" } }),                            // 1 acierto
  kp("C", { M73: { qualified: "ZA" }, M74: { qualified: "ZA" } }),                            // 0 → excluido
  kp("D", { M73: { qualified: "CA" }, M74: { qualified: "MA" } }),                            // 2 aciertos
];
const lead = koRoundQualifierLeaders(predsKo, offKo, "DIECISEISAVOS");
eq(lead.resolved, 2, "ko-top: 2 cruces resueltos (ignora M75 sin q:)");
eq(lead.leaders.map((r) => [r.nick, r.hits]), [["A", 2], ["D", 2], ["B", 1]],
  "ko-top: ranking por aciertos, empate alfabético, excluye 0");
eq(lead.perfect, 2, "ko-top: 2 con pleno (2/2)");
ok(koRoundQualifierLeaders(predsKo, offKo, "OCTAVOS") === null, "ko-top: null si la ronda no tiene cruces resueltos");

// Set-based: cuenta los equipos que pasan de verdad aunque el participante los ponga
// en otro cruce (otro slot). E cruza CA↔MA de slot: por posición serían 0 aciertos,
// pero ambos pasan → 2 (vayan por el cruce que sea).
const off2 = { knockout: { M73: KO("DIECISEISAVOS", "CA"), M74: KO("DIECISEISAVOS", "MA") } };
const lead2 = koRoundQualifierLeaders(
  [kp("E", { M73: { qualified: "MA" }, M74: { qualified: "CA" } })], off2, "DIECISEISAVOS");
eq(lead2.leaders.map((r) => [r.nick, r.hits]), [["E", 2]],
  "ko-top set-based: cuenta equipos que pasan aunque estén en otro slot");
eq(lead2.perfect, 1, "ko-top set-based: pleno aunque los cruces no coincidan por posición");

// ── koRoundFollowers · quién está "vivo" en las pre-estadísticas ─────────────
const km = (round, home_slot, away_slot, home, away, hg, ag, qualified) =>
  ({ round, home_slot, away_slot, home, away, hg, ag, qualified, pen: null });
const fp = (nick, ko) => ({ nick, groupMatches: {}, knockout: ko, champion: null });

// Semis jugadas: FR y ENG las pierden, así que juegan el tercer puesto; ES y AR, la final.
const offSF = { knockout: {
  M101: km("SEMIS", "W97", "W98", "FR", "ES", 0, 2, "ES"),
  M102: km("SEMIS", "W99", "W100", "ENG", "AR", 1, 2, "AR"),
  M103: km("TERCER_PUESTO", "L101", "L102", "FR", "ENG", null, null, null),
  M104: km("FINAL", "W101", "W102", "ES", "AR", null, null, null),
} };
const fans = [
  fp("A", { M103: { home: "FR", away: "ENG", hg: 1, ag: 0, qualified: "FR" } }),
  fp("B", { M103: { home: "FR", away: "ENG", hg: 0, ag: 1, qualified: "ENG" } }),
];
const third = koRoundFollowers(fans, offSF, "TERCER_PUESTO");
// El bug: perder la semi metía a FR y ENG en "eliminados" y salían tachados con 💀 en las
// pre-estadísticas del partido que estaban a punto de jugar. Perder la semi te manda AL
// tercer puesto; los dos contendientes de un cruce real y sin jugar están vivos por definición.
eq(third.teams.length, 2, "tercer puesto: el roster son los dos perdedores de semis");
ok(third.teams.every((t) => t.alive), "tercer puesto: los perdedores de semis están VIVOS (juegan justo ese partido)");
ok(!third.fromBrackets, "tercer puesto: el roster sale del cruce real, no de las quinielas");
ok(koRoundFollowers(fans, offSF, "FINAL").teams.every((t) => t.alive), "final con finalistas oficiales: ambos vivos");

// Pero cuando la final AÚN no tiene finalistas y el roster se deduce de las quinielas, sí hay
// que marcar a quien ya no puede llegar: ahí `alive:false` es correcto y debe conservarse.
const offPartial = { knockout: {
  M101: km("SEMIS", "W97", "W98", "FR", "ES", 0, 2, "ES"),          // jugada → FR no llega a la final
  M102: km("SEMIS", "W99", "W100", "ENG", "AR", null, null, null),  // pendiente
  M104: km("FINAL", "W101", "W102", null, null, null, null, null),  // sin finalistas todavía
} };
const fbFinal = koRoundFollowers(
  [fp("A", { M104: { home: "FR", away: "AR", hg: 1, ag: 0, qualified: "FR" } })], offPartial, "FINAL");
ok(fbFinal.fromBrackets, "final sin finalistas oficiales: el roster sale de las quinielas");
eq(fbFinal.teams.find((t) => t.id === "FR").alive, false,
  "final desde quinielas: FR perdió su semi y ya no puede llegar → sigue marcándose eliminado");
eq(fbFinal.teams.find((t) => t.id === "AR").alive, true,
  "final desde quinielas: AR sigue vivo (su semi no se ha jugado)");

function round1(n) { return Math.round(n * 10) / 10; }
console.log(`\nstats: ${pass} OK, ${fail} fallos`);
process.exit(fail ? 1 : 0);
