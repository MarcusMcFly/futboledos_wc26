// Render + wiring de la fase de grupos: inputs de marcador por partido y la
// tabla de clasificación dinámica debajo. La tabla se recalcula al instante
// con cada cambio; el usuario nunca la edita a mano. (spec Dynamic Group Standings)
// @ts-check
import { computeStandings, teamsOf } from "./standings.js";

/** @typedef {import("./standings.js").Group} Group */
/** @typedef {import("./standings.js").Score} Score */
/** @typedef {import("./standings.js").StandingRow} StandingRow */

/** @param {string} s */
function esc(s) {
  return String(s).replace(
    /[&<>"']/g,
    (c) =>
      ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[
        c
      ] ?? c,
  );
}

/**
 * @param {Group} group
 * @returns {string}
 */
function matchInputsHtml(group) {
  return group.matches
    .map(
      (m) => `
      <div class="match" data-match="${esc(m.match_id)}">
        <span class="team home">${esc(m.home_team)}</span>
        <input type="number" min="0" inputmode="numeric"
               data-match="${esc(m.match_id)}" data-side="home"
               aria-label="Goles de ${esc(m.home_team)}">
        <span class="muted">×</span>
        <input type="number" min="0" inputmode="numeric"
               data-match="${esc(m.match_id)}" data-side="away"
               aria-label="Goles de ${esc(m.away_team)}">
        <span class="team away">${esc(m.away_team)}</span>
      </div>`,
    )
    .join("");
}

/**
 * @param {StandingRow[]} rows
 * @returns {string}
 */
function standingsTableHtml(rows) {
  const body = rows
    .map(
      (r) => `<tr>
        <td>${esc(r.team)}</td>
        <td>${r.J}</td><td>${r.G}</td><td>${r.E}</td><td>${r.P}</td>
        <td>${r.GF}</td><td>${r.GC}</td><td>${r.DG}</td>
        <td class="pts">${r.Pts}</td>
      </tr>`,
    )
    .join("");
  return `<table class="standings">
    <thead><tr>
      <th>Equipo</th><th>J</th><th>G</th><th>E</th><th>P</th>
      <th>GF</th><th>GC</th><th>DG</th><th>Pts</th>
    </tr></thead>
    <tbody>${body}</tbody>
  </table>`;
}

/**
 * @param {Group} group
 * @returns {string}
 */
function groupHtml(group) {
  return `<section class="group panel" data-group="${esc(group.group_id)}">
    <h3>Grupo ${esc(group.group_id)} <span class="muted">(${teamsOf(group)
      .length} equipos)</span></h3>
    ${matchInputsHtml(group)}
    <div class="standings-mount"></div>
  </section>`;
}

/**
 * Renderiza todos los grupos en el contenedor y cablea el recálculo inmediato.
 * @param {HTMLElement} container
 * @param {{ groups: Group[] }} groupsFile
 */
export function renderGroupStage(container, groupsFile) {
  container.innerHTML = groupsFile.groups.map(groupHtml).join("");

  for (const group of groupsFile.groups) {
    /** @type {Record<string, Score>} */
    const scores = {};
    const groupEl = /** @type {HTMLElement} */ (
      container.querySelector(`[data-group="${CSS.escape(group.group_id)}"]`)
    );
    const mount = /** @type {HTMLElement} */ (
      groupEl.querySelector(".standings-mount")
    );

    const renderTable = () => {
      mount.innerHTML = standingsTableHtml(computeStandings(group, scores));
    };

    for (const input of /** @type {NodeListOf<HTMLInputElement>} */ (
      groupEl.querySelectorAll('input[type="number"]')
    )) {
      input.addEventListener("input", () => {
        const matchId = input.dataset.match;
        const side = /** @type {"home"|"away"} */ (input.dataset.side);
        if (!matchId || !side) return;
        if (!scores[matchId]) scores[matchId] = { home: null, away: null };
        const raw = input.value.trim();
        // Vacío -> null (partido incompleto, no afecta). (spec)
        scores[matchId][side] = raw === "" ? null : Number(raw);
        renderTable(); // actualización inmediata
      });
    }

    renderTable(); // tabla inicial (todo a cero)
  }
}
