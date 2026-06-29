// Visualizador (Parte 2). Router por query param:
//   (sin parámetro | ?view=all)  → clasificación general + pools
//   ?pool=<slug>                 → detalle de un pool
//   ?nick=<nick>                 → detalle de un participante (desglose SPEC §12)
// Todo se calcula en cliente desde las predicciones + el resultado oficial.
// @ts-check
import { loadRegistry, loadRules, loadTeams, loadOfficial, loadSubmission, loadLatestSnapshot } from "./data.js";
import { parsePrediction } from "./parse_prediction.js";
import { buildLeaderboard } from "./leaderboard.js";
import { buildPoolRanking } from "./pools.js";
import { groupMatchDistribution, contrarianOutcome, exactHeroes, globalAccuracy, championDistribution, groupStandings, groupCrossStats, koMatchDistribution, koHeroes } from "./stats.js";
import { computeMovements, topMovers, newLeader } from "./history.js";

const $app = /** @type {HTMLElement} */ (document.getElementById("app"));
let TEAMS = {};

const esc = (s) => String(s).replace(/[&<>"']/g, (c) =>
  ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
const teamName = (id) => (TEAMS[id] && TEAMS[id].name) || id || "?";
const renderError = (msg) => { $app.innerHTML = `<div class="error-state"><p>⚠️ ${esc(msg)}</p></div>`; };

const ROUND_LABEL = {
  DIECISEISAVOS: "Dieciseisavos", OCTAVOS: "Octavos", CUARTOS: "Cuartos",
  SEMIS: "Semifinales", TERCER_PUESTO: "Tercer puesto", FINAL: "Final",
};

// ── Carga + enrutado ─────────────────────────────────────────────────────────
async function main() {
  $app.innerHTML = `<div class="loading muted">Cargando…</div>`;
  let registry, rules, teamsFile, officialText, snapshot;
  try {
    [registry, rules, teamsFile, officialText, snapshot] = await Promise.all(
      [loadRegistry(), loadRules(), loadTeams(), loadOfficial(), loadLatestSnapshot()]);
  } catch (e) { return renderError(e instanceof Error ? e.message : String(e)); }
  TEAMS = teamsFile.teams || {};
  const official = parsePrediction(officialText || "");

  let subs;
  try {
    subs = await Promise.all(registry.participants.map(async (p) =>
      ({ nick: p.nick, prediction: parsePrediction(await loadSubmission(p.file)) })));
  } catch (e) { return renderError("No se pudo cargar una predicción: " + (e instanceof Error ? e.message : e)); }

  const board = buildLeaderboard(subs, official, rules);
  const byNick = new Map(board.map((s) => [s.nick, s]));
  const predByNick = new Map(subs.map((s) => [s.nick, s.prediction]));
  const poolRanking = buildPoolRanking(registry.pools, byNick, rules);
  const poolsByNick = poolMembership(registry.pools);
  const predictions = subs.map((s) => s.prediction);
  const movements = computeMovements(board, snapshot);
  const ctx = { registry, rules, official, board, byNick, predByNick, predictions, poolRanking, poolsByNick, snapshot, movements };

  const params = new URLSearchParams(location.search);
  const nick = params.get("nick"), pool = params.get("pool");
  const match = params.get("match"), komatch = params.get("komatch"), view = params.get("view");
  if (nick) renderUser(ctx, nick);
  else if (pool) renderPool(ctx, pool);
  else if (match) renderMatch(ctx, match);
  else if (komatch) renderKoMatch(ctx, komatch);
  else if (view === "matches") renderMatches(ctx);
  else if (view === "ko-matches") renderKoMatches(ctx);
  else if (view === "scoring") renderScoring(ctx);
  else renderHome(ctx);
}

function poolMembership(pools) {
  const map = new Map();
  for (const p of pools) for (const n of p.members) {
    if (!map.has(n)) map.set(n, []);
    map.get(n).push(p);
  }
  return map;
}

// ── Estado del torneo (banner) ───────────────────────────────────────────────
function officialProgress(official) {
  const g = Object.values(official.groupMatches);
  const groupDone = g.filter((m) => m.hg != null && m.ag != null).length;
  const ko = Object.values(official.knockout);
  const koDone = ko.filter((m) => m.hg != null && m.ag != null && m.qualified).length;
  return { groupDone, koDone, champion: official.champion };
}

function statusBanner(official) {
  const { groupDone, koDone, champion } = officialProgress(official);
  if (groupDone === 0) return `<div class="banner warn">⏳ El torneo aún no ha empezado: no hay resultados oficiales. Las puntuaciones aparecerán a 0 hasta que se carguen.</div>`;
  if (champion) return `<div class="banner ok-banner">🏆 Torneo finalizado. Campeón oficial: <strong>${esc(teamName(champion))}</strong>.</div>`;
  // Fase de grupos completa: lo anuncia el banner de "Fase de grupos completada".
  // Mientras no haya eliminatorias, no mostramos el aviso provisional de grupos.
  if (groupDone >= 72) {
    if (!koDone) return "";
    return `<div class="banner warn">📊 Eliminatorias: ${koDone}/32 partidos disputados. Puntuación provisional, se recalcula con cada resultado.</div>`;
  }
  const parts = [`${groupDone}/72 partidos de grupo`];
  if (koDone) parts.push(`${koDone}/32 de eliminatoria`);
  return `<div class="banner warn">📊 Resultados oficiales cargados: ${parts.join(" · ")}. Puntuación provisional, se recalcula con cada resultado.</div>`;
}

// Lista de grupos que ya tienen sus 6 partidos jugados (y por tanto puntúan en el
// ranking de grupo). Se muestra debajo del statusBanner mientras haya alguno cerrado
// pero el torneo no haya terminado.
function completedGroupsBanner(official) {
  const byGroup = {};
  for (const [id, m] of Object.entries(official.groupMatches)) {
    const grp = id.split("_")[0];
    (byGroup[grp] = byGroup[grp] || []).push(m);
  }
  const done = Object.keys(byGroup)
    .filter((grp) => byGroup[grp].length === 6 && byGroup[grp].every((m) => m.hg != null && m.ag != null))
    .sort();
  if (!done.length) return "";
  if (done.length < 12)
    return `<div class="banner ok-banner">✅ Grupos completos: <strong>${done.join(" · ")}</strong>. Su ranking de grupo ya está consolidado.</div>`;
  // Los 12 grupos cerrados: mensaje de fase de grupos completada + los 8 mejores terceros.
  const thirds = official.thirdsQualified || [];
  const thirdsHtml = thirds.length
    ? `<br>🥉 <strong>8 mejores terceros clasificados:</strong> ${thirds
        .map((t) => `${esc(teamName(t.id))} <span class="muted">(${esc(t.group)})</span>`)
        .join(" · ")}`
    : "";
  return `<div class="banner ok-banner">🏁 <strong>¡Fase de grupos completada!</strong> Los 12 grupos están cerrados y sus rankings consolidados.${thirdsHtml}</div>`;
}

// ── Vista: clasificación general ─────────────────────────────────────────────
// Fecha + hora de la fecha límite, fijada a la zona horaria del evento para que
// no cambie según el navegador (la hora coincide con el inicio del 1er partido).
function deadlineWhen(iso) {
  const d = new Date(iso);
  const tz = "Europe/Madrid";
  const fecha = d.toLocaleDateString("es-ES", { day: "numeric", month: "long", year: "numeric", timeZone: tz });
  const hora = d.toLocaleTimeString("es-ES", { hour: "2-digit", minute: "2-digit", timeZone: tz });
  return `${fecha} a las ${hora}`;
}

function deadlineBanner(rules) {
  const iso = rules && rules.meta && rules.meta.submission_deadline;
  if (!iso) return "";
  const closed = Date.now() >= new Date(iso).getTime();
  if (closed) return "";
  const when = deadlineWhen(iso);
  return `<div class="banner">⏱️ Las predicciones se cierran el ${when} (inicio del primer partido). <a href="./predicciones.html">Haz la tuya</a>.</div>`;
}

// Aviso de que los resultados/puntuaciones mostrados no son reales todavía.
// Controlado por meta.simulation en scoring_rules.json: quítalo (o ponlo a false)
// cuando se carguen resultados oficiales reales.
function simulationBanner(rules) {
  const sim = rules && rules.meta && rules.meta.simulation;
  if (!sim) return "";
  return `<div class="banner warn">🧪 <strong>Simulación:</strong> los resultados y las puntuaciones que se muestran son de prueba, no oficiales. El torneo aún no ha empezado.</div>`;
}

// Saludo de arranque: solo mientras no haya resultados oficiales (el pistoletazo
// de salida). En cuanto se cargue el primer resultado, lo releva el statusBanner.
function welcomeBanner(official) {
  const { groupDone, champion } = officialProgress(official);
  if (groupDone > 0 || champion) return "";
  return `<div class="banner welcome">🎉 <strong>¡El torneo da comienzo!</strong> Las predicciones están echadas y ahora solo queda rodar el balón. Mucha suerte a todos y… <strong>¡Feliz Mundial 2026!</strong> ⚽🌎</div>`;
}

function renderHome(ctx) {
  document.title = "Clasificación · Futboledos WC26";
  $app.innerHTML = `
    ${welcomeBanner(ctx.official)}
    ${deadlineBanner(ctx.rules)}
    ${simulationBanner(ctx.rules)}
    ${statusBanner(ctx.official)}
    ${completedGroupsBanner(ctx.official)}
    <div class="view-head"><h1>Clasificación general</h1><span class="muted">${ctx.board.length} participantes</span></div>
    ${leaderboardTable(ctx, ctx.board, { showPools: true })}
    ${ctx.movements.hasSnapshot ? `<h2 class="section">Movimiento <span class="muted">· desde ${esc(ctx.snapshot.label || "el último corte")}</span></h2>${topMoversPanel(ctx)}` : ""}
    <h2 class="section">Competición por pools <span class="muted">· media por participante activo</span></h2>
    ${poolTable(ctx)}
    <h2 class="section">Estadísticas del torneo</h2>
    ${statsPanel(ctx)}
    <p class="legend muted">Total = grupos + ranking de grupo + mejores terceros + eliminatorias + bonus de progresión. Pulsa un nombre para ver su desglose, o <a href="?view=scoring">cómo se puntúa</a>.</p>`;
}

// Panel de engagement: precisión global + campeón más votado + acceso a partidos.
function statsPanel(ctx) {
  const acc = globalAccuracy(ctx.predictions, ctx.official, ctx.board);
  const champs = championDistribution(ctx.predictions);
  const accCards = acc.completedMatches
    ? `<div class="cards">
        <div class="card"><div class="card-n">${acc.correctSignPct}%</div><div class="card-l">Aciertos de signo</div></div>
        <div class="card"><div class="card-n">${acc.exactPct}%</div><div class="card-l">Marcadores exactos</div></div>
        <div class="card"><div class="card-n">${acc.avgPointsUser}</div><div class="card-l">Media de puntos</div></div>
        <div class="card"><div class="card-n">${acc.completedMatches}/72</div><div class="card-l">Partidos jugados</div></div>
      </div>`
    : `<p class="muted">Sin partidos oficiales aún: la precisión global aparecerá cuando se carguen resultados.</p>`;
  const champList = champs.length
    ? `<div class="champ-fav"><h3>Campeón más votado 🏆</h3>${champs.slice(0, 5).map((c) => `
        <div class="bar-row"><span class="bar-l">${esc(teamName(c.id))}</span>
          <span class="bar-track"><span class="bar-fill" style="width:${c.pct}%"></span></span>
          <b class="bar-v">${c.count}</b></div>`).join("")}</div>`
    : "";
  return `${accCards}${champList}<p><a class="more" href="?view=matches">Ver distribución de predicciones por partido →</a></p>`;
}

function leaderboardTable(ctx, rows, { showPools = false, poolInternal = false } = {}) {
  if (!rows.length) return `<p class="muted">Aún no hay participantes.</p>`;
  const showMov = !poolInternal && ctx.movements.hasSnapshot;
  const body = rows.map((s, i) => {
    const chips = showPools ? poolChips(ctx, s.nick) : "";
    const pos = poolInternal ? i + 1 : s.rank;
    const mov = showMov ? `<td class="lb-mov">${moveIndicator(ctx.movements.map.get(s.nick))}</td>` : "";
    return `<tr>
      <td class="lb-pos">${pos}</td>${mov}
      <td class="lb-who"><a href="?nick=${encodeURIComponent(s.nick)}">${esc(s.nick)}</a>${chips}</td>
      <td class="lb-total">${s.score.total}</td>
      <td>${s.score.group_match_points}</td>
      <td>${s.score.group_ranking_points}</td>
      <td>${s.score.best_third_points}</td>
      <td>${s.score.knockout_match_points}</td>
      <td>${s.score.progression_bonus_points}</td>
      <td>${s.details.exact_scores}</td>
    </tr>`;
  }).join("");
  return `<table class="lb"><thead><tr>
      <th>#</th>${showMov ? "<th title='Movimiento desde el último corte'>Mov</th>" : ""}<th>Participante</th><th>Total</th>
      <th title="Partidos de grupo">Gru</th><th title="Ranking de grupo">Rnk</th>
      <th title="Mejores terceros">3º</th><th title="Eliminatorias">KO</th>
      <th title="Bonus de progresión">Bon</th><th title="Marcadores exactos">Exa</th>
    </tr></thead><tbody>${body}</tbody></table>`;
}

// Indicador de movimiento de ranking (SPEC 08 §10).
function moveIndicator(mv) {
  if (!mv) return "";
  if (mv.isNew) return `<span class="mv new" title="Nuevo">●</span>`;
  if (mv.movement == null) return "";
  if (mv.movement > 0) return `<span class="mv up" title="Sube ${mv.movement}">▲${mv.movement}</span>`;
  if (mv.movement < 0) return `<span class="mv down" title="Baja ${-mv.movement}">▼${-mv.movement}</span>`;
  return `<span class="mv flat" title="Sin cambios">=</span>`;
}

// Panel de top movers + nuevo líder (SPEC 08 §10). Vacío si no hay snapshot.
function topMoversPanel(ctx) {
  if (!ctx.movements.hasSnapshot) return "";
  const movers = topMovers(ctx.board, ctx.movements);
  const nl = newLeader(ctx.board, ctx.snapshot);
  if (!movers.length && !nl) return `<p class="muted">Sin cambios en la clasificación desde el último corte.</p>`;
  let html = "";
  if (nl) html += `<p class="badge-line">👑 <strong>Nuevo líder:</strong> <a href="?nick=${encodeURIComponent(nl)}">${esc(nl)}</a></p>`;
  if (movers.length) html += `<div class="movers">${movers.map((m) =>
    `<a class="mover" href="?nick=${encodeURIComponent(m.nick)}"><span class="mv up">▲${m.movement}</span> ${esc(m.nick)}</a>`).join("")}</div>`;
  return html;
}

function poolChips(ctx, nick) {
  const pools = ctx.poolsByNick.get(nick) || [];
  return pools.map((p) => `<a class="chip" href="?pool=${encodeURIComponent(p.slug)}">${esc(p.name)}</a>`).join("");
}

function poolTable(ctx) {
  const { eligible, notEligible } = ctx.poolRanking;
  if (!eligible.length && !notEligible.length) return `<p class="muted">No hay pools configurados.</p>`;
  const row = (p, rankCell) => `<tr>
      <td class="lb-pos">${rankCell}</td>
      <td class="lb-who"><a href="?pool=${encodeURIComponent(p.slug)}">${esc(p.name)}</a></td>
      <td class="lb-total">${p.average.toFixed(1)}</td>
      <td>${p.totalPoints}</td>
      <td>${p.activeCount}</td>
    </tr>`;
  const elig = eligible.map((p) => row(p, p.rank)).join("");
  const notElig = notEligible.map((p) => row(p, "—")).join("");
  return `<table class="lb"><thead><tr>
      <th>#</th><th>Pool</th><th title="Media de puntos por participante activo">Media</th>
      <th>Total</th><th title="Participantes activos">Act.</th>
    </tr></thead><tbody>${elig}${notElig}</tbody></table>
    ${notEligible.length ? `<p class="legend muted">Pools con menos de ${ctx.rules.pool.min_active_participants} activos no entran en el ranking oficial.</p>` : ""}`;
}

// ── Vista: pool ──────────────────────────────────────────────────────────────
function renderPool(ctx, slug) {
  const pool = ctx.registry.pools.find((p) => p.slug === slug);
  if (!pool) return renderError(`Pool "${slug}" no encontrado.`);
  const stats = [...ctx.poolRanking.eligible, ...ctx.poolRanking.notEligible].find((p) => p.slug === slug);
  const members = pool.members.map((n) => ctx.byNick.get(n)).filter(Boolean)
    .sort((a, b) => b.score.total - a.score.total);
  document.title = `${pool.name} · Futboledos WC26`;
  const elig = stats && stats.eligible;
  const rankLine = elig
    ? `Puesto en el ranking de pools: <strong>#${stats.rank}</strong>`
    : `<span class="muted">No elegible para el ranking de pools (necesita ${ctx.rules.pool.min_active_participants} activos)</span>`;
  $app.innerHTML = `
    <p><a class="back" href="?view=all">← Clasificación general</a></p>
    <h1>${esc(pool.name)}</h1>
    <div class="cards">
      <div class="card"><div class="card-n">${stats ? stats.average.toFixed(1) : "0"}</div><div class="card-l">Media / activo</div></div>
      <div class="card"><div class="card-n">${stats ? stats.totalPoints : 0}</div><div class="card-l">Puntos totales</div></div>
      <div class="card"><div class="card-n">${stats ? stats.activeCount : 0}</div><div class="card-l">Activos</div></div>
    </div>
    <p>${rankLine}</p>
    <h2 class="section">Miembros</h2>
    ${leaderboardTable(ctx, members, { poolInternal: true })}`;
}

// ── Vista: participante ──────────────────────────────────────────────────────
function renderUser(ctx, nick) {
  const s = ctx.byNick.get(nick);
  const pred = ctx.predByNick.get(nick);
  if (!s || !pred) return renderError(`Participante "${nick}" no encontrado.`);
  document.title = `${nick} · Futboledos WC26`;
  const d = s.details, sc = s.score;
  // Rankings de grupo "perfectos": orden exacto acertado (la puntuación máxima del
  // grupo, +23 ó +25 con el bonus de orden completo). Solo cuentan grupos cerrados.
  const perfectRankGroups = GROUP_LETTERS.filter((g) => {
    const r = s.breakdown.groupRankDetails[g];
    return r && r.completeOrder;
  }).length;
  const chips = poolChips(ctx, nick) || `<span class="muted">sin pool</span>`;
  const champRow = ctx.official.champion
    ? `Campeón: <strong>${esc(teamName(pred.champion))}</strong> ${d.correct_champion ? "✅" : "❌ (oficial: " + esc(teamName(ctx.official.champion)) + ")"}`
    : `Campeón pronosticado: <strong>${esc(teamName(pred.champion))}</strong> <span class="muted">(pendiente)</span>`;

  $app.innerHTML = `
    <p><a class="back" href="?view=all">← Clasificación general</a></p>
    <div class="view-head"><h1>${esc(nick)}</h1><span>${chips}</span></div>
    <div class="cards">
      <div class="card big"><div class="card-n">${sc.total}</div><div class="card-l">Puntos · #${s.rank} general</div></div>
      ${ctx.movements.hasSnapshot ? `<div class="card"><div class="card-n">${moveIndicator(ctx.movements.map.get(nick)) || "—"}</div><div class="card-l">Movimiento</div></div>` : ""}
    </div>
    <h2 class="section">Desglose</h2>
    ${breakdownBars(sc)}
    <ul class="kv">
      <li><span>Marcadores exactos</span><b>${d.exact_scores}</b></li>
      <li><span>Resultados (signo) acertados</span><b>${d.correct_signs}</b></li>
      <li><span>Ganadores de grupo</span><b>${d.correct_group_winners}/12</b></li>
      <li><span>Rankings de grupo perfectos <span class="muted">(orden exacto)</span></span><b>${perfectRankGroups}/12</b></li>
      <li><span>Mejores terceros</span><b>${d.correct_best_thirds}/8</b></li>
      <li><span>Clasificados de eliminatoria</span><b>${d.correct_qualified_knockout_teams}/32</b></li>
    </ul>
    <p class="champ">${champRow}</p>
    <h2 class="section">Fase de grupos · partido a partido</h2>
    ${groupMatchBreakdown(ctx, s, pred)}
    <h2 class="section">Eliminatorias</h2>
    ${koBreakdown(ctx, s, pred)}`;
}

function breakdownBars(sc) {
  const items = [
    ["Partidos de grupo", sc.group_match_points],
    ["Ranking de grupo", sc.group_ranking_points],
    ["Mejores terceros", sc.best_third_points],
    ["Eliminatorias", sc.knockout_match_points],
    ["Bonus de progresión", sc.progression_bonus_points],
  ];
  const max = Math.max(1, ...items.map((i) => i[1]));
  return `<div class="bars">${items.map(([label, v]) => `
    <div class="bar-row"><span class="bar-l">${label}</span>
      <span class="bar-track"><span class="bar-fill" style="width:${Math.round((v / max) * 100)}%"></span></span>
      <b class="bar-v">${v}</b></div>`).join("")}</div>`;
}

const GROUP_LETTERS = "ABCDEFGHIJKL".split("");

function groupMatchBreakdown(ctx, scored, pred) {
  const off = ctx.official;
  return GROUP_LETTERS.map((g) => {
    const rows = [];
    for (let i = 1; i <= 6; i++) {
      const id = `${g}_0${i}`;
      const om = off.groupMatches[id]; if (!om) continue;
      const pm = pred.groupMatches[id];
      const res = scored.breakdown.groupMatchDetails[id] || { points: 0, status: "pending" };
      rows.push(matchLine(teamName(om.home), teamName(om.away), pm, om, res));
    }
    return `<div class="grp"><h3>Grupo ${g}</h3>${rows.join("")}${groupRankingTable(g, scored, pred)}</div>`;
  }).join("");
}

const POS_LABEL = ["1.º", "2.º", "3.º", "4.º"];

// Clasificación PRONOSTICADA del grupo + puntos que ha dado cada línea (acierto de
// plaza + bonus por clasificado). Mientras el grupo no esté cerrado, queda pendiente.
function groupRankingTable(g, scored, pred) {
  const det = scored.breakdown.groupRankDetails[g] || { status: "pending", lines: [], points: 0, completeBonus: 0 };
  const predOrder = pred.groupOrder[g] || [];
  const isScored = det.status === "scored";
  if (!isScored && !predOrder.length) return "";

  const rows = [];
  for (let i = 0; i < 4; i++) {
    const line = isScored ? det.lines[i] : null;
    const team = line ? line.team : (predOrder[i] || null);
    const mark = line && line.posCorrect ? " ✅" : "";
    const rowCls = line && line.posCorrect ? "rank-hit" : "";
    const offCell = line && line.official ? esc(teamName(line.official)) : "—";
    const ptsCell = isScored
      ? (line && line.points > 0 ? "+" + line.points : "0")
      : `<span class="muted">pte</span>`;
    rows.push(`<tr class="${rowCls}">
      <td class="lb-pos">${POS_LABEL[i]}</td>
      <td>${team ? esc(teamName(team)) : "—"}${mark}</td>
      <td class="muted">${offCell}</td>
      <td class="pts">${ptsCell}</td></tr>`);
  }

  let foot = "";
  if (isScored && det.completeBonus > 0)
    foot += `<tr class="rank-bonus"><td colspan="3">🎯 Orden completo acertado</td><td class="pts">+${det.completeBonus}</td></tr>`;
  foot += isScored
    ? `<tr class="rank-total"><td colspan="3">Total ranking del grupo</td><td class="pts">${det.points}</td></tr>`
    : `<tr><td colspan="4" class="muted">Se puntúa cuando el grupo esté completo.</td></tr>`;

  return `<table class="standings predrank">
    <thead><tr><th>#</th><th>Tu clasificación</th><th>Oficial</th><th>Pts</th></tr></thead>
    <tbody>${rows.join("")}</tbody>
    <tfoot>${foot}</tfoot></table>`;
}

function koBreakdown(ctx, scored, pred) {
  const off = ctx.official;
  const ids = Object.keys(off.knockout).sort((a, b) => Number(a.slice(1)) - Number(b.slice(1)));
  if (!ids.length) return `<p class="muted">El bracket oficial aún no está disponible.</p>`;
  let lastRound = null, html = "";
  for (const mid of ids) {
    const om = off.knockout[mid];
    if (om.round !== lastRound) { html += `<h3>${ROUND_LABEL[om.round] || om.round}</h3>`; lastRound = om.round; }
    const pm = pred.knockout[mid];
    const res = scored.breakdown.koDetails[mid] || { points: 0, status: "pending" };
    // Muestra el fixture y marcador PREDICHOS (pueden diferir del oficial).
    const homeN = teamName(pm && pm.home), awayN = teamName(pm && pm.away);
    html += matchLine(homeN, awayN, pm, om, res, pm && pm.qualified);
  }
  return html;
}

function matchLine(homeN, awayN, pm, om, res, qualified) {
  const predScore = pm && pm.hg != null ? `${pm.hg}–${pm.ag}` : "—";
  const offScore = om && om.hg != null ? `${om.hg}–${om.ag}` : "pendiente";
  let cls = "m-pending", badge = "·";
  if (res.status === "no_prediction") { cls = "m-none"; badge = "sin pred."; }
  else if (res.status === "pending") { cls = "m-pending"; badge = "pte"; }
  else if (res.points > 0) { cls = res.exact ? "m-exact" : "m-points"; badge = "+" + res.points; }
  else { cls = "m-zero"; badge = "0"; }
  const q = qualified ? ` <span class="muted">→ ${esc(teamName(qualified))}</span>` : "";
  return `<div class="m ${cls}">
    <span class="m-fix">${esc(homeN)} <b>${predScore}</b> ${esc(awayN)}${q}</span>
    <span class="m-off muted">oficial: ${offScore}</span>
    <span class="m-pts">${badge}</span></div>`;
}

// ── Vista: lista de partidos con distribución (SPEC 08 §5) ───────────────────
function renderMatches(ctx) {
  document.title = "Partidos · Fase de grupos · Futboledos WC26";
  let html = `<p><a class="back" href="?view=all">← Clasificación general</a></p>
    <h1>Partidos · Fase de grupos</h1>
    <p class="muted">Reparto de predicciones en cada partido de la fase de grupos. Pulsa para ver el detalle.</p>`;
  for (const g of GROUP_LETTERS) {
    html += `<h3>Grupo ${g}</h3>`;
    for (let i = 1; i <= 6; i++) {
      const id = `${g}_0${i}`;
      const om = ctx.official.groupMatches[id];
      if (!om) continue;
      const dist = groupMatchDistribution(ctx.predictions, id);
      const played = om.hg != null && om.ag != null;
      html += `<a class="match-link" href="?match=${id}">
        <span class="ml-fix">${esc(teamName(om.home))} <span class="muted">vs</span> ${esc(teamName(om.away))}</span>
        ${distBar(dist)}
        <span class="ml-meta muted">${played ? `oficial ${om.hg}–${om.ag}` : `${dist.total} pred.`}</span></a>`;
    }
    html += groupClosingHtml(ctx, g);
  }
  $app.innerHTML = html;
}

// Clasificación final + estadísticas cruzadas de un grupo ya cerrado. "" si el
// grupo no ha terminado o el oficial aún no tiene el orden ([CLASIFICACION]).
function groupClosingHtml(ctx, g) {
  const rows = groupStandings(ctx.official, g);
  if (!rows) return "";
  const cs = groupCrossStats(ctx.board, ctx.predByNick, ctx.official, g);
  const perPos = cs ? new Map(cs.perPos.map((p) => [p.pos, p])) : null;
  const sign = (n) => (n > 0 ? `+${n}` : `${n}`);

  let html = `<p class="gclose-msg">🏁 Grupo ${g} cerrado · clasificación definitiva</p>
    <h4 class="gclose-h">Clasificación final</h4>
    <table class="standings gclose">
      <thead><tr><th>#</th><th>Equipo</th><th>Pts</th><th>PJ</th><th>G</th><th>E</th><th>P</th>
        <th>GF</th><th>GC</th><th>DG</th><th title="% que lo pronosticó en esta posición">Predicho aquí</th></tr></thead>
      <tbody>`;
  rows.forEach((s, i) => {
    const pp = perPos && perPos.get(i + 1);
    html += `<tr><td class="lb-pos">${i + 1}</td><td>${esc(teamName(s.id))}</td>
      <td class="pts">${s.pts}</td><td>${s.j}</td><td>${s.w}</td><td>${s.d}</td><td>${s.l}</td>
      <td>${s.gf}</td><td>${s.gc}</td><td>${sign(s.dg)}</td>
      <td class="muted">${pp ? `${pp.pct}%` : "—"}</td></tr>`;
  });
  html += `</tbody></table>`;

  if (cs) {
    html += `<p class="gclose-stats">Acertaron: 1.º <b>${cs.winnerPct}%</b> · 2 clasificados <b>${cs.top2Pct}%</b>
      · orden completo <b>${cs.fullPct}%</b> · media <b>${cs.avgPoints}</b> pts <span class="muted">(${cs.total} pred.)</span></p>`;
    if (cs.surprise)
      html += `<p class="gclose-surprise">😮 Sorpresa del grupo: <strong>${esc(teamName(cs.surprise.id))}</strong>
        <span class="muted">(pronosticada ${cs.surprise.avgPredPos}.º → terminó ${cs.surprise.actualPos}.º)</span></p>`;
    if (cs.heroes.length)
      html += `<p class="gclose-heroes">🎯 Orden completo (4/4): ${cs.heroes.map((n) =>
        `<a class="chip" href="?nick=${encodeURIComponent(n)}">${esc(n)}</a>`).join(" ")}</p>`;
  }
  return html;
}

function distBar(dist) {
  if (!dist.total) return `<span class="dist empty muted">sin predicciones</span>`;
  return `<span class="dist" title="Local ${dist.homePct}% · Empate ${dist.drawPct}% · Visitante ${dist.awayPct}%">
    <span class="dist-seg home" style="width:${dist.homePct}%"></span>
    <span class="dist-seg draw" style="width:${dist.drawPct}%"></span>
    <span class="dist-seg away" style="width:${dist.awayPct}%"></span></span>`;
}

// ── Vista: detalle de un partido de grupo ────────────────────────────────────
function renderMatch(ctx, id) {
  const om = ctx.official.groupMatches[id];
  if (!om) return renderError(`Partido "${id}" no disponible (solo fase de grupos por ahora).`);
  document.title = `${teamName(om.home)} vs ${teamName(om.away)} · Futboledos WC26`;
  const dist = groupMatchDistribution(ctx.predictions, id);
  const contra = contrarianOutcome(dist);
  const heroes = exactHeroes(ctx.predictions, ctx.official, id);
  const played = om.hg != null && om.ag != null;
  const outName = { HOME_WIN: `Gana ${teamName(om.home)}`, DRAW: "Empate", AWAY_WIN: `Gana ${teamName(om.away)}` };

  let html = `<p><a class="back" href="?view=matches">← Partidos fase de grupos</a></p>
    <div class="view-head"><h1>${esc(teamName(om.home))} <span class="muted">vs</span> ${esc(teamName(om.away))}</h1>
      <span class="muted">Grupo ${id[0]}${played ? ` · oficial ${om.hg}–${om.ag}` : " · por jugar"}</span></div>
    <h2 class="section">Distribución de predicciones <span class="muted">(${dist.total})</span></h2>`;

  if (dist.total) {
    html += `${distBar(dist)}
      <div class="dist-legend">
        <span><b class="sw home"></b>Gana ${esc(teamName(om.home))} · ${dist.homePct}% (${dist.home})</span>
        <span><b class="sw draw"></b>Empate · ${dist.drawPct}% (${dist.draw})</span>
        <span><b class="sw away"></b>Gana ${esc(teamName(om.away))} · ${dist.awayPct}% (${dist.away})</span>
      </div>
      <h3>Marcadores más comunes</h3>
      <ul class="kv">${dist.exactScores.slice(0, 3).map((s) => `<li><span>${s.score}</span><b>${s.count} (${s.pct}%)</b></li>`).join("")}</ul>`;
    if (contra) html += `<p class="contra-pick">🎲 Pick contrarian: <strong>${esc(outName[contra.outcome])}</strong> — solo ${contra.pct}% (${contra.count}).</p>`;
  } else {
    html += `<p class="muted">Nadie ha predicho este partido.</p>`;
  }

  if (played && heroes) {
    html += `<h2 class="section">Resultado oficial: ${om.hg}–${om.ag}</h2>
      <ul class="kv">
        <li><span>Acertaron el marcador exacto</span><b>${heroes.heroes.length} / ${heroes.total}</b></li>
        <li><span>Acertaron el signo</span><b>${heroes.signHits} / ${heroes.total}</b></li>
        <li><span>Dificultad</span><b>${heroes.label || "—"}${heroes.difficulty != null ? ` (${heroes.difficulty}%)` : ""}</b></li>
      </ul>`;
    if (heroes.heroes.length)
      html += `<p>🎯 <strong>Exact-score heroes:</strong> ${heroes.heroes.map((n) => `<a class="chip" href="?nick=${encodeURIComponent(n)}">${esc(n)}</a>`).join(" ")}</p>`;
  }
  $app.innerHTML = html;
}

// ── Vista: lista de partidos de eliminatoria ─────────────────────────────────
// Cada participante rellena su propio cuadro, así que no comparten rival: lo que se
// agrega por partido es a quién pronostican que PASA (distribución de clasificados).
const KO_COLORS = ["#2ea043", "#2f81f7", "#d29922", "#a371f7", "#db61a2", "#3fb950"];

// Etiqueta del cruce: equipos oficiales si el cuadro ya los resolvió, si no los
// códigos de plaza (W74, 3ABCDF…) en gris.
function koFixtureLabel(om) {
  if (om.home && om.away)
    return `${esc(teamName(om.home))} <span class="muted">vs</span> ${esc(teamName(om.away))}`;
  return `<span class="muted">${esc(om.home_slot)} vs ${esc(om.away_slot)}</span>`;
}

// Barra apilada de clasificados pronosticados (top equipos + "otros").
function koDistBar(qualifiers) {
  if (!qualifiers.length) return `<span class="dist empty muted">sin predicciones</span>`;
  const top = qualifiers.slice(0, KO_COLORS.length);
  const segs = top.map((q, i) =>
    `<span class="dist-seg" style="width:${q.pct}%;background:${KO_COLORS[i]}" title="${esc(teamName(q.id))} · ${q.pct}% (${q.count})"></span>`).join("");
  const restPct = Math.max(0, Math.round((100 - top.reduce((s, q) => s + q.pct, 0)) * 10) / 10);
  const rest = restPct > 0 ? `<span class="dist-seg" style="width:${restPct}%;background:var(--border)"></span>` : "";
  return `<span class="dist">${segs}${rest}</span>`;
}

function renderKoMatches(ctx) {
  document.title = "Partidos · Fase eliminatoria · Futboledos WC26";
  const ids = Object.keys(ctx.official.knockout).sort((a, b) => Number(a.slice(1)) - Number(b.slice(1)));
  let html = `<p><a class="back" href="?view=all">← Clasificación general</a></p>
    <h1>Partidos · Fase eliminatoria</h1>
    <p class="muted">Cada participante rellena su propio cuadro, así que aquí se agrega a quién pronostican que <strong>pasa</strong> de cada eliminatoria. Pulsa un cruce para ver el detalle.</p>`;
  if (!ids.length) {
    html += `<p class="muted">El cuadro de eliminatorias aún no está disponible.</p>`;
    $app.innerHTML = html; return;
  }
  let lastRound = null;
  for (const mid of ids) {
    const om = ctx.official.knockout[mid];
    if (om.round !== lastRound) { html += `<h3>${ROUND_LABEL[om.round] || om.round}</h3>`; lastRound = om.round; }
    const dist = koMatchDistribution(ctx.predictions, mid);
    const played = om.hg != null && om.ag != null && om.qualified;
    html += `<a class="match-link" href="?komatch=${mid}">
      <span class="ml-fix">${koFixtureLabel(om)}</span>
      ${koDistBar(dist.qualifiers)}
      <span class="ml-meta muted">${played ? `pasa ${esc(teamName(om.qualified))}` : `${dist.total} pred.`}</span></a>`;
  }
  $app.innerHTML = html;
}

// ── Vista: detalle de un partido de eliminatoria ─────────────────────────────
function renderKoMatch(ctx, id) {
  const om = ctx.official.knockout[id];
  if (!om) return renderError(`Partido de eliminatoria "${id}" no disponible.`);
  const dist = koMatchDistribution(ctx.predictions, id);
  const heroes = koHeroes(ctx.predictions, ctx.official, id);
  const played = om.hg != null && om.ag != null && om.qualified;
  document.title = `${ROUND_LABEL[om.round] || om.round} · Futboledos WC26`;

  let html = `<p><a class="back" href="?view=ko-matches">← Partidos fase eliminatoria</a></p>
    <div class="view-head"><h1>${koFixtureLabel(om)}</h1>
      <span class="muted">${ROUND_LABEL[om.round] || om.round} · ${esc(om.home_slot)} vs ${esc(om.away_slot)}${played ? ` · oficial ${om.hg}–${om.ag}` : " · por jugar"}</span></div>
    <h2 class="section">¿Quién pasa? <span class="muted">(${dist.total} pred.)</span></h2>`;

  if (dist.qualifiers.length) {
    html += `${koDistBar(dist.qualifiers)}
      <div class="champ-fav">${dist.qualifiers.slice(0, 6).map((q, i) => `
        <div class="bar-row"><span class="bar-l">${esc(teamName(q.id))}</span>
          <span class="bar-track"><span class="bar-fill" style="width:${q.pct}%;background:${KO_COLORS[i] || "var(--accent)"}"></span></span>
          <b class="bar-v">${q.count}</b></div>`).join("")}</div>`;
  } else {
    html += `<p class="muted">Nadie ha pronosticado este cruce todavía.</p>`;
  }

  if (dist.fixtures.length)
    html += `<h3>Cruces más pronosticados</h3>
      <ul class="kv">${dist.fixtures.slice(0, 5).map((f) =>
        `<li><span>${esc(teamName(f.home))} vs ${esc(teamName(f.away))}</span><b>${f.count} (${f.pct}%)</b></li>`).join("")}</ul>`;

  if (dist.exactScores.length)
    html += `<h3>Marcadores más comunes</h3>
      <ul class="kv">${dist.exactScores.slice(0, 3).map((s) =>
        `<li><span>${s.score}</span><b>${s.count} (${s.pct}%)</b></li>`).join("")}</ul>`;

  if (played && heroes) {
    html += `<h2 class="section">Resultado oficial: ${om.hg}–${om.ag} <span class="muted">· pasa ${esc(teamName(om.qualified))}</span></h2>
      <ul class="kv">
        <li><span>Acertaron quién pasa</span><b>${heroes.qualHits} / ${heroes.total}</b></li>
        <li><span>Acertaron el cruce (ambos equipos)</span><b>${heroes.fixtureHits} / ${heroes.total}</b></li>
        <li><span>Acertaron el marcador exacto</span><b>${heroes.exactHeroes.length} / ${heroes.total}</b></li>
      </ul>`;
    if (heroes.exactHeroes.length)
      html += `<p>🎯 <strong>Marcador exacto:</strong> ${heroes.exactHeroes.map((n) => `<a class="chip" href="?nick=${encodeURIComponent(n)}">${esc(n)}</a>`).join(" ")}</p>`;
  }
  $app.innerHTML = html;
}

// ── Vista: cómo se puntúa (generada desde scoring_rules.json) ────────────────
function renderScoring(ctx) {
  document.title = "Cómo se puntúa · Futboledos WC26";
  const r = ctx.rules;
  const gm = r.group_match, gr = r.group_ranking, bt = r.best_third, ko = r.knockout_match, pb = r.progression_bonus, pool = r.pool;
  const iso = r.meta && r.meta.submission_deadline;
  const dl = iso ? deadlineWhen(iso) : null;
  $app.innerHTML = `
    <p><a class="back" href="?view=all">← Clasificación general</a></p>
    <h1>Cómo se puntúa</h1>
    <p class="muted">El total de cada participante es la suma de cinco bloques, calculados automáticamente comparando tu predicción con los resultados oficiales.</p>
    ${dl ? `<div class="banner">⏱️ Fecha límite para enviar tu predicción: <strong>${dl}</strong>.</div>` : ""}

    <h2 class="section">1 · Partidos de grupo</h2>
    <ul class="rules">
      <li><b>+${gm.exact_score}</b> marcador exacto <span class="muted">(no acumula con lo de abajo)</span></li>
      <li><b>+${gm.correct_outcome}</b> resultado (1·X·2) acertado</li>
      <li><b>+${gm.correct_goal_difference}</b> diferencia de goles acertada</li>
      <li><b>+${gm.exact_home_goals}</b> goles del local exactos · <b>+${gm.exact_away_goals}</b> goles del visitante exactos</li>
    </ul>
    <p class="muted">Máximo ${gm.max_points} puntos por partido.</p>

    <h2 class="section">2 · Ranking de grupo</h2>
    <ul class="rules">
      <li>Posición acertada: <b>+${gr.position_points["1"]}</b> el 1.º · <b>+${gr.position_points["2"]}</b> el 2.º · <b>+${gr.position_points["3"]}</b> el 3.º · <b>+${gr.position_points["4"]}</b> el 4.º</li>
      <li><b>+${gr.qualified_team}</b> por cada equipo que clasifica acertado (da igual la posición)</li>
      <li><b>+${gr.complete_group_order_bonus}</b> si aciertas el orden completo del grupo</li>
    </ul>

    <h2 class="section">3 · Mejores terceros</h2>
    <ul class="rules">
      <li><b>+${bt.correct_team}</b> por cada grupo cuyo tercero clasificado aciertas</li>
      <li><b>+${bt.complete_key_bonus}</b> si aciertas los 8 terceros clasificados</li>
    </ul>

    <h2 class="section">4 · Eliminatorias</h2>
    <ul class="rules">
      <li><b>+${ko.correct_qualified_team}</b> por acertar quién pasa de ronda</li>
      <li>Si aciertas el cruce (los dos equipos): <b>+${ko.exact_score}</b> marcador exacto, o <b>+${ko.correct_outcome}</b> el resultado</li>
      <li><b>+${ko.correct_home_team}</b> / <b>+${ko.correct_away_team}</b> por cada equipo del cruce acertado</li>
    </ul>

    <h2 class="section">5 · Bonus de progresión</h2>
    <p class="muted">Por cada equipo que predices que llega a una ronda y de verdad llega:</p>
    <ul class="rules">
      <li>Dieciseisavos <b>+${pb.round_of_32}</b> · Octavos <b>+${pb.round_of_16}</b> · Cuartos <b>+${pb.quarter_final}</b> · Semis <b>+${pb.semi_final}</b></li>
      <li>Finalista <b>+${pb.runner_up}</b> · Campeón <b>+${pb.champion}</b></li>
      <li>3.º puesto <b>+${pb.third_place}</b> · 4.º puesto <b>+${pb.fourth_place}</b></li>
    </ul>

    <h2 class="section">Competición por pools</h2>
    <p>Cada pool puntúa como la <strong>media de puntos por participante activo</strong>, para que un grupo pequeño pueda competir con uno grande. Hace falta un mínimo de <strong>${pool.min_active_participants}</strong> participantes activos para entrar en el ranking de pools.</p>`;
}

main();
