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
  const fixture = new Map();  // "home|away" → veces pronosticado ese cruce
  const exact = new Map();    // "hg-ag" → veces pronosticado ese marcador
  let total = 0;
  for (const p of predictions) {
    const m = p.knockout[matchId];
    if (!m) continue;
    total++;
    if (m.qualified) qual.set(m.qualified, (qual.get(m.qualified) || 0) + 1);
    if (m.home && m.away) {
      const k = `${m.home}|${m.away}`;
      fixture.set(k, (fixture.get(k) || 0) + 1);
    }
    if (m.hg != null && m.ag != null) {
      const k = `${m.hg}-${m.ag}`;
      exact.set(k, (exact.get(k) || 0) + 1);
    }
  }
  const sorted = (mp) => [...mp.entries()].sort((a, b) => b[1] - a[1]);
  return {
    matchId, total,
    qualifiers: sorted(qual).map(([id, count]) => ({ id, count, pct: pctOf(count, total) })),
    fixtures: sorted(fixture).map(([k, count]) => {
      const [home, away] = k.split("|");
      return { home, away, count, pct: pctOf(count, total) };
    }),
    exactScores: sorted(exact).map(([score, count]) => ({ score, count, pct: pctOf(count, total) })),
  };
}

/**
 * Héroes de un partido de eliminatoria ya resuelto (clasificado oficial conocido).
 * `qualHeroes` = acertaron quién pasa; `exactHeroes` = acertaron cruce + marcador.
 * null si el partido aún no tiene clasificado/resultado oficial.
 */
export function koHeroes(predictions, official, matchId) {
  const om = official.knockout[matchId];
  if (!om || om.hg == null || om.ag == null || !om.qualified) return null;
  const qualHeroes = [], exactHeroes = [];
  let total = 0, qualHits = 0, fixtureHits = 0, signHits = 0;
  for (const p of predictions) {
    const m = p.knockout[matchId];
    if (!m) continue;
    total++;
    if (m.qualified && m.qualified === om.qualified) { qualHits++; qualHeroes.push(p.nick); }
    if (m.home === om.home && m.away === om.away) {
      fixtureHits++;
      if (m.hg != null && m.ag != null) {
        if (getOutcome(m.hg, m.ag) === getOutcome(om.hg, om.ag)) signHits++;
        if (m.hg === om.hg && m.ag === om.ag) exactHeroes.push(p.nick);
      }
    }
  }
  return {
    total, qualHits, fixtureHits, signHits, qualHeroes, exactHeroes,
    qualPct: pctOf(qualHits, total), fixturePct: pctOf(fixtureHits, total),
  };
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
