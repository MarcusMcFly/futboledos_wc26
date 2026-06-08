// Parser del bloque de texto FUTBOLEDOS_PRED_V1 (lo que exporta predicciones.html)
// hacia un objeto estructurado para puntuar (SPEC 06). Sirve igual para las
// predicciones de los participantes y para los resultados oficiales.
//
// Tolerante con predicciones incompletas: goles "-" → null (pendiente / sin
// predecir); secciones de eliminatoria que aún no existen → knockoutPending.
// @ts-check

/** Convierte un token de goles a número, o null si es "-" / inválido. */
function num(s) {
  if (s === undefined || s === "-" || s === "?") return null;
  return /^\d+$/.test(s) ? Number(s) : null;
}

/** Normaliza un team_id: "-" o "?" (slot sin resolver) → null. */
function teamId(s) {
  return s === undefined || s === "-" || s === "?" ? null : s;
}

const KO_SECTIONS = new Set([
  "DIECISEISAVOS", "OCTAVOS", "CUARTOS", "SEMIS", "TERCER_PUESTO", "FINAL",
]);

/**
 * @typedef {Object} GroupMatchPred  { home, away, hg, ag }  (hg/ag pueden ser null)
 * @typedef {Object} KnockoutPred     { round, home_slot, away_slot, home, away, hg, ag, qualified, pen }
 * @typedef {Object} ParsedPrediction
 * @property {string|null} version
 * @property {string|null} nick
 * @property {string|null} pool
 * @property {string|null} generadoAt
 * @property {Record<string, GroupMatchPred>} groupMatches   clave = match_id (A_01…L_06)
 * @property {Record<string, string[]>} groupOrder           clave = grupo → [id 1º,2º,3º,4º]
 * @property {Record<string, boolean>} tiebreakManual        clave = grupo → ¿desempate manual?
 * @property {Record<string, boolean>} groupUnresolved       clave = grupo → ¿empate sin resolver?
 * @property {string|null} thirdsKey                         clave de 8 grupos terceros (p.ej. "ABCEFGHI")
 * @property {{group:string,id:string}[]} thirdsQualified
 * @property {Record<string, KnockoutPred>} knockout         clave = id FIFA (M73…M104)
 * @property {boolean} knockoutPending
 * @property {string|null} champion
 */

/**
 * @param {string} text
 * @returns {ParsedPrediction}
 */
export function parsePrediction(text) {
  /** @type {ParsedPrediction} */
  const out = {
    version: null, nick: null, pool: null, generadoAt: null,
    groupMatches: {}, groupOrder: {}, tiebreakManual: {}, groupUnresolved: {},
    thirdsKey: null, thirdsQualified: [],
    knockout: {}, knockoutPending: false, champion: null,
  };

  const lines = String(text).replace(/\r/g, "").split("\n");
  let section = null;

  for (const raw of lines) {
    const line = raw.trim();
    if (!line) continue;

    if (line.startsWith("FUTBOLEDOS_PRED_")) { out.version = line; continue; }
    if (line.startsWith("END_")) break;

    let m;
    if ((m = line.match(/^nick:\s*(.*)$/))) { out.nick = m[1] === "-" ? null : m[1]; continue; }
    if ((m = line.match(/^pool:\s*(.*)$/))) { out.pool = m[1] === "-" ? null : m[1]; continue; }
    if ((m = line.match(/^generado:\s*(.*)$/))) { out.generadoAt = m[1] || null; continue; }
    if (/^partidos:/.test(line)) continue;
    if (/^pool_url:|^clasificacion:/.test(line)) continue;

    if ((m = line.match(/^\[(.+)\]$/))) { section = m[1]; continue; }

    if ((m = line.match(/^terceros_clave:\s*(.*)$/))) { out.thirdsKey = m[1].trim() || null; continue; }
    if ((m = line.match(/^terceros_clasificados:\s*(.*)$/))) {
      const rest = m[1].trim();
      out.thirdsQualified = rest
        ? rest.split(/\s+/).map((t) => { const [group, id] = t.split(":"); return { group, id }; })
        : [];
      continue;
    }
    if (/^r32_completados:|^completados:/.test(line)) continue;
    if ((m = line.match(/^campeon:\s*(.*)$/))) { out.champion = teamId(m[1].trim()); continue; }
    if (/^pendiente:|^error:/.test(line)) { out.knockoutPending = true; continue; }

    const p = line.split(/\s+/);

    if (section === "PARTIDOS") {
      // A_01 MX 5 0 ZA
      if (p.length >= 5) {
        out.groupMatches[p[0]] = { home: p[1], away: p[4], hg: num(p[2]), ag: num(p[3]) };
      }
      continue;
    }

    if (section === "CLASIFICACION") {
      // J 1:AR 2:DZ 3:AT 4:JO tb:manual (empate sin resolver)
      const grp = p[0];
      const order = [];
      let manual = false, unresolved = false;
      for (let i = 1; i < p.length; i++) {
        const tok = p[i];
        if (tok === "tb:manual") { manual = true; continue; }
        if (tok.startsWith("(")) { if (/empate/i.test(line)) unresolved = true; break; }
        const mm = tok.match(/^(\d+):(.+)$/);
        if (mm) order[Number(mm[1]) - 1] = mm[2];
      }
      out.groupOrder[grp] = order.filter(Boolean);
      out.tiebreakManual[grp] = manual;
      out.groupUnresolved[grp] = unresolved;
      continue;
    }

    if (KO_SECTIONS.has(section) && /^M\d+$/.test(p[0]) && p.length >= 7) {
      // M73 2A 2B AR 2 1 DZ q:AR pen:4-3
      let qualified = null, pen = null;
      for (let i = 7; i < p.length; i++) {
        if (p[i].startsWith("q:")) qualified = teamId(p[i].slice(2));
        else if (p[i].startsWith("pen:")) {
          const [ph, pa] = p[i].slice(4).split("-").map(Number);
          if (Number.isFinite(ph) && Number.isFinite(pa)) pen = { home: ph, away: pa };
        }
      }
      out.knockout[p[0]] = {
        round: section, home_slot: p[1], away_slot: p[2],
        home: teamId(p[3]), away: teamId(p[6]), hg: num(p[4]), ag: num(p[5]),
        qualified, pen,
      };
      continue;
    }
  }

  return out;
}
