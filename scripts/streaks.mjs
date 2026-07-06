// Imprime las RACHAS (streaks) actuales: liderato, escaladas, permanencia en lo
// alto y récords personales. SOLO LECTURA: no escribe nada. Uso (raíz del repo):
//
//   node scripts/streaks.mjs
//
// Combina todo el histórico de cortes (data/snapshots) con la clasificación
// actual derivada de data/official/results.txt. Es la misma lógica que alimenta
// el panel «Rachas» de la web (js/history.js). Ejecútalo DESPUÉS de editar
// results.txt para que la racha incluya la actualización recién registrada.
import { readFileSync, existsSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { loadCurrentBoard } from "./snapshot.mjs";
import { computeStreaks, benchmarkCrossings } from "../js/history.js";

const BENCHMARK_NICK = "JesusGG"; // participante de referencia (ver js/visualizer.js)

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const read = (p) => readFileSync(join(root, p), "utf8");

const indexPath = join(root, "data/snapshots/index.json");
const index = existsSync(indexPath) ? JSON.parse(read("data/snapshots/index.json")) : { snapshots: [] };
const snapshots = (index.snapshots || []).map((f) => JSON.parse(read(`data/snapshots/${f}`)));

const { board } = loadCurrentBoard();
const { badges, relegation, zones, bubble, hasHistory } = computeStreaks(board, snapshots);
const lastSnapshot = snapshots.length ? snapshots[snapshots.length - 1] : null;
const cross = benchmarkCrossings(board, lastSnapshot, BENCHMARK_NICK);
const hasCross = cross.present && (cross.passed.length || cross.droppedBehind.length);

if (!hasHistory) {
  console.log("Sin histórico suficiente para rachas (hace falta al menos un corte previo).");
  process.exit(0);
}
const hasZones = (zones && zones.length) || bubble;
if (!badges.length && !relegation.length && !hasZones && !hasCross) {
  console.log("No hay rachas destacables ahora mismo.");
  process.exit(0);
}
if (badges.length) {
  console.log("Rachas actuales:");
  for (const b of badges) console.log(`  ${b.icon} ${b.nick}: ${b.text}`);
}
if (bubble) console.log(`En la burbuja (puesto 5):\n  🫧 ${bubble.nick}: ${bubble.streak} actualizaciones en la burbuja`);
for (const z of zones || []) {
  console.log(`${z.label} (${z.note}):`);
  for (const m of z.members) console.log(`  ${z.icon} ${m.nick}: ${m.streak} actualizaciones en ${z.word}`);
}
if (relegation.length) {
  console.log("Zona de descenso (3 últimos puestos):");
  for (const r of relegation) console.log(`  🔻 ${r.nick}: ${r.streak} actualizaciones en descenso`);
}
if (hasCross) {
  console.log(`La línea de ${BENCHMARK_NICK} (última actualización):`);
  if (cross.passed.length) console.log(`  🟡 adelantaron a ${BENCHMARK_NICK}: ${cross.passed.join(", ")}`);
  if (cross.droppedBehind.length) console.log(`  🔨 ${BENCHMARK_NICK} adelantó a: ${cross.droppedBehind.join(", ")}`);
}
