// Ranking individual: puntúa a cada participante y ordena con los desempates de
// SPEC 06 §13. Empate de total → misma posición (rango compartido, §13 ejemplo).
// @ts-check
import { scoreParticipant } from "./scoring.js";

/**
 * @param {{nick:string, prediction:object}[]} participants
 * @param {object} official  resultado oficial parseado
 * @param {object} rules
 * @returns {object[]} participantes puntuados, ordenados, con `rank`
 */
export function buildLeaderboard(participants, official, rules) {
  const scored = participants.map((p) => {
    const s = scoreParticipant(p.prediction, official, rules);
    s.generadoAt = p.prediction.generadoAt || null;
    return s;
  });
  scored.sort(compareParticipants);
  scored.forEach((s, i) => {
    s.rank = i > 0 && scored[i - 1].score.total === s.score.total ? scored[i - 1].rank : i + 1;
  });
  return scored;
}

// Orden: total ↓, luego desempates §13 (exactos de grupo, clasificados KO,
// ganadores de grupo, campeón), y por último envío más temprano.
export function compareParticipants(a, b) {
  const d = a.details, e = b.details;
  if (b.score.total !== a.score.total) return b.score.total - a.score.total;
  if (e.exact_group_scores !== d.exact_group_scores) return e.exact_group_scores - d.exact_group_scores;
  if (e.correct_qualified_knockout_teams !== d.correct_qualified_knockout_teams)
    return e.correct_qualified_knockout_teams - d.correct_qualified_knockout_teams;
  if (e.correct_group_winners !== d.correct_group_winners) return e.correct_group_winners - d.correct_group_winners;
  const ca = d.correct_champion ? 1 : 0, cb = e.correct_champion ? 1 : 0;
  if (cb !== ca) return cb - ca;
  if (a.generadoAt && b.generadoAt) return a.generadoAt.localeCompare(b.generadoAt);
  return 0;
}
