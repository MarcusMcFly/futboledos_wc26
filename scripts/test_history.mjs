// Test de movimiento de ranking / top movers + rachas. node scripts/test_history.mjs
import { computeMovements, topMovers, newLeader, computeStreaks } from "../js/history.js";

let pass = 0, fail = 0;
const eq = (a, e, m) => (JSON.stringify(a) === JSON.stringify(e) ? pass++ :
  (fail++, console.error(`  ✗ ${m}\n      esperado ${JSON.stringify(e)}, obtenido ${JSON.stringify(a)}`)));
const ok = (c, m) => (c ? pass++ : (fail++, console.error(`  ✗ ${m}`)));

const board = [
  { nick: "A", rank: 1, score: { total: 100 } },
  { nick: "B", rank: 2, score: { total: 90 } },
  { nick: "C", rank: 3, score: { total: 80 } },
  { nick: "D", rank: 4, score: { total: 70 } }, // no estaba en el snapshot
];
const snapshot = { rankings: [{ nick: "B", rank: 1 }, { nick: "A", rank: 2 }, { nick: "C", rank: 4 }] };

const mv = computeMovements(board, snapshot);
ok(mv.hasSnapshot === true, "hay snapshot");
eq(mv.map.get("A").movement, 1, "A sube 1 (2→1)");
eq(mv.map.get("B").movement, -1, "B baja 1 (1→2)");
eq(mv.map.get("C").movement, 1, "C sube 1 (4→3)");
ok(mv.map.get("D").isNew === true && mv.map.get("D").movement === null, "D es nuevo (no estaba)");

eq(newLeader(board, snapshot), "A", "nuevo líder = A (antes B)");
eq(topMovers(board, mv).map((m) => m.nick), ["A", "C"], "top movers: A y C (orden por subida y puntos)");

const none = computeMovements(board, null);
ok(none.hasSnapshot === false, "sin snapshot → hasSnapshot false");
eq(none.map.get("A").movement, null, "sin snapshot → movimiento null");
eq(newLeader(board, null), null, "sin snapshot → sin nuevo líder");

// ── Rachas (streaks) ─────────────────────────────────────────────────────────
// Línea temporal (de más antiguo a más reciente): 3 snapshots + el tablero actual.
//   A: 2,1,1,1  → líder en las 3 últimas jornadas (streak 3)
//   B: 1,2,3,6  → cae del top 5 en la última jornada → sin racha positiva
//   C: 5,4,3,2  → sube en las 3 últimas actualizaciones (climb 3) y récord personal
const snaps = [
  { rankings: [{ nick: "A", rank: 2 }, { nick: "B", rank: 1 }, { nick: "C", rank: 5 }] },
  { rankings: [{ nick: "A", rank: 1 }, { nick: "B", rank: 2 }, { nick: "C", rank: 4 }] },
  { rankings: [{ nick: "A", rank: 1 }, { nick: "B", rank: 3 }, { nick: "C", rank: 3 }] },
];
const liveBoard = [
  { nick: "A", rank: 1, score: { total: 100 } },
  { nick: "C", rank: 2, score: { total: 90 } },
  { nick: "B", rank: 6, score: { total: 80 } },
];
const st = computeStreaks(liveBoard, snaps);
ok(st.hasHistory === true, "rachas: hay histórico");
eq(st.badges.map((b) => [b.nick, b.kind]), [["A", "leader"], ["C", "climb"]],
  "rachas: A líder y C escalando (un logro por persona, ordenado por relevancia)");
eq(st.badges[0].text, "3 jornadas como líder", "rachas: texto del liderato de A");
eq(st.badges[1].text, "3 actualizaciones subiendo", "rachas: texto de la escalada de C");
ok(!st.badges.some((b) => b.nick === "B"), "rachas: B no tiene racha positiva");

const noHist = computeStreaks(liveBoard, []);
ok(noHist.hasHistory === false && noHist.badges.length === 0,
  "rachas: sin snapshots → sin histórico ni badges");

console.log(`\nhistory: ${pass} OK, ${fail} fallos`);
process.exit(fail ? 1 : 0);
