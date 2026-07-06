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

// Bandas de la tabla por PUESTO ABSOLUTO, de arriba (mejor) a abajo. Cada
// participante cae en la banda de su puesto actual y, si lleva ≥2 actualizaciones
// seguidas dentro de ella, se destaca su racha acumulada ahí. La zona de descenso
// (dinámica, 3 últimos puestos) tiene prioridad y se lleva aparte en `relegation`;
// el top-4 no tiene banda (son terreno de los destacados positivos). El puesto 5 es
// la «burbuja»: el filo de la zona efervescente, justo por debajo del top-4.
const BAND_ZONES = [
  { key: "efervescente", label: "Zona efervescente",    note: "puestos 5–8",   word: "efervescencia", icon: "✨", lo: 5,  hi: 8 },
  { key: "mitad-alta",   label: "Zona de mitad-alta",   note: "puestos 9–12",  word: "mitad-alta",    icon: "🔼", lo: 9,  hi: 12 },
  { key: "mitad-baja",   label: "Zona de mitad-baja",   note: "puestos 13–16", word: "mitad-baja",    icon: "🔽", lo: 13, hi: 16 },
  { key: "pre-descenso", label: "Zona de pre-descenso", note: "puestos 17–21", word: "pre-descenso",  icon: "🟠", lo: 17, hi: 21 },
];
const bandOf = (rank) => BAND_ZONES.find((z) => rank >= z.lo && rank <= z.hi) || null;
const inBand = (z) => (rank) => rank >= z.lo && rank <= z.hi;

/**
 * Rachas activas de cada participante. Para repartir protagonismo, los logros
 * POSITIVOS se quedan con UN destacado por persona (el más vistoso) en `badges`.
 * Aparte se mapea el resto de la tabla en bandas por puesto: `bubble` (el puesto 5,
 * si lo ocupa ≥2 actualizaciones seguidas),
 * `zones` (efervescente 5–8, mitad-alta 9–12, mitad-baja 13–16, pre-descenso 17–21)
 * y `relegation` (los 3 últimos puestos). Cada quien cae en UNA sola banda según su
 * puesto actual y queda fuera de los destacados positivos. `zones` solo trae bandas
 * con al menos un miembro (racha ≥2). Vacío si no hay histórico suficiente.
 * @param {object[]} board  clasificación actual (de buildLeaderboard)
 * @param {object[]} snapshots  todos los snapshots en orden cronológico
 * @returns {{ badges: {nick:string, icon:string, kind:string, text:string, weight:number}[], relegation: {nick:string, streak:number}[], zones: {key:string, label:string, note:string, word:string, icon:string, members:{nick:string, streak:number}[]}[], bubble: {nick:string, streak:number}|null, hasHistory: boolean }}
 */
export function computeStreaks(board, snapshots) {
  const states = buildRankTimeline(board, snapshots);
  const hasHistory = states.length >= 2; // al menos un corte previo + la jornada actual
  if (!hasHistory) return { badges: [], relegation: [], zones: [], bubble: null, hasHistory: false };

  // Las bandas solo tienen sentido con un campo lo bastante grande para que los 3
  // últimos puestos (descenso) no sean casi toda la tabla.
  const current = states[states.length - 1];
  const size = current.size;
  const zoneActive = size >= 6;

  // La «burbuja» es quien ocupa AHORA el puesto 5, salvo que ese puesto caiga dentro
  // de la zona de descenso (campos pequeños): ahí manda el descenso.
  const at5 = board.find((s) => s.rank === 5);
  const bubbleNick = zoneActive && at5 && !inDropZone(5, current) ? at5.nick : null;

  const badges = [];
  const relegation = [];
  const bandBuckets = new Map(BAND_ZONES.map((z) => [z.key, []]));
  let bubble = null;
  for (const s of board) {
    const nick = s.nick;
    // Burbuja (puesto 5): se resalta aparte SI lleva ≥2 actualizaciones seguidas
    // ocupándolo, igual que las demás bandas. Si acaba de caer en el 5, no se
    // resalta: sigue optando a su banda (efervescente) o a un destacado positivo.
    if (nick === bubbleNick) {
      const held = trailingStates(states, nick, (r) => r === 5);
      if (held >= 2) { bubble = { nick, streak: held }; continue; }
    }
    // Zona de descenso (racha negativa): si está ahí ahora y lleva ≥2 jornadas, va a
    // su lista propia. En descenso no compite ni por bandas ni por positivos.
    if (zoneActive && inDropZone(s.rank, current)) {
      const drop = trailingStates(states, nick, inDropZone);
      if (drop >= 2) { relegation.push({ nick, streak: drop }); continue; }
    } else if (zoneActive) {
      // Banda absoluta según el puesto actual (efervescente … pre-descenso).
      const band = bandOf(s.rank);
      if (band) {
        const streak = trailingStates(states, nick, inBand(band));
        if (streak >= 2) { bandBuckets.get(band.key).push({ nick, streak }); continue; }
        // racha corta en la banda: sigue optando a un destacado positivo
      }
    }
    const cands = [];
    const leader = trailingStates(states, nick, (r) => r === 1);
    if (leader >= 2) cands.push({ nick, icon: "👑", kind: "leader",
      text: `${leader} actualizaciones como líder`, weight: 1000 + leader });
    const climb = trailingClimb(states, nick);
    if (climb >= 2) cands.push({ nick, icon: "🔥", kind: "climb",
      text: `${climb} actualizaciones subiendo`, weight: 700 + climb });
    const top3 = trailingStates(states, nick, (r) => r <= 3);
    if (top3 >= 3) cands.push({ nick, icon: "🥉", kind: "top3",
      text: `${top3} actualizaciones en el podio`, weight: 500 + top3 });
    const top5 = trailingStates(states, nick, (r) => r <= 5);
    if (top5 >= 4) cands.push({ nick, icon: "⭐", kind: "top5",
      text: `${top5} actualizaciones en el top 5`, weight: 300 + top5 });
    if (isNewPersonalBest(states, nick)) cands.push({ nick, icon: "📈", kind: "best",
      text: `mejor puesto hasta la fecha (#${s.rank})`, weight: 200 });
    if (cands.length) {
      cands.sort((a, b) => b.weight - a.weight);
      badges.push(cands[0]);
    }
  }
  badges.sort((a, b) => b.weight - a.weight);
  relegation.sort((a, b) => b.streak - a.streak || a.nick.localeCompare(b.nick));
  const byStreak = (a, b) => b.streak - a.streak || a.nick.localeCompare(b.nick);
  const zones = BAND_ZONES
    .map((z) => ({ key: z.key, label: z.label, note: z.note, word: z.word, icon: z.icon,
      members: bandBuckets.get(z.key).sort(byStreak) }))
    .filter((z) => z.members.length);
  return { badges, relegation, zones, bubble, hasHistory: true };
}
