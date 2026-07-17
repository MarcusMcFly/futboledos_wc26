// Estadísticas de engagement (SPEC 08, parte "sin historia"): se calculan en
// cliente desde las predicciones + el resultado oficial, sin snapshots. Lo que
// necesita historia (movimiento de ranking, top movers, rachas) es de la Fase 5.
// @ts-check
import { getOutcome } from "./scoring.js";

const round1 = (n) => Math.round(n * 10) / 10;
const pctOf = (n, total) => (total ? round1((n / total) * 100) : 0);
// Desviación media mínima (en posiciones) para considerar a un equipo "sorpresa".
const MIN_SURPRISE_GAP = 1;

/** Distribución de un partido de grupo: local/empate/visitante + marcadores. (§5/§14) */
export function groupMatchDistribution(predictions, matchId) {
  let home = 0, draw = 0, away = 0, total = 0;
  const exact = new Map();
  for (const p of predictions) {
    const m = p.groupMatches[matchId];
    if (!m || m.hg == null || m.ag == null) continue;
    total++;
    const o = getOutcome(m.hg, m.ag);
    if (o === "HOME_WIN") home++; else if (o === "AWAY_WIN") away++; else draw++;
    const k = `${m.hg}-${m.ag}`;
    exact.set(k, (exact.get(k) || 0) + 1);
  }
  const exactScores = [...exact.entries()]
    .sort((a, b) => b[1] - a[1])
    .map(([score, count]) => ({ score, count, pct: pctOf(count, total) }));
  return {
    matchId, total,
    home, draw, away,
    homePct: pctOf(home, total), drawPct: pctOf(draw, total), awayPct: pctOf(away, total),
    exactScores, mostCommon: exactScores[0] || null,
  };
}

/** Pick contrarian: el signo menos elegido (§6). Devuelve null si no hay predicciones. */
export function contrarianOutcome(dist) {
  const opts = [
    ["HOME_WIN", dist.home, dist.homePct],
    ["DRAW", dist.draw, dist.drawPct],
    ["AWAY_WIN", dist.away, dist.awayPct],
  ].filter((o) => o[1] > 0);
  if (!opts.length) return null;
  opts.sort((a, b) => a[1] - b[1]);
  return { outcome: opts[0][0], count: opts[0][1], pct: opts[0][2] };
}

const DIFFICULTY = (hits, total) => {
  if (!total) return null;
  const rate = (hits / total) * 100;
  if (rate > 20) return "Exacto común";
  if (rate >= 10) return "Exacto difícil";
  if (rate >= 3) return "Exacto raro";
  return "Exacto legendario";
};

/** Exact-score heroes de un partido de grupo jugado (§11). null si no hay resultado oficial. */
export function exactHeroes(predictions, official, matchId) {
  const om = official.groupMatches[matchId];
  if (!om || om.hg == null || om.ag == null) return null;
  const heroes = [];
  let total = 0, signHits = 0;
  for (const p of predictions) {
    const m = p.groupMatches[matchId];
    if (!m || m.hg == null || m.ag == null) continue;
    total++;
    if (getOutcome(m.hg, m.ag) === getOutcome(om.hg, om.ag)) signHits++;
    if (m.hg === om.hg && m.ag === om.ag) heroes.push(p.nick);
  }
  return {
    heroes, total, signHits,
    exactPct: pctOf(heroes.length, total),
    difficulty: total ? Math.round((1 - heroes.length / total) * 100) : null,
    label: DIFFICULTY(heroes.length, total),
  };
}

/** Precisión global del torneo sobre los partidos de grupo jugados (§13). */
export function globalAccuracy(predictions, official, board) {
  const completed = Object.keys(official.groupMatches)
    .filter((id) => { const m = official.groupMatches[id]; return m && m.hg != null && m.ag != null; });
  let preds = 0, signHits = 0, exactHits = 0;
  for (const p of predictions) {
    for (const id of completed) {
      const m = p.groupMatches[id];
      if (!m || m.hg == null || m.ag == null) continue;
      const om = official.groupMatches[id];
      preds++;
      if (getOutcome(m.hg, m.ag) === getOutcome(om.hg, om.ag)) signHits++;
      if (m.hg === om.hg && m.ag === om.ag) exactHits++;
    }
  }
  const avg = board.length ? board.reduce((s, x) => s + x.score.total, 0) / board.length : 0;
  return {
    completedMatches: completed.length,
    totalPredictions: preds,
    correctSignPct: pctOf(signHits, preds),
    exactPct: pctOf(exactHits, preds),
    avgPointsUser: round1(avg),
  };
}

