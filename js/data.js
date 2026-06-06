// Carga de las fuentes de verdad estaticas desde /data (rutas relativas).
// Cada fetch puede fallar (red, JSON invalido) -> la UI muestra estado de error.
// @ts-check
/** @typedef {import("./types.js").Catalog} Catalog */
/** @typedef {import("./types.js").ParticipantsFile} ParticipantsFile */
/** @typedef {import("./types.js").Results} Results */

/**
 * @template T
 * @param {string} file
 * @returns {Promise<T>}
 */
async function loadJson(file) {
  // Ruta relativa: funciona igual en la raiz o en subcarpeta de GitHub Pages.
  const res = await fetch(`./data/${file}`, { cache: "no-store" });
  if (!res.ok) {
    throw new Error(`No se pudo cargar ${file} (HTTP ${res.status}).`);
  }
  return /** @type {Promise<T>} */ (res.json());
}

/** @returns {Promise<Catalog>} */
export const loadCatalog = () => loadJson("catalog.json");
/** @returns {Promise<ParticipantsFile>} */
export const loadParticipants = () => loadJson("participants.json");
/** @returns {Promise<Results>} */
export const loadResults = () => loadJson("results.json");
/** @returns {Promise<{ groups: import("./standings.js").Group[] }>} */
export const loadGroups = () => loadJson("groups.json");
