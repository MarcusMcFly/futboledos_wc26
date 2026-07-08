// Visualizador (Parte 2). Router por query param:
//   (sin parámetro | ?view=all)  → clasificación general + pools
//   ?pool=<slug>                 → detalle de un pool
//   ?nick=<nick>                 → detalle de un participante (desglose SPEC §12)
// Todo se calcula en cliente desde las predicciones + el resultado oficial.
// @ts-check
import { loadRegistry, loadRules, loadTeams, loadOfficial, loadSubmission, loadAllSnapshots } from "./data.js";
import { parsePrediction } from "./parse_prediction.js";
import { buildLeaderboard } from "./leaderboard.js";
import { buildPoolRanking } from "./pools.js";
import { groupMatchDistribution, contrarianOutcome, exactHeroes, globalAccuracy, championDistribution, groupStandings, groupCrossStats, koMatchDistribution, koHeroes, koRoundQualifierLeaders, koRoundStats, koRoundFollowers } from "./stats.js";
import { computeMovements, topMovers, newLeader, computeStreaks, benchmarkCrossings } from "./history.js";
import { projectUser } from "./projection.js";
import { progressionRoundIncrement } from "./scoring.js";

// Participante "de referencia": muy conocido, sirve de vara de medir. Cuando
// alguien lo adelanta (o cae por detrás) en una actualización, se destaca.
const BENCHMARK_NICK = "JesusGG";

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
  let registry, rules, teamsFile, officialText, snapshots;
  try {
    [registry, rules, teamsFile, officialText, snapshots] = await Promise.all(
      [loadRegistry(), loadRules(), loadTeams(), loadOfficial(), loadAllSnapshots()]);
  } catch (e) { return renderError(e instanceof Error ? e.message : String(e)); }
  const snapshot = snapshots.length ? snapshots[snapshots.length - 1] : null;
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
  const streaks = computeStreaks(board, snapshots);
  const crossings = benchmarkCrossings(board, snapshot, BENCHMARK_NICK);
  const ctx = { registry, rules, official, board, byNick, predByNick, predictions, poolRanking, poolsByNick, snapshot, movements, streaks, crossings };

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

// Nº de cruces de cada ronda de eliminatoria y titular de "ronda completada". Sirven
// para que, en cuanto una ronda queda entera (todos sus cruces con clasificado), el
// banner verde del home releve al de "fase de grupos completada" y anuncie esa ronda.
const KO_ROUND_TOTAL = { DIECISEISAVOS: 16, OCTAVOS: 8, CUARTOS: 4, SEMIS: 2, TERCER_PUESTO: 1, FINAL: 1 };
const KO_ROUND_ORDER = ["FINAL", "TERCER_PUESTO", "SEMIS", "CUARTOS", "OCTAVOS", "DIECISEISAVOS"];
const KO_ROUND_DONE = {
  DIECISEISAVOS: "¡Dieciseisavos completados!", OCTAVOS: "¡Octavos completados!",
  CUARTOS: "¡Cuartos completados!", SEMIS: "¡Semifinales completadas!",
  TERCER_PUESTO: "¡Tercer puesto disputado!", FINAL: "¡Final disputada!",
};