const GROUP_LETTERS = "ABCDEFGHIJKL".split("");

/** ¿Están jugados los 6 partidos del grupo `g` en el oficial? */
export function groupComplete(official, g) {
  for (let i = 1; i <= 6; i++) {
    const m = official.groupMatches[`${g}_0${i}`];
    if (!m || m.hg == null || m.ag == null) return false;
  }
  return true;
}

/**
 * Tabla de clasificación final de un grupo CERRADO, en el orden oficial
 * (official.groupOrder[g], ya resuelto por enfrentamiento directo). Cada fila trae
 * Pts/PJ/G/E/P/GF/GC/DG calculados desde los marcadores. null si el grupo no está
 * completo o el oficial aún no tiene el orden (sección [CLASIFICACION]).
 */
export function groupStandings(official, g) {
  if (!groupComplete(official, g)) return null;
  const order = official.groupOrder[g];
  if (!order || order.length < 4) return null;
  const stat = new Map(order.map((id) => [id, { id, pts: 0, j: 0, w: 0, d: 0, l: 0, gf: 0, gc: 0, dg: 0 }]));
  for (let i = 1; i <= 6; i++) {
    const m = official.groupMatches[`${g}_0${i}`];
    const h = stat.get(m.home), a = stat.get(m.away);
    if (!h || !a) continue;
    h.j++; a.j++;
    h.gf += m.hg; h.gc += m.ag; a.gf += m.ag; a.gc += m.hg;
    if (m.hg > m.ag) { h.pts += 3; h.w++; a.l++; }
    else if (m.hg < m.ag) { a.pts += 3; a.w++; h.l++; }
    else { h.pts++; a.pts++; h.d++; a.d++; }
  }
  return order.map((id) => { const s = stat.get(id); s.dg = s.gf - s.gc; return s; });
}

/**
 * Estadísticas cruzadas (predicciones × resultado real) de un grupo CERRADO.
 * `board` = participantes puntuados (con breakdown.groupRankDetails[g]);
 * `predByNick` = Map nick→predicción. Solo cuenta a quien predijo el orden completo.
 * null si el grupo no está completo o nadie predijo su orden.
 */
export function groupCrossStats(board, predByNick, official, g) {
  if (!groupComplete(official, g)) return null;
  const off = official.groupOrder[g];
  if (!off || off.length < 4) return null;
  const offTop2 = new Set([off[0], off[1]]);
  let total = 0, winner = 0, top2 = 0, full = 0, sumPts = 0;
  const heroes = [];
  const posHit = [0, 0, 0, 0];                          // aciertos por posición final
  const predPosSum = new Map(off.map((id) => [id, 0])); // Σ posiciones predichas por equipo
  const predPosCnt = new Map(off.map((id) => [id, 0]));
  for (const entry of board) {
    const pred = predByNick.get(entry.nick);
    const po = pred && pred.groupOrder[g];
    if (!po || po.length < 4) continue;
    total++;
    const detail = entry.breakdown && entry.breakdown.groupRankDetails[g];
    sumPts += detail ? detail.points : 0;
    if (po[0] === off[0]) winner++;
    if (offTop2.has(po[0]) && offTop2.has(po[1])) top2++;
    if (off.every((id, i) => po[i] === id)) { full++; heroes.push(entry.nick); }
    for (let i = 0; i < 4; i++) if (po[i] === off[i]) posHit[i]++;
    for (const id of off) {
      const idx = po.indexOf(id);
      if (idx >= 0) { predPosSum.set(id, predPosSum.get(id) + idx + 1); predPosCnt.set(id, predPosCnt.get(id) + 1); }
    }
  }
  if (!total) return null;
  // Sorpresa: equipo con mayor distancia |posición media predicha − posición real|,
  // pero SOLO si esa desviación es de al menos una posición completa. Si el grupo
  // salió casi como se esperaba (p. ej. pronosticado 3,8.º y acabó 4.º → gap 0,2),
  // no hay sorpresa y se devuelve null en vez del "menos esperado" trivial.
  let surprise = null, bestGap = -1;
  off.forEach((id, i) => {
    const cnt = predPosCnt.get(id);
    if (!cnt) return;
    const avg = predPosSum.get(id) / cnt;
    const gap = Math.abs(avg - (i + 1));
    if (gap > bestGap) { bestGap = gap; surprise = { id, avgPredPos: round1(avg), actualPos: i + 1, gap: round1(gap) }; }
  });
  if (bestGap < MIN_SURPRISE_GAP) surprise = null;
  return {
    total, winner, top2, full, heroes,
    winnerPct: pctOf(winner, total), top2Pct: pctOf(top2, total), fullPct: pctOf(full, total),
    avgPoints: round1(sumPts / total),
    perPos: off.map((id, i) => ({ id, pos: i + 1, count: posHit[i], pct: pctOf(posHit[i], total) })),
    surprise,
  };
}

