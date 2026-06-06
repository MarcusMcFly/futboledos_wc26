// Visualizador / clasificacion. Cruza participants.json ∩ results.json contra
// el catalogo y calcula el scoring en tiempo de render. (Spec 10)
// @ts-check
import { loadCatalog, loadParticipants, loadResults } from "./data.js";
import { buildLeaderboard } from "./scoring.js";

const $app = /** @type {HTMLElement} */ (document.getElementById("app"));

/** @param {string} message */
function renderError(message) {
  $app.innerHTML = `<div class="error-state"><p>⚠️ No se pudieron cargar los datos.</p><p class="muted">${escapeHtml(
    message,
  )}</p></div>`;
}

/** @param {string} s */
function escapeHtml(s) {
  return s.replace(
    /[&<>"']/g,
    (c) =>
      ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[
        c
      ] ?? c,
  );
}

/**
 * @param {import("./types.js").Catalog} catalog
 */
function deadlineBannerHtml(catalog) {
  const closed = Date.now() >= new Date(catalog.closes_at).getTime();
  const when = new Date(catalog.closes_at).toLocaleString("es-ES", {
    dateStyle: "long",
    timeStyle: "short",
  });
  return `<div class="banner ${closed ? "danger" : "warn"}">${
    closed
      ? `⏱️ Predicciones cerradas (cierre: ${when}).`
      : `⏱️ Cierre de predicciones: ${when}`
  }</div>`;
}

/**
 * @param {import("./types.js").ScoredParticipant[]} rows
 */
function leaderboardHtml(rows) {
  if (rows.length === 0)
    return `<p class="muted">Aún no hay participantes.</p>`;
  const items = rows
    .map((p, i) => {
      const pool = p.pool_name
        ? `<span class="lb-pool"> · ${escapeHtml(p.pool_name)}</span>`
        : "";
      const contra =
        p.contradictions.length > 0
          ? `<div class="contradiction">⚠️ predicciones contradictorias: ${p.contradictions
              .map((g) => g.join(" / "))
              .join("; ")}</div>`
          : "";
      return `<div class="lb-row"><span class="lb-rank">${
        i + 1
      }</span><span class="lb-name">${escapeHtml(
        p.nickname,
      )}${pool}${contra}</span><span class="lb-score">${p.score}</span></div>`;
    })
    .join("");
  return `<div class="panel">${items}</div>`;
}

/**
 * @param {import("./types.js").Participant[]} participants
 * @param {string} selected
 */
function poolFilterHtml(participants, selected) {
  const pools = [
    ...new Set(participants.map((p) => p.pool_name).filter(Boolean)),
  ].sort();
  const opts = ['<option value="">Todos</option>']
    .concat(
      pools.map(
        (p) =>
          `<option value="${escapeHtml(/** @type {string} */ (p))}"${
            p === selected ? " selected" : ""
          }>${escapeHtml(/** @type {string} */ (p))}</option>`,
      ),
    )
    .join("");
  return `<label>Pool<select id="pool-filter">${opts}</select></label>`;
}

async function main() {
  $app.innerHTML = `<div class="error-state muted">Cargando…</div>`;
  let catalog, parts, results;
  try {
    [catalog, parts, results] = await Promise.all([
      loadCatalog(),
      loadParticipants(),
      loadResults(),
    ]);
  } catch (e) {
    renderError(e instanceof Error ? e.message : String(e));
    return;
  }

  let pool = "";
  const render = () => {
    const filtered = pool
      ? parts.participants.filter((p) => p.pool_name === pool)
      : parts.participants;
    const rows = buildLeaderboard(filtered, results, catalog);
    $app.innerHTML = `
      <h1>Clasificación — ${escapeHtml(catalog.event)}</h1>
      ${deadlineBannerHtml(catalog)}
      ${poolFilterHtml(parts.participants, pool)}
      ${leaderboardHtml(rows)}
    `;
    const sel = /** @type {HTMLSelectElement|null} */ (
      document.getElementById("pool-filter")
    );
    sel?.addEventListener("change", () => {
      pool = sel.value;
      render();
    });
  };
  render();
}

main();