// Banner de la ronda de eliminatoria más avanzada que ya esté ENTERA (todos sus
// cruces resueltos). Releva al de "fase de grupos completada" y, además del titular,
// menciona el/los top-1 en aciertos de "quién pasa" entre los cruces resueltos.
function completedRoundBanner(ctx) {
  const done = Object.values(ctx.official.knockout).filter((m) => m.hg != null && m.ag != null && m.qualified);
  if (!done.length) return "";
  const round = KO_ROUND_ORDER.find((r) => done.filter((m) => m.round === r).length === KO_ROUND_TOTAL[r]);
  if (!round) return "";
  const n = KO_ROUND_TOTAL[round];
  const crucesTxt = n === 1 ? "El cruce está resuelto" : `Los ${n} cruces están resueltos`;
  const lead = koRoundQualifierLeaders(ctx.predictions, ctx.official, round);
  let topHtml = "";
  if (lead && lead.leaders.length) {
    const best = lead.leaders[0].hits;
    const names = lead.leaders.filter((r) => r.hits === best).map((r) => esc(r.nick));
    const etiqueta = names.length === 1 ? "Top acertante de quién pasa" : "Top acertantes de quién pasa";
    topHtml = `<br>🏅 <strong>${etiqueta}:</strong> ${names.join(" · ")} <span class="muted">(${best}/${lead.resolved} cruces)</span>`;
  }
  return `<div class="banner ok-banner">🏁 <strong>${KO_ROUND_DONE[round]}</strong> ${crucesTxt}.${topHtml}</div>`;
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
    ${completedRoundBanner(ctx) || completedGroupsBanner(ctx.official)}
    <div class="view-head"><h1>Clasificación general</h1><span class="muted">${ctx.board.length} participantes</span></div>
    ${leaderboardTable(ctx, ctx.board, { showPools: true })}
    ${ctx.movements.hasSnapshot ? `<h2 class="section">Movimiento <span class="muted">· desde ${esc(ctx.snapshot.label || "el último corte")}</span></h2>${topMoversPanel(ctx)}` : ""}
    ${ctx.streaks.hasHistory && (ctx.streaks.badges.length || ctx.streaks.relegation.length || ctx.streaks.zones.length || ctx.streaks.bubble) ? `<h2 class="section">Rachas <span class="muted">· tendencias acumuladas</span></h2>${streaksPanel(ctx)}` : ""}
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
  // Partidos jugados sobre el total del Mundial: 72 de grupos + 32 de eliminatoria = 104.
  const { groupDone, koDone } = officialProgress(ctx.official);
  const totalMatches = Object.keys(ctx.official.groupMatches).length + Object.keys(ctx.official.knockout).length;
  const playedMatches = groupDone + koDone;
  const accCards = acc.completedMatches
    ? `<div class="cards">
        <div class="card"><div class="card-n">${acc.correctSignPct}%</div><div class="card-l">Aciertos de signo <span class="muted">(grupos)</span></div></div>
        <div class="card"><div class="card-n">${acc.exactPct}%</div><div class="card-l">Marcadores exactos <span class="muted">(grupos)</span></div></div>
        <div class="card"><div class="card-n">${acc.avgPointsUser}</div><div class="card-l">Media de puntos</div></div>
        <div class="card"><div class="card-n">${playedMatches}/${totalMatches}</div><div class="card-l">Partidos jugados</div></div>
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
  const bm = benchmarkLine(ctx.crossings);
  if (!movers.length && !nl && !bm) return `<p class="muted">Sin cambios en la clasificación desde el último corte.</p>`;
  let html = "";
  if (nl) html += `<p class="badge-line">👑 <strong>Nuevo líder:</strong> <a href="?nick=${encodeURIComponent(nl)}">${esc(nl)}</a></p>`;
  html += bm;
  if (movers.length) html += `<div class="movers">${movers.map((m) =>
    `<a class="mover" href="?nick=${encodeURIComponent(m.nick)}"><span class="mv up">▲${m.movement}</span> ${esc(m.nick)}</a>`).join("")}</div>`;
  return html;
}

// "La línea de JesusGG": quién lo adelantó (debajo→encima) o cayó por detrás de él
// (encima→debajo) en la última actualización. "" si no hay cruces o no está presente.
function benchmarkLine(cross) {
  if (!cross || !cross.present) return "";
  const { passed, droppedBehind, benchmark } = cross;
  if (!passed.length && !droppedBehind.length) return "";
  const link = (n) => `<a href="?nick=${encodeURIComponent(n)}">${esc(n)}</a>`;
  const bench = link(benchmark);
  const parts = [];
  if (passed.length)
    parts.push(`<span class="bm-up">🟡 ${passed.map(link).join(", ")} ${passed.length === 1 ? "adelantó" : "adelantaron"} a ${bench}</span>`);
  if (droppedBehind.length)
    parts.push(`<span class="bm-down">🔨 ${bench} adelantó a ${droppedBehind.map(link).join(", ")}</span>`);
  return `<p class="badge-line bm-line">👀 <strong>La línea de ${esc(benchmark)}:</strong> ${parts.join(" · ")}</p>`;
}

// Panel de rachas: tendencias sostenidas y positivas a lo largo del histórico de
// snapshots (no solo el último corte). Cada chip enlaza a la ficha. Máximo 8 para
// que no se sature; ya vienen ordenadas por relevancia desde computeStreaks.
function streakChip(kind, icon, nick, text) {
  return `<a class="streak streak-${kind}" href="?nick=${encodeURIComponent(nick)}">
      <span class="streak-ico">${icon}</span>
      <span class="streak-body"><b>${esc(nick)}</b><span class="streak-txt">${esc(text)}</span></span>
    </a>`;
}

function zoneGroup(cls, headIco, title, note, chips) {
  return `<p class="streak-zone-h z-${cls}">${headIco} ${esc(title)} <span class="muted">· ${esc(note)}</span></p>
    <div class="streaks">${chips}</div>`;
}

function streaksPanel(ctx) {
  const badges = ctx.streaks.badges.slice(0, 8);
  const releg = ctx.streaks.relegation || [];
  const zones = ctx.streaks.zones || [];
  const bubble = ctx.streaks.bubble || null;
  let html = "";
  if (badges.length)
    html += `<div class="streaks">${badges.map((b) =>
      streakChip(b.kind, b.icon, b.nick, b.text)).join("")}</div>`;
  // Mapa de la tabla, de arriba abajo: burbuja (puesto 5) → bandas → descenso.
  // Cada quien cae en una sola banda; el color avisa de lo cerca del descenso.
  if (bubble)
    html += zoneGroup("burbuja", "🫧", "En la burbuja", "puesto 5",
      streakChip("burbuja", "🫧", bubble.nick, `${bubble.streak} actualizaciones en la burbuja`));
  for (const z of zones)
    html += zoneGroup(z.key, z.icon, z.label, z.note, z.members.slice(0, 6).map((m) =>
      streakChip(z.key, z.icon, m.nick, `${m.streak} actualizaciones en ${z.word}`)).join(""));
  // Zona de descenso: racha (negativa) en los 3 últimos puestos, con estilo de
  // peligro para no confundirla con los destacados positivos.
  if (releg.length)
    html += zoneGroup("descenso", "⚠️", "Zona de descenso", "3 últimos puestos",
      releg.slice(0, 6).map((rz) =>
        streakChip("drop", "🔻", rz.nick, `${rz.streak} actualizaciones en descenso`)).join(""));
  return html || `<p class="muted">Aún no hay rachas destacables.</p>`;
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
  const koPhaseSection = koUserPhaseBreakdown(ctx, nick);
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
      <li><span>Clasificados por cruce <span class="muted">(desempate)</span></span><b>${d.correct_qualified_knockout_teams}/32</b></li>
    </ul>
    <p class="champ">${champRow}</p>
    <h2 class="section">Fase de grupos · partido a partido</h2>
    ${groupMatchBreakdown(ctx, s, pred)}
    <h2 class="section">Eliminatorias</h2>
    ${koBreakdown(ctx, s, pred)}
    <h2 class="section">Bonus de progresión <span class="muted">· ${sc.progression_bonus_points} pts</span></h2>
    ${progressionBreakdown(ctx, s)}
    ${koPhaseSection ? `<h2 class="section">Puntos por fase de eliminatoria</h2>
    <p class="muted">Lo mismo que se ve en cada fase de la vista de eliminatorias, con tu fila resaltada.</p>
    ${koPhaseSection}` : ""}
    <h2 class="section">Tu techo · ¿hasta dónde puedes llegar?</h2>
    ${maxProjection(ctx, nick)}`;
}

