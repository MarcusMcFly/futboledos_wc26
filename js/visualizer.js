// Visualizador (Parte 2). Router por query param:
//   (sin parámetro | ?view=all)  → clasificación general + pools
//   ?pool=<slug>                 → detalle de un pool
//   ?nick=<nick>                 → detalle de un participante (desglose SPEC §12)
// Todo se calcula en cliente desde las predicciones + el resultado oficial.
// @ts-check
import { loadRegistry, loadRules, loadTeams, loadOfficial, loadSubmission } from "./data.js";
import { parsePrediction } from "./parse_prediction.js";
import { buildLeaderboard } from "./leaderboard.js";
import { buildPoolRanking } from "./pools.js";
import { groupMatchDistribution, contrarianOutcome, exactHeroes, globalAccuracy, championDistribution } from "./stats.js";

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
  let registry, rules, teamsFile, officialText;
  try {
    [registry, rules, teamsFile, officialText] = await Promise.all(
      [loadRegistry(), loadRules(), loadTeams(), loadOfficial()]);
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
  const ctx = { registry, rules, official, board, byNick, predByNick, predictions, poolRanking, poolsByNick };

  const params = new URLSearchParams(location.search);
  const nick = params.get("nick"), pool = params.get("pool");
  const match = params.get("match"), view = params.get("view");
  if (nick) renderUser(ctx, nick);
  else if (pool) renderPool(ctx, pool);
  else if (match) renderMatch(ctx, match);
  else if (view === "matches") renderMatches(ctx);
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
  const parts = [`${groupDone}/72 partidos de grupo`];
  if (koDone) parts.push(`${koDone}/32 de eliminatoria`);
  return `<div class="banner warn">📊 Resultados oficiales cargados: ${parts.join(" · ")}. Puntuación provisional, se recalcula con cada resultado.</div>`;
}

// ── Vista: clasificación general ─────────────────────────────────────────────
function renderHome(ctx) {
  document.title = "Clasificación · Futboledos WC26";
  $app.innerHTML = `
    ${statusBanner(ctx.official)}
    <div class="view-head"><h1>Clasificación general</h1><span class="muted">${ctx.board.length} participantes</span></div>
    ${leaderboardTable(ctx, ctx.board, { showPools: true })}
    <h2 class="section">Competición por pools <span class="muted">· media por participante activo</span></h2>
    ${poolTable(ctx)}
    <h2 class="section">Estadísticas del torneo</h2>
    ${statsPanel(ctx)}
    <p class="legend muted">Total = grupos + ranking de grupo + mejores terceros + eliminatorias + bonus de progresión (SPEC 06). Pulsa un nombre para ver su desglose.</p>`;
}

// Panel de engagement (SPEC 08): precisión global + favorito de la peña + acceso a partidos.
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
    ? `<div class="champ-fav"><h3>Favorito de la peña 🏆</h3>${champs.slice(0, 5).map((c) => `
        <div class="bar-row"><span class="bar-l">${esc(teamName(c.id))}</span>
          <span class="bar-track"><span class="bar-fill" style="width:${c.pct}%"></span></span>
          <b class="bar-v">${c.count}</b></div>`).join("")}</div>`
    : "";
  return `${accCards}${champList}<p><a class="more" href="?view=matches">Ver distribución de predicciones por partido →</a></p>`;
}

function leaderboardTable(ctx, rows, { showPools = false, poolInternal = false } = {}) {
  if (!rows.length) return `<p class="muted">Aún no hay participantes.</p>`;
  const body = rows.map((s, i) => {
    const chips = showPools ? poolChips(ctx, s.nick) : "";
    const pos = poolInternal ? i + 1 : s.rank;
    return `<tr>
      <td class="lb-pos">${pos}</td>
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
      <th>#</th><th>Participante</th><th>Total</th>
      <th title="Partidos de grupo">Gru</th><th title="Ranking de grupo">Rnk</th>
      <th title="Mejores terceros">3º</th><th title="Eliminatorias">KO</th>
      <th title="Bonus de progresión">Bon</th><th title="Marcadores exactos">Exa</th>
    </tr></thead><tbody>${body}</tbody></table>`;
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
  const chips = poolChips(ctx, nick) || `<span class="muted">sin pool</span>`;
  const champRow = ctx.official.champion
    ? `Campeón: <strong>${esc(teamName(pred.champion))}</strong> ${d.correct_champion ? "✅" : "❌ (oficial: " + esc(teamName(ctx.official.champion)) + ")"}`
    : `Campeón pronosticado: <strong>${esc(teamName(pred.champion))}</strong> <span class="muted">(pendiente)</span>`;

  $app.innerHTML = `
    <p><a class="back" href="?view=all">← Clasificación general</a></p>
    <div class="view-head"><h1>${esc(nick)}</h1><span>${chips}</span></div>
    <div class="cards">
      <div class="card big"><div class="card-n">${sc.total}</div><div class="card-l">Puntos · #${s.rank} general</div></div>
    </div>
    <h2 class="section">Desglose</h2>
    ${breakdownBars(sc)}
    <ul class="kv">
      <li><span>Marcadores exactos</span><b>${d.exact_scores}</b></li>
      <li><span>Resultados (signo) acertados</span><b>${d.correct_signs}</b></li>
      <li><span>Ganadores de grupo</span><b>${d.correct_group_winners}/12</b></li>
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
    return `<div class="grp"><h3>Grupo ${g}</h3>${rows.join("")}</div>`;
  }).join("");
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
  document.title = "Partidos · Futboledos WC26";
  let html = `<p><a class="back" href="?view=all">← Clasificación general</a></p>
    <h1>Predicciones por partido</h1>
    <p class="muted">Cómo repartió la peña cada partido de la fase de grupos. Pulsa para ver el detalle.</p>`;
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
  }
  $app.innerHTML = html;
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

  let html = `<p><a class="back" href="?view=matches">← Partidos</a></p>
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

main();