/**
 * Distribución de un partido de ELIMINATORIA (analogía KO del §5 de grupos).
 * Como cada participante pronostica su propio cuadro, no comparten rival: lo que se
 * agrega es a quién pronostican que PASA (clasificado), qué cruce esperan y con qué
 * marcador. `total` = nº de predicciones con entrada para este partido.
 */
export function koMatchDistribution(predictions, matchId) {
  const qual = new Map();     // team_id → veces pronosticado como clasificado
  const fixture = new Map();  // "home|away" → [nicks que pronosticaron ese cruce]
  const exact = new Map();    // "hg-ag" → [nicks que pronosticaron ese marcador]
  let total = 0;
  const push = (mp, k, nick) => { if (!mp.has(k)) mp.set(k, []); mp.get(k).push(nick); };
  for (const p of predictions) {
    const m = p.knockout[matchId];
    if (!m) continue;
    total++;
    if (m.qualified) qual.set(m.qualified, (qual.get(m.qualified) || 0) + 1);
    if (m.home && m.away) push(fixture, `${m.home}|${m.away}`, p.nick);
    if (m.hg != null && m.ag != null) push(exact, `${m.hg}-${m.ag}`, p.nick);
  }
  const byCount = (mp) => [...mp.entries()].sort((a, b) => b[1] - a[1]);
  const byNicks = (mp) => [...mp.entries()].sort((a, b) => b[1].length - a[1].length);
  return {
    matchId, total,
    qualifiers: byCount(qual).map(([id, count]) => ({ id, count, pct: pctOf(count, total) })),
    fixtures: byNicks(fixture).map(([k, nicks]) => {
      const [home, away] = k.split("|");
      return { home, away, count: nicks.length, pct: pctOf(nicks.length, total), nicks };
    }),
    exactScores: byNicks(exact).map(([score, nicks]) =>
      ({ score, count: nicks.length, pct: pctOf(nicks.length, total), nicks })),
  };
}

/**
 * Héroes de un partido de eliminatoria ya resuelto (clasificado oficial conocido).
 * `qualHeroes` = acertaron quién pasa; `fixtureHeroes` = acertaron el cruce (ambos
 * equipos); `exactHeroes` = acertaron cruce + marcador.
 * null si el partido aún no tiene clasificado/resultado oficial.
 */
export function koHeroes(predictions, official, matchId) {
  const om = official.knockout[matchId];
  if (!om || om.hg == null || om.ag == null || !om.qualified) return null;
  const qualHeroes = [], fixtureHeroes = [], exactHeroes = [];
  let total = 0, signHits = 0;
  for (const p of predictions) {
    const m = p.knockout[matchId];
    if (!m) continue;
    total++;
    if (m.qualified && m.qualified === om.qualified) qualHeroes.push(p.nick);
    if (m.home === om.home && m.away === om.away) {
      fixtureHeroes.push(p.nick);
      if (m.hg != null && m.ag != null) {
        if (getOutcome(m.hg, m.ag) === getOutcome(om.hg, om.ag)) signHits++;
        if (m.hg === om.hg && m.ag === om.ag) exactHeroes.push(p.nick);
      }
    }
  }
  return {
    total, signHits, qualHeroes, fixtureHeroes, exactHeroes,
    qualHits: qualHeroes.length, fixtureHits: fixtureHeroes.length,
    qualPct: pctOf(qualHeroes.length, total), fixturePct: pctOf(fixtureHeroes.length, total),
  };
}