// Proyección de máxima puntuación posible: si de aquí al final se cumpliera TODO lo
// que el participante ha pronosticado (sus equipos pasan con sus marcadores y su
// campeón), ¿cuántos puntos sumaría, dónde quedaría, con quién competiría y a quién
// ya no puede superar? Incluye tres escenarios (bueno/medio/malo = 100/65/30 % de lo
// que aún puede sumar) y, como todos pronostican los mismos partidos, la
// interdependencia: en tu escenario ideal, quién sube contigo. Todo desde projection.js.
function maxProjection(ctx, nick) {
  const p = projectUser(nick, { board: ctx.board, byNick: ctx.byNick, predByNick: ctx.predByNick, official: ctx.official, rules: ctx.rules });
  if (!p) return "";
  if (p.remaining <= 0)
    return `<p class="muted">Ya no quedan puntos por disputar para ti: tu marcador de <strong>${p.current}</strong> es definitivo (todos tus pronósticos pendientes están resueltos).</p>`;

  const link = (n) => `<a href="?nick=${encodeURIComponent(n)}">${esc(n)}</a>`;
  // Lista de nombres con marcador actual, capada para no saturar (resto → "+N más").
  const CAP = 8;
  const nameList = (arr) => {
    const shown = arr.slice(0, CAP).map((o) => `${link(o.nick)} <span class="muted">(${o.current})</span>`).join(" · ");
    return arr.length > CAP ? `${shown} <span class="muted">+${arr.length - CAP} más</span>` : shown;
  };

  // Tarjetas de escenario. El puesto es el MEJOR posible con esa puntuación: como
  // los demás solo pueden sumar, tu puesto real sería ese o peor ("como muy bien #N").
  const cards = p.scenarios.map((sc) => `
    <div class="card proj-card proj-${sc.key}">
      <div class="proj-ico">${sc.icon}</div>
      <div class="card-n">${sc.score}</div>
      <div class="card-l">${sc.label} · ${sc.pct}% <span class="muted">(+${sc.gain})</span><br>
        <span class="muted">como muy bien #${sc.rank}</span></div>
    </div>`).join("");

  // Bloques de rivales.
  const blocks = [];
  blocks.push(p.impossible.length
    ? `<p class="proj-line proj-imposs">🚫 <strong>Ya no puedes superar a:</strong> ${nameList(p.impossible)} <span class="muted">— aunque se cumpla toda tu quiniela quedarían por encima de ti (comparten tus aciertos y suben contigo). Tu mejor puesto posible es #${p.rankAtCeiling}.</span></p>`
    : `<p class="proj-line proj-ok">✅ <strong>Nadie está fuera de tu alcance:</strong> si se cumpliera toda tu quiniela quedarías <strong>primero</strong>.</p>`);
  if (p.catchable.length)
    blocks.push(`<p class="proj-line">🎯 <strong>A tu alcance por arriba:</strong> ${nameList(p.catchable)} <span class="muted">— van por delante hoy, pero si se cumple tu quiniela quedarías por encima de ellos.</span></p>`);
  if (p.threat.length)
    blocks.push(`<p class="proj-line">⚔️ <strong>Aún te pueden pasar:</strong> ${nameList(p.threat)} <span class="muted">— van por detrás pero su techo llega a tu marcador de hoy.</span></p>`);
  blocks.push(p.secured.length
    ? `<p class="proj-line proj-secured">🛡️ <strong>Ya tienes ganado a:</strong> ${p.secured.length} participante${p.secured.length === 1 ? "" : "s"} <span class="muted">— ni en su mejor escenario te alcanzan.</span></p>`
    : "");

  // Interdependencia: quién sube contigo en tu mundo ideal.
  const risers = p.risers.length
    ? `<p class="proj-line proj-risers">🤝 <strong>Si se cumple tu quiniela, también suben:</strong> ${p.risers.map((o) =>
        `${link(o.nick)} <span class="muted">(${o.current}→${o.dream}, +${o.gain})</span>`).join(" · ")} <span class="muted">— coincidieron contigo, así que tu acierto es también el suyo.</span></p>`
    : "";

  return `
    <p>Si a partir de ahora se cumpliera <strong>todo</strong> lo que has pronosticado —tus equipos pasan las eliminatorias con tus marcadores y tu campeón levanta la copa— llegarías a un máximo de <strong>${p.ceiling} pts</strong> (+${p.remaining} sobre tus ${p.current} de ahora). Pero como todos jugáis los <em>mismos</em> partidos, quienes coincidieron contigo también acertarían: en ese escenario ideal <strong>realista</strong> quedarías <strong>#${p.rankAtCeiling}</strong> <span class="muted">(hoy vas #${p.currentRank})</span>.</p>
    <div class="cards proj-cards">${cards}</div>
    <p class="legend muted">Escenarios = 100 % / 65 % / 30 % de los ${p.remaining} puntos que aún puedes sumar. El puesto es el <strong>mejor posible</strong> con esa puntuación (si nadie más sumara); como los demás solo pueden subir, tu puesto real sería ese o peor.</p>
    ${blocks.join("")}
    ${risers}`;
}

// Hasta qué ronda llega cada rango de alcance (1=R32 … 6=campeón) para el bonus.
const REACH_LABEL = { 1: "Dieciseisavos", 2: "Octavos", 3: "Cuartos", 4: "Semifinales", 5: "Finalista", 6: "Campeón" };

