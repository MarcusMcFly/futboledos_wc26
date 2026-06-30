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
import { computeStreaks } from "../js/history.js";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const read = (p) => readFileSync(join(root, p), "utf8");

const indexPath = join(root, "data/snapshots/index.json");
const index = existsSync(indexPath) ? JSON.parse(read("data/snapshots/index.json")) : { snapshots: [] };
const snapshots = (index.snapshots || []).map((f) => JSON.parse(read(`data/snapshots/${f}`)));

const { board } = loadCurrentBoard();
const { badges, relegation, hasHistory } = computeStreaks(board, snapshots);

if (!hasHistory) {
  console.log("Sin histórico suficiente para rachas (hace falta al menos un corte previo).");
  process.exit(0);
}
if (!badges.length && !relegation.length) {
  console.log("No hay rachas destacables ahora mismo.");
  process.exit(0);
}
if (badges.length) {
  console.log("Rachas actuales:");
  for (const b of badges) console.log(`  ${b.icon} ${b.nick}: ${b.text}`);
}
if (relegation.length) {
  console.log("Zona de descenso (3 últimos puestos):");
  for (const r of relegation) console.log(`  🔻 ${r.nick}: ${r.streak} jornadas en descenso`);
}
