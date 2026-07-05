// Proyección de "techo" y escenarios (feature de la ficha de usuario). Responde a:
// ¿cuál es la MÁXIMA puntuación que puede alcanzar aún un participante, dónde le
// dejaría, contra quién compite y a quién ya no puede superar? Todo se deriva del
// mismo motor de puntuación, comparando cada predicción contra un resultado oficial
// HIPOTÉTICO ("mundo ideal") en el que, de aquí en adelante, se cumple todo lo que
// el participante pronosticó — respetando lo ya jugado (nadie eliminado revive).
//
// Interdependencia: como todos pronostican los MISMOS partidos, el mundo ideal de X
// fija los resultados para TODOS. Puntuar a los demás contra ese mismo oficial
// hipotético revela quién sube con X (coincidió) y quién no. De ahí salen los rivales.
// @ts-check
import { scoreParticipant } from "./scoring.js";
import { compareParticipants } from "./leaderboard.js";

// Un partido de eliminatoria está resuelto oficialmente cuando tiene marcador y
// clasificado. Mientras no lo esté, su desenlace es "libre" y lo rellena el sueño.
const isResolved = (m) => m && m.hg != null && m.ag != null && !!m.qualified;
const koIdsInOrder = (knockout) =>
  Object.keys(knockout).sort((a, b) => Number(a.slice(1)) - Number(b.slice(1)));

/**
 * Construye el resultado oficial HIPOTÉTICO del "mundo ideal" de `pred`: parte del
 * oficial real y, para cada cruce de eliminatoria aún sin resolver, lo cierra como
 * `pred` lo pronosticó (su clasificado avanza con su marcador). Los cruces ya
 * jugados se mantienen tal cual (la realidad manda: un equipo eliminado no revive,
 * porque su plaza `Wxx` propaga al ganador REAL, no al soñado). Propaga ganadores
 * (`Wxx`) y perdedores de semis (`Lxx`) igual que el bracket real.
 */
export function buildDreamOfficial(pred, official) {
  const H = { ...official, knockout: {} };
  const slotTeam = {};                       // plaza Wxx/Lxx → equipo que la ocupa
  const predKo = pred.knockout || {};
  for (const id of koIdsInOrder(official.knockout)) {
    const real = official.knockout[id];
    const NN = id.slice(1);
    // Participantes: si la realidad ya los fijó (dieciseisavos por grupos, o una
    // plaza ya propagada por un cruce jugado), se respetan; si no, salen del sueño.
    const home = real.home != null ? real.home : (slotTeam[real.home_slot] || null);
    const away = real.away != null ? real.away : (slotTeam[real.away_slot] || null);
    let hg, ag, qualified, pen = null;
    if (isResolved(real)) {
      hg = real.hg; ag = real.ag; qualified = real.qualified; pen = real.pen || null;
    } else {
      const pm = predKo[id];
      // Clasificado soñado: el que pronosticó, si es uno de los dos participantes
      // reales; si su equipo ya no está (eliminado), no puede soñarlo → cae al local.
      if (pm && pm.qualified && (pm.qualified === home || pm.qualified === away)) qualified = pm.qualified;
      else qualified = home || away || null;
      // Marcador soñado: el suyo si su cruce coincide con los participantes reales
      // (así se acredita el exacto); si no, uno coherente con el clasificado.
      if (pm && pm.home === home && pm.away === away && pm.hg != null && pm.ag != null) {
        hg = pm.hg; ag = pm.ag;
      } else if (qualified === home) { hg = 1; ag = 0; } else { hg = 0; ag = 1; }
    }
    H.knockout[id] = { round: real.round, home_slot: real.home_slot, away_slot: real.away_slot, home, away, hg, ag, qualified, pen };
    if (qualified) {
      slotTeam["W" + NN] = qualified;
      if (home && away) slotTeam["L" + NN] = qualified === home ? away : home;
    }
  }
  const fin = H.knockout["M104"];
  H.champion = fin && fin.qualified ? fin.qualified : official.champion;
  return H;
}

/** Techo (máxima puntuación alcanzable) de una predicción = su total en su mundo ideal. */
export function ceilingFor(pred, official, rules) {
  return scoreParticipant(pred, buildDreamOfficial(pred, official), rules).score.total;
}

const SCENARIOS = [
  { key: "bueno", pct: 100, icon: "🟢", label: "Bueno" },
  { key: "medio", pct: 65, icon: "🟡", label: "Medio" },
  { key: "malo", pct: 30, icon: "🔴", label: "Malo" },
];

