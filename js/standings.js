// Clasificación dinámica de grupo, calculada en cliente a partir de los
// resultados que introduce el usuario. El usuario NO edita la tabla a mano.
// Esquema de entrada: data/groups.json (schema_version 1).
// @ts-check

/**
 * @typedef {Object} Match
 * @property {string} match_id
 * @property {string} home_team
 * @property {string} away_team
 */

/**
 * @typedef {Object} Group
 * @property {string} group_id
 * @property {Match[]} matches
 */

/**
 * @typedef {Object} GroupsFile
 * @property {number} schema_version
 * @property {string} competition
 * @property {Group[]} groups
 */

/**
 * Marcador introducido por el usuario para un partido. home/away pueden ser
 * null mientras el partido está incompleto.
 * @typedef {{ home: number|null, away: number|null }} Score
 */

/**
 * Fila de la tabla de clasificación.
 * @typedef {Object} StandingRow
 * @property {string} team
 * @property {number} J    Partidos jugados (completados).
 * @property {number} G    Victorias.
 * @property {number} E    Empates.
 * @property {number} P    Derrotas.
 * @property {number} GF   Goles a favor.
 * @property {number} GC   Goles en contra.
 * @property {number} DG   Diferencia de goles (GF - GC).
 * @property {number} Pts  Puntos (victoria 3, empate 1, derrota 0).
 */

/**
 * Equipos del grupo, derivados de los partidos (el esquema no los lista aparte).
 * Orden de primera aparición para estabilidad.
 * @param {Group} group
 * @returns {string[]}
 */
export function teamsOf(group) {
  /** @type {string[]} */
  const teams = [];
  const seen = new Set();
  for (const m of group.matches) {
    for (const t of [m.home_team, m.away_team]) {
      if (!seen.has(t)) {
        seen.add(t);
        teams.push(t);
      }
    }
  }
  return teams;
}

/**
 * Un partido cuenta solo si AMBOS goles son números válidos. Vacío/null no afecta.
 * @param {Score|undefined} score
 * @returns {score is { home: number, away: number }}
 */
export function isCompleted(score) {
  return (
    !!score &&
    typeof score.home === "number" &&
    typeof score.away === "number" &&
    Number.isFinite(score.home) &&
    Number.isFinite(score.away)
  );
}

/**
 * Calcula la tabla de clasificación de un grupo a partir de los marcadores.
 * Solo los partidos completados afectan. (regla MVP)
 * @param {Group} group
 * @param {Record<string, Score>} scores  Indexado por match_id.
 * @returns {StandingRow[]}
 */
export function computeStandings(group, scores) {
  /** @type {Map<string, StandingRow>} */
  const table = new Map();
  for (const team of teamsOf(group)) {
    table.set(team, {
      team,
      J: 0,
      G: 0,
      E: 0,
      P: 0,
      GF: 0,
      GC: 0,
      DG: 0,
      Pts: 0,
    });
  }

  for (const match of group.matches) {
    const score = scores[match.match_id];
    if (!isCompleted(score)) continue; // partido incompleto: no afecta
    const home = table.get(match.home_team);
    const away = table.get(match.away_team);
    if (!home || !away) continue;

    home.J += 1;
    away.J += 1;
    home.GF += score.home;
    home.GC += score.away;
    away.GF += score.away;
    away.GC += score.home;

    if (score.home > score.away) {
      home.G += 1;
      home.Pts += 3;
      away.P += 1;
    } else if (score.home < score.away) {
      away.G += 1;
      away.Pts += 3;
      home.P += 1;
    } else {
      home.E += 1;
      away.E += 1;
      home.Pts += 1;
      away.Pts += 1;
    }
  }

  const rows = [...table.values()];
  for (const r of rows) r.DG = r.GF - r.GC;

  // Orden MVP: 1) Pts, 2) DG, 3) GF, 4) nombre alfabético.
  rows.sort(
    (a, b) =>
      b.Pts - a.Pts ||
      b.DG - a.DG ||
      b.GF - a.GF ||
      a.team.localeCompare(b.team),
  );
  return rows;
}
