// Estadísticas "de gala": curiosidades agregadas sobre las 24 quinielas (y, donde tiene
// gracia, cruzadas con el resultado oficial) pensadas para el cachondeo y el pique. Nada de
// esto afecta a la puntuación; se deriva en cliente de las predicciones. Se pinta al final
// de la pestaña de eliminatoria. Todo son funciones puras y testeables.
// @ts-check

const round1 = (n) => Math.round(n * 10) / 10;
const sign = (hg, ag) => (hg > ag ? "H" : hg < ag ? "A" : "D");

// Todos los partidos con marcador de una quiniela (grupo + eliminatoria), normalizados.
export function predMatches(pred) {
  const out = [];
  for (const id in pred.groupMatches) {
    const m = pred.groupMatches[id];
    if (m && m.hg != null && m.ag != null) out.push({ id, phase: "group", home: m.home, away: m.away, hg: m.hg, ag: m.ag });
  }
  for (const id in pred.knockout) {
    const m = pred.knockout[id];
    if (m && m.hg != null && m.ag != null && m.home && m.away) out.push({ id, phase: "ko", round: m.round, home: m.home, away: m.away, hg: m.hg, ag: m.ag });
  }
  return out;
}

// Goles a favor / en contra / nº de partidos de un equipo en una quiniela (todas las fases).
export function teamGoals(pred, teamId) {
  let gf = 0, ga = 0, matches = 0;
  for (const m of predMatches(pred)) {
    if (m.home === teamId) { gf += m.hg; ga += m.ag; matches++; }
    else if (m.away === teamId) { gf += m.ag; ga += m.hg; matches++; }
  }
  return { gf, ga, matches, dg: gf - ga };
}

const TIER_LABEL = ["Fase de grupos", "Dieciseisavos", "Octavos", "Cuartos", "Semifinales", "Final", "Campeón"];
// Ronda más lejana a la que una quiniela lleva a un equipo (0 grupos … 6 campeón).
export function teamTier(pred, teamId) {
  if (pred.champion === teamId) return 6;
  const ko = pred.knockout || {};
  const inRound = (rd) => {
    for (const id in ko) { const m = ko[id]; if (m.round === rd && (m.home === teamId || m.away === teamId)) return true; }
    return false;
  };
  if (inRound("FINAL")) return 5;
  if (inRound("SEMIS")) return 4;
  if (inRound("CUARTOS")) return 3;
  if (inRound("OCTAVOS")) return 2;
  if (inRound("DIECISEISAVOS")) return 1;
  return 0;
}
export const tierLabel = (t) => TIER_LABEL[t] || "?";

/** Perfil goleador de cada quiniela: total de goles, media, empates, mayor goleada. */
export function goalProfiles(predictions) {
  return predictions.map((p) => {
    let total = 0, matches = 0, draws = 0, homeWins = 0, awayWins = 0;
    let biggest = null;
    for (const m of predMatches(p)) {
      const t = m.hg + m.ag;
      total += t; matches++;
      const s = sign(m.hg, m.ag);
      if (s === "D") draws++; else if (s === "H") homeWins++; else awayWins++;
      if (!biggest || t > biggest.total || (t === biggest.total && Math.abs(m.hg - m.ag) > Math.abs(biggest.hg - biggest.ag)))
        biggest = { id: m.id, home: m.home, away: m.away, hg: m.hg, ag: m.ag, total: t };
    }
    return { nick: p.nick, total, matches, avg: matches ? round1(total / matches) : 0, draws, homeWins, awayWins, biggest };
  });
}

/** Totales por equipo agregando TODAS las quinielas: GF, GC, DG, apariciones, veces campeón/finalista. */
export function teamTotals(predictions) {
  const map = new Map();
  const get = (id) => { if (!map.has(id)) map.set(id, { id, gf: 0, ga: 0, matches: 0, champions: 0, finalists: 0, semis: 0 }); return map.get(id); };
  for (const p of predictions) {
    for (const m of predMatches(p)) {
      const h = get(m.home), a = get(m.away);
      h.gf += m.hg; h.ga += m.ag; h.matches++;
      a.gf += m.ag; a.ga += m.hg; a.matches++;
    }
    const fin = p.knockout && p.knockout.M104;
    if (fin && fin.home) get(fin.home).finalists++;
    if (fin && fin.away) get(fin.away).finalists++;
    for (const id of ["M101", "M102"]) {
      const m = p.knockout && p.knockout[id];
      if (m && m.home) get(m.home).semis++;
      if (m && m.away) get(m.away).semis++;
    }
    if (p.champion) get(p.champion).champions++;
  }
  return [...map.values()].map((t) => ({ ...t, dg: t.gf - t.ga, avgGf: t.matches ? round1(t.gf / t.matches) : 0, avgGa: t.matches ? round1(t.ga / t.matches) : 0 }));
}

