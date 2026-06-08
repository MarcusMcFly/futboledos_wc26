// Genera un snapshot de la clasificación actual para poder calcular el
// movimiento de ranking (SPEC 08 §20). Uso (desde la raíz del repo):
//
//   node scripts/snapshot.mjs ["etiqueta opcional"]
//
// Escribe data/snapshots/NNN.json con la clasificación congelada y actualiza
// data/snapshots/index.json. Ejecútalo DESPUÉS de actualizar
// data/official/results.txt y antes de publicar, para que la próxima
// actualización muestre las flechas de movimiento. Commitea el resultado.
import { readFileSync, writeFileSync, existsSync, mkdirSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { parsePrediction } from "../js/parse_prediction.js";
import { buildLeaderboard } from "../js/leaderboard.js";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const read = (p) => readFileSync(join(root, p), "utf8");

export function loadCurrentBoard(officialRel = "data/official/results.txt") {
  const rules = JSON.parse(read("data/scoring_rules.json"));
  const registry = JSON.parse(read("data/registry.json"));
  const official = parsePrediction(existsSync(join(root, officialRel)) ? read(officialRel) : "");
  const subs = registry.participants.map((p) => ({
    nick: p.nick, prediction: parsePrediction(read(`data/submissions/${p.file}`)),
  }));
  return { board: buildLeaderboard(subs, official, rules), official };
}

function countCompleted(official) {
  const g = Object.values(official.groupMatches).filter((m) => m.hg != null && m.ag != null).length;
  const k = Object.values(official.knockout).filter((m) => m.hg != null && m.ag != null && m.qualified).length;
  return { group: g, ko: k };
}

export function makeSnapshot(board, official, label) {
  const done = countCompleted(official);
  return {
    schema_version: 1,
    created_at: new Date().toISOString(),
    label: label || null,
    completed_group_matches: done.group,
    completed_ko_matches: done.ko,
    rankings: board.map((s) => ({ nick: s.nick, rank: s.rank, points: s.score.total })),
  };
}

// Ejecutado directamente (no importado): escribe el snapshot.
if (process.argv[1] && process.argv[1].endsWith("snapshot.mjs")) {
  const label = process.argv[2] || null;
  const dir = join(root, "data/snapshots");
  if (!existsSync(dir)) mkdirSync(dir, { recursive: true });
  const indexPath = join(dir, "index.json");
  const index = existsSync(indexPath) ? JSON.parse(readFileSync(indexPath, "utf8")) : { schema_version: 1, snapshots: [] };
  const n = String(index.snapshots.length + 1).padStart(3, "0");
  const file = `${n}.json`;

  const { board, official } = loadCurrentBoard();
  const snap = makeSnapshot(board, official, label);
  writeFileSync(join(dir, file), JSON.stringify(snap, null, 2) + "\n");
  index.snapshots.push(file);
  writeFileSync(indexPath, JSON.stringify(index, null, 2) + "\n");
  console.log(`Snapshot ${file} escrito (${snap.rankings.length} participantes, grupos ${snap.completed_group_matches}/72). Commitéalo.`);
}