/**
 * "Top players" de una RONDA de eliminatoria: ranking de participantes por número de
 * equipos-que-pasan acertados. Cuenta cuántos de los clasificados oficiales de la ronda
 * (cruces ya resueltos) figuran entre los que el participante da como clasificados en esa
 * ronda, VAYAN POR EL CRUCE QUE SEA (intersección de conjuntos, no por posición de slot).
 * Es el resumen por fase que se repite tras cada ronda. Devuelve null si la ronda no tiene
 * ningún clasificado oficial todavía.
 * `resolved` = nº de clasificados oficiales de la ronda; `perfect` = cuántos los acertaron
 * todos; `leaders` = [{nick, hits}] con hits>0, de más a menos (empate → alfabético).
 */
export function koRoundQualifierLeaders(predictions, official, round) {
  const roundIds = Object.keys(official.knockout).filter((id) => official.knockout[id].round === round);
  // Equipos que REALMENTE pasan en esta ronda (cruces oficiales ya resueltos).
  const offQ = new Set();
  for (const id of roundIds) {
    const m = official.knockout[id];
    if (m.hg != null && m.ag != null && m.qualified) offQ.add(m.qualified);
  }
  if (!offQ.size) return null;
  const leaders = predictions.map((p) => {
    // Clasificados que el participante da en esta ronda (cualquier slot). Contamos
    // cuántos pasan de verdad, vayan por el cruce que sea (intersección de conjuntos).
    const userQ = new Set();
    for (const id of roundIds) { const m = p.knockout[id]; if (m && m.qualified) userQ.add(m.qualified); }
    let hits = 0;
    for (const t of userQ) if (offQ.has(t)) hits++;
    return { nick: p.nick, hits };
  }).filter((r) => r.hits > 0)
    .sort((a, b) => b.hits - a.hits || a.nick.localeCompare(b.nick));
  return { round, resolved: offQ.size, perfect: leaders.filter((r) => r.hits === offQ.size).length, leaders };
}

/**
 * PRE-estadística de una RONDA cuyos equipos ya están definidos pero que todavía no se ha
 * jugado (p. ej. cuartos con los 8 clasificados de octavos ya propagados). Para cada uno de
 * los equipos que disputan la ronda cuenta a cuántos participantes "sigue": cuántos lo
 * pronosticaron con vida a esa altura, es decir, lo tienen entre los equipos que en SU cuadro
 * llegan a esa ronda (o más allá). Se deriva de los cruces de la ronda en cada predicción
 * (sus equipos home/away), así que no depende de posiciones de slot.
 *
 * Además, entre los que lo siguen, separa a los que apuestan que el equipo PASA su cruce de
 * esta ronda (en su cuadro lo dan como clasificado) de los que apuestan que CAE (lo tienen en
 * la ronda pero eliminado).
 *
 * Trabaja cruce a cruce: incluye en el roster los equipos de los cruces YA FIJADOS de la ronda
 * (ambos equipos propagados) que todavía no se han jugado, e ignora los que aún no tienen equipos
 * o los que ya están resueltos. Así, en semis con solo un cruce definido (p. ej. la primera semi
 * ya conocida y la segunda pendiente de los cuartos), muestra las pre-estadísticas de ese cruce.
 * CASO ESPECIAL FINAL: si la ronda es la FINAL y aún no hay ningún finalista oficial (las
 * semis sin jugar), no se puede anclar en equipos reales; entonces el roster se deriva de los
 * finalistas que cada participante pone en SU cuadro (union de sus dos finalistas), y ▲/▼
 * pasan a significar "lo hacen campeón" / "subcampeón". SOLO en ese caso los equipos que ya no
 * pueden llegar a la final se marcan con `alive:false`, para no darlos por vivos; cuando el
 * roster sale de cruces reales, todos sus equipos están vivos (van a jugar ese partido).
 *
 * Devuelve null solo si la ronda no tiene ningún cruce fijado sin jugar (ni finalistas en las
 * quinielas, en el caso de la final). `teams` = [{ id, count, pct, advance:[nick],
 * eliminate:[nick], nicks, alive }] de más a menos seguido (empate → por id); `matches` = nº de
 * cruces de la ronda con equipos, `resolved` = cuántos ya jugados, `pending` = cuántos aún sin
 * equipos, `partial` = true si no todos los cruces están fijados, `fromBrackets` = true si el
 * roster salió de las quinielas (final sin finalistas oficiales).
 */
