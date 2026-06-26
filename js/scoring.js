// Motor de puntuación SPEC 06. Funciones puras, config-driven (scoring_rules.json).
// Compara la predicción de un participante (parse_prediction.js) contra el
// resultado oficial (mismo formato) y devuelve el desglose de SPEC §12.
// Pendiente/sin predecir → 0 (§20).
// @ts-check

export function getOutcome(h, a) {
  return h > a ? "HOME_WIN" : h < a ? "AWAY_WIN" : "DRAW";
}

const GROUP_LETTERS = "ABCDEFGHIJKL".split("");
// round (sección del parser) → clave de multiplicador de fase (§9)
const STAGE_KEY = {
  DIECISEISAVOS: "R32", OCTAVOS: "R16", CUARTOS: "QF",
  SEMIS: "SF", TERCER_PUESTO: "THIRD_PLACE", FINAL: "FINAL",
};
// round → rango de alcance para la progresión (§10/§18). TERCER_PUESTO no cuenta.
const REACH_RANK = { DIECISEISAVOS: 1, OCTAVOS: 2, CUARTOS: 3, SEMIS: 4, FINAL: 5 };

// ── §5/§15 · Partido de grupo ───────────────────────────────────────────────
export function scoreGroupMatch(pred, off, rules) {
  const r = rules.group_match;
  if (!off || off.hg == null || off.ag == null) return { points: 0, status: "pending" };
  if (!pred || pred.hg == null || pred.ag == null) return { points: 0, status: "no_prediction" };
  if (pred.hg === off.hg && pred.ag === off.ag)
    return { points: r.exact_score, status: "exact", exact: true, correctOutcome: true };
  let pts = 0;
  const correctOutcome = getOutcome(pred.hg, pred.ag) === getOutcome(off.hg, off.ag);
  if (correctOutcome) pts += r.correct_outcome;
  if (pred.hg - pred.ag === off.hg - off.ag) pts += r.correct_goal_difference;
  if (pred.hg === off.hg) pts += r.exact_home_goals;
  if (pred.ag === off.ag) pts += r.exact_away_goals;
  pts = Math.min(pts, r.max_points);
  return { points: pts, status: "scored", exact: false, correctOutcome };
}

// ── §6 · Ranking de grupo ────────────────────────────────────────────────────
// order = [1º,2º,3º,4º]; clasificados = top2 + (3º si el grupo está en la clave de terceros).
function groupQualifiers(order, group, thirdsSet) {
  const q = [];
  if (order[0]) q.push(order[0]);
  if (order[1]) q.push(order[1]);
  if (thirdsSet && thirdsSet.has(group) && order[2]) q.push(order[2]);
  return q;
}

export function scoreGroupRanking(predOrder, offOrder, group, predThirdsSet, offThirdsSet, rules) {
  const r = rules.group_ranking;
  const pending = { points: 0, status: "pending", positions: 0, qualified: 0, completeOrder: false, winnerCorrect: false, completeBonus: 0, lines: [] };
  if (!offOrder || offOrder.length < 4) return pending;
  const predQ = new Set(groupQualifiers(predOrder, group, predThirdsSet));
  const offQ = new Set(groupQualifiers(offOrder, group, offThirdsSet));
  // Desglose por línea (posición predicha): puntos de acierto de plaza + bonus por
  // clasificado correcto, atribuidos al equipo que el participante puso en esa fila.
  let positions = 0, qualified = 0;
  const lines = [];
  for (let i = 0; i < 4; i++) {
    const team = predOrder[i] || null;
    const posCorrect = !!team && team === offOrder[i];
    const posPoints = posCorrect ? r.position_points[String(i + 1)] : 0;
    const qualBonus = team && predQ.has(team) && offQ.has(team) ? r.qualified_team : 0;
    if (posCorrect) positions += posPoints;
    if (qualBonus) qualified++;
    lines.push({ pos: i + 1, team, official: offOrder[i] || null, posCorrect, posPoints, qualBonus, points: posPoints + qualBonus });
  }
  const completeOrder = predOrder.length === 4 && predOrder.every((t, i) => t === offOrder[i]);
  const completeBonus = completeOrder ? r.complete_group_order_bonus : 0;
  const pts = positions + qualified * r.qualified_team + completeBonus;
  const winnerCorrect = !!predOrder[0] && predOrder[0] === offOrder[0];
  return { points: pts, status: "scored", positions, qualified, completeOrder, winnerCorrect, completeBonus, lines };
}

