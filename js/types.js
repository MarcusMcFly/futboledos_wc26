// Modelo de datos compartido entre el visualizador (cliente) y el merge flow (admin).
// Solo documentacion via JSDoc — no hay build ni chequeo de tipos. Las tres fuentes
// de verdad viven en /data y se publican via GitHub Pages.

/**
 * @typedef {Object} CatalogOption
 * @property {string} id        ID canonico usado en submissions y results. Ej: "winner_real_madrid".
 * @property {string} category  Categoria. Ej: "Winner", "TopScorer".
 * @property {boolean} exclusive Si true, solo una opcion de esta categoria puede ser correcta;
 *                               el visualizador resalta como contradictorias las predicciones
 *                               que compartan categoria exclusive=true. (Spec 10)
 * @property {string} label     Texto legible para la UI. Ej: "Real Madrid".
 */

/**
 * catalog.json — opciones oficiales + deadline de cierre.
 * @typedef {Object} Catalog
 * @property {string} version    "POOL_CATALOG_V1"
 * @property {string} event
 * @property {string} closes_at  ISO 8601. Tras esta fecha el merge rechaza y la UI deshabilita el form. (Spec 5.4)
 * @property {CatalogOption[]} options
 */

/**
 * Un participante ya mergeado (participants.json).
 * @typedef {Object} Participant
 * @property {string} nickname
 * @property {string} [pool_name]   Opcional: un nickname puede estar en varios pools. (Spec 8)
 * @property {string} submitted_at  Generado por el cliente. Informativo, NO autoritativo. (Spec 5.2)
 * @property {string[]} predictions IDs del catalogo oficial.
 */

/**
 * participants.json — generado por merge_submissions.py, nunca a mano.
 * @typedef {Object} ParticipantsFile
 * @property {string} generated_at
 * @property {Participant[]} participants
 */

/**
 * results.json — resultados oficiales publicados por el admin tras el evento. (Spec 10)
 * @typedef {Object} Results
 * @property {string[]} confirmed_outcomes  IDs del catalogo que se confirmaron como ciertos.
 */

/**
 * Resultado del scoring calculado en cliente, en tiempo de render.
 * @typedef {Participant & { score: number, hits: string[], contradictions: string[][] }} ScoredParticipant
 */

export {};
