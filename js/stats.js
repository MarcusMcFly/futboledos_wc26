// Estadísticas de engagement (SPEC 08, parte "sin historia"): se calculan en
// cliente desde las predicciones + el resultado oficial, sin snapshots. Lo que
// necesita historia (movimiento de ranking, top movers, rachas) es de la Fase 5.
// @ts-check
import { getOutcome } from "./scoring.js";

const round1 = (n) => Math.round(n * 10) / 10;
const pctOf = (n, total) => (total ? round1((n / total) * 100) : 0);

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

/** Favorito de la peña: distribución de campeones pronosticados. */
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