// ── §7/§17 · Mejores terceros (por pertenencia, no por orden) ────────────────
export function scoreBestThirds(predKey, offKey, rules) {
  const r = rules.best_third;
  const offSet = new Set((offKey || "").split(""));
  if (offSet.size === 0) return { points: 0, status: "pending", correct: 0, fullKey: false };
  const predSet = new Set((predKey || "").split(""));
  let correct = 0;
  for (const g of predSet) if (offSet.has(g)) correct++;
  let pts = correct * r.correct_team;
  const fullKey = [...predSet].sort().join("") === [...offSet].sort().join("");
  if (fullKey) pts += r.complete_key_bonus;
  return { points: pts, status: "scored", correct, fullKey };
}

// ── §8/§16 · Partido de eliminatoria ─────────────────────────────────────────
export function scoreKnockoutMatch(pred, off, rules, stageKey) {
  const r = rules.knockout_match;
  if (!off || off.hg == null || off.ag == null || !off.qualified) return { points: 0, status: "pending" };
  if (!pred) return { points: 0, status: "no_prediction" };
  let pts = 0;
  const sameHome = !!pred.home && pred.home === off.home;
  const sameAway = !!pred.away && pred.away === off.away;
  const sameFixture = sameHome && sameAway;
  if (sameHome) pts += r.correct_home_team;
  if (sameAway) pts += r.correct_away_team;
  const exact = sameFixture && pred.hg === off.hg && pred.ag === off.ag;
  const correctOutcome = sameFixture && getOutcome(pred.hg, pred.ag) === getOutcome(off.hg, off.ag);
  if (exact) pts += r.exact_score;
  else if (correctOutcome) pts += r.correct_outcome;
  const correctQualified = !!pred.qualified && pred.qualified === off.qualified;
  if (correctQualified) pts += r.correct_qualified_team;
  const mult = (rules.stage_multipliers && rules.stage_multipliers[stageKey]) || 1;
  return { points: pts * mult, status: "scored", sameFixture, exact, correctOutcome, correctQualified };
}

// ── §10/§18 · Bonus de progresión ────────────────────────────────────────────
// Alcance más lejano de cada equipo en un bracket parseado.
export function computeReach(knockout) {
  const reach = {};
  for (const mid in knockout) {
    const m = knockout[mid];
    const rank = REACH_RANK[m.round];
    if (!rank) continue;
    for (const t of [m.home, m.away]) {
      if (!t) continue;
      if (!reach[t] || reach[t] < rank) reach[t] = rank;
    }
  }
  const fin = knockout["M104"];
  if (fin && fin.qualified) reach[fin.qualified] = 6; // campeón
  return reach;
}

// Puntos acumulados por alcanzar hasta `rank` (1=R32 … 5=finalista, 6=campeón).
function cumulativeReachPoints(rank, r) {
  let pts = 0;
  if (rank >= 1) pts += r.round_of_32;
  if (rank >= 2) pts += r.round_of_16;
  if (rank >= 3) pts += r.quarter_final;
  if (rank >= 4) pts += r.semi_final;
  if (rank >= 6) pts += r.champion;        // campeón sustituye al de finalista (§10.3)
  else if (rank === 5) pts += r.runner_up; // finalista (perdió la final)
  return pts;
}

