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

// ── Cruces respecto a un participante de referencia (benchmark) ──────────────
// JesusGG es un participante "de referencia" muy conocido: sirve de vara de medir.
// En la última actualización (último snapshot → tablero actual) detectamos quién
// pasó de estar POR DEBAJO a estar POR ENCIMA de él, y al revés. Se compara la
// posición RELATIVA al benchmark en cada momento, así que vale aunque el propio
// benchmark se mueva. Empates (mismo puesto) no cuentan como cruce (lado ambiguo).
/**
 * @param {object[]} board  clasificación actual (de buildLeaderboard)
 * @param {object|null} snapshot  último snapshot commiteado
 * @param {string} benchmarkNick
 * @returns {{ present: boolean, benchmark?: string, passed: string[], droppedBehind: string[] }}
 */
export function benchmarkCrossings(board, snapshot, benchmarkNick) {
  const rankings = (snapshot && snapshot.rankings) || [];
  const empty = { present: false, passed: [], droppedBehind: [] };
  if (!rankings.length || !board.length) return empty;
  const prev = new Map(rankings.map((r) => [r.nick, r.rank]));
  const now = new Map(board.map((s) => [s.nick, s.rank]));
  const prevB = prev.get(benchmarkNick), nowB = now.get(benchmarkNick);
  if (prevB == null || nowB == null) return empty; // el benchmark no está en ambos
  const passed = [], droppedBehind = [];
  for (const s of board) {
    if (s.nick === benchmarkNick) continue;
    const p = prev.get(s.nick), n = now.get(s.nick);
    if (p == null || n == null) continue;
    if (p > prevB && n < nowB) passed.push(s.nick);            // debajo → encima
    else if (p < prevB && n > nowB) droppedBehind.push(s.nick); // encima → debajo
  }
  return { present: true, benchmark: benchmarkNick, passed, droppedBehind };
}

// ── Rachas (streaks) sobre el histórico completo de snapshots ────────────────
// El "Movimiento" solo mira el último corte. Las rachas miran TODA la serie de
// snapshots + el tablero actual como línea temporal de "jornadas", y destacan
// tendencias sostenidas y positivas: liderato, escaladas, permanencia en lo alto
// y récords personales. Cada racha se cuenta desde la jornada más reciente hacia
// atrás y se corta en cuanto deja de cumplirse (o falta el dato).

/**
 * Línea temporal de rangos: un Map<nick,rank> por estado, de más antiguo a más
 * reciente, terminando con el tablero actual (la jornada en curso).
 * @returns {Map<string,number>[]}
 */
function buildRankTimeline(board, snapshots) {
  const states = (snapshots || []).map(
    (snap) => new Map(((snap && snap.rankings) || []).map((r) => [r.nick, r.rank])));
  states.push(new Map(board.map((s) => [s.nick, s.rank])));
  return states;
}

// Nº de estados más recientes consecutivos cuyo rango cumple pred (corta en hueco).
// pred recibe (rank, state) para poder depender del tamaño del estado (p. ej. la
// zona de descenso, que son los 3 últimos puestos del total de esa jornada).
function trailingStates(states, nick, pred) {
  let c = 0;
  for (let i = states.length - 1; i >= 0; i--) {
    const state = states[i];
    const rank = state.get(nick);
    if (rank == null || !pred(rank, state)) break;
    c++;
  }
  return c;
}

// Nº de actualizaciones más recientes consecutivas en las que el rango mejoró
// (subir = el número de puesto baja). Un empate de puesto corta la racha.
function trailingClimb(states, nick) {
  let c = 0;
  for (let i = states.length - 1; i >= 1; i--) {
    const cur = states[i].get(nick), prev = states[i - 1].get(nick);
    if (cur == null || prev == null || cur >= prev) break;
    c++;
  }
  return c;
}