/** Afinidad de cada quiniela con un equipo: GF/GC que le pone y hasta qué ronda lo lleva. */
export function teamAffinity(predictions, teamId) {
  return predictions.map((p) => {
    const g = teamGoals(p, teamId);
    const tier = teamTier(p, teamId);
    return { nick: p.nick, gf: g.gf, ga: g.ga, matches: g.matches, tier, tierLabel: tierLabel(tier), champion: p.champion === teamId };
  });
}

/** Reparto: a cuántas quinielas llega el equipo a cada ronda (de campeón a fuera en grupos). */
export function teamReach(predictions, teamId) {
  const buckets = [0, 0, 0, 0, 0, 0, 0];
  const byTier = [[], [], [], [], [], [], []];
  for (const p of predictions) { const t = teamTier(p, teamId); buckets[t]++; byTier[t].push(p.nick); }
  return TIER_LABEL.map((label, t) => ({ tier: t, label, count: buckets[t], nicks: byTier[t].sort() })).reverse();
}

/** Índice contrarian: media de "rareza" del signo elegido en los partidos de grupo (0-100). */
export function contrarianIndex(predictions) {
  const ids = new Set();
  for (const p of predictions) for (const id in p.groupMatches) { const m = p.groupMatches[id]; if (m && m.hg != null && m.ag != null) ids.add(id); }
  // Distribución de signos por partido.
  const dist = new Map();
  for (const id of ids) {
    const c = { H: 0, D: 0, A: 0, total: 0 };
    for (const p of predictions) { const m = p.groupMatches[id]; if (m && m.hg != null && m.ag != null) { c[sign(m.hg, m.ag)]++; c.total++; } }
    dist.set(id, c);
  }
  return predictions.map((p) => {
    let sum = 0, n = 0;
    for (const id of ids) {
      const m = p.groupMatches[id]; if (!m || m.hg == null) continue;
      const c = dist.get(id); if (!c.total) continue;
      sum += 1 - c[sign(m.hg, m.ag)] / c.total; n++;
    }
    return { nick: p.nick, rarity: n ? round1((sum / n) * 100) : 0, picks: n };
  });
}

/** Parejas de quinielas más parecidas y quiniela más solitaria, por signos de grupo. */
export function similarity(predictions) {
  const vecs = predictions.map((p) => {
    const v = new Map();
    for (const id in p.groupMatches) { const m = p.groupMatches[id]; if (m && m.hg != null && m.ag != null) v.set(id, sign(m.hg, m.ag)); }
    return { nick: p.nick, v };
  });
  const pairs = [];
  const best = new Map(vecs.map((x) => [x.nick, { sim: -1, other: null, agree: 0, common: 0 }]));
  for (let i = 0; i < vecs.length; i++) for (let j = i + 1; j < vecs.length; j++) {
    const A = vecs[i], B = vecs[j];
    let agree = 0, common = 0;
    for (const [id, s] of A.v) if (B.v.has(id)) { common++; if (B.v.get(id) === s) agree++; }
    const sim = common ? round1((agree / common) * 100) : 0;
    pairs.push({ a: A.nick, b: B.nick, sim, agree, common });
    for (const [me, other] of [[A.nick, B.nick], [B.nick, A.nick]]) {
      const cur = best.get(me);
      if (sim > cur.sim) best.set(me, { sim, other, agree, common });
    }
  }
  pairs.sort((x, y) => y.sim - x.sim || y.agree - x.agree);
  const loners = [...best.entries()].map(([nick, b]) => ({ nick, bestSim: b.sim, closest: b.other }))
    .sort((x, y) => x.bestSim - y.bestSim);
  return { mostSimilar: pairs.slice(0, 5), loner: loners[0] || null, loners: loners.slice(0, 5) };
}

/** Reparto de finalistas pronosticados (los dos equipos de la M104 de cada quiniela). */
export function finalistDistribution(predictions) {
  const c = new Map();
  for (const p of predictions) { const m = p.knockout && p.knockout.M104; if (!m) continue; for (const t of [m.home, m.away]) if (t) c.set(t, (c.get(t) || 0) + 1); }
  const total = predictions.length;
  return [...c.entries()].sort((a, b) => b[1] - a[1]).map(([id, count]) => ({ id, count, pct: total ? Math.round((count / total) * 100) : 0 }));
}

/** Pistoleros: marcadores exactos clavados sobre los partidos YA jugados (grupo + KO). */
export function sharpshooters(predictions, official) {
  const played = [];
  for (const id in official.groupMatches) { const m = official.groupMatches[id]; if (m && m.hg != null && m.ag != null) played.push({ id, phase: "group", m }); }
  for (const id in official.knockout) { const m = official.knockout[id]; if (m && m.hg != null && m.ag != null && m.qualified) played.push({ id, phase: "ko", m }); }
  return predictions.map((p) => {
    let exact = 0, sign1x2 = 0;
    for (const { id, phase, m } of played) {
      const pm = phase === "group" ? p.groupMatches[id] : p.knockout[id];
      if (!pm || pm.hg == null || pm.ag == null) continue;
      if (phase === "ko" && !(pm.home === m.home && pm.away === m.away)) continue; // el cruce debe coincidir
      if (sign(pm.hg, pm.ag) === sign(m.hg, m.ag)) sign1x2++;
      if (pm.hg === m.hg && pm.ag === m.ag) exact++;
    }
    return { nick: p.nick, exact, sign1x2, played: played.length };
  }).sort((a, b) => b.exact - a.exact || b.sign1x2 - a.sign1x2 || a.nick.localeCompare(b.nick));
}

