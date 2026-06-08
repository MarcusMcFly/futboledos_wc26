// Competición por pools (SPEC 07): cada pool puntúa como la MEDIA de puntos por
// participante activo. Mínimo de activos para ser elegible; desempates propios.
// @ts-check

/** ¿Participante activo? (≥ active_min_predictions partidos predichos) */
function isActive(scored, poolRules) {
  return (scored.predicted_matches || 0) >= (poolRules.active_min_predictions || 1);
}

/**
 * @param {{slug:string, name:string, members:string[]}[]} pools
 * @param {Map<string, object>} scoredByNick  nick → participante puntuado (de buildLeaderboard)
 * @param {object} rules
 * @returns {{eligible:object[], notEligible:object[]}}
 */
export function buildPoolRanking(pools, scoredByNick, rules) {
  const pr = rules.pool;
  const rows = pools.map((pool) => {
    const members = pool.members.map((n) => scoredByNick.get(n)).filter(Boolean);
    const active = members.filter((m) => isActive(m, pr));
    const totalPoints = active.reduce((s, m) => s + m.score.total, 0);
    const exactHits = active.reduce((s, m) => s + m.details.exact_scores, 0);
    const bestIndividual = active.reduce((mx, m) => Math.max(mx, m.score.total), 0);
    return {
      slug: pool.slug, name: pool.name, members,
      activeCount: active.length,
      totalPoints,
      average: active.length ? totalPoints / active.length : 0,
      exactHits, bestIndividual,
      eligible: active.length >= pr.min_active_participants,
    };
  });

  const eligible = rows.filter((r) => r.eligible).sort(comparePools);
  eligible.forEach((r, i) => {
    r.rank = i > 0 && comparePools(eligible[i - 1], r) === 0 ? eligible[i - 1].rank : i + 1;
  });
  const notEligible = rows.filter((r) => !r.eligible).sort(comparePools);
  return { eligible, notEligible };
}

// Desempates SPEC 07: media ↓ → total ↓ → nº activos ↓ → exactos ↓ → mejor individual ↓.
export function comparePools(a, b) {
  if (b.average !== a.average) return b.average - a.average;
  if (b.totalPoints !== a.totalPoints) return b.totalPoints - a.totalPoints;
  if (b.activeCount !== a.activeCount) return b.activeCount - a.activeCount;
  if (b.exactHits !== a.exactHits) return b.exactHits - a.exactHits;
  return b.bestIndividual - a.bestIndividual;
}