// Desglose del bonus de progresión: por cada equipo pronosticado que ya ha sumado,
// hasta qué ronda se le acredita y cuántos puntos lleva. Los puntos se acumulan
// según los equipos avanzan en el cuadro oficial, así que esta tabla crece con el
// torneo. Los equipos que solo han llegado a dieciseisavos (todos suman lo mismo)
// se agrupan en una fila para no saturar; los que han avanzado más van con nombre.
// Incluye el acierto de 3.º/4.º puesto cuando se juega la final.
function progressionBreakdown(ctx, scored) {
  const prog = scored.breakdown.progression;
  const total = scored.score.progression_bonus_points;
  const r = ctx.rules.progression_bonus;
  if (!prog || (!(prog.teams && prog.teams.length) && !prog.extraPoints))
    return `<p class="muted">Aún no has sumado bonus de progresión. Se acredita según tus equipos avanzan en el cuadro (dieciseisavos → campeón).</p>`;
  const teams = prog.teams || [];
  const advanced = teams.filter((t) => t.credited >= 2);
  const base = teams.filter((t) => t.credited === 1);
  let rows = advanced.map((t) => {
    const hint = t.predRank > t.credited
      ? ` <span class="muted">(pronosticaste ${REACH_LABEL[t.predRank] || "?"})</span>` : "";
    return `<tr>
      <td>${esc(teamName(t.team))}</td>
      <td>${REACH_LABEL[t.credited] || "—"}${hint}</td>
      <td class="pts">+${t.points}</td></tr>`;
  }).join("");
  if (base.length) {
    const basePts = base.reduce((s, t) => s + t.points, 0);
    rows += `<tr>
      <td>🎟️ ${base.length} ${base.length === 1 ? "equipo" : "equipos"} en dieciseisavos</td>
      <td class="muted">+${r.round_of_32} cada uno</td>
      <td class="pts">+${basePts}</td></tr>`;
  }
  if (prog.thirdCorrect) rows += `<tr><td>🥉 3.º puesto acertado</td><td class="muted">tercer puesto</td><td class="pts">+${r.third_place}</td></tr>`;
  if (prog.fourthCorrect) rows += `<tr><td>4.º puesto acertado</td><td class="muted">cuarto puesto</td><td class="pts">+${r.fourth_place}</td></tr>`;
  return `<table class="standings progbonus">
      <thead><tr><th>Equipo</th><th>Bonus hasta</th><th>Pts</th></tr></thead>
      <tbody>${rows}</tbody>
      <tfoot><tr class="rank-total"><td colspan="2">Total bonus de progresión</td><td class="pts">${total}</td></tr></tfoot>
    </table>
    <p class="legend muted">Cada equipo acumula: dieciseisavos +${r.round_of_32} · octavos +${r.round_of_16} · cuartos +${r.quarter_final} · semis +${r.semi_final} · finalista +${r.runner_up} · campeón +${r.champion}. Los puntos suben a medida que tus equipos avanzan.<br>Cuenta que tengas el equipo <strong>vivo en esa ronda por cualquier vía</strong>, aunque llegara por un cruce distinto al que pronosticaste (por eso puede no cuadrar con los aciertos de "quién pasa" de cada eliminatoria).</p>`;
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
  // Agrupa por ronda para anotar en la cabecera cuántos "quién pasa" se acertaron.
  const byRound = [];
  for (const mid of ids) {
    const rd = off.knockout[mid].round;
    if (!byRound.length || byRound[byRound.length - 1].round !== rd) byRound.push({ round: rd, mids: [] });
    byRound[byRound.length - 1].mids.push(mid);
  }
  let html = "";
  for (const grp of byRound) {
    // Equipos que REALMENTE pasan en esta ronda (clasificados oficiales resueltos).
    // "Quién pasa" es set-based: cuenta tus equipos que pasan, vayan por el cruce que sea.
    const offQ = new Set();
    for (const mid of grp.mids) { const q = off.knockout[mid].qualified; if (q) offQ.add(q); }
    let qHits = 0;
    const qResolved = offQ.size;
    const lines = grp.mids.map((mid) => {
      const om = off.knockout[mid];
      const pm = pred.knockout[mid];
      const res = scored.breakdown.koDetails[mid] || { points: 0, status: "pending" };
      const qHit = !!(pm && pm.qualified && offQ.has(pm.qualified));
      if (qHit) qHits++;
      // Muestra el fixture y marcador PREDICHOS (pueden diferir del oficial).
      return matchLine(teamName(pm && pm.home), teamName(pm && pm.away), pm, om, res, pm && pm.qualified, qHit);
    }).join("");
    const qTag = qResolved
      ? ` <span class="ko-qcount">· ✅ <b>${qHits}/${qResolved}</b> quién pasa</span>` : "";
    html += `<h3>${ROUND_LABEL[grp.round] || grp.round}${qTag}</h3>${lines}`;
    // Bug histórico del cuadro: las semis se emparejaron cruzadas (W97-W99 / W98-W100)
    // en vez de W97-W98 / W99-W100. Bajo las semis "tal cual" mostramos la propuesta
    // corregida, sin tocar puntuación (solo informativo).
    if (grp.round === "SEMIS") html += correctedSemisPanel(pred);
  }
  return html;
}