/** Marcador más pronosticado del torneo (sobre todos los partidos de todas las quinielas). */
export function scorelineDistribution(predictions) {
  const c = new Map();
  let total = 0;
  for (const p of predictions) for (const m of predMatches(p)) { const k = `${m.hg}-${m.ag}`; c.set(k, (c.get(k) || 0) + 1); total++; }
  return [...c.entries()].sort((a, b) => b[1] - a[1]).map(([score, count]) => ({ score, count, pct: total ? Math.round((count / total) * 1000) / 10 : 0 }));
}

// Helpers de "premio": el/los que maximizan (o minimizan) un valor, con empates.
const winnersBy = (arr, val, dir = "max") => {
  if (!arr.length) return { value: null, nicks: [] };
  const best = arr.reduce((b, x) => (dir === "max" ? Math.max(b, val(x)) : Math.min(b, val(x))), dir === "max" ? -Infinity : Infinity);
  return { value: best, nicks: arr.filter((x) => val(x) === best).map((x) => x.nick) };
};

/**
 * Empaqueta todas las curiosidades en un objeto listo para pintar. `spainId` = equipo
 * estrella del titular (España por defecto). Solo devuelve lo que se puede calcular.
 */
export function buildFunStats(predictions, official, spainId = "ES") {
  const profiles = goalProfiles(predictions).sort((a, b) => b.total - a.total);
  const totalsAll = teamTotals(predictions);
  const contrarian = contrarianIndex(predictions).sort((a, b) => b.rarity - a.rarity);
  const sims = similarity(predictions);
  const sharp = sharpshooters(predictions, official);
  const anyPlayed = sharp.length && sharp[0].played > 0;
  const avgGoals = profiles.length ? round1(profiles.reduce((s, x) => s + x.total, 0) / profiles.reduce((s, x) => s + x.matches, 0)) : 0;
  const biggest = profiles.map((p) => p.biggest).filter(Boolean).sort((a, b) => b.total - a.total || Math.abs(b.hg - b.ag) - Math.abs(a.hg - a.ag))[0] || null;
  const biggestBy = biggest ? profiles.filter((p) => p.biggest && p.biggest.total === biggest.total).map((p) => p.nick) : [];

  return {
    n: predictions.length,
    goals: {
      profiles,
      avgGoals,
      goleador: winnersBy(profiles, (x) => x.total, "max"),
      tacano: winnersBy(profiles, (x) => x.total, "min"),
      empates: winnersBy(profiles, (x) => x.draws, "max"),
      valiente: winnersBy(profiles, (x) => x.awayWins, "max"), // el que más victorias visitantes mete
      biggest, biggestBy,
      commonScore: scorelineDistribution(predictions).slice(0, 6),
    },
    teams: {
      all: totalsAll,
      goleadores: [...totalsAll].sort((a, b) => b.gf - a.gf).slice(0, 8),
      coladeros: [...totalsAll].sort((a, b) => b.ga - a.ga).slice(0, 8),
      mejorDg: [...totalsAll].sort((a, b) => b.dg - a.dg).slice(0, 5),
      peorDg: [...totalsAll].sort((a, b) => a.dg - b.dg).slice(0, 5),
    },
    star: {
      id: spainId,
      affinity: teamAffinity(predictions, spainId).sort((a, b) => b.tier - a.tier || b.gf - a.gf || a.ga - b.ga),
      reach: teamReach(predictions, spainId),
      fans: (() => { const a = teamAffinity(predictions, spainId); const best = a.reduce((m, x) => Math.max(m, x.gf), 0); return { value: best, nicks: a.filter((x) => x.gf === best).map((x) => x.nick) }; })(),
      verdugos: (() => { const a = teamAffinity(predictions, spainId); const best = a.reduce((m, x) => Math.max(m, x.ga), 0); return { value: best, nicks: a.filter((x) => x.ga === best).map((x) => x.nick) }; })(),
      earliest: (() => { const a = teamAffinity(predictions, spainId); const worst = a.reduce((m, x) => Math.min(m, x.tier), 6); return { tier: worst, label: tierLabel(worst), nicks: a.filter((x) => x.tier === worst).map((x) => x.nick) }; })(),
    },
    character: {
      contrarian,
      rebelde: winnersBy(contrarian, (x) => x.rarity, "max"),
      borrego: winnersBy(contrarian, (x) => x.rarity, "min"),
      twins: sims.mostSimilar[0] || null,
      moreTwins: sims.mostSimilar,
      loner: sims.loner,
    },
    finalists: finalistDistribution(predictions),
    sharp: anyPlayed ? { list: sharp, played: sharp[0].played, best: sharp[0] } : null,
  };
}
