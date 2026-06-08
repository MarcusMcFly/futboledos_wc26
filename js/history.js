// Movimiento de ranking y top movers (SPEC 08 §10/§20). Compara la clasificación
// actual (calculada en vivo) contra el último snapshot commiteado. Sin snapshot,
// no hay movimiento (primer arranque).
//
// Un snapshot (data/snapshots/NNN.json) congela la clasificación en un momento:
//   { created_at, rankings: [{ nick, rank, points }], ... }
// Se generan con scripts/snapshot.mjs tras actualizar los resultados oficiales.
// @ts-check

/**
 * @param {object[]} board  clasificación actual (de buildLeaderboard)
 * @param {object|null} snapshot
 * @returns {{ map: Map<string, {rank:number, prevRank:number|null, movement:number|null, isNew:boolean}>, hasSnapshot: boolean }}
 */
export function computeMovements(board, snapshot) {
  const rankings = (snapshot && snapshot.rankings) || [];
  const prev = new Map(rankings.map((r) => [r.nick, r.rank]));
  const hasSnapshot = rankings.length > 0;
  const map = new Map();
  for (const s of board) {
    const prevRank = prev.has(s.nick) ? prev.get(s.nick) : null;
    map.set(s.nick, {
      rank: s.rank,
      prevRank,
      movement: prevRank == null ? null : prevRank - s.rank, // + = sube, − = baja
      isNew: hasSnapshot && prevRank == null,
    });
  }
  return { map, hasSnapshot };
}

/** Mayores escaladas desde el último snapshot (§10). */
export function topMovers(board, movements, n = 5) {
  return board
    .map((s) => ({ nick: s.nick, points: s.score.total, ...movements.map.get(s.nick) }))
    .filter((m) => m.movement != null && m.movement > 0)
    .sort((a, b) => b.movement - a.movement || b.points - a.points)
    .slice(0, n);
}

/** Nuevo líder: el #1 actual difiere del #1 del snapshot. Devuelve el nick o null. */
export function newLeader(board, snapshot) {
  const rankings = (snapshot && snapshot.rankings) || [];
  if (!rankings.length || !board.length) return null;
  const prevLeader = rankings.find((r) => r.rank === 1);
  if (prevLeader && board[0].nick !== prevLeader.nick) return board[0].nick;
  return null;
}