// Panel informativo "Semifinales corregidas": reconstruye cómo quedarían las semis →
// final → 3.º/4.º de un usuario con el emparejamiento CORRECTO (W97-W98 / W99-W100),
// partiendo de los 4 semifinalistas que ya eligió (ganadores de M97-M100) y manteniendo
// su campeón y su 4.º. En cada cruce corregido avanza el equipo que quedó más arriba en
// SU clasificación final original (campeón > subcampeón > 3.º > 4.º); esa misma regla
// reproduce sus propios resultados en los cruces que ya existían, así que no inventa
// nada. Es solo visual: no altera datos ni la puntuación. "" si el cuadro está incompleto.
function correctedSemisPanel(pred) {
  const ko = pred.knockout || {};
  // Ya corregida (emparejamiento W97-W98): el cuadro real ya es el bueno, no hace falta el panel.
  if (ko.M101 && ko.M101.away_slot === "W98") return "";
  const q = (id) => ko[id] && ko[id].qualified;
  const q97 = q("M97"), q98 = q("M98"), q99 = q("M99"), q100 = q("M100");
  const champ = pred.champion, m103 = ko.M103, m104 = ko.M104;
  if (!q97 || !q98 || !q99 || !q100 || !champ || !m103 || !m104 || m104.qualified == null) return "";
  // Clasificación original: 1 campeón · 2 subcampeón (perdedor de la final) ·
  // 3 tercero (ganador del 3.º puesto) · 4 cuarto (perdedor del 3.º puesto).
  const runnerUp = m104.qualified === m104.home ? m104.away : m104.home;
  const third = m103.qualified;
  const fourth = m103.qualified === m103.home ? m103.away : m103.home;
  const rank = new Map([[champ, 1], [runnerUp, 2], [third, 3], [fourth, 4]]);
  for (const t of [q97, q98, q99, q100]) if (!rank.has(t)) return "";  // cuadro inconsistente → no mostramos
  const best = (a, b) => (rank.get(a) <= rank.get(b) ? a : b);   // avanza el mejor clasificado
  const worst = (a, b) => (rank.get(a) <= rank.get(b) ? b : a);
  const sf1w = best(q97, q98), sf1l = worst(q97, q98);
  const sf2w = best(q99, q100), sf2l = worst(q99, q100);
  const finL = worst(sf1w, sf2w);   // finalista que pierde = subcampeón corregido (finW === campeón)
  const thW = best(sf1l, sf2l);     // 3.º corregido (el otro perdedor = 4.º, === cuarto original)
  const cruce = (label, a, b, w) => `<div class="m m-corr">
      <span class="m-fix">${esc(teamName(a))} <span class="muted">vs</span> ${esc(teamName(b))} <span class="m-q m-q-ok">→ ${esc(teamName(w))}</span></span>
      <span class="m-corr-label muted">${label}</span></div>`;
  const changed = finL !== runnerUp;   // ¿el reemparejamiento cambia subcampeón/3.º?
  const note = changed
    ? `Con el emparejamiento correcto, tu <strong>subcampeón</strong> y tu <strong>3.º</strong> cambian respecto a tu cuadro original (tu campeón y tu 4.º se mantienen).`
    : `Con el emparejamiento correcto tus cuatro posiciones no cambian; solo cambian los rivales de cada semifinal.`;
  return `<div class="ko-corrected">
    <h4>🔧 Semifinales corregidas <span class="muted">· propuesta</span></h4>
    <p class="muted">El cuadro original cruzaba mal las semis (W97-W99 / W98-W100). Así quedarían con el emparejamiento correcto (W97-W98 / W99-W100), manteniendo tu campeón y tu 4.º; en cada cruce avanza el equipo que quedó más arriba en tu clasificación.</p>
    ${cruce("Semifinal 1", q97, q98, sf1w)}
    ${cruce("Semifinal 2", q99, q100, sf2w)}
    ${cruce("Final", champ, finL, champ)}
    ${cruce("3.er puesto", thW, fourth, thW)}
    <p class="ko-corr-medals">🥇 ${esc(teamName(champ))} · 🥈 ${esc(teamName(finL))} · 🥉 ${esc(teamName(thW))} · 4.º ${esc(teamName(fourth))}</p>
    <p class="muted ko-corr-note">${note}</p>
  </div>`;
}