// ¿El puesto actual es el mejor (más alto) de toda su historia? Solo cuenta como
// logro fresco si supera estrictamente cualquier puesto previo (récord nuevo).
function isNewPersonalBest(states, nick) {
  const last = states[states.length - 1].get(nick);
  if (last == null) return false;
  let best = Infinity;
  for (let i = 0; i < states.length - 1; i++) {
    const r = states[i].get(nick);
    if (r != null && r < best) best = r;
  }
  return best !== Infinity && last < best;
}

// Zona de descenso = los 3 últimos puestos del total de esa jornada. Un rango está
// en zona si `rank >= size - 2` (con 24 participantes: puestos 22, 23 y 24).
const inDropZone = (rank, state) => rank >= state.size - 2;

/**
 * Rachas activas de cada participante. Para repartir protagonismo, los logros
 * POSITIVOS se quedan con UN destacado por persona (el más vistoso) en `badges`.
 * Aparte, `relegation` lista a quien lleva ≥2 jornadas seguidas en la zona de
 * descenso (3 últimos puestos); esos quedan excluidos de los destacados positivos.
 * Vacía si no hay histórico suficiente (hace falta ≥1 corte previo).
 * @param {object[]} board  clasificación actual (de buildLeaderboard)
 * @param {object[]} snapshots  todos los snapshots en orden cronológico
 * @returns {{ badges: {nick:string, icon:string, kind:string, text:string, weight:number}[], relegation: {nick:string, streak:number}[], hasHistory: boolean }}
 */
export function computeStreaks(board, snapshots) {
  const states = buildRankTimeline(board, snapshots);
  const hasHistory = states.length >= 2; // al menos un corte previo + la jornada actual
  if (!hasHistory) return { badges: [], relegation: [], hasHistory: false };

  // La zona de descenso solo tiene sentido con un campo lo bastante grande para
  // que los 3 últimos puestos no sean (casi) toda la tabla.
  const size = states[states.length - 1].size;
  const zoneActive = size >= 6;

  const badges = [];
  const relegation = [];
  for (const s of board) {
    const nick = s.nick;
    // Zona de descenso (racha negativa): si está ahí ahora y lleva ≥2 jornadas,
    // va a su lista propia y no compite por los destacados positivos.
    if (zoneActive && inDropZone(s.rank, states[states.length - 1])) {
      const drop = trailingStates(states, nick, inDropZone);
      if (drop >= 2) { relegation.push({ nick, streak: drop }); continue; }
    }
    const cands = [];
    const leader = trailingStates(states, nick, (r) => r === 1);
    if (leader >= 2) cands.push({ nick, icon: "👑", kind: "leader",
      text: `${leader} jornadas como líder`, weight: 1000 + leader });
    const climb = trailingClimb(states, nick);
    if (climb >= 2) cands.push({ nick, icon: "🔥", kind: "climb",
      text: `${climb} actualizaciones subiendo`, weight: 700 + climb });
    const top3 = trailingStates(states, nick, (r) => r <= 3);
    if (top3 >= 3) cands.push({ nick, icon: "🥉", kind: "top3",
      text: `${top3} jornadas en el podio`, weight: 500 + top3 });
    const top5 = trailingStates(states, nick, (r) => r <= 5);
    if (top5 >= 4) cands.push({ nick, icon: "⭐", kind: "top5",
      text: `${top5} jornadas en el top 5`, weight: 300 + top5 });
    if (isNewPersonalBest(states, nick)) cands.push({ nick, icon: "📈", kind: "best",
      text: `mejor puesto hasta la fecha (#${s.rank})`, weight: 200 });
    if (cands.length) {
      cands.sort((a, b) => b.weight - a.weight);
      badges.push(cands[0]);
    }
  }
  badges.sort((a, b) => b.weight - a.weight);
  relegation.sort((a, b) => b.streak - a.streak || a.nick.localeCompare(b.nick));
  return { badges, relegation, hasHistory: true };
}
