// Generacion y validacion en cliente del bloque POOL_SUBMISSION_V1. (Spec 5.2)
// El mismo regex/formato debe ser replicado por merge_submissions.py (admin).
// @ts-check
/** @typedef {import("./types.js").Catalog} Catalog */

export const SUBMISSION_BEGIN = "POOL_SUBMISSION_V1";
export const SUBMISSION_END = "END_POOL_SUBMISSION";

const NAME_CHARS = /^[a-zA-Z0-9_\-]+$/;

/**
 * @typedef {Object} DraftSubmission
 * @property {string} nickname
 * @property {string} [pool_name]
 * @property {string[]} predictions
 */

/**
 * Reglas de validacion del cliente. (Spec 5.2)
 * @param {DraftSubmission} draft
 * @param {Catalog} catalog
 * @returns {{ ok: boolean, errors: string[] }}
 */
export function validateSubmission(draft, catalog) {
  /** @type {string[]} */
  const errors = [];
  const nick = (draft.nickname ?? "").trim();

  if (nick.length < 2 || nick.length > 30) {
    errors.push("nickname: requerido, 2–30 caracteres.");
  } else if (!NAME_CHARS.test(nick)) {
    errors.push("nickname: solo se permiten [a-zA-Z0-9_-].");
  }

  const pool = (draft.pool_name ?? "").trim();
  if (pool) {
    if (pool.length > 40) errors.push("pool_name: maximo 40 caracteres.");
    else if (!NAME_CHARS.test(pool))
      errors.push("pool_name: solo se permiten [a-zA-Z0-9_-].");
  }

  if (!draft.predictions || draft.predictions.length < 1) {
    errors.push("predictions: al menos 1 prediccion.");
  } else {
    const validIds = new Set(catalog.options.map((o) => o.id));
    const unknown = draft.predictions.filter((id) => !validIds.has(id));
    if (unknown.length) {
      errors.push(`predictions: IDs fuera del catalogo: ${unknown.join(", ")}`);
    }
  }

  return { ok: errors.length === 0, errors };
}

/**
 * Genera el bloque integro POOL_SUBMISSION_V1 ... END_POOL_SUBMISSION.
 * submitted_at se genera en el dispositivo del usuario (informativo). (Spec 5.2)
 * El bloque debe copiarse completo; validar antes de mostrarlo.
 * @param {DraftSubmission} draft
 * @returns {string}
 */
export function generateSubmissionBlock(draft) {
  const lines = [SUBMISSION_BEGIN, `nickname: ${draft.nickname.trim()}`];
  if (draft.pool_name && draft.pool_name.trim()) {
    lines.push(`pool_name: ${draft.pool_name.trim()}`);
  }
  lines.push(`submitted_at: ${new Date().toISOString()}`);
  lines.push("predictions:");
  for (const id of draft.predictions) {
    lines.push(`  - ${id}`);
  }
  lines.push(SUBMISSION_END);
  return lines.join("\n");
}

/**
 * True si el deadline de catalog.closes_at ya paso (cierra el form). (Spec 5.4)
 * @param {Catalog} catalog
 * @param {Date} [now]
 * @returns {boolean}
 */
export function isClosed(catalog, now = new Date()) {
  return now.getTime() >= new Date(catalog.closes_at).getTime();
}