export function scoreProgression(pred, off, rules) {
  const r = rules.progression_bonus;
  const predReach = computeReach(pred.knockout || {});
  const offReach = computeReach(off.knockout || {});
  let reachPoints = 0;
  for (const team in predReach) {
    const offRank = offReach[team];
    if (!offRank) continue;
    reachPoints += cumulativeReachPoints(Math.min(predReach[team], offRank), r);
  }
  // 3.º / 4.º puesto (M103), si está jugado (§10.5)
  let extraPoints = 0, thirdCorrect = false, fourthCorrect = false;
  const pM = (pred.knockout || {})["M103"], oM = (off.knockout || {})["M103"];
  if (oM && oM.qualified && oM.hg != null && oM.ag != null && pM) {
    const offThird = oM.qualified;
    const offFourth = oM.qualified === oM.home ? oM.away : oM.home;
    const predThird = pM.qualified;
    const predFourth = pM.qualified === pM.home ? pM.away : pM.home;
    if (predThird && predThird === offThird) { extraPoints += r.third_place; thirdCorrect = true; }
    if (predFourth && predFourth === offFourth) { extraPoints += r.fourth_place; fourthCorrect = true; }
  }
  return { points: reachPoints + extraPoints, reachPoints, extraPoints, thirdCorrect, fourthCorrect };
}

// ── ¿Grupo oficialmente completo? (sus 6 partidos con resultado) ─────────────
function offGroupComplete(off, g) {
  for (let i = 1; i <= 6; i++) {
    const m = off.groupMatches[`${g}_0${i}`];
    if (!m || m.hg == null || m.ag == null) return false;
  }
  return true;
}

// ── §12 · Puntuación completa de un participante ─────────────────────────────
export function scoreParticipant(pred, off, rules) {
  // Partidos de grupo
  let gmPoints = 0, exactGroup = 0, exactTotal = 0, correctSigns = 0, predictedMatches = 0;
  const groupMatchDetails = {};
  for (const id in off.groupMatches) {
    const pm = pred.groupMatches[id];
    if (pm && pm.hg != null && pm.ag != null) predictedMatches++;
    const res = scoreGroupMatch(pm, off.groupMatches[id], rules);
    gmPoints += res.points;
    if (res.exact) { exactGroup++; exactTotal++; }
    if (res.correctOutcome) correctSigns++;
    groupMatchDetails[id] = res;
  }

  // Ranking de grupo + mejores terceros (solo grupos oficialmente completos)
  const predThirdsSet = new Set((pred.thirdsKey || "").split(""));
  const offThirdsSet = new Set((off.thirdsKey || "").split(""));
  let grPoints = 0, correctWinners = 0;
  const groupRankDetails = {};
  for (const g of GROUP_LETTERS) {
    const res = offGroupComplete(off, g)
      ? scoreGroupRanking(pred.groupOrder[g] || [], off.groupOrder[g] || [], g, predThirdsSet, offThirdsSet, rules)
      : { points: 0, status: "pending", positions: 0, qualified: 0, completeOrder: false, winnerCorrect: false };
    grPoints += res.points;
    if (res.winnerCorrect) correctWinners++;
    groupRankDetails[g] = res;
  }
  const bestThirds = scoreBestThirds(pred.thirdsKey, off.thirdsKey, rules);

  // Eliminatorias
  let koPoints = 0, koQualified = 0;
  const koDetails = {};
  for (const mid in off.knockout) {
    const res = scoreKnockoutMatch(pred.knockout[mid], off.knockout[mid], rules, STAGE_KEY[off.knockout[mid].round]);
    koPoints += res.points;
    if (res.correctQualified) koQualified++;
    if (res.exact) exactTotal++;
    if (res.correctOutcome) correctSigns++;
    koDetails[mid] = res;
  }

  // Progresión + campeón
  const progression = scoreProgression(pred, off, rules);
  const championCorrect = !!off.champion && pred.champion === off.champion;

  const total = gmPoints + grPoints + bestThirds.points + koPoints + progression.points;
  return {
    nick: pred.nick,
    predicted_matches: predictedMatches,
    score: {
      total,
      group_match_points: gmPoints,
      group_ranking_points: grPoints,
      best_third_points: bestThirds.points,
      knockout_match_points: koPoints,
      progression_bonus_points: progression.points,
    },
    details: {
      exact_scores: exactTotal,
      exact_group_scores: exactGroup,
      correct_signs: correctSigns,
      correct_group_winners: correctWinners,
      correct_best_thirds: bestThirds.correct,
      correct_qualified_knockout_teams: koQualified,
      correct_champion: championCorrect,
    },
    breakdown: { groupMatchDetails, groupRankDetails, bestThirds, koDetails, progression },
  };
}