/** Equipos que han perdido algún cruce oficial ya resuelto. OJO: "perdió un cruce" no es lo
 * mismo que "fuera del torneo" — el perdedor de una semi cae al partido por el tercer puesto
 * (su plaza `Lxx` propaga). Solo sirve para saber quién ya no puede llegar a la FINAL. */
function koLosers(official) {
  const out = new Set();
  for (const id of Object.keys(official.knockout)) {
    const m = official.knockout[id];
    if (m.hg != null && m.ag != null && m.qualified) {
      const loser = m.qualified === m.home ? m.away : m.home;
      if (loser) out.add(loser);
    }
  }
  return out;
}

export function koRoundFollowers(predictions, official, round) {
  const mids = Object.keys(official.knockout).filter((id) => official.knockout[id].round === round);
  if (!mids.length) return null;
  const roster = [];
  let resolved = 0, pending = 0;
  for (const id of mids) {
    const m = official.knockout[id];
    if (m.home == null || m.away == null) { pending++; continue; }   // aún sin equipos → no entra
    if (m.hg != null && m.ag != null && m.qualified) { resolved++; continue; } // ya jugado → no es "pre"
    roster.push(m.home, m.away);
  }
  // Final aún sin finalistas oficiales: el roster sale de los finalistas de cada quiniela.
  let fromBrackets = false;
  if (!roster.length && round === "FINAL" && resolved === 0) {
    fromBrackets = true;
    const set = new Set();
    for (const p of predictions) for (const id of mids) {
      const m = p.knockout[id];
      if (m && m.home) set.add(m.home);
      if (m && m.away) set.add(m.away);
    }
    roster.push(...set);
  }
  if (!roster.length) return null;                                    // nada que mostrar aún
  // Si el roster sale de cruces REALES ya fijados y sin jugar, sus equipos están vivos por
  // definición: van a jugar ese partido. Perder la semifinal no elimina a nadie, te manda al
  // partido por el tercer puesto — marcar ahí a los dos contendientes como muertos era el bug.
  // La pregunta "¿sigue vivo?" solo tiene sentido cuando el roster lo deducimos de las
  // quinielas (final sin finalistas oficiales): ahí sí hay equipos que ya no pueden llegar.
  const eliminated = fromBrackets ? koLosers(official) : new Set();
  const total = predictions.length;
  // Por cada participante: los equipos que da en esta ronda y si los da clasificados (pasa)
  // o eliminados (cae) en su propio cuadro.
  const userTeams = predictions.map((p) => {
    const adv = new Map();   // teamId → ¿lo pronostica clasificado en su cruce de la ronda?
    for (const id of mids) {
      const m = p.knockout[id];
      if (!m) continue;
      if (m.home) adv.set(m.home, m.qualified === m.home);
      if (m.away) adv.set(m.away, m.qualified === m.away);
    }
    return { nick: p.nick, adv };
  });
  const teams = roster.map((t) => {
    const advance = [], eliminate = [];
    for (const u of userTeams) { if (u.adv.has(t)) (u.adv.get(t) ? advance : eliminate).push(u.nick); }
    advance.sort((a, b) => a.localeCompare(b));
    eliminate.sort((a, b) => a.localeCompare(b));
    const count = advance.length + eliminate.length;
    return { id: t, count, pct: total ? Math.round((count / total) * 100) : 0, advance, eliminate, nicks: [...advance, ...eliminate], alive: !eliminated.has(t) };
    // Los equipos vivos van primero; dentro, de más a menos seguido.
  }).sort((a, b) => (Number(b.alive) - Number(a.alive)) || b.count - a.count || String(a.id).localeCompare(String(b.id)));
  const matches = fromBrackets ? teams.length : roster.length / 2;
  return { round, total, teams, matches, resolved, pending, partial: !fromBrackets && (pending > 0 || resolved > 0), fromBrackets };
}

