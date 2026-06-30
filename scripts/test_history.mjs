// Test de movimiento de ranking / top movers + rachas. node scripts/test_history.mjs
import { computeMovements, topMovers, newLeader, computeStreaks, benchmarkCrossings } from "../js/history.js";

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
ok(Array.isArray(noHist.relegation) && noHist.relegation.length === 0,
  "rachas: sin histórico → relegation vacío");

// ── Zona de descenso ─────────────────────────────────────────────────────────
// Campo de 6 (zona = 3 últimos puestos: rangos 4,5,6). Rangos constantes en las 4
// jornadas (3 snapshots + tablero): A líder, B/C en podio, D/E/F atascados abajo.
const sixRanks = ["A", "B", "C", "D", "E", "F"].map((nick, i) => ({ nick, rank: i + 1 }));
const dropSnaps = [{ rankings: sixRanks }, { rankings: sixRanks }, { rankings: sixRanks }];
const dropBoard = sixRanks.map((r) => ({ nick: r.nick, rank: r.rank, score: { total: 100 - r.rank } }));
const ds = computeStreaks(dropBoard, dropSnaps);
eq(ds.relegation.map((r) => [r.nick, r.streak]), [["D", 4], ["E", 4], ["F", 4]],
  "descenso: D, E y F llevan 4 jornadas en los 3 últimos puestos");
ok(!ds.badges.some((b) => ["D", "E", "F"].includes(b.nick)),
  "descenso: los relegados NO aparecen en los destacados positivos");
eq(ds.badges.map((b) => [b.nick, b.kind]), [["A", "leader"], ["B", "top3"], ["C", "top3"]],
  "descenso: arriba siguen saliendo los positivos (A líder, B/C podio)");

// Campo pequeño (3): la zona de descenso se desactiva (serían casi todos).
const smallDrop = computeStreaks(
  [{ nick: "X", rank: 1, score: { total: 30 } }, { nick: "Y", rank: 2, score: { total: 20 } }, { nick: "Z", rank: 3, score: { total: 10 } }],
  [{ rankings: [{ nick: "X", rank: 1 }, { nick: "Y", rank: 2 }, { nick: "Z", rank: 3 }] }]);
ok(smallDrop.relegation.length === 0, "descenso: con <6 participantes no hay zona de descenso");

// ── Cruces respecto al benchmark (JesusGG) ───────────────────────────────────
// snapshot: A1 B2 J3 C4 D5  →  ahora: A1 C2 J3 B4 D5 (J fijo en 3).
//   C: 4→2 (debajo→encima de J) = adelantó    ·    B: 2→4 (encima→debajo) = cayó
const bmSnap = { rankings: [{ nick: "A", rank: 1 }, { nick: "B", rank: 2 }, { nick: "J", rank: 3 }, { nick: "C", rank: 4 }, { nick: "D", rank: 5 }] };
const bmBoard = [
  { nick: "A", rank: 1 }, { nick: "C", rank: 2 }, { nick: "J", rank: 3 }, { nick: "B", rank: 4 }, { nick: "D", rank: 5 },
];
const cx = benchmarkCrossings(bmBoard, bmSnap, "J");
ok(cx.present === true, "benchmark: presente en ambos");
eq(cx.passed, ["C"], "benchmark: C adelantó al benchmark (debajo→encima)");
eq(cx.droppedBehind, ["B"], "benchmark: B cayó por detrás (encima→debajo)");

// El benchmark se mueve: snapshot X1 J2 Y3 → ahora J1 X2 Y3. J adelanta a X.
const mvSnap = { rankings: [{ nick: "X", rank: 1 }, { nick: "J", rank: 2 }, { nick: "Y", rank: 3 }] };
const mvBoard = [{ nick: "J", rank: 1 }, { nick: "X", rank: 2 }, { nick: "Y", rank: 3 }];
const cx2 = benchmarkCrossings(mvBoard, mvSnap, "J");
eq(cx2.passed, [], "benchmark móvil: nadie lo adelanta");
eq(cx2.droppedBehind, ["X"], "benchmark móvil: X queda por detrás al adelantarle J");

ok(benchmarkCrossings(bmBoard, bmSnap, "ZZZ").present === false, "benchmark: ausente → present false");
ok(benchmarkCrossings(bmBoard, null, "J").present === false, "benchmark: sin snapshot → present false");

console.log(`\nhistory: ${pass} OK, ${fail} fallos`);
process.exit(fail ? 1 : 0);