/**
 * Proyección completa para el participante `nick`. Devuelve su techo, los tres
 * escenarios (100/65/30 % de lo que aún puede sumar), el ranking en su mundo ideal
 * (con los demás puntuados contra ESE mismo oficial hipotético) y la clasificación
 * de rivales: a quién ya no puede superar, con quién compite y a quién tiene ganado.
 * `null` si el participante no existe.
 */
export function projectUser(nick, { board, byNick, predByNick, official, rules }) {
  const me = byNick.get(nick);
  const myPred = predByNick.get(nick);
  if (!me || !myPred) return null;

  const current = me.score.total;
  // Techo propio de cada participante (su máximo alcanzable, respetando lo jugado).
  const ceilings = new Map();
  for (const [n, pred] of predByNick) ceilings.set(n, ceilingFor(pred, official, rules));
  const ceiling = ceilings.get(nick);
  const remaining = Math.max(0, ceiling - current);

  // Rank de una puntuación si el resto del campo se quedara como está ahora.
  const rankByCurrent = (score) => 1 + board.filter((o) => o.nick !== nick && o.score.total > score).length;

  const scenarios = SCENARIOS.map((sc) => {
    const score = current + Math.round((remaining * sc.pct) / 100);
    return { ...sc, gain: score - current, score, rank: rankByCurrent(score) };
  });

  // Mundo ideal de X: puntúa a TODOS contra el oficial hipotético de X y ordena con
  // los desempates oficiales. Aquí se ve la interdependencia (quién sube con X).
  const dreamOff = buildDreamOfficial(myPred, official);
  const dreamScored = [...predByNick.entries()].map(([n, pred]) => {
    const sc = scoreParticipant(pred, dreamOff, rules);
    sc.generadoAt = pred.generadoAt || null;
    return sc;
  });
  dreamScored.sort(compareParticipants);
  dreamScored.forEach((sc, i) => {
    sc.rank = i > 0 && dreamScored[i - 1].score.total === sc.score.total ? dreamScored[i - 1].rank : i + 1;
  });
  const dreamByNick = new Map(dreamScored.map((sc) => [sc.nick, sc]));
  const myDream = dreamByNick.get(nick);
  const rankAtCeiling = myDream.rank;

  // Clasificación de rivales teniendo en cuenta la INTERDEPENDENCIA: la pregunta
  // "¿a quién puedo superar?" se decide en TU mundo ideal, no contra los marcadores
  // congelados de hoy. Si tu quiniela se cumple, quienes coincidieron contigo también
  // suben, así que "cazar" a alguien exige quedar por delante de él en ESE escenario.
  //   · imposible de superar : aun cumpliéndose tu quiniela queda por encima de ti
  //                            (su rank en tu mundo ideal < el tuyo) → no le adelantas.
  //   · a tu alcance (arriba) : va por delante HOY, pero en tu mundo ideal quedas por
  //                            encima de él → alcanzable.
  //   · te pueden pasar (abajo): va por detrás/igual y su techo llega a tu actual.
  //   · ganado (abajo)        : su techo < tu actual → no te alcanza jamás.
  const impossible = [], catchable = [], threat = [], secured = [];
  for (const o of board) {
    if (o.nick === nick) continue;
    const oc = o.score.total, ce = ceilings.get(o.nick);
    const entry = { nick: o.nick, current: oc, ceiling: ce };
    if (dreamByNick.get(o.nick).rank < myDream.rank) impossible.push(entry);
    else if (oc > current) catchable.push(entry);
    else if (ce >= current) threat.push(entry);
    else secured.push(entry);
  }
  impossible.sort((a, b) => a.current - b.current);   // los más cercanos primero
  catchable.sort((a, b) => b.current - a.current);    // los de justo por encima primero
  threat.sort((a, b) => b.current - a.current);       // las amenazas más cercanas primero

  // Los que más suben en tu mundo ideal (coincidieron contigo): sabor de interdependencia.
  const risers = board
    .filter((o) => o.nick !== nick)
    .map((o) => ({ nick: o.nick, current: o.score.total, dream: dreamByNick.get(o.nick).score.total }))
    .map((o) => ({ ...o, gain: o.dream - o.current }))
    .filter((o) => o.gain > 0)
    .sort((a, b) => b.gain - a.gain)
    .slice(0, 4);

  return {
    current, ceiling, remaining, scenarios,
    rankAtCeiling, currentRank: me.rank,
    impossible, catchable, threat, secured, risers,
    dreamByNick,
  };
}
