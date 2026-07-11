// Test del visualizador (Fase 3): simula navegador (document/fetch/location) y
// comprueba que las tres vistas se renderizan. Ejecutar: node scripts/test_visualizer.mjs
import { readFileSync, existsSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");

let appHTML = "";
const appEl = { set innerHTML(v) { appHTML = v; }, get innerHTML() { return appHTML; } };
globalThis.document = { getElementById: (id) => (id === "app" ? appEl : null), title: "" };
globalThis.fetch = async (url) => {
  // El oficial vivo (data/official/results.txt) cambia según se juegan partidos;
  // los tests congelan el estado de arranque (oficial en blanco) con un fixture
  // para no romperse cada vez que el admin registra un resultado.
  const rel = url.replace(/^\.\//, "");
  const path = /official\/results\.txt$/.test(rel)
    ? join(root, "scripts", "fixtures", "official_launch.txt")
    : join(root, rel);
  if (!existsSync(path)) return { ok: false, status: 404 };
  const text = readFileSync(path, "utf8");
  return { ok: true, status: 200, json: async () => JSON.parse(text), text: async () => text };
};

let pass = 0, fail = 0;
const has = (html, needle, msg) => (html.includes(needle) ? pass++ :
  (fail++, console.error(`  ✗ ${msg} — no contiene ${JSON.stringify(needle)}`)));
const not = (html, needle, msg) => (!html.includes(needle) ? pass++ :
  (fail++, console.error(`  ✗ ${msg} — no debería contener ${JSON.stringify(needle)}`)));

async function route(search) {
  globalThis.location = { search };
  appHTML = "";
  await import(`../js/visualizer.js?${Date.now()}-${Math.random()}`);
  for (let i = 0; i < 400 && /Cargando/.test(appHTML); i++) await new Promise((r) => setTimeout(r, 5));
  return appHTML;
}

const home = await route("");
has(home, "Clasificación general", "home: título");
has(home, "Marcus", "home: participante");
has(home, "Competición por pools", "home: sección pools");
has(home, "Quinielas panda", "home: pool elegible");
has(home, "?nick=Marcus", "home: enlace a detalle");

const pool = await route("?pool=quinielas_panda");
has(pool, "Quinielas panda", "pool: nombre");
has(pool, "Media / activo", "pool: tarjeta media");
has(pool, "Miembros", "pool: sección miembros");

const user = await route("?nick=Marcus");
has(user, "Desglose", "user: desglose");
has(user, "Marcadores exactos", "user: detalles");
has(user, "Grupo A", "user: partido a partido");
has(user, "México", "user: nombres de equipo");

has(home, "Estadísticas del torneo", "home: panel de stats");
has(home, "Campeón más votado", "home: campeón más votado");
not(home, "Movimiento", "home: sin sección de movimiento (no hay snapshot al arrancar)");
not(home, "Las predicciones se cerraron", "home: sin banner de fecha límite ya cerrada");
not(home, "Simulación", "home: sin aviso de simulación (meta.simulation:false)");
has(home, "El torneo aún no ha empezado", "home: banner de torneo sin resultados oficiales");
has(home, "¡El torneo da comienzo!", "home: mensaje de bienvenida de arranque");
has(home, "Feliz Mundial 2026", "home: saludo de bienvenida");
if (home.includes("SPEC 0")) { fail++; console.error("  ✗ home: NO debe mostrar 'SPEC 0x'"); } else pass++;
if (/de la peña|la peña/.test(home)) { fail++; console.error("  ✗ home: NO debe contener 'la peña'"); } else pass++;

const matches = await route("?view=matches");
has(matches, "Partidos · Fase de grupos", "matches: título");
has(matches, "Grupo A", "matches: grupos");
has(matches, "?match=A_01", "matches: enlace a detalle de partido");
has(matches, "dist-seg", "matches: barra de distribución");

const koMatches = await route("?view=ko-matches");
has(koMatches, "Partidos · Fase eliminatoria", "ko-matches: título");
has(koMatches, "Dieciseisavos", "ko-matches: ronda R32");
has(koMatches, "Final", "ko-matches: ronda final");
has(koMatches, "?komatch=M73", "ko-matches: enlace a detalle de cruce");
has(koMatches, "dist-seg", "ko-matches: barra de clasificados");
has(koMatches, "Estadísticas de gala", "ko-matches: módulo de curiosidades al final");
has(koMatches, "Rey del gol", "ko-matches: premio del módulo de curiosidades");

const koMatch = await route("?komatch=M73");
has(koMatch, "¿Quién pasa?", "ko-match: distribución de clasificados");
has(koMatch, "Cruces más pronosticados", "ko-match: top cruces");
has(koMatch, "por jugar", "ko-match: cruce aún sin jugar");
not(koMatch, "Resultado oficial", "ko-match: sin resumen post-partido (no jugado)");

const match = await route("?match=A_01");
has(match, "Distribución de predicciones", "match: distribución");
has(match, "Marcadores más comunes", "match: top marcadores");
has(match, "por jugar", "match: partido aún sin jugar (sin resultado oficial)");
not(match, "Resultado oficial", "match: sin resumen post-partido (no jugado)");

const mover = await route("?nick=Carlos-Seco");
not(mover, "Movimiento", "user: sin tarjeta de movimiento (no hay snapshot al arrancar)");

const scoring = await route("?view=scoring");
has(scoring, "Cómo se puntúa", "scoring: título");
has(scoring, "Partidos de grupo", "scoring: bloque grupos");
has(scoring, "Bonus de progresión", "scoring: bloque progresión");
has(scoring, "11 de junio de 2026", "scoring: fecha límite");
has(scoring, "+25", "scoring: valor de campeón desde rules");

const err = await route("?nick=noexiste");
has(err, "no encontrado", "error: nick inexistente");

console.log(`\nvisualizer: ${pass} OK, ${fail} fallos`);
process.exit(fail ? 1 : 0);
