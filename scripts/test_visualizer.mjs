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
  const path = join(root, url.replace(/^\.\//, ""));
  if (!existsSync(path)) return { ok: false, status: 404 };
  const text = readFileSync(path, "utf8");
  return { ok: true, status: 200, json: async () => JSON.parse(text), text: async () => text };
};

let pass = 0, fail = 0;
const has = (html, needle, msg) => (html.includes(needle) ? pass++ :
  (fail++, console.error(`  ✗ ${msg} — no contiene ${JSON.stringify(needle)}`)));

async function route(search) {
  globalThis.location = { search };
  appHTML = "";
  await import(`../js/visualizer.js?${Date.now()}-${Math.random()}`);
  for (let i = 0; i < 400 && /Cargando/.test(appHTML); i++) await new Promise((r) => setTimeout(r, 5));
  return appHTML;
}

const home = await route("");
has(home, "Clasificación general", "home: título");
has(home, "Di_mario", "home: participante");
has(home, "Competición por pools", "home: sección pools");
has(home, "Medris 56", "home: pool elegible");
has(home, "?nick=Di_mario", "home: enlace a detalle");

const pool = await route("?pool=medris_56");
has(pool, "Medris 56", "pool: nombre");
has(pool, "Media / activo", "pool: tarjeta media");
has(pool, "Miembros", "pool: sección miembros");

const user = await route("?nick=Di_mario");
has(user, "Desglose", "user: desglose");
has(user, "Marcadores exactos", "user: detalles");
has(user, "Grupo A", "user: partido a partido");
has(user, "México", "user: nombres de equipo");

has(home, "Estadísticas del torneo", "home: panel de stats");
has(home, "Campeón más votado", "home: campeón más votado");
has(home, "Movimiento", "home: sección de movimiento (hay snapshot)");
has(home, "▼1", "home: ivancalle10 baja 1 desde el snapshot A-H");
has(home, "●", "home: indicador de participante nuevo (no estaba en el snapshot)");
has(home, "Las predicciones se cierran el 11 de junio de 2026", "home: banner de fecha límite");
has(home, "a las 21:00", "home: banner de fecha límite con hora");
has(home, "Simulación", "home: aviso de simulación (meta.simulation)");
if (home.includes("SPEC 0")) { fail++; console.error("  ✗ home: NO debe mostrar 'SPEC 0x'"); } else pass++;
if (/de la peña|la peña/.test(home)) { fail++; console.error("  ✗ home: NO debe contener 'la peña'"); } else pass++;

const matches = await route("?view=matches");
has(matches, "Predicciones por partido", "matches: título");
has(matches, "Grupo A", "matches: grupos");
has(matches, "?match=A_01", "matches: enlace a detalle de partido");
has(matches, "dist-seg", "matches: barra de distribución");

const match = await route("?match=A_01");
has(match, "Distribución de predicciones", "match: distribución");
has(match, "Marcadores más comunes", "match: top marcadores");
has(match, "Resultado oficial", "match: resumen post-partido (jugado)");
has(match, "Exact-score heroes", "match: heroes");

const mover = await route("?nick=Carlos-Seco");
has(mover, "Movimiento", "user: tarjeta de movimiento");

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
