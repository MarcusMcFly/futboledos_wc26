// Scoring calculado en cliente, en tiempo de render. NO se persiste. (Spec 10)
// @ts-check
/** @typedef {import("./types.js").Catalog} Catalog */
/** @typedef {import("./types.js").Participant} Participant */
/** @typedef {import("./types.js").Results} Results */
/** @typedef {import("./types.js").ScoredParticipant} ScoredParticipant */

/**
 * Score = numero de predicciones que coinciden con los resultados oficiales.
 * score = count(participant.predictions ∩ confirmed_outcomes)   (Spec 10)
 * @param {string[]} predictions
 * @param {string[]} confirmedOutcomes
 * @returns {{ score: number, hits: string[] }}
 */
export function computeScore(predictions, confirmedOutcomes) {
  const confirmed = new Set(confirmedOutcomes);
  const hits = predictions.filter((id) => confirmed.has(id));
  return { score: hits.length, hits };
}

/**
 * Detecta predicciones contradictorias: dos o mas IDs de la misma categoria
 * marcada exclusive=true en el catalogo. Devuelve un grupo de IDs por cada
 * categoria exclusiva con >1 prediccion. (Spec 10)
 * @param {string[]} predictions
 * @param {Catalog} catalog
 * @returns {string[][]}
 */
export function findContradictions(predictions, catalog) {
  /** @type {Map<string, string[]>} */
  const byCategory = new Map();
  for (const id of predictions) {
    const opt = catalog.options.find((o) => o.id === id);
    if (!opt || !opt.exclusive) continue;
    const group = byCategory.get(opt.category) ?? [];
    group.push(id);
    byCategory.set(opt.category, group);
  }
  return [...byCategory.values()].filter((group) => group.length > 1);
}

/**
 * Aplica scoring + contradicciones a un participante. Calculado, no persistido.
 * @param {Participant} participant
 * @param {Results} results
 * @param {Catalog} catalog
 * @returns {ScoredParticipant}
 */
export function scoreParticipant(participant, results, catalog) {
  const { score, hits } = computeScore(
    participant.predictions,
    results.confirmed_outcomes,
  );
  return {
    ...participant,
    score,
    hits,
    contradictions: findContradictions(participant.predictions, catalog),
  };
}

/**
 * Tabla de clasificacion ordenada por score desc (desempate: submitted_at asc).
 * @param {Participant[]} participants
 * @param {Results} results
 * @param {Catalog} catalog
 * @returns {ScoredParticipant[]}
 */
export function buildLeaderboard(participants, results, catalog) {
  return participants
    .map((p) => scoreParticipant(p, results, catalog))
    .sort(
      (a, b) =>
        b.score - a.score || a.submitted_at.localeCompare(b.submitted_at),
    );
}