function matchLine(homeN, awayN, pm, om, res, qualified, qHit) {
  const predScore = pm && pm.hg != null ? `${pm.hg}–${pm.ag}` : "—";
  // Réplica del cruce oficial real (equipos + marcador + penaltis), que puede
  // diferir de la fixture predicha que se muestra a la izquierda.
  const offScore = om && om.hg != null
    ? `${esc(teamName(om.home))} ${koScoreText(om)} ${esc(teamName(om.away))}`
    : "pendiente";
  // Marca visual del acierto del cruce: exacto (ambos equipos + marcador), cruce
  // acertado (ambos equipos, marcador no), o parcial (algún punto sin acertar el cruce).
  let cls = "m-pending", badge = "·", tag = "";
  if (res.status === "no_prediction") { cls = "m-none"; badge = "sin pred."; }
  else if (res.status === "pending") { cls = "m-pending"; badge = "pte"; }
  else if (res.points > 0) {
    if (res.exact) { cls = "m-exact"; tag = `<span class="m-tag m-tag-exact">🤝 exacto</span>`; }
    else if (res.sameFixture) { cls = "m-fixture"; tag = `<span class="m-tag m-tag-fix">🤝 cruce</span>`; }
    else { cls = "m-points"; }
    badge = "+" + res.points;
  }
  else { cls = "m-zero"; badge = "0"; }
  // Resalta el "quién pasa" acertado para verlo de un vistazo. Set-based: tu equipo pasa
  // de verdad, vaya por este cruce o por otro (independiente de los puntos del slot).
  const q = qualified
    ? ` <span class="m-q${qHit ? " m-q-ok" : " muted"}">→ ${esc(teamName(qualified))}${qHit ? " ✅" : ""}</span>`
    : "";
  return `<div class="m ${cls}">
    <span class="m-fix">${esc(homeN)} <b>${predScore}</b> ${esc(awayN)}${q}${tag}</span>
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

// Plaza de origen en texto legible: "Ganador M75" / "Perdedor M101" para las rondas
// que dependen de otros partidos, o el código tal cual en dieciseisavos (1E, 2B, 3ABCDF…).
function slotLabel(slot) {
  const w = /^W(\d+)$/.exec(slot); if (w) return `Ganador M${w[1]}`;
  const l = /^L(\d+)$/.exec(slot); if (l) return `Perdedor M${l[1]}`;
  return slot;
}

// Etiqueta del cruce: CADA lado se resuelve por separado. Si el equipo ya está puesto
// (un ganador propagado desde la ronda anterior), se muestra su nombre aunque el rival
// siga pendiente; si no, su plaza de origen en gris. Así, en cuanto un equipo se
// clasifica, aparece ya en su cruce de la ronda siguiente.
function koSide(team, slot) {
  return team ? esc(teamName(team)) : `<span class="muted">${esc(slotLabel(slot))}</span>`;
}
function koFixtureLabel(om) {
  return `${koSide(om.home, om.home_slot)} <span class="muted">vs</span> ${koSide(om.away, om.away_slot)}`;
}
// Marcador oficial de un cruce ya jugado: "0–1" y, si se decidió en la tanda,
// "0–1 (pen 3–4)". "" si el cruce todavía no se ha jugado.
function koScoreText(om) {
  if (!om || om.hg == null || om.ag == null) return "";
  const pen = om.pen ? ` (pen ${om.pen.home}–${om.pen.away})` : "";
  return `${om.hg}–${om.ag}${pen}`;
}

// Chips enlazadas a la ficha de cada participante.
const chipList = (nicks) => nicks.map((n) =>
  `<a class="chip" href="?nick=${encodeURIComponent(n)}">${esc(n)}</a>`).join(" ");

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
    if (om.round !== lastRound) {
      // Al cambiar de ronda, cierra la anterior con su "top players" + estadísticas.
      if (lastRound !== null) html += koRoundFooter(ctx, lastRound);
      html += `<h3>${ROUND_LABEL[om.round] || om.round}</h3>`;
      lastRound = om.round;
    }
    const dist = koMatchDistribution(ctx.predictions, mid);
    const played = om.hg != null && om.ag != null && om.qualified;
    html += `<a class="match-link" href="?komatch=${mid}">
      <span class="ml-fix">${koFixtureLabel(om)}</span>
      ${koDistBar(dist.qualifiers)}
      <span class="ml-meta muted">${played ? `${koScoreText(om)} · pasa ${esc(teamName(om.qualified))}` : `${dist.total} pred.`}</span></a>`;
  }
  if (lastRound !== null) html += koRoundFooter(ctx, lastRound);
  $app.innerHTML = html;
}

// Pie de una ronda en la lista de eliminatoria: si la ronda aún no se ha jugado pero ya
// tiene equipos (p. ej. cuartos), las PRE-estadísticas de equipos más/menos seguidos; y,
// cuando hay resultados, el "top de puntos", el "top acertantes" y las estadísticas.
function koRoundFooter(ctx, round) {
  return koPreStatsPanel(ctx, round) + koRoundPointsPanel(ctx, round) + koRoundLeadersPanel(ctx, round) + koRoundStatsPanel(ctx, round);
}

// PRE-estadísticas de una ronda todavía sin jugar (equipos ya definidos): a cuántos
// participantes "sigue" cada equipo (cuántos lo tienen vivo en su cuadro a esta altura),
// con el más y el menos seguido destacados. "" si la ronda no aplica (ya jugada o sin
// equipos aún). Solo se ve, por ahora, en cuartos.
function koPreStatsPanel(ctx, round) {
  const data = koRoundFollowers(ctx.predictions, ctx.official, round);
  if (!data || !data.teams.length) return "";
  const max = data.teams[0].count, min = data.teams[data.teams.length - 1].count;
  const most = data.teams.filter((t) => t.count === max).map((t) => teamName(t.id));
  const least = data.teams.filter((t) => t.count === min).map((t) => teamName(t.id));
  const rows = data.teams.map((t) => {
    // Segmentos relativos al equipo MÁS seguido, para comparar barras entre equipos.
    const advW = max ? (t.advance.length / max) * 100 : 0;
    const elimW = max ? (t.eliminate.length / max) * 100 : 0;
    const tip = `Pasa (${t.advance.length}): ${t.advance.join(", ") || "—"}  ·  Cae (${t.eliminate.length}): ${t.eliminate.join(", ") || "—"}`;
    return `<div class="ps-row" title="${esc(tip)}">
      <span class="ps-team">${esc(teamName(t.id))}</span>
      <span class="ps-bar"><span class="ps-adv" style="width:${advW}%"></span><span class="ps-elim" style="width:${elimW}%"></span></span>
      <span class="ps-n">
        <span>${t.count}<span class="muted">/${data.total}</span></span>
        <span class="ps-split"><span class="ps-adv-t">${t.advance.length}▲</span> <span class="ps-elim-t">${t.eliminate.length}▼</span></span>
      </span>
    </div>`;
  }).join("");
  const s = (arr) => (arr.length > 1 ? "s" : "");
  return `<div class="prestats">
    <p class="prestats-h">🔮 Pre-estadísticas de ${ROUND_LABEL[round] || round}
      <span class="muted">· a cuántos de los ${data.total} participantes “sigue” cada equipo (lo metieron en ${(ROUND_LABEL[round] || round).toLowerCase()} en su quiniela)</span></p>
    <p class="ps-legend muted"><span class="ps-adv-t">▲ verde</span>: apuestan que <strong>pasa</strong> su cruce · <span class="ps-elim-t">▼ rojo</span>: que <strong>cae</strong>.</p>
    <div class="ps-list">${rows}</div>
    <p class="ps-extremes">🔥 Más seguido${s(most)}: <strong>${most.map(esc).join(" · ")}</strong> <span class="muted">(${max}/${data.total})</span>
      · 🥶 Menos seguido${s(least)}: <strong>${least.map(esc).join(" · ")}</strong> <span class="muted">(${min}/${data.total})</span></p>
  </div>`;
}

// Puntos que cada participante sacó DE ESTA FASE, combinando cuadro + pase:
//   · cuadro  = puntos de los cruces ya resueltos de la ronda (equipos + marcador +
//               quién pasa), tal cual los da el motor en breakdown.koDetails.
//   · prog    = incremento del bonus de progresión que generan estos partidos, es
//               decir, sus equipos que superan la ronda y avanzan a la siguiente
//               (vía progressionRoundIncrement).
// Solo cuenta cruces ya jugados, así que la tabla se actualiza partido a partido.
// `null` si la ronda aún no tiene ningún cruce resuelto.
function koRoundPointLeaders(ctx, round) {
  const off = ctx.official.knockout;
  const resolvedMids = Object.keys(off).filter((mid) => {
    const m = off[mid];
    return m.round === round && m.hg != null && m.ag != null && m.qualified;
  });
  if (!resolvedMids.length) return null;
  const r = ctx.rules.progression_bonus;
  const rows = ctx.board.map((s) => {
    let cuadro = 0;
    for (const mid of resolvedMids) cuadro += (s.breakdown.koDetails[mid] || {}).points || 0;
    let prog = 0;
    for (const t of s.breakdown.progression.teams) prog += progressionRoundIncrement(t.credited, round, r);
    if (round === "FINAL") prog += s.breakdown.progression.extraPoints || 0;   // 3.º/4.º puesto
    return { nick: s.nick, cuadro, prog, points: cuadro + prog };
  }).filter((x) => x.points > 0)
    .sort((a, b) => b.points - a.points || b.cuadro - a.cuadro || a.nick.localeCompare(b.nick));
  let lastPts = null, place = 0;
  rows.forEach((r) => { if (r.points !== lastPts) { place++; lastPts = r.points; } r.place = place; });
  return { round, leaders: rows, resolved: resolvedMids.length };
}

// "Top de puntos" de una fase de eliminatoria: quién sacó más puntos de la ronda
// (cuadro + progresión). Se pinta igual debajo de la lista de partidos de la fase y en
// la ficha de cada usuario. `highlightNick` resalta su fila y, si queda fuera del top 8,
// añade su fila al final con su puesto real. "" mientras la ronda no tenga cruce resuelto.
function koRoundPointsPanel(ctx, round, highlightNick = null) {
  const data = koRoundPointLeaders(ctx, round);
  if (!data || !data.leaders.length) return "";
  const koRow = (r) => {
    const medal = r.place <= 3 ? KO_MEDAL[r.place - 1] : (r.place <= 8 ? "•" : "#" + r.place);
    const detail = r.prog > 0 ? `cuadro ${r.cuadro} · prog +${r.prog}` : `cuadro ${r.cuadro}`;
    const me = r.nick === highlightNick ? " kolead-me" : "";
    return `<a class="mover kolead-row${me}" href="?nick=${encodeURIComponent(r.nick)}">
      <span class="kolead-m">${medal}</span> ${esc(r.nick)}
      <b class="kolead-n">${r.points}</b> <span class="kolead-d muted">${detail}</span></a>`;
  };
  const meIdx = highlightNick ? data.leaders.findIndex((r) => r.nick === highlightNick) : -1;
  const items = data.leaders.slice(0, 8).map(koRow).join("")
    + (meIdx >= 8 ? `<span class="kolead-gap muted">…</span>` + koRow(data.leaders[meIdx]) : "");
  const cruces = `${data.resolved} ${data.resolved === 1 ? "cruce" : "cruces"}`;
  return `<div class="kolead">
    <p class="kolead-h">🏆 Top de puntos de ${ROUND_LABEL[round] || round}
      <span class="muted">· cuadro + progresión · ${cruces}</span></p>
    <div class="movers">${items}</div></div>`;
}

// Réplica del "Top de puntos" fase a fase en la ficha de un usuario, con su fila
// resaltada: para que cada participante vea lo mismo que en la vista de eliminatorias,
// contextualizado a él. "" si aún no hay ninguna fase con partidos jugados.
function koUserPhaseBreakdown(ctx, nick) {
  const rounds = [];
  for (const mid of Object.keys(ctx.official.knockout).sort((a, b) => Number(a.slice(1)) - Number(b.slice(1)))) {
    const rd = ctx.official.knockout[mid].round;
    if (!rounds.includes(rd)) rounds.push(rd);
  }
  return rounds.map((rd) => koRoundPointsPanel(ctx, rd, nick)).filter(Boolean).join("");
}

// "Top players" de una fase de eliminatoria: los participantes que más equipos que
// pasan llevan acertados en esa ronda (sobre los cruces ya resueltos). Se pinta debajo
// de la lista de partidos de cada ronda y se repite fase a fase. "" mientras la ronda
// no tenga ningún cruce decidido. Medalla por puesto (empates comparten medalla).
const KO_MEDAL = ["🥇", "🥈", "🥉"];
function koRoundLeadersPanel(ctx, round) {
  const data = koRoundQualifierLeaders(ctx.predictions, ctx.official, round);
  if (!data || !data.leaders.length) return "";
  let lastHits = null, place = 0;
  const items = data.leaders.slice(0, 8).map((r) => {
    if (r.hits !== lastHits) { place++; lastHits = r.hits; }
    const medal = place <= 3 ? KO_MEDAL[place - 1] : "•";
    return `<a class="mover kolead-row" href="?nick=${encodeURIComponent(r.nick)}">
      <span class="kolead-m">${medal}</span> ${esc(r.nick)}
      <b class="kolead-n">${r.hits}/${data.resolved}</b></a>`;
  }).join("");
  const cruces = `${data.resolved} ${data.resolved === 1 ? "cruce resuelto" : "cruces resueltos"}`;
  const perfect = data.perfect
    ? ` · <span class="kolead-perfect">🎯 ${data.perfect} con pleno (${data.resolved}/${data.resolved})</span>` : "";
  return `<div class="kolead">
    <p class="kolead-h">🏅 Top acertantes de ${ROUND_LABEL[round] || round}
      <span class="muted">· quién pasa · ${cruces}${perfect}</span></p>
    <div class="movers">${items}</div></div>`;
}

// Estadísticas destacadas de una ronda, debajo del "Top acertantes": la sorpresa
// (a qué eliminado respaldaba más gente), y los plenos de cruces y marcadores
// exactos. "" mientras la ronda no tenga ningún cruce resuelto o nada que destacar.
function koRoundStatsPanel(ctx, round) {
  const s = koRoundStats(ctx.predictions, ctx.official, round);
  if (!s) return "";
  const blocks = [];

  // Sorpresas: cruces donde la multitud más respaldó al que acabó cayendo.
  const surprises = s.surprises.filter((x) => x.backedPct >= 50).slice(0, 3);
  if (surprises.length) {
    const rows = surprises.map((x) =>
      `<a class="kostat-row" href="?komatch=${x.matchId}">
        <span class="kostat-face">😱</span>
        <span class="kostat-txt"><strong>${esc(teamName(x.eliminated))}</strong> eliminado
          <span class="muted">— lo daban clasificado el ${x.backedPct}% · pasó ${esc(teamName(x.qualified))}</span></span></a>`).join("");
    blocks.push(`<div class="kostat-block"><p class="kostat-h">😱 La sorpresa de la ronda</p>${rows}</div>`);
  }

  // Cruces exactos (ambos equipos) y marcadores exactos: podios de participantes.
  const podium = (rows, verb) => rows.slice(0, 5).map((r) =>
    `<a class="mover" href="?nick=${encodeURIComponent(r.nick)}">${esc(r.nick)} <b>${r.hits}</b></a>`).join("") ||
    `<span class="muted">Nadie ${verb} todavía.</span>`;
  if (s.exactFixtures.length)
    blocks.push(`<div class="kostat-block"><p class="kostat-h">🤝 Más cruces exactos
      <span class="muted">(ambos equipos, de ${s.resolved})</span></p>
      <div class="movers">${podium(s.exactFixtures, "acertó un cruce")}</div></div>`);
  if (s.exactScores.length)
    blocks.push(`<div class="kostat-block"><p class="kostat-h">🎯 Más marcadores exactos
      <span class="muted">(de ${s.resolved})</span></p>
      <div class="movers">${podium(s.exactScores, "clavó un marcador")}</div></div>`);

  if (!blocks.length) return "";
  return `<div class="kostats">
    <p class="kostats-h">📊 Estadísticas de ${ROUND_LABEL[round] || round}</p>
    ${blocks.join("")}</div>`;
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
      <span class="muted">${ROUND_LABEL[om.round] || om.round} · ${esc(om.home_slot)} vs ${esc(om.away_slot)}${played ? ` · oficial ${koScoreText(om)}` : " · por jugar"}</span></div>
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
    html += `<h3>Cruces pronosticados <span class="muted">(${dist.fixtures.length})</span></h3>
      <ul class="ko-people">${dist.fixtures.map((f) =>
        `<li><div class="kp-head"><span>${esc(teamName(f.home))} <span class="muted">vs</span> ${esc(teamName(f.away))}</span><b>${f.count} (${f.pct}%)</b></div>
          <div class="kp-who">${chipList(f.nicks)}</div></li>`).join("")}</ul>`;

  if (dist.exactScores.length)
    html += `<h3>Marcadores más comunes</h3>
      <ul class="ko-people">${dist.exactScores.slice(0, 6).map((s) =>
        `<li><div class="kp-head"><span>${s.score}</span><b>${s.count} (${s.pct}%)</b></div>
          <div class="kp-who">${chipList(s.nicks)}</div></li>`).join("")}</ul>`;

  if (played && heroes) {
    html += `<h2 class="section">Resultado oficial: ${koScoreText(om)} <span class="muted">· pasa ${esc(teamName(om.qualified))}</span></h2>
      <ul class="kv">
        <li><span>Acertaron quién pasa</span><b>${heroes.qualHits} / ${heroes.total}</b></li>
        <li><span>Acertaron el cruce (ambos equipos)</span><b>${heroes.fixtureHits} / ${heroes.total}</b></li>
        <li><span>Acertaron el marcador exacto</span><b>${heroes.exactHeroes.length} / ${heroes.total}</b></li>
      </ul>`;
    if (heroes.qualHeroes.length)
      html += `<p>✅ <strong>Acertaron quién pasa:</strong> ${chipList(heroes.qualHeroes)}</p>`;
    if (heroes.fixtureHeroes.length)
      html += `<p>🤝 <strong>Acertaron el cruce:</strong> ${chipList(heroes.fixtureHeroes)}</p>`;
    if (heroes.exactHeroes.length)
      html += `<p>🎯 <strong>Marcador exacto:</strong> ${chipList(heroes.exactHeroes)}</p>`;
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
      <li><b>+${ko.correct_home_team}</b> por acertar el equipo local del cruce y <b>+${ko.correct_away_team}</b> por el visitante <span class="muted">(máx. +${ko.correct_home_team + ko.correct_away_team} por tener los dos)</span></li>
      <li><b>Solo si aciertas el cruce completo</b> (los dos equipos), además: <b>+${ko.exact_score}</b> si clavas el marcador exacto, <b>o +${ko.correct_outcome}</b> si aciertas el resultado (1·X·2)</li>
      <li><b>+${ko.correct_qualified_team}</b> por acertar quién pasa de ronda <span class="muted">(cuenta aunque falles el cruce y el marcador)</span></li>
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
