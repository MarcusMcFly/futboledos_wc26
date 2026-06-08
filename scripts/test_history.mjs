// Test de movimiento de ranking / top movers (Fase 5). node scripts/test_history.mjs
import { computeMovements, topMovers, newLeader } from "../js/history.js";

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

console.log(`\nhistory: ${pass} OK, ${fail} fallos`);
process.exit(fail ? 1 : 0);