/**
 * Estadísticas destacadas de una RONDA de eliminatoria ya (parcialmente) resuelta,
 * para pintar debajo del "Top acertantes" de la ronda. null si no hay ningún cruce
 * decidido. Solo mira los cruces de la ronda con `qualified` oficial.
 *
 * - `surprises`: por cada cruce, el equipo que ACABÓ eliminado y el % de
 *   participantes que lo daban clasificado (el "batacazo": cuanto más respaldo tenía
 *   el que cayó, mayor la sorpresa). Ordenado de mayor a menor respaldo al eliminado.
 * - `exactFixtures`: ranking de participantes por nº de cruces con AMBOS equipos
 *   acertados (sobre los resueltos), de más a menos (empate → alfabético).
 * - `exactScores`: ídem por nº de marcadores exactos (mismo cruce + mismo resultado
 *   de tiempo reglamentario; los penaltis no cuentan para el exacto).
 * - `qualCounts`: nº de clasificados ("quién pasa") acertados por cada participante,
 *   incluidos los ceros, para ver el reparto de equipos-que-pasan por usuario.
 */
export function koRoundStats(predictions, official, round) {
  const ids = Object.keys(official.knockout).filter((id) => {
    const m = official.knockout[id];
    return m.round === round && m.hg != null && m.ag != null && m.qualified;
  }).sort((a, b) => Number(a.slice(1)) - Number(b.slice(1)));
  if (!ids.length) return null;

  // Sorpresas: por cada cruce, cuántos daban clasificado al que acabó eliminado.
  const surprises = [];
  for (const id of ids) {
    const om = official.knockout[id];
    const eliminated = om.qualified === om.home ? om.away : om.home;
    let backed = 0, total = 0;
    for (const p of predictions) {
      const m = p.knockout[id];
      if (!m || !m.qualified) continue;
      total++;
      if (m.qualified === eliminated) backed++;
    }
    if (total > 0)
      surprises.push({ matchId: id, eliminated, qualified: om.qualified, backed, total, backedPct: pctOf(backed, total) });
  }
  surprises.sort((a, b) => b.backedPct - a.backedPct);

  // Aciertos por participante: cruces exactos, marcadores exactos y clasificados.
  // Cruces/marcadores exactos son por slot (el cruce ES el emparejamiento). El reparto
  // de clasificados es set-based: equipos que pasan de verdad, vayan por el cruce que sea.
  const roundIds = Object.keys(official.knockout).filter((id) => official.knockout[id].round === round);
  const offQ = new Set(ids.map((id) => official.knockout[id].qualified));
  const exactFixtures = [], exactScores = [], qualCounts = [];
  for (const p of predictions) {
    let fx = 0, sc = 0;
    for (const id of ids) {
      const om = official.knockout[id], m = p.knockout[id];
      if (!m) continue;
      if (m.home === om.home && m.away === om.away) {
        fx++;
        if (m.hg === om.hg && m.ag === om.ag) sc++;
      }
    }
    const userQ = new Set();
    for (const id of roundIds) { const m = p.knockout[id]; if (m && m.qualified) userQ.add(m.qualified); }
    let ql = 0;
    for (const t of userQ) if (offQ.has(t)) ql++;
    qualCounts.push({ nick: p.nick, hits: ql });
    if (fx > 0) exactFixtures.push({ nick: p.nick, hits: fx });
    if (sc > 0) exactScores.push({ nick: p.nick, hits: sc });
  }
  const byHits = (a, b) => b.hits - a.hits || a.nick.localeCompare(b.nick);
  exactFixtures.sort(byHits);
  exactScores.sort(byHits);
  qualCounts.sort(byHits);

  return { round, resolved: ids.length, surprises, exactFixtures, exactScores, qualCounts };
}

/** Campeón más votado: distribución de campeones pronosticados. */
export function championDistribution(predictions) {
  const c = new Map();
  for (const p of predictions) {
    if (!p.champion) continue;
    c.set(p.champion, (c.get(p.champion) || 0) + 1);
  }
  const total = [...c.values()].reduce((s, n) => s + n, 0);
  return [...c.entries()]
    .sort((a, b) => b[1] - a[1])
    .map(([id, count]) => ({ id, count, pct: pctOf(count, total) }));
}
